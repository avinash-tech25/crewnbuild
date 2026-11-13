"""Load the technician checklist templates of the Partner service catalog -- server access only.

  python -m app.seeds.seed_service_checklists --dry-run    # what would happen, nothing written
  python -m app.seeds.seed_service_checklists              # apply

A service is matched on (trade, slug), exactly as seed_service_catalog does, and
that script's catalog is the source of truth: a checklist is defined for every
service in it and for nothing else. Services are only READ here -- no name, price,
order or id is ever changed, and no service is created.

Insert-only and idempotent. For each service:
  * no templates yet             -> the checklist below is inserted, positions 1..n
  * the same templates already   -> left alone ("unchanged")
  * different templates already  -> left alone and reported ("kept"): an edit made
                                    on the server is never silently overwritten
Nothing is updated or deleted, so running this twice leaves the same rows.

Templates are only COPIED onto bookings made after they exist (the snapshot in
DispatchService.create_booking). Existing bookings, their steps and photos are
never touched by this script.

Consultation is an assessment visit, so its checklist is about understanding and
advising, not about doing repair work.
"""

import argparse
import sys

from app.database.session import SessionLocal
from app.modules.catalog.models import Service, ServiceStepTemplate
from app.modules.registry import import_all_models
from app.seeds.seed_service_catalog import CATALOG

import_all_models()

MIN_STEPS, MAX_STEPS, MAX_TITLE = 4, 7, 120

