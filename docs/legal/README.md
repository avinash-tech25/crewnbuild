# Terms of Service and Privacy Policy

The two Word files in this folder are the source (updated 20 November 2026):

- the Terms: the one `.docx` whose name contains "Terms" (its file name still carries the
  old brand; the script finds it by that word, so the name can change freely);
- the Privacy Policy: the one `.docx` whose name contains "Privacy".

`python scripts/convert_legal_docs.py` (needs `pip install python-docx`) turns them into the
content both web apps render, written to `src/features/legal/content/{terms,privacy}.js` in
`professional/frontend` and `partner/frontend` (identical copies; the apps share no code).
Every section, heading, number, list and sentence is copied word for word. The only change
is the brand: any `@gharbanao.in` address becomes `support@crewnbuild.com`, `gharbanao.in`
becomes `crewnbuild.com`, and "GharBanao" becomes "CREWNBUILD". In the 20 Nov files that
touched: Terms 10.5 (support@), 21.2 and 22.6 (legal@); Privacy 1.1 (the site), 6.3 and 8.2
(dpdp@). Replace a Word file and rerun the script; never edit the generated files by hand.

The 20 Nov files print no title, effective date or version. The script then uses its
defaults: the titles "Terms and Conditions (Terms of Use)" and "Privacy Policy", version
**1.1**, effective and last updated **20 November 2026** (`DEFAULT_VERSION`,
`DEFAULT_DATE` in the script).

Both apps publish `/legal` (the Legal hub), `/terms` and `/privacy`, linked from the footers'
Legal column; the sign-up consent line opens either text in a dialog. Each account records
the `terms_version`, `privacy_version` and `terms_accepted_at` it agreed to; the backends
refuse sign-up without acceptance (see "Versions" below).

Bracketed placeholders in the texts are shown as written, for example `[ACN-3703]`, `[15]`,
`[Grievance Officer Name]`, `[Designation]`, `[KYC partner]`, `[cloud region]`; the script
prints the full list.

## Statements that do not match the app (flagged, not changed)

Written against the 17 November texts; not re-checked against the 20 November update.

The final texts fixed the Aadhaar statements: technicians' Aadhaar number is stored
encrypted and shown masked, and their face photo is used to verify identity and then
deleted. Their processors are now named in part. The statements below still contradict how
CREWNBUILD handles data, promise things it does not do, or leave out data it does process.
**None of the texts was changed**; each needs a decision by legal / product. Paths are in
the repository; PB = `partner/backend/app`, PrB = `professional/backend/app`.

### Identity and verification

1. **"Aadhaar-based verification is voluntary … another officially valid document"**
   (Privacy 7.1; Terms 4.3(b)). True for the Verified badge, but a technician cannot
   receive jobs without Aadhaar and a face capture (PB/modules/technicians/eligibility.py);
   no other document is offered to them.
2. **"We keep the verification status and name-match outcome"** (Privacy 2.3, 7.3).
   *Unsupported.* A person reviews the submission (PB/scripts/identity_review.py); there is
   no name-match outcome or KYC provider.
3. **Withdrawal deletes verification data** (Privacy 7.4); **KYC kept 5 years after
   closure** (Privacy 9). *Unsupported.* Partner has no consent-withdrawal or
   account-deletion path; the encrypted Aadhaar has no retention limit.

### Money

4. **Technician payout bank details** (holder, bank, encrypted account number, IFSC) are
   not mentioned anywhere. *Omission* (PB/modules/technicians/bank_account_service.py).
5. **"Free for Homeowners … CREWNBUILD does not receive, hold or pay out Project payments
   … no commission"** (Terms Key Points, 3.4, 6.1, 9.1, 9.6). *Contradiction.* House
   Owners and Site Engineers pay technician bookings through CREWNBUILD's Razorpay
   account (PrB/modules/billing/booking_payment_service.py), and Partner records a
   platform commission per job (PB/core/config.py `partner_commission_rate_percent`;
   PB/modules/technicians/earnings_service.py).
