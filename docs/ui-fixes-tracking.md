# UI fixes tracking

The 154 items of `CrewNBuild_UI_Fixes (1).pdf` (checked on crewnbuild.com, 23 Nov 2026), with their
original numbers, sections and priorities. Pending means its stage has not started. For items 1-51,
"Desktop" is a visual check at 1366px and "mobile" at 375px; sideways scroll was measured at 12 widths
(320 to 1920px). Items 1-51 were then
measured for clipping and overlap at all 12 widths, with screenshots reviewed at 320, 820, 1024 and 1920px. For items 52-59,
overflow, cut text and overlap were measured at all 12 widths in English and 6 widths in the other
languages, with mocked API replies (no code was sent); screenshots were reviewed at 6 widths.
For items 60-154, every Builder page was measured at all 12 widths with mocked API data, with
screenshots reviewed at 320, 820 and 1366px. Nothing signed in was checked with real data yet.

Stage 4 (pages outside the list): House Owner, Site Engineer, Supplier (three categories), the other
public pages and Partner were measured at all 12 widths with mocked data, and Builder dialogs, forms
and tables too. Builder and House Owner were also measured in Telugu and Arabic, and Supplier and Site
Engineer in Tamil, at 6 widths. Dashboard headers were measured in English, Telugu, Tamil and Arabic at
12 widths for House Owner, Site Engineer and Material Supplier.

