+++
id = "create-project"
title = "Create a construction project"
stage = 5
keywords = ["new project", "create project", "start project", "add project", "construction project"]
buttons = [{ label = "My projects", path = "/owner/projects" }]
next = ["builder-or-self", "find-builders"]
+++
Where: **Projects** -> **Create New Project**, or Dashboard -> Our Services -> **Construction Project**.

Fields:
1. **Pincode** first: the 6-digit pincode of the site. The State fills in from India Post, and the City too when the pincode has one city. Choose the post office branch (one branch is chosen for you).
2. **State** and **City**: they must belong to that pincode, or the form shows a mismatch error.
3. **Site address**, **Project title**, **Project description**. These are required.
4. Project image (optional).
5. **Construction type**: **Hire Builder** or **Self Construction**. This can't be changed later.
6. Building type (Residential / Commercial), plot area (sq ft), floors (G to G+3, G-1 to G-3 with basement, Duplex or Mansion).
7. **Start Date** and **End Date**. Both are required, and the end date can't be before the start date.
8. Budget (optional).
   The budget is also shown in words, in lakh rupees.
9. Optional: **Get Estimate** on the right. Choose Standard or Premium, then tap **Yes** to apply it. If the budget is empty, the estimate becomes the budget.

Tap **Create project**. You'll see "Project created successfully."

What happens next:
- Three payment stages (escrow milestones) are created automatically.
- Builders (or suppliers, for self construction) with the same pincode are notified about your new project.
