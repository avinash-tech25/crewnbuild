# Schema comparison: the old live database and the new schema (MG-07)

The old live database `octabuild` (Professional in schema `octabuild`, Partner in schema `partner`; `LEGACY_PARTNER_DATABASE_URL` is not set) compared with the new baselines (`professional` 0002, `partner` 0001, technical-architecture.md section 16.2). Read in a read-only session and read-only transactions; nothing was written. Every old table and column is listed with where it lives now; row counts are of the old tables on 2026-11-13.

## No home

Old columns that nothing in the new schema holds. None is read by the old code at the head of the old repository, so dropping them changes no behaviour; the data they hold is noted.

| Old table | Column | Rows in table | Why it has no home |
| --- | --- | --- | --- |
| `octabuild.supplier_products` | `stock_quantity` | 11 | not in the old code: a column left by an earlier migration; differs from `quantity` in all 11 rows |
| `partner.service_request_assignments` | `accepted_at` | 0 | not in the old code (it records `responded_at` + `status`); empty in all rows |
| `partner.service_request_tracking` | `technician_id` | 0 | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `partner.service_request_tracking` | `latitude` | 0 | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `partner.service_request_tracking` | `longitude` | 0 | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `partner.service_request_tracking` | `accuracy` | 0 | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `partner.service_request_tracking` | `heading` | 0 | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `partner.service_request_tracking` | `speed` | 0 | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `partner.service_request_tracking` | `location_updated_at` | 0 | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `partner.services` | `option_group` | 15 | from revision `0014_service_options`, which is not in the old repository; no old code reads it; set on 3 of 15 rows, one group |
| `partner.services` | `option_name` | 15 | from revision `0014_service_options`, which is not in the old repository; no old code reads it; set on 3 of 15 rows, one group |

No old table is without a home: every data table maps to one new table, or two where section 10 splits it. The two Alembic version tables are replaced by the new ones.

## Findings

- **The live database is behind the old code.** Professional is at revisions `0018_subcategory_image`, `0014_cctv_shared_state` (two heads) of the old repository's 54, so it has 63 of the 98 tables the old code defines. Partner is at `0014_service_options`, a revision that is **not** in the old repository (its 0014 is `0014_production_dispatch`); the database was migrated from another branch.
- **`supplier_products` has two stock columns.** The old code reads and writes `quantity`; `stock_quantity` is left from an earlier migration and differs in all 11 rows. The new `supplier_listings.stock_quantity` holds the old `quantity` (the new model keeps the attribute name `quantity`). A data copy (R8) must take `quantity`, not `stock_quantity`.
- **Columns the database has that the old code does not**: `services.option_group/option_name`, `service_request_assignments.accepted_at`, the live-position columns of `service_request_tracking`, and `supplier_products.stock_quantity` (all in the no-home list).
- **Columns the old code renamed that this database still has under the old name**: `technician_profiles.is_available` (now `work_status`), `technician_locations.device_recorded_at` (now `device_timestamp`). Both have a home under the new name.
- **Encrypted bank account numbers** carry no key version in the old table; a copy must decrypt them with the old key and re-encrypt with the current versioned key.

## Totals

| | Count |
| --- | --- |
| Old tables (data) | 84 (63 Professional, 21 Partner) |
| Old Alembic version tables | 2 (replaced) |
| Old rows (data tables) | 614 |
| Old columns | 959 |
| Old columns with a home | 948 |
| Old columns with no home | 11 |
| Old tables without a home | 0 |
| New tables | 122 (100 Professional, 22 Partner) |
| New tables with no table in this database | 36 |

Tables the old code defines but this database lacks (later old revisions; no data to copy): Professional `account_deletion_requests`, `auth_sessions`, `builder_subscriptions`, `daily_record_adjustments`, `equipment_items`, `equipment_requests`, `equipment_usage_logs`, `labor_daily_records`, `labor_requests`, `labor_services`, `oauth_identities`, `payment_orders`, `payment_receipts`, `payment_transactions`, `phone_otp_send_events`, `phone_verifications`, `store_builder_requests`, `store_items`, `store_payment_records`, `store_purchase_receipts`, `store_site_request_lines`, `store_site_requests`, `store_stock_movements`, `subscription_coupon_redemptions`, `subscription_coupons`, `subscription_payments`, `subscription_plan_prices`, `subscription_webhook_events`, `support_ticket_messages`, `support_tickets`, `weather_alert_acknowledgements`, `weather_alerts`, `weather_geocode_cache`, `weather_site_locations`, `weather_snapshots`; Partner `auth_sessions`.

New tables with no table in this database: `partner.sessions`, `professional.account_deletion_requests`, `professional.booking_payment_orders`, `professional.booking_payment_receipts`, `professional.booking_payment_transactions`, `professional.builder_subscriptions`, `professional.equipment_listings`, `professional.equipment_requests`, `professional.equipment_usage_logs`, `professional.labour_attendance_records`, `professional.labour_requests`, `professional.labour_services`, `professional.otp_send_events`, `professional.payment_webhook_events`, `professional.phone_verification_codes`, `professional.site_daily_record_adjustments`, `professional.store_builder_requests`, `professional.store_goods_receipts`, `professional.store_items`, `professional.store_payments`, `professional.store_site_request_items`, `professional.store_site_requests`, `professional.store_stock_movements`, `professional.subscription_coupon_redemptions`, `professional.subscription_coupons`, `professional.subscription_payments`, `professional.subscription_plan_prices`, `professional.support_ticket_messages`, `professional.support_tickets`, `professional.user_oauth_identities`, `professional.user_sessions`, `professional.weather_alert_acknowledgements`, `professional.weather_alerts`, `professional.weather_geocode_cache`, `professional.weather_site_locations`, `professional.weather_snapshots`.

## Every old table and column

A column whose name did not change and whose table is renamed only is shown with its new table. Every `id` becomes a UUID (section 9.1); integer references follow it.

### `octabuild.admin_profiles` → `professional.admin_profiles` (2 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `admin_profiles.id` | id becomes UUID (section 9.1) |
| `user_id` | uuid | `admin_profiles.user_id` |  |
| `scope` | character varying | `admin_profiles.scope` |  |
| `permissions` | text | `admin_profiles.permissions` |  |
| `created_by_id` | uuid | `admin_profiles.created_by_id` |  |
| `created_at` | timestamp without time zone | `admin_profiles.created_at` |  |
| `updated_at` | timestamp without time zone | `admin_profiles.updated_at` |  |

### `octabuild.advertisement_daily_stats` → `professional.ad_daily_stats` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `ad_daily_stats.id` | id becomes UUID (section 9.1) |
| `advertisement_id` | integer | `ad_daily_stats.ad_id` | table renamed |
| `placement` | character varying | `ad_daily_stats.placement` |  |
| `day` | date | `ad_daily_stats.day` |  |
| `views` | integer | `ad_daily_stats.views` |  |
| `clicks` | integer | `ad_daily_stats.clicks` |  |

### `octabuild.advertisements` → `professional.ads` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `ads.id` | id becomes UUID (section 9.1) |
| `title` | character varying | `ads.title` |  |
| `image_url` | character varying | `ads.image_url` |  |
| `link_url` | character varying | `ads.link_url` |  |
| `placements` | text | `ads.placements` |  |
| `scope` | character varying | `ads.scope` |  |
| `status` | character varying | `ads.status` |  |
| `starts_on` | date | `ads.starts_on` |  |
| `ends_on` | date | `ads.ends_on` |  |
| `display_width` | character varying | `ads.display_width` |  |
| `price_amount` | numeric | `ads.price_amount` |  |
| `currency` | character varying | `ads.currency` |  |
| `pricing_model` | character varying | `ads.pricing_model` |  |
| `created_by_id` | uuid | `ads.created_by_user_id` | user reference: `_user_id` name (section 9.2) |
| `created_at` | timestamp without time zone | `ads.created_at` |  |
| `updated_at` | timestamp without time zone | `ads.updated_at` |  |

### `octabuild.audit_events` → `professional.admin_audit_logs` (70 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `admin_audit_logs.id` | id becomes UUID (section 9.1) |
| `actor_id` | uuid | `admin_audit_logs.actor_id` |  |
| `actor_email` | character varying | `admin_audit_logs.actor_email` |  |
| `actor_role` | character varying | `admin_audit_logs.actor_role` |  |
| `scope` | character varying | `admin_audit_logs.scope` |  |
| `action` | character varying | `admin_audit_logs.action` |  |
| `target_type` | character varying | `admin_audit_logs.target_type` |  |
| `target_id` | character varying | `admin_audit_logs.target_id` |  |
| `summary` | text | `admin_audit_logs.summary` |  |
| `reason` | text | `admin_audit_logs.reason` |  |
| `created_at` | timestamp without time zone | `admin_audit_logs.created_at` |  |

### `octabuild.award_offers` → `professional.project_award_offers` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `project_award_offers.id` | id becomes UUID (section 9.1) |
| `award_id` | integer | `project_award_offers.award_id` |  |
| `proposed_by_id` | uuid | `project_award_offers.proposed_by_user_id` | user reference: `_user_id` name (section 9.2) |
| `amount` | numeric | `project_award_offers.amount` |  |
| `note` | text | `project_award_offers.note` |  |
| `status` | character varying | `project_award_offers.status` |  |
| `created_at` | timestamp without time zone | `project_award_offers.created_at` |  |
| `responded_at` | timestamp without time zone | `project_award_offers.responded_at` |  |

### `octabuild.builder_engineer_invitations` → `professional.team_invitations` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `team_invitations.id` | id becomes UUID (section 9.1) |
| `contractor_id` | uuid | `team_invitations.builder_id` | `contractor_id` → `builder_id` (role BUILDER) |
| `invite_code` | character varying | `team_invitations.invite_code` |  |
| `phone` | character varying | `team_invitations.phone` |  |
| `email` | character varying | `team_invitations.email` |  |
| `status` | character varying | `team_invitations.status` |  |
| `created_at` | timestamp without time zone | `team_invitations.created_at` |  |
| `updated_at` | timestamp without time zone | `team_invitations.updated_at` |  |

### `octabuild.builder_engineer_memberships` → `professional.team_memberships` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `team_memberships.id` | id becomes UUID (section 9.1) |
| `contractor_id` | uuid | `team_memberships.builder_id` | `contractor_id` → `builder_id` (role BUILDER) |
| `engineer_id` | uuid | `team_memberships.engineer_id` |  |
| `status` | character varying | `team_memberships.status` |  |
| `request_sender_role` | character varying | `team_memberships.request_sender_role` |  |
| `created_at` | timestamp without time zone | `team_memberships.created_at` |  |
| `updated_at` | timestamp without time zone | `team_memberships.updated_at` |  |

