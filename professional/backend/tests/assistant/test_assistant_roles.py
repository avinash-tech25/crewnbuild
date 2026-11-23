"""Viswa for every signed-in role (phase 2): each role is offered only its own tools, never
reaches another user's records (same role or another role), other users' project ids are
refused, contact details are redacted, and an administrator gets help and counts only."""

import json
from datetime import date
from typing import Any

import pytest
from admin.helpers import create_admin, create_manager
from admin.helpers import signed_in as admin_signed_in
from conftest import ClientFactory
from fastapi.testclient import TestClient
from labour_supply.helpers import category_supplier
from marketplace.test_marketplace import list_product, make_catalog
from projects.helpers import Person, award, builder, create_project, engineer, owner
from sqlalchemy.orm import Session

from app.modules.assistant import router as assistant_router
from app.modules.assistant.tools import TOOLS
from assistant.test_assistant import FakeAI, chat, done


@pytest.fixture
def ai() -> FakeAI:
    return FakeAI()


@pytest.fixture
def client(make_client: ClientFactory, ai: FakeAI) -> TestClient:
    return make_client(
        overrides={assistant_router.get_provider: lambda: ai}, openai_api_key="test-key", assistant_max_tool_calls=50
    )


class World:
    """Two of each: builders with awarded projects, their site engineers, suppliers."""

    def __init__(self, client: TestClient, database: Session) -> None:
        self.owner_a = owner(client, database)
        self.owner_b = owner(client, database, "owner.b@example.in", "9876500021")
        self.builder_a = builder(client, database)
        self.builder_b = builder(client, database, "builder.b@example.in", "9876500022")
        self.project_a = create_project(self.owner_a, title="Alpha Residence")["id"]
        self.project_b = create_project(self.owner_b, title="Bravo Secret Tower")["id"]
        award(self.owner_a, self.builder_a, self.project_a)
        award(self.owner_b, self.builder_b, self.project_b)
        self.engineer_a = engineer(client, database)
        self.engineer_b = engineer(client, database, "engineer.b@example.in", "9876500023")
        for team_builder, team_engineer, project in (
            (self.builder_a, self.engineer_a, self.project_a),
            (self.builder_b, self.engineer_b, self.project_b),
        ):
            email = team_engineer.user.email
            code = team_builder.post("/engineers/invite", json={"email": email}).json()["invite_code"]
            team_engineer.post("/engineers/join-team", json={"invite_code": code})
            team_builder.post(f"/projects/{project}/assign-engineer", json={"engineer_id": str(team_engineer.user.id)})
        day = {"work_date": date.today().isoformat(), "floor": "G", "block": "A", "work_type": "Footings"}
        self.engineer_a.post("/cost-tool/registers", json={"project_id": self.project_a, **day})
        self.engineer_b.post("/cost-tool/registers", json={"project_id": self.project_b, **day})
        catalog = make_catalog(database)
        self.material_a = category_supplier(client, database, "Material Supplier", "mat.a@example.in", "9876500031")
        self.material_b = category_supplier(client, database, "Material Supplier", "mat.b@example.in", "9876500032")
        assert list_product(self.material_a, catalog).status_code == 200
        list_product(self.material_b, catalog)
        list_product(self.material_b, catalog, master_variant_id=None, quantity=3)
        self.labour = category_supplier(client, database, "Labor Supplier", "lab@example.in", "9876500033")
        self.equipment = category_supplier(client, database, "Equipment Supplier", "eqp@example.in", "9876500034")
        self.plain_supplier = category_supplier(client, database, "", "plain@example.in", "9876500035")
        admin_user = create_admin(database)
        self.admin = Person(admin_user, *admin_signed_in(client, admin_user.email))
        manager_user = create_manager(database, permissions="")
        self.manager = Person(manager_user, *admin_signed_in(client, manager_user.email))
        # Distinctive names, so a leak check never matches an ordinary word like "builder".
        names = {"owner_a": "Asha Kumari", "owner_b": "Bhavna Zorawar", "builder_a": "Arjun Vellore",
                 "builder_b": "Bhima Quillon", "engineer_a": "Anil Fenwick", "engineer_b": "Bala Xandor",
                 "material_a": "Amar Tolland", "material_b": "Bharat Yewdale"}  # fmt: skip
        for attribute, name in names.items():
            getattr(self, attribute).user.name = name
        database.commit()


@pytest.fixture
def world(client: TestClient, database: Session) -> World:
    return World(client, database)


def offered(ai: FakeAI) -> set[str]:
    return set(ai.calls[0][1])


EXPECTED = {
    "builder_a": {"incoming_requests", "sent_requests", "my_engineers", "my_suppliers", "project_store",
                  "project_cost_summary", "find_clients", "my_projects"},
    "engineer_a": {"my_assigned_projects", "my_orders", "project_store", "my_daily_records", "opportunities"},
    "material_a": {"my_listings", "incoming_orders", "my_clients"},
    "labour": {"my_labour_services", "incoming_orders", "my_clients"},
    "equipment": {"my_equipment", "incoming_orders", "my_clients"},
    "plain_supplier": {"my_clients"},
}  # fmt: skip
EVERY_SIGNED_IN = {"help_search", "estimate_cost", "my_profile", "my_notifications", "my_conversations"}


