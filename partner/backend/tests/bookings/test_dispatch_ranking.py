"""The ranking engine on its own: pure functions, no database."""

import uuid

import pytest

from app.core.config import InsecureConfigurationError, Settings, validate_dispatch_settings
from app.modules.bookings.dispatch_ranking import CandidateMetrics, RankingConfig, rank_candidates, score_candidate

RADIUS = 5000.0


def config(**overrides) -> RankingConfig:
    return RankingConfig.from_settings(Settings(**overrides))


def candidate(**values) -> CandidateMetrics:
    values.setdefault("technician_id", uuid.uuid4())
    values.setdefault("distance_meters", 1000.0)
    values.setdefault("location_accuracy_meters", 10.0)
    return CandidateMetrics(**values)


def test_weights_are_normalised_by_their_sum():
    weights = config(
        dispatch_weight_distance=3,
        dispatch_weight_rating=1,
        dispatch_weight_availability=0,
        dispatch_weight_acceptance=0,
        dispatch_weight_completion=0,
        dispatch_weight_cancellation=0,
        dispatch_weight_experience=0,
        dispatch_weight_fairness=0,
    ).weights
    assert weights["distance"] == pytest.approx(0.75) and weights["rating"] == pytest.approx(0.25)
    assert sum(weights.values()) == pytest.approx(1.0)


def test_every_metric_is_normalised_into_zero_to_one():
    extremes = [
        candidate(
            distance_meters=0,
            rating_average=5.0,
            rating_count=500,
            offers_answered=500,
            offers_accepted=500,
            jobs_completed=500,
            experience_years=60,
            location_age_seconds=0,
        ),
        candidate(
            distance_meters=RADIUS * 3,
            rating_average=1.0,
            rating_count=500,
            offers_answered=500,
            jobs_completed=0,
            jobs_handed_back=500,
            offers_accepted=500,
            jobs_today=50,
            location_age_seconds=10_000,
            location_accuracy_meters=5000,
        ),
    ]
    for metrics in extremes:
        score, breakdown = score_candidate(metrics, radius_meters=RADIUS, use_eta=False, config=config())
        assert 0.0 <= score <= 1.0
        assert all(0.0 <= value <= 1.0 for value in breakdown["scores"].values()), breakdown


def test_a_poor_technician_does_not_win_by_standing_200_m_closer():
    poor = candidate(
        distance_meters=1000,
        rating_average=2.0,
        rating_count=20,
        offers_answered=20,
        offers_accepted=6,
        jobs_completed=4,
        jobs_handed_back=2,
    )
    good = candidate(
        distance_meters=1200,
        rating_average=4.8,
        rating_count=20,
        offers_answered=20,
        offers_accepted=18,
        jobs_completed=18,
    )
    ranked = rank_candidates([poor, good], radius_meters=RADIUS, config=config())
    assert ranked[0].technician_id == good.technician_id


def test_distance_decides_between_otherwise_identical_technicians():
    near = candidate(distance_meters=500)
    far = candidate(distance_meters=4000)
    assert rank_candidates([far, near], radius_meters=RADIUS, config=config())[0].technician_id == near.technician_id


def test_a_newcomer_is_neither_punished_nor_crowned():
    """Bayesian smoothing: one 5-star job is not better than forty 4.8-star ones,
    and no history at all sits near the prior rather than at zero."""
    one_lucky_job = candidate(rating_average=5.0, rating_count=1)
    proven = candidate(rating_average=4.8, rating_count=40)
    newcomer = candidate()
    scored = {
        name: score_candidate(metrics, radius_meters=RADIUS, use_eta=False, config=config())[1]["scores"]["rating"]
        for name, metrics in (("lucky", one_lucky_job), ("proven", proven), ("new", newcomer))
    }
    assert scored["proven"] > scored["lucky"]
    assert scored["new"] == pytest.approx((4.0 - 1) / 4)


