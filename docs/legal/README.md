# Terms of Service and Privacy Policy

The two PDFs in this folder are the source:

- `CrewnBuild_Terms_and_Conditions.pdf`
- `CrewnBuild_Privacy_Policy.pdf`

`python scripts/convert_legal_docs.py` (needs PyMuPDF: `pip install pymupdf`) turns them into
the content both web apps render, written to `src/features/legal/content/{terms,privacy}.js`
in `professional/frontend` and `partner/frontend` (identical copies; the apps share no code).
The text lives in the frontends only. Replace a PDF and rerun the script; never edit the
generated files by hand. The script reads the structure from the type sizes (title,
section headings, numbered clauses, body lines; the running header and page numbers are
dropped) and prints every placeholder left.

Both apps publish them at `/terms` and `/privacy` (public, linked from the footers' Legal
column), and open them in a dialog from the sign-up consent checkbox. Each account records
the `terms_version`, `privacy_version` and `terms_accepted_at` it agreed to; the backends
refuse sign-up without acceptance (see "Versions" below).

## Changes made in conversion

- "GharBanao" → "CREWNBUILD" (including "CREWNBUILD Verified", "CREWNBUILD Weekly").
- "GharBanao Technologies Pvt. Ltd." → **[Company legal name]** (placeholder; also the
  running page header of the PDFs, which is not shown).
- `dpdp@gharbanao.in` → **[privacy contact email]** (placeholder).
- `gharbanao.in` → `crewnbuild.com`. This also turned `support@`, `legal@` and
  `grievance@gharbanao.in` into `support@crewnbuild.com`, `legal@crewnbuild.com` and
  `grievance@crewnbuild.com`. **Confirm these mailboxes exist before publishing.**
- The PDFs set the rupee sign in a symbol font whose text reads "I" ("I2,999"); the script
  restores "₹".
- The PDFs carry no effective date, last-updated date or version line. The pages show
  **[DD Month YYYY]** for both dates until legal review sets them, and the version from
  the script (see "Versions").
- Everything else is word for word. The numbered clauses are bold throughout in the PDFs;
  on the pages only the clause number is bold, so the text stays readable.

## Placeholders still to complete (legal review)

Shown on the pages exactly as written, lightly highlighted.

### Terms of Service (24)

| Placeholder | Where |
|---|---|
| [Company legal name] | Header; 1. Acceptance and Eligibility; 20. Grievance Redressal; Contact Us |
| [Company registration number] | 1. Acceptance and Eligibility; Contact Us |
| [Registered office address] | 1. Acceptance and Eligibility; 20. Grievance Redressal; Contact Us |
| [notice period] | 1. Acceptance and Eligibility |
| [to be confirmed] | 4. Accounts and Verification (KYC); 7. Terms for Contractors and Service Professionals |
| [number] | 6. Terms for Homeowners |
| [except where the contact number is shown to be invalid or a duplicate, in which case we may issue a replacement credit] | 7. Terms for Contractors and Service Professionals |
| [at least weekly, or whenever prices change] | 8. Terms for Suppliers |
| [or promptly tell the buyer if you cannot] | 8. Terms for Suppliers |
| [inclusive or exclusive, as applicable] | 9. Fees, Pricing, Estimates and Payments |
| [less the value of any Leads accepted in that period] | 10. Cancellations and Refunds |
| [number of days] | 10. Cancellations and Refunds |
| [refund processing period] | 10. Cancellations and Refunds |
| [notice or export period] | 19. Suspension and Termination |
| [Grievance Officer name] | 20. Grievance Redressal |
| [Designation] | 20. Grievance Redressal |
| [Contact number] | 20. Grievance Redressal |
| [business hours] | 20. Grievance Redressal |
| [privacy contact email] | 20. Grievance Redressal; Contact Us |
| [Optional] | 21. Governing Law and Dispute Resolution |
| [amount to be confirmed] | 21. Governing Law and Dispute Resolution |
| [arbitral institution to be confirmed] | 21. Governing Law and Dispute Resolution |
| [Hyderabad, Telangana] | 21. Governing Law and Dispute Resolution |
| [DD Month YYYY] | Header (effective date, last updated; not in the PDF) |

### Privacy Policy (21)