def test_each_role_is_offered_exactly_its_tools(world: World, ai: FakeAI) -> None:
    for name, own in EXPECTED.items():
        ai.calls.clear()
        done(chat(getattr(world, name), "hello"))
        assert offered(ai) == own | EVERY_SIGNED_IN, name
    ai.calls.clear()
    done(chat(world.admin, "hello"))
    assert offered(ai) == {"help_search", "admin_counts"}


@pytest.mark.parametrize(
    ("who", "foreign"),
    [
        (
            "material_a",
            ["project_cost_summary", "incoming_requests", "my_projects", "my_daily_records", "admin_counts"],
        ),
        ("labour", ["my_listings", "my_equipment", "my_engineers"]),
        ("equipment", ["my_listings", "my_labour_services", "find_clients"]),
        ("engineer_a", ["project_cost_summary", "my_listings", "my_projects", "admin_counts"]),
        ("builder_a", ["my_listings", "my_orders", "my_daily_records", "admin_counts", "my_award"]),
        ("owner_a", ["incoming_requests", "my_listings", "my_daily_records", "admin_counts"]),
        ("admin", ["my_profile", "my_projects", "my_notifications", "estimate_cost", "find_builders"]),
    ],
)
def test_a_role_cannot_call_another_roles_tools(world: World, ai: FakeAI, who: str, foreign: list[str]) -> None:
    ai.steps = [[(name, {}) for name in foreign], "ok"]
    done(chat(getattr(world, who), "try everything"))
    assert ai.tool_results() == [{"error": f"There is no tool '{name}' for this user."} for name in foreign]


def every_tool_of(role_tools: set[str], project_id: str | None) -> list[tuple[str, dict[str, Any]]]:
    calls = []
    for name in sorted(role_tools | EVERY_SIGNED_IN - {"help_search", "estimate_cost"}):
        needs_project = "project_id" in (TOOLS[name].parameters.get("required") or [])
        calls.append((name, {"project_id": project_id} if needs_project else {}))
    return calls


def secrets_of(*people: Person) -> list[str]:
    values = []
    for person in people:
        values += [person.user.email, person.user.phone]
        if person.user.address:
            values.append(person.user.address)
    return [value for value in values if value]


def test_a_builder_sees_only_its_own_projects_and_no_contact_details(world: World, ai: FakeAI) -> None:
    # Builder B's project id, through every project tool: refused.
    foreign = {"project_id": world.project_b}
    ai.steps = [[("project_cost_summary", foreign), ("project_store", foreign)], "no"]
    done(chat(world.builder_a, "costs of " + world.project_b))
    assert ai.tool_results() == [{"error": "That project is not one of the user's projects."}] * 2
    world.builder_a.delete("/assistant/history")

    # Every builder tool for its own project: real answers, nothing of B's, no contact details.
    ai.calls.clear()
    ai.steps = [every_tool_of(EXPECTED["builder_a"], world.project_a), "Summary."]
    done(chat(world.builder_a, "everything"))
    results = ai.tool_results()
    assert not [r for r in results if "error" in r], results
    sent = ai.sent()
    assert "Alpha Residence" in sent and world.engineer_a.user.name in sent
    others = secrets_of(world.owner_a, world.owner_b, world.engineer_a, world.engineer_b, world.builder_b)
    for leak in ["Bravo Secret Tower", world.project_b, world.builder_b.user.name, world.engineer_b.user.name, *others]:
        assert leak not in sent, leak


def test_a_site_engineer_reads_only_assigned_projects(world: World, ai: FakeAI) -> None:
    for tool in ("my_daily_records", "project_store"):
        ai.calls.clear()
        ai.steps = [[(tool, {"project_id": world.project_b})], "no"]
        done(chat(world.engineer_a, "records"))
        assert ai.tool_results() == [{"error": "That project is not one of the user's projects."}], tool
    world.engineer_a.delete("/assistant/history")
    ai.calls.clear()
    ai.steps = [every_tool_of(EXPECTED["engineer_a"], world.project_a), "Summary."]
    done(chat(world.engineer_a, "everything"))
    results = ai.tool_results()
    assert not [r for r in results if "error" in r], results
    records = next(r for r in results if "records" in r)
    assert records["total"] == 1 and set(records["records"][0]) <= {
        "work_date",
        "status",
        "work_type",
        "floor",
        "block",
    }
    sent = ai.sent()
    assert "Alpha Residence" in sent
    for leak in ["Bravo Secret Tower", world.project_b, *secrets_of(world.owner_a, world.builder_a, world.engineer_b)]:
        assert leak not in sent, leak