### `octabuild.builder_offline_suppliers` → `professional.builder_offline_suppliers` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `builder_offline_suppliers.id` | id becomes UUID (section 9.1) |
| `contractor_id` | uuid | `builder_offline_suppliers.builder_id` | `contractor_id` → `builder_id` (role BUILDER) |
| `name` | character varying | `builder_offline_suppliers.name` |  |
| `phone` | character varying | `builder_offline_suppliers.phone` |  |
| `created_at` | timestamp without time zone | `builder_offline_suppliers.created_at` |  |

### `octabuild.builder_profiles` → `professional.builder_profiles` (1 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `builder_profiles.id` | id becomes UUID (section 9.1) |
| `user_id` | uuid | `builder_profiles.user_id` |  |
| `company_name` | character varying | `builder_profiles.company_name` |  |
| `license_number` | character varying | `builder_profiles.license_number` |  |
| `experience_years` | integer | `builder_profiles.experience_years` |  |
| `completed_projects` | integer | `builder_profiles.completed_projects` |  |
| `completed_project_details` | text | `builder_profiles.completed_project_details` |  |
| `gallery` | text | `builder_profiles.gallery` |  |
| `company_logo_url` | character varying | `builder_profiles.company_logo_url` |  |
| `about` | text | `builder_profiles.about` |  |
| `gstin` | character varying | `builder_profiles.gstin` |  |
| `pan` | character varying | `builder_profiles.pan` |  |
| `website` | character varying | `builder_profiles.website` |  |
| `business_type` | character varying | `builder_profiles.business_type` |  |
| `registration_year` | integer | `builder_profiles.registration_year` |  |
| `team_size` | character varying | `builder_profiles.team_size` |  |
| `insurance_available` | boolean | `builder_profiles.has_insurance` | boolean `has_` name |
| `service_locations` | text | `builder_profiles.service_locations` |  |
| `services_offered` | text | `builder_profiles.services_offered` |  |
| `equipment_owned` | text | `builder_profiles.equipment_owned` |  |
| `documents` | text | `builder_profiles.documents` |  |

### `octabuild.builder_workers` → `professional.builder_workers` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `builder_workers.id` | id becomes UUID (section 9.1) |
| `contractor_id` | uuid | `builder_workers.builder_id` | `contractor_id` → `builder_id` (role BUILDER) |
| `name` | character varying | `builder_workers.name` |  |
| `category` | character varying | `builder_workers.category` |  |
| `created_at` | timestamp without time zone | `builder_workers.created_at` |  |

### `octabuild.cart_items` → `professional.cart_items` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `cart_items.id` | id becomes UUID (section 9.1) |
| `user_id` | uuid | `cart_items.user_id` |  |
| `project_id` | integer | `cart_items.project_id` |  |
| `supplier_id` | uuid | `cart_items.supplier_user_id` | user reference: `_user_id` name (section 9.2) |
| `product_id` | integer | `cart_items.listing_id` | the supplier listing (old supplier_products.id) |
| `quantity` | double precision | `cart_items.quantity` |  |
| `created_at` | timestamp without time zone | `cart_items.created_at` |  |
| `updated_at` | timestamp without time zone | `cart_items.updated_at` |  |

### `octabuild.cctv_audit_events` → `professional.cctv_audit_events` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `cctv_audit_events.id` | id becomes UUID (section 9.1) |
| `occurred_at` | timestamp with time zone | `cctv_audit_events.occurred_at` |  |
| `actor_user_id` | uuid | `cctv_audit_events.actor_user_id` |  |
| `actor_role` | character varying | `cctv_audit_events.actor_role` |  |
| `action` | character varying | `cctv_audit_events.action` |  |
| `outcome` | character varying | `cctv_audit_events.outcome` |  |
| `project_id` | integer | `cctv_audit_events.project_id` |  |
| `device_id` | uuid | `cctv_audit_events.device_id` |  |
| `channel_id` | uuid | `cctv_audit_events.channel_id` |  |
| `playback_session_id` | uuid | `cctv_audit_events.playback_session_id` |  |
| `client_ip` | inet | `cctv_audit_events.client_ip` |  |
| `detail` | jsonb | `cctv_audit_events.detail` |  |

### `octabuild.cctv_channels` → `professional.cctv_channels` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `cctv_channels.id` | id becomes UUID (section 9.1) |
| `device_id` | uuid | `cctv_channels.device_id` |  |
| `project_id` | integer | `cctv_channels.project_id` |  |
| `channel_number` | integer | `cctv_channels.channel_number` |  |
| `name` | character varying | `cctv_channels.name` |  |
| `location_label` | character varying | `cctv_channels.location_label` |  |
| `onvif_video_source_token` | character varying | `cctv_channels.onvif_video_source_token` |  |
| `main_profile_token` | character varying | `cctv_channels.main_profile_token` |  |
| `sub_profile_token` | character varying | `cctv_channels.sub_profile_token` |  |
| `main_stream_path` | character varying | `cctv_channels.main_stream_path` |  |
| `sub_stream_path` | character varying | `cctv_channels.sub_stream_path` |  |
| `main_codec` | character varying | `cctv_channels.main_codec` |  |
| `sub_codec` | character varying | `cctv_channels.sub_codec` |  |
| `main_width` | integer | `cctv_channels.main_width` |  |
| `main_height` | integer | `cctv_channels.main_height` |  |
| `sub_width` | integer | `cctv_channels.sub_width` |  |
| `sub_height` | integer | `cctv_channels.sub_height` |  |
| `preferred_stream` | character varying | `cctv_channels.preferred_stream` |  |
| `status` | character varying | `cctv_channels.status` |  |
| `status_detail` | character varying | `cctv_channels.status_detail` |  |
| `last_checked_at` | timestamp with time zone | `cctv_channels.last_checked_at` |  |
| `is_enabled` | boolean | `cctv_channels.is_enabled` |  |
| `display_order` | integer | `cctv_channels.display_order` |  |
| `created_by_user_id` | uuid | `cctv_channels.created_by_user_id` |  |
| `updated_by_user_id` | uuid | `cctv_channels.updated_by_user_id` |  |
| `created_at` | timestamp with time zone | `cctv_channels.created_at` |  |
| `updated_at` | timestamp with time zone | `cctv_channels.updated_at` |  |

### `octabuild.cctv_device_credentials` → `professional.cctv_device_credentials` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `cctv_device_credentials.id` | id becomes UUID (section 9.1) |
| `device_id` | uuid | `cctv_device_credentials.device_id` |  |
| `username_ciphertext` | bytea | `cctv_device_credentials.username_ciphertext` |  |
| `password_ciphertext` | bytea | `cctv_device_credentials.password_ciphertext` |  |
| `encryption_scheme` | character varying | `cctv_device_credentials.encryption_scheme` |  |
| `key_version` | smallint | `cctv_device_credentials.key_version` |  |
| `last_verified_at` | timestamp with time zone | `cctv_device_credentials.last_verified_at` |  |
| `created_by_user_id` | uuid | `cctv_device_credentials.created_by_user_id` |  |
| `updated_by_user_id` | uuid | `cctv_device_credentials.updated_by_user_id` |  |
| `created_at` | timestamp with time zone | `cctv_device_credentials.created_at` |  |
| `updated_at` | timestamp with time zone | `cctv_device_credentials.updated_at` |  |

### `octabuild.cctv_devices` → `professional.cctv_devices` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `cctv_devices.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `cctv_devices.project_id` |  |
| `name` | character varying | `cctv_devices.name` |  |
| `device_type` | character varying | `cctv_devices.device_type` |  |
| `manufacturer` | character varying | `cctv_devices.manufacturer` |  |
| `model` | character varying | `cctv_devices.model` |  |
| `firmware_version` | character varying | `cctv_devices.firmware_version` |  |
| `serial_number` | character varying | `cctv_devices.serial_number` |  |
| `onvif_endpoint_reference` | character varying | `cctv_devices.onvif_endpoint_reference` |  |
| `host` | character varying | `cctv_devices.host` |  |
| `rtsp_port` | integer | `cctv_devices.rtsp_port` |  |
| `onvif_port` | integer | `cctv_devices.onvif_port` |  |
| `onvif_use_tls` | boolean | `cctv_devices.onvif_use_tls` |  |
| `onvif_service_path` | character varying | `cctv_devices.onvif_service_path` |  |
| `connection_method` | character varying | `cctv_devices.connection_method` |  |
| `status` | character varying | `cctv_devices.status` |  |
| `status_detail` | character varying | `cctv_devices.status_detail` |  |
| `last_checked_at` | timestamp with time zone | `cctv_devices.last_checked_at` |  |
| `last_online_at` | timestamp with time zone | `cctv_devices.last_online_at` |  |
| `is_active` | boolean | `cctv_devices.is_active` |  |
| `created_by_user_id` | uuid | `cctv_devices.created_by_user_id` |  |
| `updated_by_user_id` | uuid | `cctv_devices.updated_by_user_id` |  |
| `created_at` | timestamp with time zone | `cctv_devices.created_at` |  |
| `updated_at` | timestamp with time zone | `cctv_devices.updated_at` |  |

### `octabuild.cctv_discovery_results` → `professional.cctv_discovery_results` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `cctv_discovery_results.id` | id becomes UUID (section 9.1) |
| `device_id` | uuid | `cctv_discovery_results.device_id` |  |
| `project_id` | integer | `cctv_discovery_results.project_id` |  |
| `user_id` | uuid | `cctv_discovery_results.user_id` |  |
| `fingerprint` | character varying | `cctv_discovery_results.fingerprint` |  |
| `candidates` | jsonb | `cctv_discovery_results.candidates` |  |
| `created_at` | timestamp with time zone | `cctv_discovery_results.created_at` |  |
| `expires_at` | timestamp with time zone | `cctv_discovery_results.expires_at` |  |