| No. | Section | Priority | Initial status | Action | Final status | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Whole site | High | Already fixed | None, left unchanged | Already fixed | Desktop and mobile, functional: header and logo hidden after scrolling |
| 2 | Whole site | High | Partially fixed | CREWNBUILD in the header labels, the catalogue line and the other languages (old brand name removed). The logo picture still reads "Crew&Build" | Blocked: needs new logo art; legal and account deletion wording left as is | Code |
| 3 | Whole site | Medium | Partially fixed | Wider tracking in the two remaining heading styles and the CTA heading | Completed | Desktop and mobile |
| 4 | Whole site | Medium | Pending | Self-hosted Noto Sans for six scripts; each loads only with its language | Completed | Desktop and mobile, functional: production build, six languages, no sideways scroll |
| 5 | Whole site | Low | Pending | Inter 800 declared (the existing variable files carry it) | Completed | Functional: weight 800 loads |
| 6 | Whole site | Low | Partially fixed | Less space above and below the 3D house section | Completed | Desktop and mobile |
| 7 | Whole site | Medium | Partially fixed | None. Supplier differs; owner, builder and engineer share one bearded face | Blocked: needs new character art | Desktop and mobile |
| 8 | Top banner (hero) | High | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 9 | Top banner (hero) | High | Already fixed | None, left unchanged | Already fixed | Desktop and mobile: all four on one line. Four tabs wrapped at 320px: fixed, now one line at all 12 widths |
| 10 | Top banner (hero) | High | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 11 | Top banner (hero) | Medium | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 12 | Top banner (hero) | High | Already fixed | None, left unchanged | Already fixed | Desktop and mobile, functional: each slide has its own button and link |
| 13 | Top banner (hero) | Medium | Partially fixed | Weather removed from the home page header only; other pages keep it | Completed | Desktop and mobile, functional |
| 14 | Top banner (hero) | Low | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 15 | Top banner (hero) | Low | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 16 | 3D house section | High | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 17 | 3D house section | Medium | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 18 | 3D house section | Low | Partially fixed | Two round poles replaced by square piers in the wall finish (ground colour was done) | Completed | Desktop |
| 19 | 3D house section | Low | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 20 | 3D house section | Medium | Partially fixed | Phones show the existing house picture with a "View in 3D" button; 3D already loaded late | Completed | Mobile, functional: 3D loads only after the tap |
| 21 | 3D house section | Low | Pending | House box centred on the text | Completed | Desktop: 1024, 1366, 1920 |
| 22 | Roles section | Medium | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 23 | Roles section | High | Already fixed | None, left unchanged | Already fixed | Desktop and mobile: all 107px on desktop |
| 24 | Roles section | Medium | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 25 | Roles section | Medium | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 26 | Roles section | Low | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 27 | Roles section | Low | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 28 | Roles section | Medium | Pending | Equipment owners removed from the footer line in seven languages | Completed | Desktop and mobile |
| 29 | Roles section | Medium | Already fixed | None, left unchanged | Already fixed | Functional: four sign-up links by role |
| 30 | Inside the Platform cards | High | Already fixed | None, left unchanged | Already fixed | Desktop |
| 31 | Inside the Platform cards | High | Already fixed | None, left unchanged | Already fixed | Desktop |
| 32 | Inside the Platform cards | Medium | Already fixed | None, left unchanged | Already fixed | Desktop |
| 33 | Inside the Platform cards | Medium | Partially fixed | Low stock bar was amber on amber; now dark green | Completed | Functional: bar colour measured at 320, 820 and 1366 |
| 34 | Inside the Platform cards | Medium | Already fixed | None, left unchanged | Already fixed | Desktop; link read in code |
| 35 | Inside the Platform cards | Low | Already fixed | None, left unchanged | Already fixed | Desktop |
| 36 | Inside the Platform cards | Low | Already fixed | None, left unchanged | Already fixed | Desktop |
| 37 | Inside the Platform cards | Low | Already fixed | None, left unchanged | Already fixed | Desktop, functional: stays at 112px while cards scroll |
| 38 | How it works | Medium | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 39 | How it works | Low | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 40 | How it works | Medium | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 41 | How it works | Medium | Pending | Platform section uses the How it works step names | Completed | Functional: seven languages |
| 42 | How it works | Medium | Already fixed | None, left unchanged | Already fixed | Mobile |
| 43 | Footer | Medium | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 44 | Footer | Medium | Pending | Trysol logo smaller, light grey, no white box (same image) | Completed | Desktop and mobile |
| 45 | Footer | Low | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 46 | Footer | Medium | Pending | One language control that opens a list | Completed | Desktop and mobile, functional: all seven languages |
| 47 | Footer | Low | Partially fixed | Space kept for the assistant button. Privacy and Terms stay in the Legal column, not repeated below | Completed | Desktop and mobile. Contact column and footer note fixed on tablets |
| 48 | Footer | Low | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 49 | Footer | Low | Already fixed | None, left unchanged | Already fixed | Functional: phone link works; WhatsApp shows only when the server has a number |
| 50 | Footer | Low | Pending | Small line cropped off the footer logo | Completed | Desktop and mobile |
| 51 | Above footer | Low | Already fixed | None, left unchanged | Already fixed | Desktop and mobile |
| 52 | Login page | High | Already fixed | None, left unchanged | Already fixed | Desktop, tablet and mobile, functional: "Change mobile number", "Resend code in 00:55", then "Resend code" |
| 53 | Login page | Medium | Already fixed | None: the number shows once, with "Change mobile number" (the PDF's second option) | Already fixed | Desktop, tablet and mobile, functional: Change returns to the number step |
| 54 | Login page | Low | Already fixed | None, left unchanged | Already fixed | Desktop, tablet and mobile: code boxes as wide as the number box at all 12 widths |
| 55 | Login page | Low | Already fixed | None, left unchanged | Already fixed | Desktop, tablet and mobile: one logo |
| 56 | Login page | Low | Already fixed | None, left unchanged | Already fixed | Desktop, tablet and mobile: no weather |
| 57 | Login page | Low | Already fixed | None, left unchanged | Already fixed | Desktop, tablet and mobile: plain text with the shield |
| 58 | Login page | Low | Already fixed | Already beside the logo; its touch area made 40px high | Already fixed | Desktop, tablet and mobile, functional: opens the home page |
| 59 | Login page | Low | Pending | Login shows the home page tagline from the same translation keys; unused login tagline removed | Completed | Desktop, tablet and mobile, functional: seven languages |
| 60 | Builder - Dashboard | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 61 | Builder - Dashboard | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 62 | Builder - Dashboard | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 63 | Builder - Dashboard | Medium | Pending | Each card opens its own list; the Requests filter is in the address | Completed | Functional: four cards, refresh and Back. Mocked data; real data pending |
| 64 | Builder - Dashboard | Medium | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 65 | Builder - Dashboard | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 66 | Builder - Dashboard | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 67 | Builder - Dashboard | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 68 | Builder - Dashboard | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 69 | Builder - Dashboard | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 70 | Builder - Dashboard | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 71 | Builder - Requests | High | Pending | A note under the quotation box when it is under half the budget; it blocks nothing | Completed | Functional. Mocked data; real data pending |
| 72 | Builder - Requests | High | Pending | The pill shows Accepted, as the filter does; the assignment stage is a chip beside it (display only) | Completed | Functional. Mocked data; real data pending |
| 73 | Builder - Requests | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 74 | Builder - Requests | High | Partially fixed | None. Products offered are shown | Blocked: the request carries no price | Code. Mocked data; real data pending |
| 75 | Builder - Requests | Low | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 76 | Builder - Requests | Low | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 77 | Builder - Requests | Low | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 78 | Builder - Requests | Low | Pending | Names and places start with a capital | Blocked: full city names need data ("hyd" stays as typed) | Code. Mocked data; real data pending |
| 79 | Builder - Requests | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 80 | Builder - Requests | Low | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 81 | Builder - Requests | Medium | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 82 | Builder - My Partners | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 83 | Builder - My Partners | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 84 | Builder - My Partners | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 85 | Builder - My Partners | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 86 | Builder - My Partners | Low | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 87 | Builder - My Partners | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 88 | Builder - My Partners | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 89 | Builder - My Partners | Low | Already fixed | My Partners already shows the city; the supplier lead card now does too, when the supplier gave an address | Already fixed | Mocked data; real data pending |
| 90 | Builder - My Partners | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 91 | Builder - My Partners | Low | Pending | Partner names shown with first letters in capital; stored names unchanged | Completed | Functional. Mocked data; real data pending |
| 92 | Builder - My Partners | Low | Pending | Initials in a coloured circle when a site engineer has no photo | Completed | Functional. Mocked data; real data pending |
| 93 | Builder - My Partners | Low | Partially fixed | None. View Profile is there | Blocked: Message needs a way to open one person's chat | Code. Mocked data; real data pending |
| 94 | Builder - My Partners | Low | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 95 | Builder - My Partners | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 96 | Builder - Find Clients | High | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 97 | Builder - Find Clients | High | Pending | None | Blocked: matching address and pincode needs data and backend checks | Code. Mocked data; real data pending |
| 98 | Builder - Find Clients | Medium | Partially fixed | Leads with both size and budget come first | Completed | Functional. Mocked data; real data pending |
| 99 | Builder - Find Clients | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 100 | Builder - Find Clients | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 101 | Builder - Find Clients | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 102 | Builder - Find Clients | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 103 | Builder - Find Clients | Medium | Pending | Search, type filter and budget or size order for owners; search and category for suppliers | Completed | Functional. Mocked data; real data pending |
| 104 | Builder - Find Clients | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 105 | Builder - Find Clients | Low | Pending | None | Blocked: separate area and city fields need the database | Code. Mocked data; real data pending |
| 106 | Builder - Find Clients | Low | Pending | "Sent 2 days ago" and the existing Withdraw on supplier leads; contacted owner leads already move to Requests | Completed | Functional: the existing withdraw call. Mocked data; real data pending |
| 107 | Builder - Buy & Sell | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 108 | Builder - Buy & Sell | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 109 | Builder - Buy & Sell | Low | Pending | None, both kept as decided | Blocked: business and data decision | Code. Mocked data; real data pending |
| 110 | Builder - Buy & Sell | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 111 | Builder - Buy & Sell | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 112 | Builder - Buy & Sell | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 113 | Builder - Buy & Sell | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 114 | Builder - Buy & Sell | Low | Partially fixed | None. Sold is there | Blocked: view and enquiry counts are not recorded | Code. Mocked data; real data pending |
| 115 | Builder - Product Catalog | High | Pending | None | Blocked: brand pictures are catalog data | Code. Mocked data; real data pending |
| 116 | Builder - Product Catalog | Medium | Pending | None | Blocked: category name is catalog data | Code. Mocked data; real data pending |
| 117 | Builder - Product Catalog | Medium | Pending | None | Blocked: one category list is a data decision | Code. Mocked data; real data pending |
| 118 | Builder - Product Catalog | Medium | Pending | Opens on the suppliers' best discounts, from the offers already loaded | Completed | Functional. Mocked data; real data pending |
| 119 | Builder - Product Catalog | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 120 | Builder - Product Catalog | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 121 | Builder - Projects | High | Pending | None | Blocked: Current follows the Site Engineer assignment (business rule) | Code. Mocked data; real data pending |
| 122 | Builder - Projects | High | Pending | An active project in Upcoming reads Upcoming, as its tab does (display only) | Completed | Functional. Mocked data; real data pending |
| 123 | Builder - Projects | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 124 | Builder - Projects | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 125 | Builder - Projects | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 126 | Builder - Projects | Low | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 127 | Builder - Projects | Low | Pending | Brand green focus ring for dashboard controls | Completed | Functional. Mocked data; real data pending |
| 128 | Builder - Projects | Low | Pending | "Gachibowli, Hyderabad - 500032" from the stored address and city | Completed | Functional. Mocked data; real data pending |
| 129 | Builder - Help Center | High | Pending | The escrow question removed: the Terms say payments are not held or released | Completed | Functional. Mocked data; real data pending |
| 130 | Builder - Help Center | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 131 | Builder - Help Center | Medium | Partially fixed | None. Contact support button is there | Blocked: a feedback form needs somewhere to send it | Code. Mocked data; real data pending |
| 132 | Builder - Help Center | Low | Pending | Search box in the Help Center | Completed | Functional. Mocked data; real data pending |
| 133 | Builder - Profile | High | Pending | GSTIN and PAN format checked before saving, only when changed | Completed | Functional: wrong values refused, right ones sent. Mocked data; real data pending |
| 134 | Builder - Profile | Medium | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 135 | Builder - Profile | Low | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 136 | Builder - Profile | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 137 | Builder - Profile | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 138 | Builder - Profile | Low | Partially fixed | An all-capitals About is shown in normal letters; the 1-2 sentences hint was there | Completed | Functional. Mocked data; real data pending |
| 139 | Builder - Profile | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 140 | Builder - Profile | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 141 | Builder - Profile | Low | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 142 | Builder - Profile | Medium | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 143 | Builder - Notifications | High | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 144 | Builder - Notifications | Medium | Partially fixed | None. Dots, count and the cut-off are fixed; the panel lists them all | Blocked: View all needs a notifications page | Code. Mocked data; real data pending |
| 145 | Builder - Notifications | Medium | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 146 | Builder - Messages | Medium | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 147 | Builder - Messages | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 148 | Builder - Messages | Medium | Partially fixed | A supplier's request shows its category and what it offers | Blocked: the chat request carries no product | Code. Mocked data; real data pending |
| 149 | Builder - Messages | Low | Pending | The request card no longer keeps the outer bubble's padding | Completed | Functional. Mocked data; real data pending |
| 150 | Builder - Messages | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
| 151 | Builder - Messages | Low | Pending | Uploaded photo, else initials, in Messages | Completed | Functional. Mocked data; real data pending |
| 152 | Builder - Header | Low | Pending | Same focus ring as 127 | Completed | Functional. Mocked data; real data pending |
| 153 | Builder - Header | Low | Already fixed | None, left unchanged | Already fixed | Code only; browser and real data pending |
| 154 | Builder - Header | Low | Already fixed | None, left unchanged | Already fixed | Mocked data; real data pending |