CHECKLISTS: dict[tuple[str, str], list[str]] = {
    # ------------------------------------------------------------------ PLUMBER
    ("PLUMBER", "tap-repair"): [
        "Inspect the tap and identify the cause of the leak or fault",
        "Shut off the water supply to the tap",
        "Dismantle the tap and check the washer, cartridge and seals",
        "Repair or replace the faulty parts",
        "Reassemble the tap and restore the water supply",
        "Test for drips and smooth operation",
    ],
    ("PLUMBER", "tap-installation"): [
        "Check the mounting point, pipe connection and new tap fittings",
        "Shut off the water supply",
        "Remove the old tap if present and clean the mounting area",
        "Install the new tap with proper sealing",
        "Restore the water supply and check for leaks",
        "Test the water flow and tap operation",
    ],
    ("PLUMBER", "pipe-leakage-repair"): [
        "Locate the leak and inspect the surrounding area for damage",
        "Shut off the water supply to the affected line",
        "Drain the line and prepare the damaged section",
        "Repair or replace the damaged pipe, joint or fitting",
        "Restore the water supply and check the repair under pressure",
        "Clean and dry the work area",
    ],
    ("PLUMBER", "sink-repair"): [
        "Inspect the sink, drain and fittings for the reported problem",
        "Shut off the water supply below the sink",
        "Clear blockages or repair the trap and drain connections",
        "Repair or reseal leaking joints and fittings",
        "Restore the water supply and run water to test drainage",
        "Check under the sink for leaks and clean the area",
    ],
    ("PLUMBER", "toilet-repair"): [
        "Inspect the toilet, cistern and flush mechanism",
        "Shut off the water supply to the cistern",
        "Repair or replace the faulty flush, fill valve or seals",
        "Clear any blockage in the toilet or outlet",
        "Restore the water supply and test the flush and refill",
        "Check the base and connections for leaks",
    ],
    ("PLUMBER", "shower-installation"): [
        "Check the wall point, pipe connections and shower fittings",
        "Shut off the water supply",
        "Mount the shower mixer, arm and head securely",
        "Seal all joints and connections",
        "Restore the water supply and test flow and temperature control",
        "Check for leaks and clean the work area",
    ],
    ("PLUMBER", "water-tank-pipe-inspection"): [
        "Inspect the tank for cracks, leaks and a secure lid",
        "Check the inlet, outlet and overflow pipes",
        "Inspect visible pipe lines and joints for leaks or corrosion",
        "Check the float valve and water level control",
        "Note the issues found and recommend repairs to the customer",
    ],
    ("PLUMBER", "consultation"): [
        "Understand the customer's plumbing requirement",
        "Inspect the relevant fixtures and pipe lines",
        "Identify the problems and possible solutions",
        "Explain the recommended work and materials to the customer",
        "Answer questions and agree the next steps",
    ],
    # -------------------------------------------------------------- ELECTRICIAN
    ("ELECTRICIAN", "switch-socket-repair"): [
        "Inspect the faulty switch or socket and the reported issue",
        "Switch off power at the MCB and confirm it is dead with a tester",
        "Open the switchboard and check the wiring and terminals",
        "Repair the connections or replace the faulty switch or socket",
        "Refit the board cover securely",
        "Restore power and test operation",
    ],
    ("ELECTRICIAN", "switch-socket-installation"): [
        "Confirm the installation location and circuit capacity",
        "Switch off power at the MCB and confirm it is dead",
        "Prepare the box and run or extend the wiring as needed",
        "Connect and fix the new switch or socket",
        "Restore power and test operation and earthing",
    ],
    ("ELECTRICIAN", "fan-installation"): [
        "Inspect the mounting point and electrical supply",
        "Switch off power at the MCB",
        "Fix the ceiling hook or mounting bracket securely",
        "Assemble the fan and connect the wiring and regulator",
        "Secure the canopy and check the blade balance",
        "Restore power and test all speeds",
    ],
    ("ELECTRICIAN", "fan-repair"): [
        "Check the reported fan problem and the regulator",
        "Switch off power at the MCB",
        "Inspect the capacitor, winding, bearings and wiring",
        "Repair or replace the faulty component",
        "Reassemble the fan and check the blade balance",
        "Restore power and test all speeds for noise and wobble",
    ],
    ("ELECTRICIAN", "light-installation"): [
        "Confirm the fitting location and power supply",
        "Switch off power at the MCB and confirm it is dead",
        "Mount the fixture or bracket securely",
        "Connect the wiring and earth",
        "Restore power and test the light and its switch",
    ],
    ("ELECTRICIAN", "light-repair"): [
        "Check the reported fault in the light",
        "Switch off power at the MCB",
        "Inspect the bulb or tube, holder, driver and wiring",
        "Repair or replace the faulty part",
        "Restore power and test the light and its switch",
    ],
    ("ELECTRICIAN", "wiring-repair"): [
        "Identify the faulty circuit and the reported problem",
        "Switch off power at the MCB and confirm it is dead",
        "Trace and inspect the damaged wiring",
        "Repair or replace the damaged wiring with proper joints and insulation",
        "Check the connections, insulation and earthing",
        "Restore power and test the affected circuit",
    ],
    ("ELECTRICIAN", "electrical-inspection"): [
        "Inspect the distribution board, MCBs and RCCB",
        "Check switches, sockets and visible wiring for damage or overheating",
        "Test the earthing and the RCCB trip",
        "Check for overloaded circuits and loose connections",
        "Note the issues found and explain recommendations to the customer",
    ],
    ("ELECTRICIAN", "consultation"): [
        "Understand the customer's electrical requirement",
        "Inspect the relevant points, board and wiring",
        "Identify safety issues and possible solutions",
        "Explain the recommended work and materials to the customer",
        "Answer questions and agree the next steps",
    ],
    # ---------------------------------------------------------------- CARPENTER
    ("CARPENTER", "door-repair"): [
        "Inspect the door, frame, hinges and the reported problem",
        "Tighten or replace loose or damaged hinges and screws",
        "Plane or adjust the door where it sticks or drags",
        "Repair damaged wood or joints",
        "Check the door opens, closes and latches smoothly",
        "Clean up wood shavings and debris",
    ],
    ("CARPENTER", "door-handle-lock-installation"): [
        "Check the door thickness and the new handle or lock set",
        "Mark and drill the door and frame as required",
        "Fit the lock body, handle and strike plate",
        "Align the latch with the strike plate",
        "Test the lock with its keys and the handle operation",
        "Hand over the keys and clean the work area",
    ],
    ("CARPENTER", "furniture-repair"): [
        "Inspect the furniture and the damage to be repaired",
        "Dismantle the affected part if required",
        "Repair or reinforce joints, fasteners and damaged wood",
        "Reassemble and align the furniture",
        "Check stability and smooth operation of moving parts",
        "Clean the work area",
    ],
    ("CARPENTER", "cabinet-repair"): [
        "Inspect the cabinet, doors, hinges and drawers",
        "Tighten or replace loose or broken hinges and handles",
        "Repair or realign drawer channels and shelves",
        "Adjust the doors so they close and align properly",
        "Test all doors and drawers",
        "Clean the work area",
    ],
    ("CARPENTER", "shelf-installation"): [
        "Confirm the shelf position, wall type and expected load",
        "Check the wall for hidden pipes or wiring before drilling",
        "Mark and level the bracket positions",
        "Drill and fix the brackets with suitable anchors",
        "Mount the shelf and check it is level and secure",
        "Clean up dust and debris",
    ],
    ("CARPENTER", "curtain-rod-installation"): [
        "Confirm the rod position and height with the customer",
        "Check the wall for hidden pipes or wiring before drilling",
        "Mark and level the bracket positions",
        "Drill and fix the brackets securely",
        "Mount the rod and check the curtains slide freely",
        "Clean up dust and debris",
    ],
    ("CARPENTER", "minor-woodwork"): [
        "Understand the required woodwork and take measurements",
        "Prepare and cut the material to size",
        "Carry out the woodwork and fix it securely",
        "Finish the edges and surfaces",
        "Check fit, alignment and strength",
        "Clean the work area",
    ],
    ("CARPENTER", "consultation"): [
        "Understand the customer's woodwork requirement",
        "Inspect the relevant furniture, doors or area",
        "Take measurements where needed",
        "Explain the recommended work, materials and options",
        "Answer questions and agree the next steps",
    ],
    # ------------------------------------------------------------------ PAINTER
    ("PAINTER", "wall-touch-up"): [
        "Inspect the patches and marks to be touched up",
        "Cover furniture and the floor near the work area",
        "Clean and lightly sand the patches",
        "Fill cracks or dents and let them dry",
        "Apply matching paint to the touched-up areas",
        "Check the finish blends in and clean the area",
    ],
    ("PAINTER", "single-wall-painting"): [
        "Inspect the wall and confirm the colour with the customer",
        "Move or cover furniture and protect the floor",
        "Mask switchboards, edges and adjoining surfaces",
        "Scrape, fill and sand the wall surface",
        "Apply primer where needed",
        "Apply the paint coats evenly",
        "Remove the masking, inspect the finish and clean up",
    ],
    ("PAINTER", "room-painting"): [
        "Inspect the room and confirm the colours with the customer",
        "Move or cover furniture and protect floors and fixtures",
        "Mask switchboards, windows, doors and edges",
        "Scrape, fill cracks and sand the walls and ceiling",
        "Apply primer where needed",
        "Apply the paint coats evenly on the ceiling and walls",
        "Remove the masking, inspect the finish and clean the room",
    ],
    ("PAINTER", "door-painting"): [
        "Inspect the door and confirm the finish and colour",
        "Remove or mask the handles, hinges and lock",
        "Sand the surface and fill dents or cracks",
        "Apply primer where needed",
        "Apply the paint coats evenly on all faces and edges",
        "Refit or unmask the hardware once dry and clean up",
    ],
    ("PAINTER", "window-painting"): [
        "Inspect the window frame, shutters and grill",
        "Mask the glass panes and hardware",
        "Scrape loose paint, remove rust and sand",
        "Apply primer where needed",
        "Apply the paint coats evenly",
        "Remove the masking and clean the glass and area",
    ],
    ("PAINTER", "exterior-touch-up"): [
        "Inspect the exterior surfaces and mark the areas to touch up",
        "Set up safe access and protect the surroundings",
        "Clean, scrape and repair cracks in the marked areas",
        "Apply primer or a waterproof coat where needed",
        "Apply matching exterior paint",
        "Inspect the finish and clean the area",
    ],
    ("PAINTER", "consultation"): [
        "Understand the customer's painting requirement",
        "Inspect the surfaces for dampness, cracks and condition",
        "Estimate the area and suggest paint types and colours",
        "Explain the recommended work to the customer",
        "Answer questions and agree the next steps",
    ],
}