### `octabuild.cctv_playback_sessions` → `professional.cctv_playback_sessions` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `cctv_playback_sessions.id` | id becomes UUID (section 9.1) |
| `channel_id` | uuid | `cctv_playback_sessions.channel_id` |  |
| `project_id` | integer | `cctv_playback_sessions.project_id` |  |
| `viewer_user_id` | uuid | `cctv_playback_sessions.viewer_user_id` |  |
| `viewer_role` | character varying | `cctv_playback_sessions.viewer_role` |  |
| `access_basis` | character varying | `cctv_playback_sessions.access_basis` |  |
| `stream_variant` | character varying | `cctv_playback_sessions.stream_variant` |  |
| `transport` | character varying | `cctv_playback_sessions.transport` |  |
| `token_hash` | bytea | `cctv_playback_sessions.token_hash` |  |
| `gateway_path` | character varying | `cctv_playback_sessions.gateway_path` |  |
| `gateway_session_ref` | character varying | `cctv_playback_sessions.gateway_session_ref` |  |
| `status` | character varying | `cctv_playback_sessions.status` |  |
| `end_reason` | character varying | `cctv_playback_sessions.end_reason` |  |
| `client_ip` | inet | `cctv_playback_sessions.client_ip` |  |
| `created_at` | timestamp with time zone | `cctv_playback_sessions.created_at` |  |
| `expires_at` | timestamp with time zone | `cctv_playback_sessions.expires_at` |  |
| `started_at` | timestamp with time zone | `cctv_playback_sessions.started_at` |  |
| `last_authorized_at` | timestamp with time zone | `cctv_playback_sessions.last_authorized_at` |  |
| `ended_at` | timestamp with time zone | `cctv_playback_sessions.ended_at` |  |

### `octabuild.cctv_project_access` → `professional.cctv_project_access` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `cctv_project_access.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `cctv_project_access.project_id` |  |
| `user_id` | uuid | `cctv_project_access.user_id` |  |
| `device_id` | uuid | `cctv_project_access.device_id` |  |
| `verified_at` | timestamp with time zone | `cctv_project_access.verified_at` |  |
| `revoked_at` | timestamp with time zone | `cctv_project_access.revoked_at` |  |

### `octabuild.cctv_rate_limit_events` → `professional.cctv_rate_limit_events` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | bigint | `cctv_rate_limit_events.id` | id becomes UUID (section 9.1) |
| `scope` | character varying | `cctv_rate_limit_events.scope` |  |
| `subject` | character varying | `cctv_rate_limit_events.subject` |  |
| `occurred_at` | timestamp with time zone | `cctv_rate_limit_events.occurred_at` |  |

### `octabuild.conversation_participants` → `professional.conversation_participants` (4 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `conversation_participants.id` | id becomes UUID (section 9.1) |
| `conversation_id` | integer | `conversation_participants.conversation_id` |  |
| `user_id` | uuid | `conversation_participants.user_id` |  |
| `unread_count` | integer | `conversation_participants.unread_count` |  |

### `octabuild.conversations` → `professional.conversations` (2 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `conversations.id` | id becomes UUID (section 9.1) |
| `title` | character varying | `conversations.title` |  |
| `conversation_type` | character varying | `conversations.conversation_type` |  |
| `direct_key` | character varying | `conversations.direct_key` |  |
| `last_message` | text | `conversations.last_message` |  |
| `last_message_at` | timestamp without time zone | `conversations.last_message_at` |  |
| `created_at` | timestamp without time zone | `conversations.created_at` |  |

### `octabuild.daily_site_records` → `professional.site_daily_records` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `site_daily_records.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `site_daily_records.project_id` |  |
| `contractor_id` | uuid | `site_daily_records.builder_id` | `contractor_id` → `builder_id` (role BUILDER) |
| `created_by_id` | uuid | `site_daily_records.created_by_user_id` | user reference: `_user_id` name (section 9.2) |
| `work_date` | date | `site_daily_records.work_on` | date column: `_on`/`_at` name (section 9.2) |
| `floor` | character varying | `site_daily_records.floor` |  |
| `block` | character varying | `site_daily_records.block` |  |
| `work_type` | character varying | `site_daily_records.work_type` |  |
| `activity_category` | character varying | `site_daily_records.activity_category` |  |
| `boq_reference` | character varying | `site_daily_records.boq_reference` |  |
| `activity_unit` | character varying | `site_daily_records.activity_unit` |  |
| `planned_quantity` | numeric | `site_daily_records.planned_quantity` |  |
| `completed_quantity` | numeric | `site_daily_records.completed_quantity` |  |
| `progress_note` | text | `site_daily_records.progress_note` |  |
| `status` | character varying | `site_daily_records.status` |  |
| `inspection_remarks` | text | `site_daily_records.inspection_remarks` |  |
| `labour_worker_count` | integer | `site_daily_records.labour_worker_count` |  |
| `total_expenses` | numeric | `site_daily_records.total_expenses_amount` | money column: `_amount` suffix (section 9.2) |
| `labour_cost` | numeric | `site_daily_records.labour_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `material_cost` | numeric | `site_daily_records.material_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `equipment_cost` | numeric | `site_daily_records.equipment_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `material_used` | text | `site_daily_records.material_used` |  |
| `equipment_used` | text | `site_daily_records.equipment_used` |  |
| `created_at` | timestamp without time zone | `site_daily_records.created_at` |  |
| `updated_at` | timestamp without time zone | `site_daily_records.updated_at` |  |
| `closed_at` | timestamp without time zone | `site_daily_records.closed_at` |  |

### `octabuild.email_verifications` → `professional.email_verification_codes` (1 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `email_verification_codes.id` | id becomes UUID (section 9.1) |
| `email` | character varying | `email_verification_codes.email` |  |
| `purpose` | character varying | `email_verification_codes.purpose` |  |
| `code_hash` | character varying | `email_verification_codes.code_hash` |  |
| `expires_at` | timestamp without time zone | `email_verification_codes.expires_at` |  |
| `attempts` | integer | `email_verification_codes.attempts` |  |
| `last_sent_at` | timestamp without time zone | `email_verification_codes.last_sent_at` |  |
| `verified_at` | timestamp without time zone | `email_verification_codes.verified_at` |  |
| `created_at` | timestamp without time zone | `email_verification_codes.created_at` |  |

### `octabuild.engineer_profiles` → `professional.engineer_profiles` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `engineer_profiles.id` | id becomes UUID (section 9.1) |
| `user_id` | uuid | `engineer_profiles.user_id` |  |
| `qualification` | character varying | `engineer_profiles.qualification` |  |
| `specialization` | character varying | `engineer_profiles.specialization` |  |
| `experience_years` | integer | `engineer_profiles.experience_years` |  |
| `license_number` | character varying | `engineer_profiles.license_number` |  |
| `about` | text | `engineer_profiles.about` |  |
| `profile_image_url` | character varying | `engineer_profiles.profile_image_url` |  |
| `created_at` | timestamp without time zone | `engineer_profiles.created_at` |  |

### `octabuild.escrow_milestones` → `professional.project_escrow_milestones` (9 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `project_escrow_milestones.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `project_escrow_milestones.project_id` |  |
| `name` | character varying | `project_escrow_milestones.name` |  |
| `amount` | numeric | `project_escrow_milestones.amount` |  |
| `status` | character varying | `project_escrow_milestones.status` |  |
| `created_at` | timestamp without time zone | `project_escrow_milestones.created_at` |  |

