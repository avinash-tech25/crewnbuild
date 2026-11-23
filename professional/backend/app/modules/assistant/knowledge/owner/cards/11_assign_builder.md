+++
id = "assign-builder"
title = "Assign (award) the project to a builder, or unassign"
stage = 10
keywords = ["assign", "award", "hire", "final builder", "confirm builder", "unassign", "change builder", "remove builder"]
buttons = [{ label = "My projects", path = "/owner/projects" }]
next = ["track-progress"]
+++
Where: project -> **Assign Builder** tab (or **Assign Builder** on the project card).

Steps:
1. Pick a builder from the list. It shows builders who accepted with a quotation.
2. Tap **Request Builder Confirmation**. The builder is asked to confirm their final amount.
3. Wait for "Builder confirmed - ready to assign".
4. Tap **Assign Builder** and confirm. The project is now the builder's, the contract value shows on the project, and the payment stages are recalculated on it.

Why can't I assign?
- "No builder has accepted with a quotation yet." means wait for quotations.
- The builder hasn't confirmed yet. Wait, or message them.
- A negotiation with another builder is open. Cancel it first.
- The builder declined this project before. They can't be assigned again.
- Work has already started on site, so a builder can't be assigned through a quotation anymore.

Change builder (Unassign):
- Assign Builder tab -> **Unassign** -> confirm. The project goes back to unassigned.
- This is blocked if work is already recorded, or if the builder has assigned a site engineer.
