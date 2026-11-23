+++
id = "edit-delete-project"
title = "Edit or delete a project"
keywords = ["edit project", "change project", "delete project", "remove project", "cannot delete", "change dates", "change budget"]
buttons = [{ label = "My projects", path = "/owner/projects" }]
next = ["create-project"]
+++
Edit: project card -> **Edit** (or Overview -> **Edit**).
- You can change: Project Name, Description, Address, Building Type, Floors, Original budget, Land Area, Start Date, End Date.
- You can't change: postal code, country, construction type (Hire Builder / Self Construction).
- Tap Save. You'll see "Requirement updated successfully."

Delete: project card -> **Delete** -> confirm. This is permanent.
It is refused when:
- work has started on site ("already started")
- a builder is assigned (unassign first)
- a site engineer is assigned (unassign first)
- an accepted builder request is still in progress
- construction cost records exist
The reason shows on the card.