| Placeholder | Where |
|---|---|
| [Company legal name] | Header; 1. Who We Are and What This Policy Covers; 12. Data Protection Officer and Grievance Redressal; 14. Contact Us |
| [privacy contact email] | At a Glance; 6. Worker Data and Other People’s Data; 8. Your Rights; 12. Data Protection Officer and Grievance Redressal; 14. Contact Us |
| [Company registration number] | 1. Who We Are and What This Policy Covers; 14. Contact Us |
| [Registered office address] | 1. Who We Are and What This Policy Covers; 12. Data Protection Officer and Grievance Redressal; 14. Contact Us |
| [confirm with KYC partner] | 2. Personal Data We Collect |
| [provider name] | 4. Who We Share Data With |
| [hosting provider and region] | 4. Who We Share Data With |
| [cloud region] | 4. Who We Share Data With |
| [for example PAN, driving licence or voter ID; confirm] | 7. Aadhaar and Identity Verification |
| [KYC partner] | 7. Aadhaar and Identity Verification |
| [last four digits] | 7. Aadhaar and Identity Verification |
| [retention period] | 9. How Long We Keep Data |
| [backup retention period] | 9. How Long We Keep Data |
| [inactivity period] | 9. How Long We Keep Data |
| [Align with ISO/IEC 27001; confirm.] | 10. How We Protect Data |
| [Data Protection Officer name] | 12. Data Protection Officer and Grievance Redressal |
| [Designation] | 12. Data Protection Officer and Grievance Redressal |
| [Contact number] | 12. Data Protection Officer and Grievance Redressal |
| [business hours] | 12. Data Protection Officer and Grievance Redressal |
| [notice period] | 13. Changes to This Policy |
| [DD Month YYYY] | Header (effective date, last updated; not in the PDF) |

The Grievance Officer's and DPO's **[Contact number]** is left for legal review; the site's
support line (+91 628 1921 628, shown in the footers) is not assumed to be that number.

## Statements that do not match the app (flagged, not changed)

The texts were written for another product (the PDFs repeat the earlier drafts on every point below). These statements contradict how CREWNBUILD
handles data, promise things it does not do, or leave out data it does process. **None of
the texts was changed**; each needs a decision by legal / product before publishing.
Paths are in the repository; PB = `partner/backend/app`, PrB = `professional/backend/app`.

### Identity, Aadhaar and face capture (Partner technicians) — highest priority