### `octabuild.estimates` → `professional.cost_estimates` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `cost_estimates.id` | id becomes UUID (section 9.1) |
| `owner_id` | uuid | `cost_estimates.owner_id` |  |
| `location` | character varying | `cost_estimates.location` |  |
| `pincode` | character varying | `cost_estimates.pincode` |  |
| `plot_area` | double precision | `cost_estimates.plot_area` |  |
| `floors` | integer | `cost_estimates.floors` |  |
| `floor_type` | character varying | `cost_estimates.floor_type` |  |
| `construction_type` | character varying | `cost_estimates.construction_type` |  |
| `building_type` | character varying | `cost_estimates.building_type` |  |
| `finishing_type` | character varying | `cost_estimates.finishing_type` |  |
| `budget` | numeric | `cost_estimates.budget_amount` | money column: `_amount` suffix (section 9.2) |
| `estimated_cost` | numeric | `cost_estimates.estimated_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `estimated_duration_days` | integer | `cost_estimates.estimated_duration_days` |  |
| `material_estimate` | numeric | `cost_estimates.material_estimate_amount` | money column: `_amount` suffix (section 9.2) |
| `labour_estimate` | numeric | `cost_estimates.labour_estimate_amount` | money column: `_amount` suffix (section 9.2) |
| `created_at` | timestamp without time zone | `cost_estimates.created_at` |  |

### `octabuild.labour_logs` → `professional.legacy_labour_logs` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `legacy_labour_logs.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `legacy_labour_logs.project_id` |  |
| `labour_count` | integer | `legacy_labour_logs.labour_count` |  |
| `labour_cost` | numeric | `legacy_labour_logs.labour_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `work_date` | timestamp without time zone | `legacy_labour_logs.worked_at` | date column: `_on`/`_at` name (section 9.2) |
| `created_at` | timestamp without time zone | `legacy_labour_logs.created_at` |  |

### `octabuild.master_brands` → `professional.catalog_brands` (19 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `catalog_brands.id` | id becomes UUID (section 9.1) |
| `slug` | character varying | `catalog_brands.slug` |  |
| `name` | character varying | `catalog_brands.name` |  |
| `manufacturer` | character varying | `catalog_brands.manufacturer` |  |
| `description` | text | `catalog_brands.description` |  |
| `logo_url` | character varying | `catalog_brands.logo_url` |  |
| `sort_order` | integer | `catalog_brands.sort_order` |  |
| `is_active` | boolean | `catalog_brands.is_active` |  |
| `created_at` | timestamp without time zone | `catalog_brands.created_at` |  |
| `updated_at` | timestamp without time zone | `catalog_brands.updated_at` |  |

### `octabuild.master_categories` → `professional.catalog_categories` (5 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `catalog_categories.id` | id becomes UUID (section 9.1) |
| `slug` | character varying | `catalog_categories.slug` |  |
| `name` | character varying | `catalog_categories.name` |  |
| `description` | text | `catalog_categories.description` |  |
| `sort_order` | integer | `catalog_categories.sort_order` |  |
| `is_active` | boolean | `catalog_categories.is_active` |  |
| `created_at` | timestamp without time zone | `catalog_categories.created_at` |  |
| `updated_at` | timestamp without time zone | `catalog_categories.updated_at` |  |
| `country_code` | character varying | `catalog_categories.country_code` |  |
| `image_url` | character varying | `catalog_categories.image_url` |  |

### `octabuild.master_product_images` → `professional.catalog_product_media` (41 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `catalog_product_media.id` | id becomes UUID (section 9.1) |
| `master_product_id` | integer | `catalog_product_media.product_id` | catalog rename |
| `variant_id` | integer | `catalog_product_media.variant_id` |  |
| `uploaded_file_id` | integer | `catalog_product_media.file_id` | files rename |
| `image_url` | character varying | `catalog_product_media.image_url` |  |
| `alt_text` | character varying | `catalog_product_media.alt_text` |  |
| `is_primary` | boolean | `catalog_product_media.is_primary` |  |
| `sort_order` | integer | `catalog_product_media.sort_order` |  |
| `created_at` | timestamp without time zone | `catalog_product_media.created_at` |  |
| `media_type` | character varying | `catalog_product_media.media_type` |  |
| `thumbnail_url` | character varying | `catalog_product_media.thumbnail_url` |  |

### `octabuild.master_product_variants` → `professional.catalog_product_variants` (156 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `catalog_product_variants.id` | id becomes UUID (section 9.1) |
| `master_product_id` | integer | `catalog_product_variants.product_id` | catalog rename |
| `slug` | character varying | `catalog_product_variants.slug` |  |
| `name` | character varying | `catalog_product_variants.name` |  |
| `unit_id` | integer | `catalog_product_variants.unit_id` |  |
| `specifications` | jsonb | `catalog_product_variants.specifications` |  |
| `sort_order` | integer | `catalog_product_variants.sort_order` |  |
| `is_active` | boolean | `catalog_product_variants.is_active` |  |
| `created_at` | timestamp without time zone | `catalog_product_variants.created_at` |  |
| `updated_at` | timestamp without time zone | `catalog_product_variants.updated_at` |  |

### `octabuild.master_products` → `professional.catalog_products` (74 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `catalog_products.id` | id becomes UUID (section 9.1) |
| `subcategory_id` | integer | `catalog_products.subcategory_id` |  |
| `brand_id` | integer | `catalog_products.brand_id` |  |
| `slug` | character varying | `catalog_products.slug` |  |
| `name` | character varying | `catalog_products.name` |  |
| `description` | text | `catalog_products.description` |  |
| `standard_code` | character varying | `catalog_products.standard_code` |  |
| `unit_id` | integer | `catalog_products.unit_id` |  |
| `specifications` | jsonb | `catalog_products.specifications` |  |
| `is_active` | boolean | `catalog_products.is_active` |  |
| `created_by` | uuid | `catalog_products.created_by_user_id` | user reference: `_user_id` name (section 9.2) |
| `created_at` | timestamp without time zone | `catalog_products.created_at` |  |
| `updated_at` | timestamp without time zone | `catalog_products.updated_at` |  |
| `country_code` | character varying | `catalog_products.country_code` |  |
| `short_description` | text | `catalog_products.short_description` |  |
| `product_type` | character varying | `catalog_products.product_type` |  |
| `search_keywords` | text | `catalog_products.search_keywords` |  |
| `normalized_name` | character varying | `catalog_products.normalized_name` |  |
| `highlights` | jsonb | `catalog_products.highlights` |  |
| `faqs` | jsonb | `catalog_products.faqs` |  |
| `returns_exchange_policy` | text | `catalog_products.returns_exchange_policy` |  |

### `octabuild.master_subcategories` → `professional.catalog_subcategories` (20 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `catalog_subcategories.id` | id becomes UUID (section 9.1) |
| `category_id` | integer | `catalog_subcategories.category_id` |  |
| `slug` | character varying | `catalog_subcategories.slug` |  |
| `name` | character varying | `catalog_subcategories.name` |  |
| `description` | text | `catalog_subcategories.description` |  |
| `sort_order` | integer | `catalog_subcategories.sort_order` |  |
| `is_active` | boolean | `catalog_subcategories.is_active` |  |
| `created_at` | timestamp without time zone | `catalog_subcategories.created_at` |  |
| `updated_at` | timestamp without time zone | `catalog_subcategories.updated_at` |  |
| `image_url` | character varying | `catalog_subcategories.image_url` |  |

### `octabuild.master_units` → `professional.catalog_units` (4 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `catalog_units.id` | id becomes UUID (section 9.1) |
| `code` | character varying | `catalog_units.code` |  |
| `name` | character varying | `catalog_units.name` |  |
| `sort_order` | integer | `catalog_units.sort_order` |  |
| `is_active` | boolean | `catalog_units.is_active` |  |
| `created_at` | timestamp without time zone | `catalog_units.created_at` |  |
| `unit_family` | character varying | `catalog_units.unit_family` |  |

### `octabuild.material_logs` → `professional.legacy_material_logs` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `legacy_material_logs.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `legacy_material_logs.project_id` |  |
| `material_name` | character varying | `legacy_material_logs.material_name` |  |
| `quantity` | double precision | `legacy_material_logs.quantity` |  |
| `unit` | character varying | `legacy_material_logs.unit` |  |
| `cost` | numeric | `legacy_material_logs.cost_amount` | money column: `_amount` suffix (section 9.2) |
| `created_at` | timestamp without time zone | `legacy_material_logs.created_at` |  |

### `octabuild.material_order_items` → `professional.purchase_orders`, `professional.purchase_order_items` (4 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `purchase_order_items.id` | on the order line |
| `request_code` | character varying | `purchase_orders.order_number` | one order per request code and supplier |
| `project_id` | integer | `purchase_orders.project_id` | on the order |
| `engineer_id` | uuid | `purchase_orders.buyer_user_id` | the buyer, on the order |
| `supplier_id` | uuid | `purchase_orders.supplier_user_id` | on the order |
| `product_id` | integer | `purchase_order_items.listing_id` | the supplier listing |
| `material_name` | character varying | `purchase_order_items.material_name` | on the order line |
| `category` | character varying | `purchase_order_items.category` | on the order line |
| `price` | numeric | `purchase_order_items.unit_price_amount` | money column: `_amount` suffix (section 9.2) |
| `quantity` | double precision | `purchase_order_items.quantity` | on the order line |
| `unit` | character varying | `purchase_order_items.unit` | on the order line |
| `status` | character varying | `purchase_order_items.status` | on the order line |
| `created_at` | timestamp without time zone | `purchase_order_items.created_at` | on the order line |
| `fulfilled_at` | timestamp without time zone | `purchase_order_items.fulfilled_at` | on the order line |

### `octabuild.messages` → `professional.messages` (4 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `messages.id` | id becomes UUID (section 9.1) |
| `conversation_id` | integer | `messages.conversation_id` |  |
| `sender_id` | uuid | `messages.sender_user_id` | user reference: `_user_id` name (section 9.2) |
| `receiver_id` | uuid | `messages.receiver_user_id` | user reference: `_user_id` name (section 9.2) |
| `message_type` | character varying | `messages.message_type` |  |
| `body` | text | `messages.body` |  |
| `attachment_url` | character varying | `messages.attachment_url` |  |
| `read_at` | timestamp without time zone | `messages.read_at` |  |
| `created_at` | timestamp without time zone | `messages.created_at` |  |

### `octabuild.notifications` → `professional.notifications` (19 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `notifications.id` | id becomes UUID (section 9.1) |
| `user_id` | uuid | `notifications.user_id` |  |
| `title` | character varying | `notifications.title` |  |
| `body` | text | `notifications.body` |  |
| `is_read` | boolean | `notifications.is_read` |  |
| `created_at` | timestamp without time zone | `notifications.created_at` |  |

### `octabuild.owner_profiles` → `professional.owner_profiles` (2 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `owner_profiles.id` | id becomes UUID (section 9.1) |
| `user_id` | uuid | `owner_profiles.user_id` |  |
| `building_type` | character varying | `owner_profiles.building_type` |  |
| `construction_type` | character varying | `owner_profiles.construction_type` |  |
| `budget` | numeric | `owner_profiles.budget_amount` | money column: `_amount` suffix (section 9.2) |
| `land_area` | double precision | `owner_profiles.land_area` |  |
| `floors` | integer | `owner_profiles.floors` |  |
| `project_title` | character varying | `owner_profiles.project_title` |  |
| `project_description` | text | `owner_profiles.project_description` |  |
| `site_status` | character varying | `owner_profiles.site_status` |  |
| `start_timeline` | character varying | `owner_profiles.start_timeline` |  |
| `design_status` | character varying | `owner_profiles.design_status` |  |
| `contact_preference` | character varying | `owner_profiles.contact_preference` |  |
| `floor_type` | character varying | `owner_profiles.floor_type` |  |

### `octabuild.project_awards` → `professional.project_awards` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `project_awards.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `project_awards.project_id` |  |
| `request_id` | integer | `project_awards.request_id` |  |
| `builder_id` | uuid | `project_awards.builder_id` |  |
| `status` | character varying | `project_awards.status` |  |
| `agreed_offer_id` | integer | `project_awards.agreed_offer_id` |  |
| `created_at` | timestamp without time zone | `project_awards.created_at` |  |
| `responded_at` | timestamp without time zone | `project_awards.responded_at` |  |
| `confirmed_at` | timestamp without time zone | `project_awards.confirmed_at` |  |

### `octabuild.project_engineer_assignments` → `professional.project_engineer_assignments` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `project_engineer_assignments.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `project_engineer_assignments.project_id` |  |
| `engineer_id` | uuid | `project_engineer_assignments.engineer_id` |  |
| `status` | character varying | `project_engineer_assignments.status` |  |
| `created_at` | timestamp without time zone | `project_engineer_assignments.created_at` |  |
| `updated_at` | timestamp without time zone | `project_engineer_assignments.updated_at` |  |

### `octabuild.project_material_inventory` → `professional.project_material_stock` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `project_material_stock.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `project_material_stock.project_id` |  |
| `contractor_id` | uuid | `project_material_stock.builder_id` | `contractor_id` → `builder_id` (role BUILDER) |
| `product_id` | integer | `project_material_stock.listing_id` | the supplier listing |
| `material` | character varying | `project_material_stock.material` |  |
| `unit` | character varying | `project_material_stock.unit` |  |
| `current_stock` | double precision | `project_material_stock.current_stock` |  |
| `minimum_stock` | double precision | `project_material_stock.minimum_stock` |  |
| `updated_at` | timestamp without time zone | `project_material_stock.updated_at` |  |

### `octabuild.project_media` → `professional.project_photos` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `project_photos.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `project_photos.project_id` |  |
| `timeline_id` | integer | `project_photos.timeline_entry_id` | table renamed |
| `image_url` | character varying | `project_photos.image_url` |  |
| `created_at` | timestamp without time zone | `project_photos.created_at` |  |

