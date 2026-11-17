# Terms of Service and Privacy Policy

The two Word files in this folder are the source and the final text:

- `CREWNBUILD_Terms_and_Conditions.docx`
- `CREWNBUILD_Privacy_Policy.docx`

`python scripts/convert_legal_docs.py` (needs `pip install python-docx`) turns them into the
content both web apps render, written to `src/features/legal/content/{terms,privacy}.js` in
`professional/frontend` and `partner/frontend` (identical copies; the apps share no code).
The wording is copied exactly: nothing is replaced or removed. The structure comes from the
Word styles (Heading 1 title, Heading 2 sections, bulleted and numbered lists, bold runs),
and the effective date, version and last-updated date from the line under the title. Replace
a Word file and rerun the script; never edit the generated files by hand.

Both apps publish:

- `/legal`, the Legal hub: a welcome card, one card per policy (our short summary, its
  version and effective date, a link to the full text) and a Contact card
  (support@crewnbuild.com, +91 628 1921 628);
- `/terms` and `/privacy`, the full texts, each with a table of contents and a Back link to
  `/legal`.

All three are public and linked from the footers' Legal column. The sign-up consent line
opens either text in a dialog. Each account records the `terms_version`, `privacy_version`
and `terms_accepted_at` it agreed to; the backends refuse sign-up without acceptance (see
"Versions" below).

The final texts have no [placeholders] left. They name two mailboxes, support@crewnbuild.com
and legal@crewnbuild.com: confirm both exist before publishing.

## Statements that do not match the app (flagged, not changed)

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

### Not checked against code

31. The DPDP timeline ("core obligations from May 2027"), staff MFA, encryption at rest
    beyond Aadhaar / bank / face / camera credentials, PCI-DSS and penetration testing.

## Versions

The version printed in each Word file is the version an account accepts: both are **1.0**,
effective 17 November 2026. The backends accept sign-up only with these versions
(`TERMS_VERSION` / `PRIVACY_VERSION` in `professional/backend/app/core/legal.py` and
`partner/backend/app/core/legal.py`); a test in each backend checks that they equal the
version in the frontend's generated text. When a text changes: replace the Word file with
its new version printed, rerun the script, and change both constants in the same commit.
Accounts keep the version they accepted.