def validate() -> None:
    """Refuse to run on a checklist that breaks the rules, before touching the database."""
    catalog = {(trade, slug) for trade, entries in CATALOG.items() for slug, *_ in entries}
    if set(CHECKLISTS) != catalog:
        raise ValueError(
            f"checklists and catalog differ: missing={sorted(catalog - set(CHECKLISTS))} extra={sorted(set(CHECKLISTS) - catalog)}"
        )
    for key, steps in CHECKLISTS.items():
        if not MIN_STEPS <= len(steps) <= MAX_STEPS:
            raise ValueError(f"{key}: {len(steps)} steps, expected {MIN_STEPS}-{MAX_STEPS}")
        if any(not title.strip() or len(title) > MAX_TITLE or title != title.strip() for title in steps):
            raise ValueError(f"{key}: a step is blank, padded or longer than {MAX_TITLE} characters")
        if len({title.casefold() for title in steps}) != len(steps):
            raise ValueError(f"{key}: duplicate step")


def seed(session, *, apply: bool = True) -> list[tuple[str, str, str, int]]:
    """Returns (trade, slug, outcome, templates) per service; outcome is created /
    unchanged / kept / missing-service. Commits only when `apply` and something was created."""
    validate()
    report, created_any = [], False
    for (trade, slug), steps in CHECKLISTS.items():
        service = session.query(Service).filter(Service.trade == trade, Service.slug == slug).one_or_none()
        if service is None:
            report.append((trade, slug, "missing-service", 0))
            continue
        existing = (
            session.query(ServiceStepTemplate)
            .filter(ServiceStepTemplate.service_id == service.id)
            .order_by(ServiceStepTemplate.position)
            .all()
        )
        if existing:
            same = [(t.position, t.title, t.is_active) for t in existing] == [
                (n, title, True) for n, title in enumerate(steps, start=1)
            ]
            report.append((trade, slug, "unchanged" if same else "kept", len(existing)))
            continue
        if apply:
            for position, title in enumerate(steps, start=1):
                session.add(ServiceStepTemplate(service_id=service.id, position=position, title=title, is_active=True))
            created_any = True
        report.append((trade, slug, "created" if apply else "would-create", len(steps)))
    if apply and created_any:
        session.commit()
    else:
        session.rollback()
    return report


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="report what would happen; write nothing")
    args = parser.parse_args(argv)
    session = SessionLocal()
    try:
        report = seed(session, apply=not args.dry_run)
        total = session.query(ServiceStepTemplate).count()
    finally:
        session.close()
    for trade, slug, outcome, count in report:
        print(f"{trade:<12} {slug:<31} {outcome:<16} {count}")
    outcomes = {name: sum(1 for row in report if row[2] == name) for name in {row[2] for row in report}}
    print(f"services: {len(report)} | {outcomes} | templates in partner.catalog_service_checklist_steps: {total}")
    if any(row[2] == "kept" for row in report):
        print("NOTE: 'kept' services already had different templates; they were left untouched.")
    return 1 if any(row[2] == "missing-service" for row in report) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