### `octabuild.project_supplier_assignments` → `professional.project_supplier_assignments` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `project_supplier_assignments.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `project_supplier_assignments.project_id` |  |
| `supplier_id` | uuid | `project_supplier_assignments.supplier_id` |  |
| `engineer_id` | uuid | `project_supplier_assignments.engineer_id` |  |
| `contractor_id` | uuid | `project_supplier_assignments.builder_id` | `contractor_id` → `builder_id` (role BUILDER) |
| `status` | character varying | `project_supplier_assignments.status` |  |
| `created_at` | timestamp without time zone | `project_supplier_assignments.created_at` |  |
| `updated_at` | timestamp without time zone | `project_supplier_assignments.updated_at` |  |

### `octabuild.project_timelines` → `professional.project_timeline_entries` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `project_timeline_entries.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `project_timeline_entries.project_id` |  |
| `created_by_id` | uuid | `project_timeline_entries.created_by_user_id` | user reference: `_user_id` name (section 9.2) |
| `title` | character varying | `project_timeline_entries.title` |  |
| `description` | text | `project_timeline_entries.description` |  |
| `date` | timestamp without time zone | `project_timeline_entries.activity_at` | date column: `_on`/`_at` name (section 9.2) |
| `completion_status` | character varying | `project_timeline_entries.completion_status` |  |
| `created_at` | timestamp without time zone | `project_timeline_entries.created_at` |  |

### `octabuild.projects` → `professional.projects` (3 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `projects.id` | id becomes UUID (section 9.1) |
| `owner_id` | uuid | `projects.owner_id` |  |
| `contractor_id` | uuid | `projects.builder_id` | `contractor_id` → `builder_id` (role BUILDER) |
| `title` | character varying | `projects.title` |  |
| `description` | text | `projects.description` |  |
| `address` | text | `projects.address` |  |
| `pincode` | character varying | `projects.pincode` |  |
| `project_country` | character varying | `projects.project_country` |  |
| `project_state` | character varying | `projects.project_state` |  |
| `project_city` | character varying | `projects.project_city` |  |
| `building_type` | character varying | `projects.building_type` |  |
| `construction_type` | character varying | `projects.construction_type` |  |
| `budget` | numeric | `projects.budget_amount` | money column: `_amount` suffix (section 9.2) |
| `land_area` | double precision | `projects.land_area` |  |
| `floors` | integer | `projects.floors` |  |
| `status` | character varying | `projects.status` |  |
| `compliance_status` | character varying | `projects.compliance_status` |  |
| `completion_percentage` | integer | `projects.completion_percentage` |  |
| `cover_image_url` | character varying | `projects.cover_image_url` |  |
| `created_at` | timestamp without time zone | `projects.created_at` |  |
| `floor_type` | character varying | `projects.floor_type` |  |
| `estimated_cost` | numeric | `projects.estimated_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `estimated_duration_days` | integer | `projects.estimated_duration_days` |  |
| `material_estimate` | numeric | `projects.material_estimate_amount` | money column: `_amount` suffix (section 9.2) |
| `labour_estimate` | numeric | `projects.labour_estimate_amount` | money column: `_amount` suffix (section 9.2) |
| `start_date` | date | `projects.starts_on` | date column: `_on`/`_at` name (section 9.2) |
| `end_date` | date | `projects.ends_on` | date column: `_on`/`_at` name (section 9.2) |

### `octabuild.property_listing_images` → `professional.property_listing_images` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `property_listing_images.id` | id becomes UUID (section 9.1) |
| `listing_id` | integer | `property_listing_images.listing_id` |  |
| `image_url` | character varying | `property_listing_images.image_url` |  |
| `sort_order` | integer | `property_listing_images.sort_order` |  |
| `created_at` | timestamp without time zone | `property_listing_images.created_at` |  |

### `octabuild.property_listings` → `professional.property_listings` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `property_listings.id` | id becomes UUID (section 9.1) |
| `seller_id` | uuid | `property_listings.seller_user_id` | user reference: `_user_id` name (section 9.2) |
| `source_project_id` | integer | `property_listings.source_project_id` |  |
| `title` | character varying | `property_listings.title` |  |
| `description` | text | `property_listings.description` |  |
| `property_type` | character varying | `property_listings.property_type` |  |
| `listing_type` | character varying | `property_listings.listing_type` |  |
| `address` | text | `property_listings.address` |  |
| `pincode` | character varying | `property_listings.pincode` |  |
| `country` | character varying | `property_listings.country` |  |
| `state` | character varying | `property_listings.state` |  |
| `city` | character varying | `property_listings.city` |  |
| `price` | numeric | `property_listings.price_amount` | money column: `_amount` suffix (section 9.2) |
| `is_negotiable` | boolean | `property_listings.is_negotiable` |  |
| `carpet_area` | double precision | `property_listings.carpet_area` |  |
| `built_up_area` | double precision | `property_listings.built_up_area` |  |
| `land_area` | double precision | `property_listings.land_area` |  |
| `bedrooms` | integer | `property_listings.bedrooms` |  |
| `bathrooms` | integer | `property_listings.bathrooms` |  |
| `floors` | integer | `property_listings.floors` |  |
| `furnishing` | character varying | `property_listings.furnishing` |  |
| `age_years` | integer | `property_listings.age_years` |  |
| `facing` | character varying | `property_listings.facing` |  |
| `status` | character varying | `property_listings.status` |  |
| `cover_image_url` | character varying | `property_listings.cover_image_url` |  |
| `listed_at` | timestamp without time zone | `property_listings.listed_at` |  |
| `sold_at` | timestamp without time zone | `property_listings.sold_at` |  |
| `created_at` | timestamp without time zone | `property_listings.created_at` |  |
| `floor_type` | character varying | `property_listings.floor_type` |  |
| `video_url` | character varying | `property_listings.video_url` |  |

### `octabuild.reports` → `professional.user_reports` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `user_reports.id` | id becomes UUID (section 9.1) |
| `reporter_id` | uuid | `user_reports.reporter_id` |  |
| `subject_type` | character varying | `user_reports.subject_type` |  |
| `subject_id` | character varying | `user_reports.subject_id` |  |
| `category` | character varying | `user_reports.category` |  |
| `description` | text | `user_reports.description` |  |
| `status` | character varying | `user_reports.status` |  |
| `scope` | character varying | `user_reports.scope` |  |
| `resolved_by_id` | uuid | `user_reports.resolved_by_id` |  |
| `resolved_at` | timestamp without time zone | `user_reports.resolved_at` |  |
| `resolution_note` | text | `user_reports.resolution_note` |  |
| `created_at` | timestamp without time zone | `user_reports.created_at` |  |

### `octabuild.requests` → `professional.project_requests`, `professional.property_enquiries` (2 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `project_requests.id`; property rows: `property_enquiries.id` | split by kind (section 10) |
| `project_id` | integer | `project_requests.project_id` | split by kind (section 10) |
| `property_listing_id` | integer | property rows only: `property_enquiries.listing_id` | split by kind (section 10) |
| `sender_id` | uuid | `project_requests.sender_id`; property rows: `property_enquiries.buyer_user_id` | split by kind (section 10) |
| `receiver_id` | uuid | `project_requests.receiver_id`; property rows: `property_enquiries.seller_user_id` | split by kind (section 10) |
| `request_type` | character varying | `project_requests.request_type` | split by kind (section 10) |
| `status` | character varying | `project_requests.status`; property rows: `property_enquiries.status` | split by kind (section 10) |
| `quotation_amount` | numeric | `project_requests.quotation_amount`; property rows: `property_enquiries.offer_amount` | split by kind (section 10) |
| `quotation_created_at` | timestamp without time zone | `project_requests.quotation_created_at`; property rows: `property_enquiries.offered_at` | split by kind (section 10) |
| `created_at` | timestamp without time zone | `project_requests.created_at`; property rows: `property_enquiries.created_at` | split by kind (section 10) |

### `octabuild.reviews` → `professional.project_reviews` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `project_reviews.id` | id becomes UUID (section 9.1) |
| `project_id` | integer | `project_reviews.project_id` |  |
| `reviewer_id` | uuid | `project_reviews.reviewer_id` |  |
| `reviewee_id` | uuid | `project_reviews.reviewee_id` |  |
| `rating` | integer | `project_reviews.rating` |  |
| `comment` | text | `project_reviews.comment` |  |
| `created_at` | timestamp without time zone | `project_reviews.created_at` |  |

### `octabuild.site_expenses` → `professional.site_expenses` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `site_expenses.id` | id becomes UUID (section 9.1) |
| `register_id` | integer | `site_expenses.daily_record_id` | the daily record it belongs to |
| `category` | character varying | `site_expenses.category` |  |
| `description` | text | `site_expenses.description` |  |
| `amount` | numeric | `site_expenses.amount` |  |
| `expense_date` | date | `site_expenses.expense_on` | date column: `_on`/`_at` name (section 9.2) |
| `created_at` | timestamp without time zone | `site_expenses.created_at` |  |

### `octabuild.site_labour_entries` → `professional.site_labour_entries` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `site_labour_entries.id` | id becomes UUID (section 9.1) |
| `register_id` | integer | `site_labour_entries.daily_record_id` | the daily record it belongs to |
| `worker_id` | integer | `site_labour_entries.worker_id` |  |
| `labour_category` | character varying | `site_labour_entries.labour_category` |  |
| `worker_name` | character varying | `site_labour_entries.worker_name` |  |
| `worker_count` | integer | `site_labour_entries.worker_count` |  |
| `daily_wage` | numeric | `site_labour_entries.daily_wage_amount` | money column: `_amount` suffix (section 9.2) |
| `attendance_status` | character varying | `site_labour_entries.attendance_status` |  |
| `overtime_hours` | double precision | `site_labour_entries.overtime_hours` |  |
| `overtime_rate` | numeric | `site_labour_entries.overtime_rate_amount` | money column: `_amount` suffix (section 9.2) |
| `advance_paid` | numeric | `site_labour_entries.advance_paid_amount` | money column: `_amount` suffix (section 9.2) |
| `remarks` | text | `site_labour_entries.remarks` |  |
| `regular_amount` | numeric | `site_labour_entries.regular_amount` |  |
| `overtime_amount` | numeric | `site_labour_entries.overtime_amount` |  |
| `total_amount` | numeric | `site_labour_entries.total_amount` |  |
| `payable_amount` | numeric | `site_labour_entries.payable_amount` |  |
| `created_at` | timestamp without time zone | `site_labour_entries.created_at` |  |

### `octabuild.site_machinery_usages` → `professional.site_machinery_usages` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `site_machinery_usages.id` | id becomes UUID (section 9.1) |
| `register_id` | integer | `site_machinery_usages.daily_record_id` | the daily record it belongs to |
| `machine` | character varying | `site_machinery_usages.machine` |  |
| `hours` | double precision | `site_machinery_usages.hours` |  |
| `rate_per_hour` | numeric | `site_machinery_usages.rate_per_hour_amount` | money column: `_amount` suffix (section 9.2) |
| `operator_charge` | numeric | `site_machinery_usages.operator_charge_amount` | money column: `_amount` suffix (section 9.2) |
| `fuel_cost` | numeric | `site_machinery_usages.fuel_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `maintenance_cost` | numeric | `site_machinery_usages.maintenance_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `total_cost` | numeric | `site_machinery_usages.total_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `created_at` | timestamp without time zone | `site_machinery_usages.created_at` |  |