1. **"We do not store full Aadhaar numbers or biometric data"** (Privacy: At a Glance, 2.8,
   7.3; "we keep only the verification status, name-match outcome, [last four digits] and a
   non-reversible token"). *Contradiction.* Partner stores the full Aadhaar number
   encrypted, with its last four digits and a keyed fingerprint
   (PB/modules/technicians/identity_service.py `aadhaar_ciphertext`, `aadhaar_last4`,
   `aadhaar_fingerprint`), and a live face photo as an encrypted file for review
   (same file, face capture). There is no name-match outcome or KYC token.
2. **"We verify through a UIDAI-permitted route … through [KYC partner] and do not collect
   your Aadhaar number or biometrics ourselves"** (Privacy 7.2, 2.3). *Contradiction.*
   The app collects the number itself (format check only) and a person reviews the
   submission (PB/scripts/identity_review.py); there is no KYC provider.
3. **"Aadhaar-based verification is voluntary … another officially valid document"**
   (Privacy 7.1; Terms 4.3(b)). *Contradiction.* A technician cannot receive jobs without
   Aadhaar and face capture (PB/modules/technicians/eligibility.py; onboarding steps
   EMAIL → FACE → AADHAAR → PROFILE); no other document is offered.
4. **Withdrawal deletes verification data; KYC kept "[retention period] years after account closure"** (Privacy
   7.4, 9). *Unsupported.* Partner has no consent-withdrawal or account-deletion path; the
   encrypted Aadhaar has no retention limit.
5. **Face-capture retention is not stated.** *Omission.* The photo is deleted on the
   reviewer's decision or after 7 days (PB/core/config.py `face_capture_retention_days`).

### Money

6. **Technician payout bank details** (holder, bank, encrypted account number, IFSC) are
   not mentioned anywhere. *Omission* (PB/modules/technicians/bank_account_service.py).
7. **"Free for Homeowners … CREWNBUILD does not receive, hold or pay out Project payments
   … no commission"** (Terms Key Points, 3.4, 6.1, 9.1, 9.6). *Contradiction.* House
   Owners and Site Engineers pay technician bookings through CREWNBUILD's Razorpay
   account (PrB/modules/billing/booking_payment_service.py), and Partner records a
   platform commission per job (PB/core/config.py `partner_commission_rate_percent`;
   PB/modules/technicians/earnings_service.py).
8. **Auto-renewing subscriptions, RBI e-mandate, pre-debit notice, "Account → Billing"
   cancel** (Terms 9.5; Privacy 2.3). *Contradiction.* Plans are one-off prepaid periods
   with no auto-renewal, mandate or cancel endpoint (PrB/modules/billing/subscription_service.py).
9. **Plans and prices "Starter free / Pro ₹999 / Enterprise ₹2,999", "14-day free trial"
   converting to paid, 14-day refund window, annual pro-rated refunds** (Terms 7.1, 9.5,
   10.1). *Contradiction.* The app's tiers are Free, Professional and Business
   (Professional ₹899/month, Business ₹1,199/month or ₹9,999/year; PrB/modules/billing/plans.py,
   PrB/seeds/seed_subscription_plan_prices.py); new builders get 30 days of Professional
   free, which never converts to paid; refunds come only from the payment provider.
10. **Lead Credits** (packs ₹4,000/5 …; a Lead "offered for 2 hours", accepting "deducts a
    credit"; Terms 7.2, 9.1, 10.2; Privacy 2.3). *Unsupported.* No credits or lead
    expiry exist; "leads" in the app are a per-plan cap on a builder's open requests.
11. **Supplier featured plans ₹2,000 / ₹4,000 / ₹8,000, listing-payment records** (Terms
    8.4, 9.1, 10.3; Privacy 2.4). *Unsupported.* Suppliers have no paid plans.
12. **GST invoices / GST Invoice Generator** (Privacy 3.1; Terms 7.5, 9.3). *Unsupported.*
    No GST invoicing; booking receipts state no tax.
13. **Escrow "if and when offered … until then an indicative plan"** (Terms 9.6). The app
    already shows an "Escrow milestones" section (a budget split by stage; no money is
    held). The label and the text should agree.

### Location

14. **"Precise device location only if you grant permission", used for rates, permits and
    nearby contractors** (Privacy 2.6). *Contradiction / omission.* Technicians must share
    continuous GPS to be offered jobs, streamed live to the customer during a booking
    (PB/modules/technicians/technician_location_service.py; one live row, removed on
    sign-out, going offline, or an hour after the last update); booking addresses and
    coordinates are stored; the weather feature uses device location. None of these
    purposes is listed.
15. **"Approximate location derived from your IP address"** (Privacy 2.1). *Unsupported.*
    No IP geolocation exists.

### Sharing and processors

16. **"We share your details … only when you ask us to connect you"; "Contractors see
    contact details only after they accept a Lead"** (Privacy At a Glance, 3.1, 4.1).
    *Contradiction.* Builders' Find Clients lists open projects and their House Owners in
    their pincodes without any enquiry: owner name, photo, street address, pincode,
    budget, area and description (PrB/modules/marketplace/discovery_service.py). Phone and
    e-mail are withheld until a request between the two is accepted (either side).
17. **Processors** (Privacy 4.2, 4.8; Terms 14) — placeholders today; the code uses:
    Dovesoft (WhatsApp), Resend and SMTP (e-mail), Razorpay, AWS S3 (default region
    `us-east-1` in config: check the "primary storage in India" claim), Google and
    Microsoft sign-in, an OpenAI-compatible service and Google Gemini (machine
    translation of user text; Vastu floor-plan analysis), Open-Meteo (weather), OpenStreetMap
    Nominatim (geocoding booking addresses), OSRM (routing), map tiles, India Post (PIN
    codes). No KYC partner, SMS provider, analytics or fraud tool is used.
18. **"GSTIN verified against the GST portal"; GST portal, RERA portal and analytics as
    sources** (Privacy 2.4, 2.7). *Unsupported.* Builder and supplier verification is
    manual admin review of uploaded documents (PrB/modules/admin/verification_service.py).

### Sign-in, consent and rights

19. **"Sign you in by OTP"; "verify your mobile number by OTP"; SMS** (Privacy 3.1; Terms
    4.2, 5.5). Sign-in is e-mail and password, e-mail code, WhatsApp code (optional),
    Google / Microsoft (Professional), and e-mail code plus password (Partner). No SMS is
    sent; the cross-app Partner hand-off sign-in is not mentioned.
20. **Per-purpose consents, marketing opt-in / "STOP", the "CREWNBUILD Weekly"
    newsletter, withdrawing consent in settings** (Privacy 3.2, 8.1, 9). *Unsupported.*
    The only consent recorded is the Terms / Privacy acceptance at sign-up.
21. **18 and over** (Terms 1.3; Privacy 11). *Unsupported.* No age check.
22. **Data access summary, nomination, "Privacy Settings" page, export records for 30 days
    after closure** (Privacy 8.1–8.2; Terms 19.3). *Unsupported.*
23. **Cookie banner, analytics and marketing cookies** (Privacy 5). *Unsupported.* No
    banner or analytics; only the HttpOnly session cookies and local preferences.

### Retention

24. **"Deleted accounts: personal data erased within 30 days"; active data kept 3 years after
    closure; KYC [retention period] years; inactive accounts after [inactivity period] years**
    (Privacy 9).
    *Contradiction / unsupported.* Professional deletion is an immediate anonymising soft
    delete that keeps a permanent deletion record (name, e-mail, phone) with no purge
    (PrB/modules/accounts/account_deletion_service.py); Partner has no deletion; no
    inactivity or backup job exists.
25. **Logs kept 13 months** (Privacy 9). *Unsupported.* Logs go to stdout with no set
    retention; the admin and CCTV audit logs are kept without limit.

### "Tools run on your device"

26. **"Calculators run on your device; figures not sent to our servers"** (Privacy At a
    Glance, 2.2). *Partly contradicted.* The construction cost estimator sends area,
    budget and location to the server to calculate (not stored); a Vastu plan is uploaded
    and sent to Gemini. Stamp duty, TDS, loan and ROI calculators are on-device. There are
    no capital-gains or solar calculators.

### Features named in the texts that the app does not have

27. Defect / Warranty Tracker and notices, 21-day defect response; RERA Builder Trust
    Score, quote benchmarks, Construction Cost Index and "human review" of scores;
    WhatsApp share cards and payslips; client portal; Professional Quote PDF; maintenance
    reminders, Budget Tracker, Material Logger, Rate Analysis Calculator; the Homeowner
    enquiry sent to "up to [number]" businesses; possibly staff accounts and supplier rate-card
    validity and bulk order matching.
28. **Labour Wage Register** (Privacy 2.5, 6, 11; Terms 7.5–7.6). *Partly.* Builders' daily
    cost records hold worker names, optional phone, attendance and daily wage; no bank /
    UPI details, UAN, ESIC, e-Shram, payslips or injury records, and no feature by that name.

### Data the app processes that the texts never mention

29. The Partner app and technicians as a user class: face, Aadhaar, bank details, live GPS,
    job photos (before / after / customer), the start-work code, bills, ratings, earnings
    and commission; technicians see a customer's first name and phone once a job is accepted.
30. Data passed between the two apps: owners' and Site Engineers' contact details to the
    Partner app for bookings (PrB/modules/accounts/partner_view.py), bookings back.
31. Live CCTV / DVR access to project sites, encrypted camera credentials, and an audit
    trail with viewers' IP addresses (PrB/modules/cctv).
32. In-app messaging with attachments, notifications, support tickets with attachments,
    abuse reports; weather alerts on project locations; site photo and video uploads;
    third-party ads; the supplier shop, purchase orders, labour and equipment supply.

### Not checked against code

33. The DPDP timeline ("core obligations from May 2027"), staff MFA, encryption at rest
    beyond Aadhaar / bank / face / camera credentials, PCI-DSS and penetration testing.

## Versions

The PDFs have no version, so `VERSIONS` in `scripts/convert_legal_docs.py` sets it: both
texts are **1.1** (1.0 was the earlier Word drafts). The backends accept sign-up only with
the current versions (`TERMS_VERSION` / `PRIVACY_VERSION` in
`professional/backend/app/core/legal.py` and `partner/backend/app/core/legal.py`). When a
text changes: replace the PDF, raise its version in the script, rerun it, and raise the
matching constant in both backends in the same commit. Accounts keep the version they
accepted.