6. **Auto-renewing subscriptions, RBI e-mandate, pre-debit notice, "Account → Billing"
   cancel** (Terms 9.5; Privacy 2.3). *Contradiction.* Plans are one-off prepaid periods
   with no auto-renewal, mandate or cancel endpoint (PrB/modules/billing/subscription_service.py).
7. **Plans and prices "Starter free / Pro ₹999 / Enterprise ₹2,999", "14-day free trial"
   converting to paid, 14-day refund window, annual pro-rated refunds** (Terms 7.1, 9.5,
   10.1). *Contradiction.* The app's tiers are Free, Professional and Business
   (Professional ₹899/month, Business ₹1,199/month or ₹9,999/year; PrB/modules/billing/plans.py,
   PrB/seeds/seed_subscription_plan_prices.py); new builders get 30 days of Professional
   free, which never converts to paid; refunds come only from the payment provider.
8. **Lead Credits** (packs ₹4,000/5 …; a Lead "offered for 2 hours", accepting "deducts a
    credit"; Terms 7.2, 9.1, 10.2; Privacy 2.3). *Unsupported.* No credits or lead
    expiry exist; "leads" in the app are a per-plan cap on a builder's open requests.
9. **Supplier featured plans ₹2,000 / ₹4,000 / ₹8,000, listing-payment records** (Terms
    8.4, 9.1, 10.3; Privacy 2.4). *Unsupported.* Suppliers have no paid plans.
10. **GST invoices / GST Invoice Generator** (Privacy 3.1; Terms 7.5, 9.3). *Unsupported.*
    No GST invoicing; booking receipts state no tax.
11. **Escrow "if and when offered … until then an indicative plan"** (Terms 9.6). The app
    already shows an "Escrow milestones" section (a budget split by stage; no money is
    held). The label and the text should agree.

### Location

12. **"Precise device location only if you grant permission", used for rates, permits and
    nearby contractors** (Privacy 2.6). *Contradiction / omission.* Technicians must share
    continuous GPS to be offered jobs, streamed live to the customer during a booking
    (PB/modules/technicians/technician_location_service.py; one live row, removed on
    sign-out, going offline, or an hour after the last update); booking addresses and
    coordinates are stored; the weather feature uses device location. None of these
    purposes is listed.
13. **"Approximate location derived from your IP address"** (Privacy 2.1). *Unsupported.*
    No IP geolocation exists.

### Sharing and processors

14. **"We share your details … only when you ask us to connect you"; "Contractors see
    contact details only after they accept a Lead"** (Privacy At a Glance, 3.1, 4.1).
    *Contradiction.* Builders' Find Clients lists open projects and their House Owners in
    their pincodes without any enquiry: owner name, photo, street address, pincode,
    budget, area and description (PrB/modules/marketplace/discovery_service.py). Phone and
    e-mail are withheld until a request between the two is accepted (either side).
15. **Processors** (Privacy 4.2, 4.8; Terms 14). The text now names Razorpay and Amazon
    Web Services, Mumbai region, as primary storage: the S3 region in config defaults to
    `us-east-1`; confirm production uses `ap-south-1`. It also lists KYC partners, SMS,
    analytics and fraud-prevention tools, none of which the code uses, and leaves out
    Dovesoft (WhatsApp), Resend / SMTP (e-mail), Google and Microsoft sign-in, an
    OpenAI-compatible service and Google Gemini (machine translation; Vastu plan
    analysis), Open-Meteo, OpenStreetMap Nominatim, OSRM, map tiles and India Post.
16. **"GSTIN verified against the GST portal"; GST portal, RERA portal and analytics as
    sources** (Privacy 2.4, 2.7). *Unsupported.* Builder and supplier verification is
    manual admin review of uploaded documents (PrB/modules/admin/verification_service.py).

### Sign-in, consent and rights

17. **"Sign you in by OTP"; "verify your mobile number by OTP"; SMS** (Privacy 3.1; Terms
    4.2, 5.5). Sign-in is e-mail and password, e-mail code, WhatsApp code (optional),
    Google / Microsoft (Professional), and e-mail code plus password (Partner). No SMS is
    sent; the cross-app Partner hand-off sign-in is not mentioned.
18. **Per-purpose consents, marketing opt-in / "STOP", the "CREWNBUILD Weekly"
    newsletter, withdrawing consent in settings** (Privacy 3.2, 8.1, 9). *Unsupported.*
    The only consent recorded is the Terms / Privacy acceptance at sign-up.
19. **18 and over** (Terms 1.3; Privacy 11). *Unsupported.* No age check.
20. **Data access summary, nomination, "Privacy Settings" page, export records for 30 days
    after closure** (Privacy 8.1–8.2; Terms 19.3). *Unsupported.*
21. **Cookie banner, analytics and marketing cookies** (Privacy 5). *Unsupported.* No
    banner or analytics; only the HttpOnly session cookies and local preferences.

### Retention

22. **"Deleted accounts: personal data erased within 30 days … backups overwritten within
    90 days"; active data kept 3 years after closure; KYC 5 years; inactive accounts erased
    after 3 years** (Privacy 9).
    *Contradiction / unsupported.* Professional deletion is an immediate anonymising soft
    delete that keeps a permanent deletion record (name, e-mail, phone) with no purge
    (PrB/modules/accounts/account_deletion_service.py); Partner has no deletion; no
    inactivity or backup job exists.
23. **Logs kept 13 months** (Privacy 9). *Unsupported.* Logs go to stdout with no set
    retention; the admin and CCTV audit logs are kept without limit.

### "Tools run on your device"

24. **"Calculators run on your device; figures not sent to our servers"** (Privacy At a
    Glance, 2.2). *Partly contradicted.* The construction cost estimator sends area,
    budget and location to the server to calculate (not stored); a Vastu plan is uploaded
    and sent to Gemini. Stamp duty, TDS, loan and ROI calculators are on-device. There are
    no capital-gains or solar calculators.

### Features named in the texts that the app does not have

25. Defect / Warranty Tracker and notices, 21-day defect response; RERA Builder Trust
    Score, quote benchmarks, Construction Cost Index and "human review" of scores;
    WhatsApp share cards and payslips; client portal; Professional Quote PDF; maintenance
    reminders, Budget Tracker, Material Logger, Rate Analysis Calculator; the Homeowner
    enquiry sent to "up to [number]" businesses; possibly staff accounts and supplier rate-card
    validity and bulk order matching.
26. **Labour Wage Register** (Privacy 2.5, 6, 11; Terms 7.5–7.6). *Partly.* Builders' daily
    cost records hold worker names, optional phone, attendance and daily wage; no bank /
    UPI details, UAN, ESIC, e-Shram, payslips or injury records, and no feature by that name.

### Data the app processes that the texts never mention

27. The Partner app and technicians as a user class. The text now covers their Aadhaar number
    and face photo (Privacy At a Glance, 2.3, 2.8, 7.2–7.3), but not their bank details,
    live GPS, job photos (before / after / customer), the start-work code, bills, ratings,
    earnings and commission, or that technicians see a customer's first name and phone once
    a job is accepted.
28. Data passed between the two apps: owners' and Site Engineers' contact details to the
    Partner app for bookings (PrB/modules/accounts/partner_view.py), bookings back.
29. Live CCTV / DVR access to project sites, encrypted camera credentials, and an audit
    trail with viewers' IP addresses (PrB/modules/cctv).
30. In-app messaging with attachments, notifications, support tickets with attachments,
    abuse reports; weather alerts on project locations; site photo and video uploads;
    third-party ads; the supplier shop, purchase orders, labour and equipment supply.

### Viswa, the in-app help assistant (new; for legal review)

31. **An AI help chat ("Viswa")** for visitors and every signed-in role (House Owners, Builders,
    Engineers, Suppliers, administrators) (PrB/modules/assistant).
    *Not in the texts.* Suggested Privacy Policy wording, for legal review:
    - **What is sent to the AI provider:** the question typed, the earlier messages of the
      same chat, the user's role and first name, and only the information a question needs
      from the user's own records (project titles, status and amounts; requests and
      quotations; orders, listings and stock; daily-record dates; cost totals; notification
      titles; names of the builders, suppliers, engineers or clients the user deals with;
      for administrators, overview counts only, never a person). The provider is the same OpenAI-compatible service
      already used for translation (Google Gemini's OpenAI-compatible API), a processor.
    - **Never sent:** phone numbers, e-mail addresses, street addresses, Aadhaar, PAN,
      GSTIN, bank details, documents, passwords or codes, camera / CCTV data, and other
      people's message texts (removed by field and by pattern before anything leaves).
    - **Who can see what:** the assistant sees only what the user's own screens show; it
      cannot read other users' records.
    - **Storage and retention:** a signed-in user's chat is kept for 30 days
      (ASSISTANT_HISTORY_DAYS) and then deleted automatically; **Clear chat** deletes it at
      once; deleting the account deletes it. Visitors' chats are not stored on the server
      (only in their own browser tab). Thumbs up / down are stored with the answer.
    - **Limits:** messages are rate-limited per account and per visitor address; answers
      may be wrong and the widget says so ("Viswa can make mistakes").
    - To confirm with the provider: where it processes data, whether it keeps prompts,
      and whether they are used for training (the paid Gemini API terms say no).

### Not checked against code

31. The DPDP timeline ("core obligations from May 2027"), staff MFA, encryption at rest
    beyond Aadhaar / bank / face / camera credentials, PCI-DSS and penetration testing.

## Disclaimer

`CREWNBUILD_Disclaimer.docx` (the one `.docx` with "Disclaimer" in its name) is converted by
the same script into `professional/frontend/src/features/legal/content/disclaimer.js`
(Professional only), word for word with the same brand rule; the document already says
CREWNBUILD and crewnbuild.com, so nothing was replaced. It prints its own title, version
**1.0** and dates (effective and last updated 23 November 2026). It is published at
`/disclaimer` (sidebar of sections, as /terms), listed on the `/legal` hub and in the
footer's Legal column. It is not accepted at sign-up, so it has no version constant in
`app/core/legal.py`.

**Placeholders remaining in the Disclaimer: none.** (The script prints "placeholders: none".)

**The last section, "Short-Form Disclaimers for Use on the Website", is not published** (it is
for developers and designers; its lines are the short notes on the screens). The Word file
keeps it; the script skips it (`SKIP_SECTIONS`), so /disclaimer shows 16 sections.

**Short notes in the app** (`shared/ui/DisclaimerNote.jsx`; one grey line, an info icon and
"Read disclaimer" linking to the section; keys `disclaimer.note.*`): the document's short
forms, brand already CREWNBUILD. Where the document has no short form, the line quotes the
section it links to: property prices (9.2), Book Technician ("Read This First", third
point), adverts (6.4, with a visible "Sponsored" label), the language switcher (12.1, as the
switcher's tooltip and screen-reader description, so the header keeps its size), and Viswa
("Viswa can make mistakes. Not professional advice.", wording given by the product owner,
linked to section 3). For legal review: the document has no short form for Book Technician,
property prices or Viswa.

## Versions

Both texts are version **1.1** (20 November 2026); 1.0 was the 17 November text. The
backends accept sign-up only with the current versions (`TERMS_VERSION` /
`PRIVACY_VERSION` in `professional/backend/app/core/legal.py` and
`partner/backend/app/core/legal.py`); a test in each backend checks that they equal the
version in the frontend's generated text. When a text changes: replace the Word file, raise
the version (in the document, or `DEFAULT_VERSION` in the script when the document prints
none), rerun the script, and change both constants in the same commit. Accounts keep the
version they accepted.
