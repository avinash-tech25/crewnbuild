+++
id = "estimate-cost"
title = "Estimate the cost to build"
stage = 4
keywords = ["cost", "price", "estimate", "budget", "how much", "calculate", "sqm", "sq ft", "lakh", "crore"]
buttons = [{ label = "Open Estimate", path = "/estimate" }]
next = ["create-project"]
+++
When the user wants an estimate, OFFER TO CALCULATE IT HERE IN THE CHAT (don't just send them to the page):
- Signed in: use "The user's projects (live)" and offer each project as a suggestion
  ("Use <title>") plus "Enter new details". If they have no projects, ask for the inputs.
- Not signed in: ask for the inputs in one short question.
Give the Estimate page button as an extra, not instead.

The bot can calculate it for you with the estimate tool (it uses Crew&Build's own calculator). It needs:
- plot area per floor (sq ft or square metres)
- floors and building type:
  floors G, G+1, G+2, G+3, G-1/G-2/G-3 (with basement), Duplex or Mansion; building type Residential or Commercial
- finishing: Standard or Premium
- the plot's pincode. For a signed-in user the tool uses the pincode from their profile; ask only if the plot is somewhere else or the user is not signed in.
Ask for missing inputs in one short question. Never guess them, and never take them from the example stories.
If the user is signed in, you may look up their projects (my_projects: plot_area_sqft, floor_type, postal_code)
and ASK "Shall I use your project <title> (<area> sq ft, <floors>)?" before calculating. Only calculate after they confirm.
Projects don't store the finishing level: ask for it in the same question instead of assuming.
If the calculator can't be reached, say so and give the Estimate button. Do not quote any number then.

How Crew&Build calculates:
- The base rate comes from recent real builder quotations on Crew&Build when there are at least 5 (rate_source "builder_quotes": say "based on N recent builder quotations").
- Otherwise it is ₹2,800 per sq ft for Standard and ₹3,800 for Premium.
- It is adjusted by building type and by location (from the pincode).
- Built-up area = area per floor x floors. Then 10% is added for contingency.
- You get a likely range of plus or minus 10%, a materials / labour split, and an indicative duration (90 days per floor).
- It excludes land, finance costs, furniture and unusual site conditions. Final prices come from builder quotations.
- GST is not calculated or added in the estimate.

Do it yourself:
1. Open **Estimate** (no login needed).
2. Step 1: Country India, State, City and the 6-digit pincode.
3. Step 2: area per floor (Sq. Feet / Sq. Meter switch), floors, building type, finishing.
4. Tap **Calculate Estimate**. You can **Print** or **Share** it.
This page does not save the estimate to your account. To keep it, use **Get Estimate** inside Create Project and tap **Yes** to apply it (see create-project).