def test_fairness_spreads_work_across_the_day():
    busy = candidate(jobs_today=6)
    idle = candidate(jobs_today=0)
    ranked = rank_candidates([busy, idle], radius_meters=RADIUS, config=config())
    assert ranked[0].technician_id == idle.technician_id


def test_a_fresh_precise_position_counts_as_more_available():
    fresh = candidate(location_age_seconds=1, location_accuracy_meters=8)
    shaky = candidate(location_age_seconds=13, location_accuracy_meters=600)
    ranked = rank_candidates([shaky, fresh], radius_meters=RADIUS, config=config())
    assert ranked[0].technician_id == fresh.technician_id


def test_ties_are_broken_deterministically_never_randomly():
    ids = sorted(uuid.uuid4() for _ in range(5))
    pool = [candidate(technician_id=technician_id, distance_meters=1000) for technician_id in reversed(ids)]
    first = [entry.technician_id for entry in rank_candidates(pool, radius_meters=RADIUS, config=config())]
    second = [
        entry.technician_id for entry in rank_candidates(list(reversed(pool)), radius_meters=RADIUS, config=config())
    ]
    assert first == second == sorted(ids, key=str)
    assert [entry.rank for entry in rank_candidates(pool, radius_meters=RADIUS, config=config())] == [1, 2, 3, 4, 5]


def test_eta_replaces_distance_only_when_every_candidate_has_one():
    """A batch is never scored on two scales: one missing ETA means distance for all."""
    a = candidate(distance_meters=1000, eta_seconds=900)  # close but slow (a river in the way)
    b = candidate(distance_meters=2000, eta_seconds=200)
    with_eta = rank_candidates([a, b], radius_meters=RADIUS, config=config())
    assert with_eta[0].technician_id == b.technician_id
    assert with_eta[0].breakdown["inputs"]["proximity_basis"] == "eta"

    c = candidate(distance_meters=3000, eta_seconds=None)
    mixed = rank_candidates([a, b, c], radius_meters=RADIUS, config=config())
    assert mixed[0].technician_id == a.technician_id
    assert all(entry.eta_seconds is None for entry in mixed)
    assert mixed[0].breakdown["inputs"]["proximity_basis"] == "straight_line_distance"


def test_the_breakdown_explains_the_score():
    ranked = rank_candidates(
        [candidate(distance_meters=1500, rating_average=4.5, rating_count=10)], radius_meters=RADIUS, config=config()
    )[0]
    breakdown = ranked.breakdown
    recomputed = sum(breakdown["scores"][name] * breakdown["weights"][name] for name in breakdown["scores"])
    assert recomputed == pytest.approx(ranked.score, abs=1e-3)
    assert breakdown["inputs"]["distance_meters"] == 1500.0


@pytest.mark.parametrize(
    "overrides",
    [
        {"location_persist_heartbeat_seconds": 20, "location_stale_threshold_seconds": 15},
        {"location_update_interval_seconds": 10, "location_stale_threshold_seconds": 15},
        {"dispatch_batch_size": 0},
        {"dispatch_candidate_pool_size": 2, "dispatch_batch_size": 3},
        {"dispatch_eta_provider": "google"},
        {"dispatch_weight_distance": -1},
    ],
)
def test_settings_that_would_break_dispatch_are_refused(overrides):
    with pytest.raises(InsecureConfigurationError):
        validate_dispatch_settings(Settings(**overrides))


def test_the_search_rings_widen_by_step_up_to_the_maximum():
    assert Settings(
        technician_search_radius_km=5, technician_search_radius_step_km=5, technician_max_search_radius_km=15
    ).search_radii_meters == [5000.0, 10000.0, 15000.0]
    assert Settings(
        technician_search_radius_km=2, technician_search_radius_step_km=5, technician_max_search_radius_km=10
    ).search_radii_meters == [2000.0, 7000.0, 10000.0]