### `octabuild.site_material_purchases` → `professional.site_material_purchases` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `site_material_purchases.id` | id becomes UUID (section 9.1) |
| `register_id` | integer | `site_material_purchases.daily_record_id` | the daily record it belongs to |
| `supplier_id` | integer | `site_material_purchases.offline_supplier_id` | the builder's offline supplier |
| `supplier_name` | character varying | `site_material_purchases.supplier_name` |  |
| `invoice_number` | character varying | `site_material_purchases.invoice_number` |  |
| `material` | character varying | `site_material_purchases.material` |  |
| `quantity` | double precision | `site_material_purchases.quantity` |  |
| `unit` | character varying | `site_material_purchases.unit` |  |
| `rate` | numeric | `site_material_purchases.rate_amount` | money column: `_amount` suffix (section 9.2) |
| `transport_cost` | numeric | `site_material_purchases.transport_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `loading_cost` | numeric | `site_material_purchases.loading_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `unloading_cost` | numeric | `site_material_purchases.unloading_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `gst_percent` | double precision | `site_material_purchases.gst_percent` |  |
| `discount` | numeric | `site_material_purchases.discount_amount` | money column: `_amount` suffix (section 9.2) |
| `subtotal` | numeric | `site_material_purchases.subtotal_amount` | money column: `_amount` suffix (section 9.2) |
| `tax_amount` | numeric | `site_material_purchases.tax_amount` |  |
| `total_amount` | numeric | `site_material_purchases.total_amount` |  |
| `purchase_date` | date | `site_material_purchases.purchased_on` | date column: `_on`/`_at` name (section 9.2) |
| `created_at` | timestamp without time zone | `site_material_purchases.created_at` |  |

### `octabuild.site_material_usages` → `professional.site_material_usages` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `site_material_usages.id` | id becomes UUID (section 9.1) |
| `register_id` | integer | `site_material_usages.daily_record_id` | the daily record it belongs to |
| `product_id` | integer | `site_material_usages.listing_id` | the supplier listing |
| `project_id` | integer | `site_material_usages.project_id` |  |
| `engineer_id` | uuid | `site_material_usages.engineer_id` |  |
| `material` | character varying | `site_material_usages.material` |  |
| `opening_stock` | double precision | `site_material_usages.opening_stock` |  |
| `quantity_used` | double precision | `site_material_usages.quantity_used` |  |
| `unit` | character varying | `site_material_usages.unit` |  |
| `rate` | numeric | `site_material_usages.rate_amount` | money column: `_amount` suffix (section 9.2) |
| `total_cost` | numeric | `site_material_usages.total_cost_amount` | money column: `_amount` suffix (section 9.2) |
| `closing_stock` | double precision | `site_material_usages.closing_stock` |  |
| `work_date` | date | `site_material_usages.work_on` | date column: `_on`/`_at` name (section 9.2) |
| `created_at` | timestamp without time zone | `site_material_usages.created_at` |  |

### `octabuild.site_payments` → `professional.site_payments` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `site_payments.id` | id becomes UUID (section 9.1) |
| `register_id` | integer | `site_payments.daily_record_id` | the daily record it belongs to |
| `direction` | character varying | `site_payments.direction` |  |
| `payment_type` | character varying | `site_payments.payment_type` |  |
| `party_name` | character varying | `site_payments.party_name` |  |
| `amount` | numeric | `site_payments.amount` |  |
| `payment_date` | date | `site_payments.paid_on` | date column: `_on`/`_at` name (section 9.2) |
| `remarks` | text | `site_payments.remarks` |  |
| `created_at` | timestamp without time zone | `site_payments.created_at` |  |

### `octabuild.supplier_bulk_pricing` → `professional.supplier_listing_price_tiers` (5 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `supplier_listing_price_tiers.id` | id becomes UUID (section 9.1) |
| `supplier_product_id` | integer | `supplier_listing_price_tiers.listing_id` | table renamed |
| `min_quantity` | numeric | `supplier_listing_price_tiers.min_quantity` |  |
| `max_quantity` | numeric | `supplier_listing_price_tiers.max_quantity` |  |
| `unit_price` | numeric | `supplier_listing_price_tiers.unit_price_amount` | money column: `_amount` suffix (section 9.2) |
| `is_active` | boolean | `supplier_listing_price_tiers.is_active` |  |
| `created_at` | timestamp without time zone | `supplier_listing_price_tiers.created_at` |  |
| `updated_at` | timestamp without time zone | `supplier_listing_price_tiers.updated_at` |  |

### `octabuild.supplier_products` → `professional.supplier_listings` (11 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `supplier_listings.id` | id becomes UUID (section 9.1) |
| `supplier_id` | uuid | `supplier_listings.supplier_user_id` | user reference: `_user_id` name (section 9.2) |
| `name` | character varying | `supplier_listings.name` |  |
| `brand` | character varying | `supplier_listings.brand` |  |
| `size` | character varying | `supplier_listings.size` |  |
| `category` | character varying | `supplier_listings.category` |  |
| `image_url` | character varying | `supplier_listings.image_url` |  |
| `features` | text | `supplier_listings.features` |  |
| `description` | text | `supplier_listings.description` |  |
| `product_type` | character varying | `supplier_listings.product_type` |  |
| `grade` | character varying | `supplier_listings.grade` |  |
| `usage` | text | `supplier_listings.usage` |  |
| `unit` | character varying | `supplier_listings.unit` |  |
| `price` | numeric | `supplier_listings.price_amount` | money column: `_amount` suffix (section 9.2) |
| `quantity` | double precision | `supplier_listings.stock_quantity` | **the stock the old code reads and writes** (model attribute `quantity`) |
| `low_stock_threshold` | double precision | `supplier_listings.low_stock_threshold` |  |
| `stock_alert_state` | character varying | `supplier_listings.stock_alert_state` |  |
| `is_published` | boolean | `supplier_listings.is_published` |  |
| `created_at` | timestamp without time zone | `supplier_listings.created_at` |  |
| `master_product_id` | integer | `supplier_listings.catalog_product_id` | catalog rename |
| `master_variant_id` | integer | `supplier_listings.catalog_variant_id` | catalog rename |
| `stock_quantity` | numeric | **no home** | not in the old code: a column left by an earlier migration; differs from `quantity` in all 11 rows |
| `discount_percentage` | numeric | `supplier_listings.discount_percentage` |  |

### `octabuild.supplier_profiles` → `professional.supplier_profiles` (2 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `supplier_profiles.id` | id becomes UUID (section 9.1) |
| `user_id` | uuid | `supplier_profiles.user_id` |  |
| `store_name` | character varying | `supplier_profiles.store_name` |  |
| `categories` | text | `supplier_profiles.categories` |  |
| `about` | text | `supplier_profiles.about` |  |
| `gstin` | character varying | `supplier_profiles.gstin` |  |
| `pan` | character varying | `supplier_profiles.pan` |  |
| `website` | character varying | `supplier_profiles.website` |  |
| `business_type` | character varying | `supplier_profiles.business_type` |  |
| `supplier_category` | character varying | `supplier_profiles.supplier_category` |  |
| `registration_year` | integer | `supplier_profiles.registration_year` |  |
| `delivery_locations` | text | `supplier_profiles.delivery_locations` |  |
| `documents` | text | `supplier_profiles.documents` |  |
| `gallery` | text | `supplier_profiles.gallery` |  |
| `store_logo_url` | character varying | `supplier_profiles.store_logo_url` |  |

### `octabuild.uploaded_files` → `professional.files` (115 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `files.id` | id becomes UUID (section 9.1) |
| `storage_key` | character varying | `files.storage_key` |  |
| `bucket` | character varying | `files.bucket` |  |
| `filename` | character varying | `files.filename` |  |
| `content_type` | character varying | `files.content_type` |  |
| `content` | bytea | `files.content` |  |
| `size` | integer | `files.size_bytes` | unit in the name |
| `owner_id` | uuid | `files.owner_user_id` | user reference: `_user_id` name (section 9.2) |
| `created_at` | timestamp without time zone | `files.created_at` |  |

### `octabuild.users` → `professional.users` (7 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `users.id` | id becomes UUID (section 9.1) |
| `name` | character varying | `users.name` |  |
| `email` | character varying | `users.email` |  |
| `phone` | character varying | `users.phone` |  |
| `hashed_password` | character varying | `users.password_hash` | Argon2id from now on; bcrypt still verified and re-hashed |
| `role` | character varying | `users.role` |  |
| `status` | character varying | `users.status` |  |
| `address` | text | `users.address` |  |
| `pincode` | character varying | `users.pincode` |  |
| `location` | character varying | `users.location` |  |
| `country_of_residence` | character varying | `users.country_code` | 'India' → 'IN' (all rows are India) |
| `rating` | double precision | `users.rating` |  |
| `profile_image_url` | character varying | `users.profile_image_url` |  |
| `created_at` | timestamp without time zone | `users.created_at` |  |

### `octabuild.verification_records` → `professional.user_verification_reviews` (1 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | integer | `user_verification_reviews.id` | id becomes UUID (section 9.1) |
| `user_id` | uuid | `user_verification_reviews.user_id` |  |
| `verification_type` | character varying | `user_verification_reviews.verification_type` |  |
| `status` | character varying | `user_verification_reviews.status` |  |
| `documents_reviewed` | text | `user_verification_reviews.documents_reviewed` |  |
| `reviewer_id` | uuid | `user_verification_reviews.reviewer_id` |  |
| `reviewer_email` | character varying | `user_verification_reviews.reviewer_email` |  |
| `scope` | character varying | `user_verification_reviews.scope` |  |
| `notes` | text | `user_verification_reviews.notes` |  |
| `expires_on` | date | `user_verification_reviews.expires_on` |  |
| `is_current` | boolean | `user_verification_reviews.is_current` |  |
| `created_at` | timestamp without time zone | `user_verification_reviews.created_at` |  |

### `partner.email_otps` → `partner.email_otp_codes` (3 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `email_otp_codes.id` | id becomes UUID (section 9.1) |
| `email` | character varying | `email_otp_codes.email` |  |
| `purpose` | character varying | `email_otp_codes.purpose` |  |
| `code_hash` | character varying | `email_otp_codes.code_hash` |  |
| `expires_at` | timestamp without time zone | `email_otp_codes.expires_at` |  |
| `attempts` | integer | `email_otp_codes.attempts` |  |
| `last_sent_at` | timestamp without time zone | `email_otp_codes.last_sent_at` |  |
| `send_window_started_at` | timestamp without time zone | `email_otp_codes.send_window_started_at` |  |
| `sends_in_window` | integer | `email_otp_codes.sends_in_window` |  |
| `created_at` | timestamp without time zone | `email_otp_codes.created_at` |  |

### `partner.identity_verifications` → `partner.technician_identity_verifications` (2 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `technician_identity_verifications.id` | id becomes UUID (section 9.1) |
| `user_id` | uuid | `technician_identity_verifications.technician_id` | points to technicians |
| `face_status` | character varying | `technician_identity_verifications.face_status` |  |
| `face_consent_at` | timestamp without time zone | `technician_identity_verifications.face_consent_at` |  |
| `face_provider` | character varying | `technician_identity_verifications.face_provider` |  |
| `face_provider_reference` | character varying | `technician_identity_verifications.face_provider_reference` |  |
| `face_submitted_at` | timestamp without time zone | `technician_identity_verifications.face_submitted_at` |  |
| `face_capture_expires_at` | timestamp without time zone | `technician_identity_verifications.face_capture_expires_at` |  |
| `face_verified_at` | timestamp without time zone | `technician_identity_verifications.face_verified_at` |  |
| `aadhaar_status` | character varying | `technician_identity_verifications.aadhaar_status` |  |
| `aadhaar_consent_at` | timestamp without time zone | `technician_identity_verifications.aadhaar_consent_at` |  |
| `aadhaar_last4` | character varying | `technician_identity_verifications.aadhaar_last4` |  |
| `aadhaar_fingerprint` | character varying | `technician_identity_verifications.aadhaar_fingerprint` |  |
| `aadhaar_ciphertext` | text | `technician_identity_verifications.aadhaar_ciphertext` |  |
| `aadhaar_submitted_at` | timestamp without time zone | `technician_identity_verifications.aadhaar_submitted_at` |  |
| `aadhaar_verified_at` | timestamp without time zone | `technician_identity_verifications.aadhaar_verified_at` |  |
| `created_at` | timestamp without time zone | `technician_identity_verifications.created_at` |  |
| `updated_at` | timestamp without time zone | `technician_identity_verifications.updated_at` |  |

### `partner.service_request_assignments` → `partner.booking_offers` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `booking_offers.id` | id becomes UUID (section 9.1) |
| `service_request_id` | uuid | `booking_offers.booking_id` | `service_request_id` → `booking_id` (section 11) |
| `technician_id` | uuid | `booking_offers.technician_id` |  |
| `status` | character varying | `booking_offers.status` |  |
| `match_type` | character varying | `booking_offers.match_type` |  |
| `offered_at` | timestamp without time zone | `booking_offers.offered_at` |  |
| `expires_at` | timestamp without time zone | `booking_offers.expires_at` |  |
| `responded_at` | timestamp without time zone | `booking_offers.responded_at` |  |
| `distance_meters` | double precision | `booking_offers.distance_meters` |  |
| `batch_number` | integer | `booking_offers.batch_number` |  |
| `rank` | integer | `booking_offers.rank` |  |
| `score` | double precision | `booking_offers.score` |  |
| `score_breakdown` | jsonb | `booking_offers.score_breakdown` |  |
| `eta_seconds` | double precision | `booking_offers.eta_seconds` |  |
| `status_reason` | character varying | `booking_offers.status_reason` |  |
| `accepted_at` | timestamp without time zone | **no home** | not in the old code (it records `responded_at` + `status`); empty in all rows |
| `updated_at` | timestamp without time zone | `booking_offers.updated_at` |  |

### `partner.service_request_bill_items` → `partner.booking_work_bill_items` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `booking_work_bill_items.id` | id becomes UUID (section 9.1) |
| `bill_id` | uuid | `booking_work_bill_items.bill_id` |  |
| `kind` | character varying | `booking_work_bill_items.kind` |  |
| `name` | character varying | `booking_work_bill_items.name` |  |
| `description` | text | `booking_work_bill_items.description` |  |
| `quantity` | numeric | `booking_work_bill_items.quantity` |  |
| `unit` | character varying | `booking_work_bill_items.unit` |  |
| `unit_price` | numeric | `booking_work_bill_items.unit_price` |  |
| `amount` | numeric | `booking_work_bill_items.amount` |  |
| `work_date` | date | `booking_work_bill_items.work_date` |  |
| `created_at` | timestamp without time zone | `booking_work_bill_items.created_at` |  |
| `updated_at` | timestamp without time zone | `booking_work_bill_items.updated_at` |  |

### `partner.service_request_bills` → `partner.booking_work_bills` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `booking_work_bills.id` | id becomes UUID (section 9.1) |
| `service_request_id` | uuid | `booking_work_bills.booking_id` | `service_request_id` → `booking_id` (section 11) |
| `status` | character varying | `booking_work_bills.status` |  |
| `notes` | text | `booking_work_bills.notes` |  |
| `service_price` | numeric | `booking_work_bills.service_price` |  |
| `materials_total` | numeric | `booking_work_bills.materials_total` |  |
| `additional_labour_total` | numeric | `booking_work_bills.additional_labour_total` |  |
| `bill_total` | numeric | `booking_work_bills.bill_total` |  |
| `currency` | character | `booking_work_bills.currency` |  |
| `finalized_at` | timestamp without time zone | `booking_work_bills.finalized_at` |  |
| `created_at` | timestamp without time zone | `booking_work_bills.created_at` |  |
| `updated_at` | timestamp without time zone | `booking_work_bills.updated_at` |  |

### `partner.service_request_media` → `partner.booking_media` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `booking_media.id` | id becomes UUID (section 9.1) |
| `service_request_id` | uuid | `booking_media.booking_id` | `service_request_id` → `booking_id` (section 11) |
| `kind` | character varying | `booking_media.kind` |  |
| `uploaded_by_requester_id` | uuid | `booking_media.uploaded_by_requester_id` |  |
| `uploaded_by_technician_id` | uuid | `booking_media.uploaded_by_technician_id` |  |
| `storage_key` | character | `booking_media.storage_key` |  |
| `content_type` | character varying | `booking_media.content_type` |  |
| `byte_size` | integer | `booking_media.byte_size` |  |
| `created_at` | timestamp without time zone | `booking_media.created_at` |  |
| `bill_item_id` | uuid | `booking_media.bill_item_id` |  |

### `partner.service_request_rating_tags` → `partner.booking_rating_tags` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `rating_id` | uuid | `booking_rating_tags.rating_id` |  |
| `tag` | character varying | `booking_rating_tags.tag` |  |

### `partner.service_request_ratings` → `partner.booking_ratings` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `booking_ratings.id` | id becomes UUID (section 9.1) |
| `service_request_id` | uuid | `booking_ratings.booking_id` | `service_request_id` → `booking_id` (section 11) |
| `technician_id` | uuid | `booking_ratings.technician_id` |  |
| `stars` | smallint | `booking_ratings.stars` |  |
| `created_at` | timestamp without time zone | `booking_ratings.created_at` |  |

### `partner.service_request_start_otps` → `partner.booking_start_codes` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `booking_start_codes.id` | id becomes UUID (section 9.1) |
| `service_request_id` | uuid | `booking_start_codes.booking_id` | `service_request_id` → `booking_id` (section 11) |
| `code_ciphertext` | text | `booking_start_codes.code_ciphertext` |  |
| `code_digest` | character | `booking_start_codes.code_digest` |  |
| `status` | character varying | `booking_start_codes.status` |  |
| `failed_attempts` | smallint | `booking_start_codes.failed_attempts` |  |
| `last_failed_at` | timestamp without time zone | `booking_start_codes.last_failed_at` |  |
| `created_at` | timestamp without time zone | `booking_start_codes.created_at` |  |
| `expires_at` | timestamp without time zone | `booking_start_codes.expires_at` |  |
| `consumed_at` | timestamp without time zone | `booking_start_codes.consumed_at` |  |
| `consumed_by_technician_id` | uuid | `booking_start_codes.consumed_by_technician_id` |  |
| `closed_at` | timestamp without time zone | `booking_start_codes.closed_at` |  |
| `requested_by_user_id` | uuid | `booking_start_codes.requested_by_user_id` |  |

### `partner.service_request_steps` → `partner.booking_checklist_steps` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `booking_checklist_steps.id` | id becomes UUID (section 9.1) |
| `service_request_id` | uuid | `booking_checklist_steps.booking_id` | `service_request_id` → `booking_id` (section 11) |
| `position` | smallint | `booking_checklist_steps.position` |  |
| `title` | character varying | `booking_checklist_steps.title` |  |
| `template_id` | uuid | `booking_checklist_steps.template_id` |  |
| `completed_at` | timestamp without time zone | `booking_checklist_steps.completed_at` |  |
| `created_at` | timestamp without time zone | `booking_checklist_steps.created_at` |  |
| `updated_at` | timestamp without time zone | `booking_checklist_steps.updated_at` |  |

### `partner.service_request_tracking` → `partner.booking_destinations` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `service_request_id` | uuid | `booking_destinations.booking_id` | `service_request_id` → `booking_id` (section 11) |
| `destination_latitude` | double precision | `booking_destinations.destination_latitude` |  |
| `destination_longitude` | double precision | `booking_destinations.destination_longitude` |  |
| `destination_accuracy` | double precision | `booking_destinations.destination_accuracy` |  |
| `destination_set_at` | timestamp without time zone | `booking_destinations.destination_set_at` |  |
| `technician_id` | uuid | **no home** | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `latitude` | double precision | **no home** | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `longitude` | double precision | **no home** | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `accuracy` | double precision | **no home** | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `heading` | double precision | **no home** | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `speed` | double precision | **no home** | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `location_updated_at` | timestamp without time zone | **no home** | live position per booking: not in the old code, which keeps it per technician in `technician_locations`; the table has no rows |
| `created_at` | timestamp without time zone | `booking_destinations.created_at` |  |
| `updated_at` | timestamp without time zone | `booking_destinations.updated_at` |  |

### `partner.service_requests` → `partner.bookings` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `bookings.id` | id becomes UUID (section 9.1) |
| `requested_by_user_id` | uuid | `bookings.requested_by_user_id` |  |
| `technician_id` | uuid | `bookings.technician_id` |  |
| `technician_type` | character varying | `bookings.technician_type` |  |
| `service_address` | text | `bookings.service_address` |  |
| `pincode` | character varying | `bookings.pincode` |  |
| `description` | text | `bookings.description` |  |
| `status` | character varying | `bookings.status` |  |
| `created_at` | timestamp without time zone | `bookings.created_at` |  |
| `updated_at` | timestamp without time zone | `bookings.updated_at` |  |
| `requested_by_role` | character varying | `bookings.requested_by_role` |  |
| `assigned_at` | timestamp without time zone | `bookings.assigned_at` |  |
| `accepted_at` | timestamp without time zone | `bookings.accepted_at` |  |
| `en_route_at` | timestamp without time zone | `bookings.en_route_at` |  |
| `arrived_at` | timestamp without time zone | `bookings.arrived_at` |  |
| `started_at` | timestamp without time zone | `bookings.started_at` |  |
| `completed_at` | timestamp without time zone | `bookings.completed_at` |  |
| `cancelled_at` | timestamp without time zone | `bookings.cancelled_at` |  |
| `service_area` | character varying | `bookings.service_area` |  |
| `service_latitude` | double precision | `bookings.service_latitude` |  |
| `service_longitude` | double precision | `bookings.service_longitude` |  |
| `service_id` | uuid | `bookings.catalog_service_id` | catalog rename |
| `service_kind` | character varying | `bookings.service_kind` |  |
| `quoted_amount` | numeric | `bookings.quoted_amount` |  |
| `currency` | character varying | `bookings.currency` |  |
| `service_notes` | text | `bookings.service_notes` |  |
| `service_notes_updated_at` | timestamp without time zone | `bookings.service_notes_updated_at` |  |
| `dispatch_attempts` | integer | `bookings.dispatch_attempts` |  |

### `partner.service_step_templates` → `partner.catalog_service_checklist_steps` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `catalog_service_checklist_steps.id` | id becomes UUID (section 9.1) |
| `service_id` | uuid | `catalog_service_checklist_steps.catalog_service_id` | catalog rename |
| `position` | smallint | `catalog_service_checklist_steps.position` |  |
| `title` | character varying | `catalog_service_checklist_steps.title` |  |
| `is_active` | boolean | `catalog_service_checklist_steps.is_active` |  |
| `created_at` | timestamp without time zone | `catalog_service_checklist_steps.created_at` |  |
| `updated_at` | timestamp without time zone | `catalog_service_checklist_steps.updated_at` |  |

### `partner.services` → `partner.catalog_services` (15 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `catalog_services.id` | id becomes UUID (section 9.1) |
| `trade` | character varying | `catalog_services.trade` |  |
| `slug` | character varying | `catalog_services.slug` |  |
| `service_name` | character varying | `catalog_services.service_name` |  |
| `service_kind` | character varying | `catalog_services.service_kind` |  |
| `image_url` | character varying | `catalog_services.image_url` |  |
| `description` | text | `catalog_services.description` |  |
| `includes` | text | `catalog_services.includes` |  |
| `price` | numeric | `catalog_services.price` |  |
| `currency` | character varying | `catalog_services.currency` |  |
| `is_active` | boolean | `catalog_services.is_active` |  |
| `sort_order` | integer | `catalog_services.sort_order` |  |
| `created_at` | timestamp without time zone | `catalog_services.created_at` |  |
| `updated_at` | timestamp without time zone | `catalog_services.updated_at` |  |
| `option_group` | character varying | **no home** | from revision `0014_service_options`, which is not in the old repository; no old code reads it; set on 3 of 15 rows, one group |
| `option_name` | character varying | **no home** | from revision `0014_service_options`, which is not in the old repository; no old code reads it; set on 3 of 15 rows, one group |

### `partner.technician_bank_accounts` → `partner.technician_payout_accounts` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `technician_payout_accounts.id` | id becomes UUID (section 9.1) |
| `technician_id` | uuid | `technician_payout_accounts.technician_id` |  |
| `account_holder_name` | character varying | `technician_payout_accounts.account_holder_name` |  |
| `bank_name` | character varying | `technician_payout_accounts.bank_name` |  |
| `encrypted_account_number` | text | `technician_payout_accounts.account_number_ciphertext` | plus `account_number_key_version`; re-encrypt with the versioned key when copying |
| `account_number_last4` | character | `technician_payout_accounts.account_number_last4` |  |
| `ifsc_code` | character | `technician_payout_accounts.ifsc_code` |  |
| `verification_status` | character varying | `technician_payout_accounts.verification_status` |  |
| `created_at` | timestamp without time zone | `technician_payout_accounts.created_at` |  |
| `updated_at` | timestamp without time zone | `technician_payout_accounts.updated_at` |  |

### `partner.technician_earnings` → `partner.technician_earnings` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `technician_earnings.id` | id becomes UUID (section 9.1) |
| `technician_id` | uuid | `technician_earnings.technician_id` |  |
| `service_request_id` | uuid | `technician_earnings.booking_id` | `service_request_id` → `booking_id` (section 11) |
| `service_name` | character varying | `technician_earnings.service_name` |  |
| `service_kind` | character varying | `technician_earnings.service_kind` |  |
| `gross_amount` | numeric | `technician_earnings.gross_amount` |  |
| `commission_rate` | numeric | `technician_earnings.commission_rate` |  |
| `commission_amount` | numeric | `technician_earnings.commission_amount` |  |
| `net_amount` | numeric | `technician_earnings.net_amount` |  |
| `currency` | character | `technician_earnings.currency` |  |
| `status` | character varying | `technician_earnings.status` |  |
| `earned_at` | timestamp without time zone | `technician_earnings.earned_at` |  |
| `created_at` | timestamp without time zone | `technician_earnings.created_at` |  |

### `partner.technician_locations` → `partner.technician_locations` (2 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `technician_id` | uuid | `technician_locations.technician_id` |  |
| `latitude` | double precision | `technician_locations.latitude` |  |
| `longitude` | double precision | `technician_locations.longitude` |  |
| `accuracy` | double precision | `technician_locations.accuracy` |  |
| `heading` | double precision | `technician_locations.heading` |  |
| `speed` | double precision | `technician_locations.speed` |  |
| `last_location_at` | timestamp without time zone | `technician_locations.last_location_at` |  |
| `altitude` | double precision | `technician_locations.altitude` |  |
| `device_recorded_at` | timestamp without time zone | `technician_locations.device_timestamp` | the old code's name |

### `partner.technician_profiles` → `partner.technician_profiles` (2 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `technician_profiles.id` | id becomes UUID (section 9.1) |
| `user_id` | uuid | `technician_profiles.technician_id` | points to technicians |
| `technician_type` | character varying | `technician_profiles.technician_type` |  |
| `experience_years` | integer | `technician_profiles.experience_years` |  |
| `is_available` | boolean | `technician_profiles.work_status` | the old code's replacement: true → AVAILABLE, false → OFFLINE |
| `profile_image_url` | character varying | `technician_profiles.profile_image_url` |  |
| `created_at` | timestamp without time zone | `technician_profiles.created_at` |  |
| `updated_at` | timestamp without time zone | `technician_profiles.updated_at` |  |
| `service_radius_km` | smallint | `technician_profiles.service_radius_km` |  |
| `offers_all_services` | boolean | `technician_profiles.offers_all_services` |  |
| `working_schedule_enabled` | boolean | `technician_profiles.working_schedule_enabled` |  |

### `partner.technician_services` → `partner.technician_services` (0 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `technician_id` | uuid | `technician_services.technician_id` |  |
| `service_id` | uuid | `technician_services.catalog_service_id` | catalog rename |
| `created_at` | timestamp without time zone | `technician_services.created_at` |  |

### `partner.technician_working_hours` → `partner.technician_working_hours` (5 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `technician_id` | uuid | `technician_working_hours.technician_id` |  |
| `weekday` | smallint | `technician_working_hours.weekday` |  |
| `start_time` | time without time zone | `technician_working_hours.start_time` |  |
| `end_time` | time without time zone | `technician_working_hours.end_time` |  |
| `created_at` | timestamp without time zone | `technician_working_hours.created_at` |  |
| `updated_at` | timestamp without time zone | `technician_working_hours.updated_at` |  |

### `partner.users` → `partner.technicians` (2 rows)

| Old column | Old type | New home | Note |
| --- | --- | --- | --- |
| `id` | uuid | `technicians.id` | id becomes UUID (section 9.1) |
| `name` | character varying | `technicians.name` |  |
| `email` | character varying | `technicians.email` |  |
| `phone` | character varying | `technicians.phone` |  |
| `hashed_password` | character varying | `technicians.password_hash` | Argon2id from now on |
| `status` | character varying | `technicians.status` |  |
| `address` | text | `technicians.address` |  |
| `pincode` | character varying | `technicians.pincode` |  |
| `area` | character varying | `technicians.area` |  |
| `block` | character varying | `technicians.block` |  |
| `division` | character varying | `technicians.division` |  |
| `district` | character varying | `technicians.district` |  |
| `state` | character varying | `technicians.state` |  |
| `created_at` | timestamp without time zone | `technicians.created_at` |  |
| `updated_at` | timestamp without time zone | `technicians.updated_at` |  |
| `email_verified_at` | timestamp without time zone | `technicians.email_verified_at` |  |
| `onboarding_completed_at` | timestamp without time zone | `technicians.onboarding_completed_at` |  |

### Alembic version tables

- `public.alembic_version` (2 rows): replaced by `professional.alembic_version` (new baseline 0001/0002)
- `partner.partner_alembic_version` (1 rows): replaced by `partner.alembic_version` (new baseline 0001)
