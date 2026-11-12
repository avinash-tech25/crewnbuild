# Porting to-do: stubs and temporary behaviour

Every stub or temporary behaviour the restructure has left in place, one line each. Each module adds its own stubs here and removes the lines it wires back. Paths are under `professional/backend/app/` unless they name another place.

| # | Module | File / function | What is switched off or temporary | Wired back by |
| --- | --- | --- | --- | --- |
| 1 | accounts | `modules/projects/owner_first_project.py` → `create_owner_profile_project_if_missing` | Completing a House Owner profile with a project title and description creates no first project (no-op) | projects module |
| 2 | accounts | `modules/accounts/repository.py` → `count_open_partner_bookings` | Reads `partner.v_professional_bookings` only when the view exists; until Partner's baseline creates and grants it, no booking counts as open | R4c (Partner baseline with the view) |
| 3 | accounts | `modules/accounts/profile_payloads.py` → `builder_reviews` | Business-logo answer always reports 0 reviews | projects module (`project_reviews`) |
| 4 | accounts | `modules/admin/audit_log.py` → `record_admin_action` | No audit row when an administrator changes its own sign-in number | admin module (`admin_audit_logs`) |
| 5 | accounts | `modules/files/file_ownership.py` → `release_unreferenced_files` | Replaced photos and logos, removed portfolio media and a deleted account's files are only unlinked; nothing is deleted from storage | files module |
| 6 | accounts | `modules/billing/lead_locations.py` → `plan_in_force` / `limited_plan` | Builder location caps read `builder_subscriptions` directly (Free when the table is missing); no free-trial state | billing module (replace with `subscription_state`) |
| 7 | accounts | `modules/accounts/deletion_blockers.py` → `pending_shared_project_titles` | SHARED_PROJECTS refusal never fires | projects module |
| 8 | accounts | `modules/accounts/deletion_blockers.py` → `pending_builder_history_project_titles` | BUILDER_PROJECT_HISTORY refusal never fires | projects, site_operations, labour_supply, equipment_supply modules |
| 9 | accounts | `modules/accounts/deletion_blockers.py` → `pending_supplier_transaction_history_count` | SUPPLIER_TRANSACTION_HISTORY refusal never fires | marketplace and store modules |
| 10 | accounts | `modules/accounts/deletion_blockers.py` → `pending_supplier_project_history_titles` | SUPPLIER_PROJECT_HISTORY refusal never fires | labour_supply, equipment_supply, projects modules |
| 11 | accounts | `modules/accounts/deletion_blockers.py` → `pending_store_manager_shared_history_count` | STORE_MANAGER_HISTORY refusal never fires | store and marketplace modules |
| 12 | accounts | `modules/accounts/deletion_blockers.py` → `pending_engineer_history_project_titles` | ENGINEER_PROJECT_HISTORY refusal never fires | labour_supply, equipment_supply, marketplace, store, projects modules |
| 13 | identity | `core/security/access_tokens.py` → `ACCESS_ISSUER` | Hand-off token issuer is now `professional`; old Partner code checks `iss=octabuild` | R4c (Partner accepts `iss=professional`) |
| 14 | identity | `core/config.py` → `google_redirect_uri`, `microsoft_redirect_uri` | Callbacks moved to `/api/v1/auth/oauth/<provider>/callback`; the Google and Microsoft consoles still list the old address | Deployment (update both provider consoles) |
| 15 | accounts | `modules/files/file_ownership.py` → `FILE_ADDRESS` | Stored file addresses are now `/files/<uuid>`; data copied from the old database still holds `/files/<int>` | R8 (data copy rewrites file addresses) |
| 16 | accounts | `modules/accounts/service.py` → `complete_user_profile` | Complete-profile writes `profile_image_url`, `company_logo_url` and `store_logo_url` without the own-upload check (old bug kept) | R6 (security layer) |
| 17 | billing | `modules/billing/signup_checkout.py` → `has_paid_period` | Pending paid sign-up reads `builder_subscriptions` directly; no paid period while the table is missing | billing module |
| 18 | identity | `modules/identity/login_throttle.py` | Password sign-in throttle counts in each process at 10 per account / 50 per address, not shared and not section 6.4's 5/20 | R6 (security layer) |