def test_suppliers_see_only_their_own_listings_and_orders(world: World, ai: FakeAI) -> None:
    ai.steps = [every_tool_of(EXPECTED["material_a"], None), "Summary."]
    done(chat(world.material_a, "my stock"))
    results = ai.tool_results()
    assert not [r for r in results if "error" in r], results
    listings = next(r for r in results if "listings" in r)
    assert listings["total"] == 1  # supplier B has two; none of them is here
    for leak in secrets_of(world.material_b, world.material_a):
        assert leak not in ai.sent(), leak
    for who in ("labour", "equipment", "plain_supplier"):
        ai.calls.clear()
        ai.steps = [every_tool_of(EXPECTED[who], None), "Summary."]
        done(chat(getattr(world, who), "my work"))
        assert not [r for r in ai.tool_results() if "error" in r], who


def test_an_owner_cannot_use_a_builders_or_engineers_project_tools_on_their_projects(world: World, ai: FakeAI) -> None:
    # Owner A owns project A, but builder-only and engineer-only tools are not theirs.
    own = {"project_id": world.project_a}
    ai.steps = [[("project_cost_summary", own), ("my_daily_records", own)], "no"]
    done(chat(world.owner_a, "costs"))
    assert all("There is no tool" in r["error"] for r in ai.tool_results())
    # And a builder never reaches a project it was not awarded, even one an owner created.
    unawarded = create_project(world.owner_a, title="Unawarded Cottage")["id"]
    ai.calls.clear()
    ai.steps = [[("project_store", {"project_id": unawarded})], "no"]
    done(chat(world.builder_a, "store"))
    assert ai.tool_results() == [{"error": "That project is not one of the user's projects."}]


def test_an_administrator_gets_counts_only(world: World, ai: FakeAI) -> None:
    ai.steps = [[("admin_counts", {})], "There are some pending items."]
    done(chat(world.admin, "What needs attention?"))
    (counts,) = ai.tool_results()
    assert set(counts) == {"scope", "attention", "by_country"}
    assert all(isinstance(value, int) for value in counts["attention"].values())
    sent = ai.sent()
    for leak in [world.owner_a.user.name, world.builder_a.user.name, *secrets_of(world.owner_a, world.builder_a)]:
        assert leak not in sent, leak
    # Asking for people is refused before the AI.
    ai.calls.clear()
    reply = done(chat(world.admin, "List all users' emails and phone numbers"))
    assert reply["answer_type"] == "refused" and ai.calls == []
    # A manager without permissions still gets only what the overview allows it (no error, no people).
    ai.steps = [[("admin_counts", {})], "ok"]
    done(chat(world.manager, "counts?"))
    assert "error" not in ai.tool_results()[0]


def test_every_role_gets_its_own_welcome_and_stored_chat(world: World, ai: FakeAI) -> None:
    seen = set()
    for name in ("owner_a", "builder_a", "engineer_a", "material_a", "labour", "equipment", "plain_supplier", "admin"):
        who = getattr(world, name)
        welcome = who.get("/assistant/welcome").json()
        assert welcome["suggestions"] and who.user.name.split(" ")[0] in welcome["message"], name
        seen.add(tuple(welcome["suggestions"]))
        ai.steps = [f"Answer for {name}."]
        done(chat(who, "hello"))
        assert who.get("/assistant/history").json()["messages"][-1]["text"] == f"Answer for {name}."
    assert len(seen) == 8  # different chips per role


def test_help_cards_per_role_link_only_to_that_roles_pages(client: TestClient) -> None:
    from app.modules.assistant.knowledge import load_knowledge

    knowledge = load_knowledge()
    prefixes = {
        "BUILDER": "/contractor", "SITE_ENGINEER": "/engineer", "ENGINEER": "/engineer", "SUPPLIER": "/supplier",
        "SUPPLIER_MATERIAL": "/supplier", "SUPPLIER_LABOUR": "/supplier", "SUPPLIER_EQUIPMENT": "/supplier",
        "ADMIN": "/admin",
    }  # fmt: skip
    for role, prefix in prefixes.items():
        paths = knowledge.allowed_paths(role) - {"/contact-us"}
        assert paths and all(path.startswith(prefix) for path in paths), (role, paths)
        assert knowledge.search(role, "where is everything dashboard"), role
    assert "/supplier/products" not in knowledge.allowed_paths("SUPPLIER_LABOUR")
    assert "/supplier/labor-services" not in knowledge.allowed_paths("SUPPLIER_MATERIAL")


def test_the_role_is_the_sessions_whatever_the_browser_sends(world: World, ai: FakeAI) -> None:
    body = {"message": "hi", "role": "ADMIN", "user_id": str(world.admin.user.id), "history": []}
    done(world.material_a.post("/assistant/chat", json=body))
    assert offered(ai) == EXPECTED["material_a"] | EVERY_SIGNED_IN
    assert "admin_counts" not in json.dumps(ai.calls[0][1])
