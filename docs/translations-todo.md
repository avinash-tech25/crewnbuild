# Translations to do before release

The Professional web app is translated into Arabic (`ar`), Hindi (`hi`), Kannada (`kn`), Malayalam (`ml`), Tamil (`ta`) and Telugu (`te`), one file per language in `professional/frontend/src/i18n/locales/`. A key missing from a language shows the English text (`i18n/dictionaries.js`), so nothing breaks, but these labels are not translated yet.

**How this list was made:** every key in `locales/en.js` that the old app's English text (`Kuwait-Version/Octabuild/frontend 7/frontend/src/i18n/translations.js`, the state R7 started from) did not have, checked against each language file. All other English keys are unchanged since the old app, and no language lost a translation it had there.

**Status (14 Nov 2026):** 18 keys, missing in all six languages. Seventeen are from the request details change (a supplier or builder shown by who they are, `features/requests/counterparty.js` and `features/requests/components/PartyDetails.jsx`); one is the plans section's "Most popular" label.

| Key | English | Where it shows | Missing in |
| --- | --- | --- | --- |
| `req.party.supplierName` | Supplier name | Request details: row label | ar, hi, kn, ml, ta, te |
| `req.party.builderName` | Builder name | Request details: row label | ar, hi, kn, ml, ta, te |
| `req.party.company` | Company | Request details: row label | ar, hi, kn, ml, ta, te |
| `req.party.supplierCategory` | Supplier category | Request details: row label | ar, hi, kn, ml, ta, te |
| `req.party.offers` | Offers | Request details: a Material Supplier's offer row | ar, hi, kn, ml, ta, te |
| `req.party.trades` | Trades | Request details: a Labour Supplier's offer row | ar, hi, kn, ml, ta, te |
| `req.party.equipmentTypes` | Equipment types | Request details: an Equipment Supplier's offer row | ar, hi, kn, ml, ta, te |
| `req.party.listingsOne` | {count} active listing | Offer row, one listing (keep `{count}`) | ar, hi, kn, ml, ta, te |
| `req.party.listingsMany` | {count} active listings | Offer row, several listings (keep `{count}`) | ar, hi, kn, ml, ta, te |
| `req.party.verified` | Verified | Request details: row label | ar, hi, kn, ml, ta, te |
| `req.party.verifiedYes` | Verified | Verified row value, and the badge on the builder's card | ar, hi, kn, ml, ta, te |
| `req.party.verifiedNo` | Not verified yet | Verified row value | ar, hi, kn, ml, ta, te |
| `req.party.memberSince` | Member since | Request details: row label; supplier's requests table | ar, hi, kn, ml, ta, te |
| `req.party.memberSinceValue` | {date} | Member-since value; `{date}` is the month and year in the reader's language. Change only if the language needs words around the date | ar, hi, kn, ml, ta, te |
| `req.party.phone` | Phone | Request details, after acceptance | ar, hi, kn, ml, ta, te |
| `req.party.email` | Email | Request details, after acceptance | ar, hi, kn, ml, ta, te |
| `req.party.contactAfterAccept` | Phone and email are shared once the request is accepted. | Request details, before acceptance | ar, hi, kn, ml, ta, te |
| `subscription.plans.mostPopular` | Most popular | Builder plans (landing page and sign-up): the label on the recommended plan | ar, hi, kn, ml, ta, te |

**Not covered by this list:**

- The **Partner** web app (`partner/frontend`) has no translations at all; it is English only, as the old Partner app was.
- Text that comes from the server (error messages, notification texts) is in English in both apps, as before.

To check again, compare `locales/en.js` with each language file: every key in English should be in all six.
