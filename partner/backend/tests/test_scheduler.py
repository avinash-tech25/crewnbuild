"""The scheduler unit (section 15.1, SC-01; R6, porting-todo #71): one active copy,
each job once across processes, a failing job never stops the others."""

from sqlalchemy import text

from app.database.session import engine
from app.jobs import run_scheduler
from app.jobs.scheduler import Job, Scheduler, lock_key, run_job_once, try_lock, unlock

SERVICE = "test-service"


def test_only_one_copy_is_active_and_a_standby_takes_over() -> None:
    first, second = Scheduler(engine, SERVICE, []), Scheduler(engine, SERVICE, [])
    assert first.become_leader()
    assert not second.become_leader()
    first.release()
    assert second.become_leader()
    second.release()


def test_a_job_running_elsewhere_is_skipped() -> None:
    ran: list[str] = []
    job = Job("sweep", 60, lambda: ran.append("ran"))
    with engine.connect() as elsewhere:  # a copy started by hand holds the job's lock
        assert try_lock(elsewhere, lock_key(SERVICE, "sweep"))
        assert run_job_once(engine, SERVICE, job) is False
        unlock(elsewhere, lock_key(SERVICE, "sweep"))
        elsewhere.commit()
    assert run_job_once(engine, SERVICE, job) is True
    assert ran == ["ran"]


def test_due_jobs_run_and_a_failure_never_stops_the_others() -> None:
    now = [1000.0]
    ran: list[str] = []

    def broken() -> None:
        raise RuntimeError("boom")

    jobs = [Job("broken", 60, broken), Job("fine", 30, lambda: ran.append("fine")), Job("off", 0, lambda: None)]
    scheduler = Scheduler(engine, SERVICE, jobs, clock=lambda: now[0])
    assert [job.name for job in scheduler.jobs] == ["broken", "fine"]  # interval 0: off
    assert scheduler.tick() == ["broken", "fine"]
    assert ran == ["fine"]
    now[0] += 31
    assert scheduler.tick() == ["fine"]  # broken is due again only after 60 s
    now[0] += 30
    assert scheduler.tick() == ["broken", "fine"]


def test_no_lock_is_left_behind() -> None:
    run_job_once(engine, SERVICE, Job("quick", 60, lambda: None))
    with engine.connect() as connection:
        held = connection.execute(text("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'")).scalar()
    assert held == 0


def test_the_partner_jobs() -> None:
    jobs = {job.name: job.interval_seconds for job in run_scheduler.build_jobs()}
    assert jobs == {"dispatch_sweep": 3.0, "face_capture_purge": 3600, "rate_limit_purge": 3600}


def test_the_api_no_longer_sweeps_and_the_scheduler_publishes_by_notify(monkeypatch) -> None:
    import importlib.util

    from app.modules.realtime.hub import RealtimeHub

    assert importlib.util.find_spec("app.modules.bookings.dispatch_worker") is None
    sent = []
    hub = RealtimeHub(engine, cross_process=False, channel="test_channel")
    monkeypatch.setattr(hub, "_notify", lambda topic, room, message: sent.append((topic, room, message)))
    hub.publish_from_outside()
    assert hub.relaying
    hub.publish("technician", "t-1", {"type": "job_request"})
    assert sent == [("technician", "t-1", {"type": "job_request"})]
