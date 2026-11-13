# Coverage: the old Octabuild backend in Professional

Every route and table of the old backend (`Kuwait-Version/Octabuild/backend`) and where it is now. Routes were listed by importing the old app and reading `app.routes` (not from the docs); tables from the old models' metadata. New routes are under `/api/v1`; a path parameter that was an integer id is a UUID now. FastAPI's own `/openapi.json`, `/docs`, `/docs/oauth2-redirect` and `/redoc` are left out on both sides.

## MISSING

- Route `GET /health/db` (`database_health_check`): Not ported. The docs keep it as `/api/v1/health/db` (NFR-13, technical-architecture section 15); no decision retires it.

## Totals

| | Count |
| --- | --- |
| Old routes (HTTP and WebSocket) | 374 (the old app registered `GET /projects/{project_id}/suppliers` three times, with one handler: 376 registrations) |
| New routes (HTTP and WebSocket) | 374 |
| Old routes ported | 372 |
| Old routes retired by decision | 1 |
| Old routes missing | 1 |
| New routes with no old counterpart | 2 |
| Old tables | 98 |
| New tables | 100 |
| Old tables kept or renamed | 96 |
| Old tables split in two | 2 |
| Old tables removed | 0 |

New routes with no old counterpart: `GET /api/v1/auth/sessions`; `DELETE /api/v1/auth/sessions/{session_id}` (the session list, off unless `SESSION_LIST_ENABLED`, identity decision).

## 1. Routes

### app.admin.routes.admin_account_deletion_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/admin/deleted-accounts` | `/api/v1/admin/deleted-accounts` |
| GET | `/admin/deleted-accounts/{record_id}` | `/api/v1/admin/deleted-accounts/{record_id}` |

### app.admin.routes.admin_catalog_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/admin/catalog/categories` | `/api/v1/admin/catalog/categories` |
| POST | `/admin/catalog/categories` | `/api/v1/admin/catalog/categories` |
| PATCH | `/admin/catalog/categories/{category_id}` | `/api/v1/admin/catalog/categories/{category_id}` |
| GET | `/admin/catalog/subcategories` | `/api/v1/admin/catalog/subcategories` |
| POST | `/admin/catalog/subcategories` | `/api/v1/admin/catalog/subcategories` |
| PATCH | `/admin/catalog/subcategories/{subcategory_id}` | `/api/v1/admin/catalog/subcategories/{subcategory_id}` |
| GET | `/admin/catalog/brands` | `/api/v1/admin/catalog/brands` |
| POST | `/admin/catalog/brands` | `/api/v1/admin/catalog/brands` |
| PATCH | `/admin/catalog/brands/{brand_id}` | `/api/v1/admin/catalog/brands/{brand_id}` |
| GET | `/admin/catalog/units` | `/api/v1/admin/catalog/units` |
| GET | `/admin/catalog/products` | `/api/v1/admin/catalog/products` |
| GET | `/admin/catalog/products/{product_id}` | `/api/v1/admin/catalog/products/{product_id}` |
| POST | `/admin/catalog/products` | `/api/v1/admin/catalog/products` |
| PATCH | `/admin/catalog/products/{product_id}` | `/api/v1/admin/catalog/products/{product_id}` |
| POST | `/admin/catalog/products/{product_id}/variants` | `/api/v1/admin/catalog/products/{product_id}/variants` |
| PATCH | `/admin/catalog/variants/{variant_id}` | `/api/v1/admin/catalog/variants/{variant_id}` |
| POST | `/admin/catalog/products/{product_id}/image` | `/api/v1/admin/catalog/products/{product_id}/image` |
| POST | `/admin/catalog/categories/{category_id}/image` | `/api/v1/admin/catalog/categories/{category_id}/image` |
| POST | `/admin/catalog/subcategories/{subcategory_id}/image` | `/api/v1/admin/catalog/subcategories/{subcategory_id}/image` |
| POST | `/admin/catalog/brands/{brand_id}/logo` | `/api/v1/admin/catalog/brands/{brand_id}/logo` |
| POST | `/admin/catalog/products/{product_id}/video` | `/api/v1/admin/catalog/products/{product_id}/video` |
| DELETE | `/admin/catalog/products/{product_id}/video` | `/api/v1/admin/catalog/products/{product_id}/video` |
| POST | `/admin/catalog/products/{product_id}/images` | `/api/v1/admin/catalog/products/{product_id}/images` |
| PATCH | `/admin/catalog/products/{product_id}/images/order` | `/api/v1/admin/catalog/products/{product_id}/images/order` |
| PATCH | `/admin/catalog/images/{image_id}/primary` | `/api/v1/admin/catalog/images/{image_id}/primary` |
| DELETE | `/admin/catalog/images/{image_id}` | `/api/v1/admin/catalog/images/{image_id}` |

### app.admin.routes.admin_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/admin/me` | `/api/v1/admin/me` |
| GET | `/admin/users` | `/api/v1/admin/users` |
| GET | `/admin/projects` | `/api/v1/admin/projects` |
| GET | `/admin/manager-presets` | `/api/v1/admin/manager-presets` |
| GET | `/admin/admins` | `/api/v1/admin/admins` |
| POST | `/admin/admins` | `/api/v1/admin/admins` |
| PATCH | `/admin/admins/{user_id}` | `/api/v1/admin/admins/{user_id}` |
| POST | `/admin/admins/{user_id}/deactivate` | `/api/v1/admin/admins/{user_id}/deactivate` |
| POST | `/admin/admins/{user_id}/reactivate` | `/api/v1/admin/admins/{user_id}/reactivate` |
| GET | `/admin/audit` | `/api/v1/admin/audit` |
| POST | `/admin/users/{user_id}/suspend` | `/api/v1/admin/users/{user_id}/suspend` |
| POST | `/admin/users/{user_id}/reactivate` | `/api/v1/admin/users/{user_id}/reactivate` |
| GET | `/admin/verification` | `/api/v1/admin/verification` |
| POST | `/admin/verification/{user_id}` | `/api/v1/admin/verification/{user_id}` |
| GET | `/admin/reports` | `/api/v1/admin/reports` |
| POST | `/admin/reports/{report_id}` | `/api/v1/admin/reports/{report_id}` |
| GET | `/admin/users/{user_id}` | `/api/v1/admin/users/{user_id}` |
| GET | `/admin/projects/{project_id}` | `/api/v1/admin/projects/{project_id}` |
| GET | `/admin/leads` | `/api/v1/admin/leads` |
| GET | `/admin/notifications` | `/api/v1/admin/notifications` |
| POST | `/admin/notifications` | `/api/v1/admin/notifications` |
| GET | `/admin/overview` | `/api/v1/admin/overview` |
| POST | `/admin/ads/image` | `/api/v1/admin/ads/image` |
| GET | `/admin/ads/placements` | `/api/v1/admin/ads/placements` |
| GET | `/admin/ads` | `/api/v1/admin/ads` |
| POST | `/admin/ads` | `/api/v1/admin/ads` |
| PATCH | `/admin/ads/{advert_id}` | `/api/v1/admin/ads/{advert_id}` |
| POST | `/admin/ads/{advert_id}/status` | `/api/v1/admin/ads/{advert_id}/status` |
| GET | `/admin/ads/{advert_id}/stats` | `/api/v1/admin/ads/{advert_id}/stats` |

### app.admin.routes.admin_support_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/admin/support/tickets` | `/api/v1/admin/support/tickets` |
| GET | `/admin/support/tickets/{ticket_id}` | `/api/v1/admin/support/tickets/{ticket_id}` |
| GET | `/admin/support/tickets/{ticket_id}/attachment` | `/api/v1/admin/support/tickets/{ticket_id}/attachment` |
| POST | `/admin/support/tickets/{ticket_id}/reply` | `/api/v1/admin/support/tickets/{ticket_id}/reply` |

### app.builder.routes.award_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/projects/{project_id}/award` | `/api/v1/projects/{project_id}/award` |
| POST | `/awards/{award_id}/confirm` | `/api/v1/awards/{award_id}/confirm` |
| POST | `/awards/{award_id}/decline` | `/api/v1/awards/{award_id}/decline` |
| POST | `/awards/{award_id}/cancel` | `/api/v1/awards/{award_id}/cancel` |
| POST | `/awards/{award_id}/offers` | `/api/v1/awards/{award_id}/offers` |
| POST | `/award-offers/{offer_id}/accept` | `/api/v1/award-offers/{offer_id}/accept` |
| POST | `/award-offers/{offer_id}/reject` | `/api/v1/award-offers/{offer_id}/reject` |

### app.house_owner.routes.estimate_routes

| Method | Old path | New path |
| --- | --- | --- |
| POST | `/estimates` | retired: Retired by decision (porting-todo row 31): it always failed and nothing called it; `cost_estimates` is kept for the data copy. |
| POST | `/estimates/calculate` | `/api/v1/estimates/calculate` |
| POST | `/estimates/public-calculate` | `/api/v1/estimates/public-calculate` |

### app.main

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/health` | `/api/v1/health` |
| GET | `/health/db` | **MISSING**: Not ported. The docs keep it as `/api/v1/health/db` (NFR-13, technical-architecture section 15); no decision retires it. |

### app.payment_gateway.router

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/payments/gateway-status` | `/api/v1/payments/gateway-status` |
| GET | `/payments/technician-bookings` | `/api/v1/payments/technician-bookings` |
| POST | `/payments/orders` | `/api/v1/payments/orders` |
| POST | `/payments/verify` | `/api/v1/payments/verify` |
| POST | `/payments/failures` | `/api/v1/payments/failures` |
| GET | `/payments/receipts/{receipt_number}` | `/api/v1/payments/receipts/{receipt_number}` |
| POST | `/payments/mock/checkout` | `/api/v1/payments/mock/checkout` |
| POST | `/payments/webhooks/razorpay` | `/api/v1/payments/webhooks/razorpay` |

### app.shared.account.routes.account_routes

| Method | Old path | New path |
| --- | --- | --- |
| PATCH | `/auth/complete-profile` | `/api/v1/auth/complete-profile` |
| PATCH | `/auth/supplier-category` | `/api/v1/auth/supplier-category` |
| PATCH | `/auth/engineer-category` | `/api/v1/auth/engineer-category` |
| POST | `/auth/phone/change` | `/api/v1/auth/phone/change` |
| PATCH | `/auth/profile-image` | `/api/v1/auth/profile-image` |
| PATCH | `/auth/business-logo` | `/api/v1/auth/business-logo` |
| PATCH | `/auth/location` | `/api/v1/auth/location` |
| GET | `/locations/pincode/{pincode}` | `/api/v1/locations/pincode/{pincode}` |
| DELETE | `/account` | `/api/v1/account` |

### app.shared.account_deletion.routes.account_deletion_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/account-deletion-requests/config` | `/api/v1/account-deletion-requests/config` |
| POST | `/account-deletion-requests` | `/api/v1/account-deletion-requests` |
| GET | `/account/deletion-form` | `/api/v1/account/deletion-form` |
| POST | `/account/delete` | `/api/v1/account/delete` |

### app.shared.advertisements.routes.advertisement_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/ads` | `/api/v1/ads` |
| POST | `/ads/{advert_id}/event` | `/api/v1/ads/{advert_id}/event` |
| GET | `/ads/{advert_id}/image` | `/api/v1/ads/{advert_id}/image` |
| GET | `/ad-placements` | `/api/v1/ad-placements` |

### app.shared.auth.routes.auth_routes

| Method | Old path | New path |
| --- | --- | --- |
| POST | `/auth/email/send-code` | `/api/v1/auth/email/send-code` |
| POST | `/auth/email/verify-code` | `/api/v1/auth/email/verify-code` |
| GET | `/auth/phone/config` | `/api/v1/auth/phone/config` |
| GET | `/auth/recovery/config` | `/api/v1/auth/recovery/config` |
| POST | `/auth/phone/send-code` | `/api/v1/auth/phone/send-code` |
| POST | `/auth/phone/verify-code` | `/api/v1/auth/phone/verify-code` |
| POST | `/auth/phone/login/send-code` | `/api/v1/auth/phone/login/send-code` |
| POST | `/auth/phone/login/verify-code` | `/api/v1/auth/phone/login/verify-code` |
| POST | `/auth/email/profile/send-code` | `/api/v1/auth/email/profile/send-code` |
| POST | `/auth/email/profile/verify-code` | `/api/v1/auth/email/profile/verify-code` |
| POST | `/auth/signup` | `/api/v1/auth/signup` |
| POST | `/auth/password/forgot` | `/api/v1/auth/password/forgot` |
| POST | `/auth/password/verify-code` | `/api/v1/auth/password/verify-code` |
| POST | `/auth/password/reset` | `/api/v1/auth/password/reset` |
| POST | `/auth/login` | `/api/v1/auth/login` |
| POST | `/auth/refresh` | `/api/v1/auth/refresh` |
| POST | `/auth/logout` | `/api/v1/auth/logout` |
| GET | `/auth/session` | `/api/v1/auth/session` |
| POST | `/auth/partner-handoff` | `/api/v1/auth/partner-handoff` |
| GET | `/auth/oauth/google/start` | `/api/v1/auth/oauth/google/start` |
| GET | `/auth/oauth/google/callback` | `/api/v1/auth/oauth/google/callback` |
| GET | `/auth/oauth/microsoft/start` | `/api/v1/auth/oauth/microsoft/start` |
| GET | `/auth/oauth/microsoft/callback` | `/api/v1/auth/oauth/microsoft/callback` |

### app.shared.catalog.routes.catalog_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/catalog/categories` | `/api/v1/catalog/categories` |
| GET | `/catalog/subcategories` | `/api/v1/catalog/subcategories` |
| GET | `/catalog/brands` | `/api/v1/catalog/brands` |
| GET | `/catalog/units` | `/api/v1/catalog/units` |
| GET | `/catalog/products` | `/api/v1/catalog/products` |
| GET | `/catalog/search` | `/api/v1/catalog/search` |
| GET | `/catalog/products/{product_id}` | `/api/v1/catalog/products/{product_id}` |
| GET | `/catalog/products/{product_id}/variants` | `/api/v1/catalog/products/{product_id}/variants` |
| GET | `/catalog/products/{product_id}/offers` | `/api/v1/catalog/products/{product_id}/offers` |

### app.shared.cctv.routes.cctv_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/cctv/projects` | `/api/v1/cctv/projects` |
| GET | `/cctv/projects/{project_id}/camera-setup` | `/api/v1/cctv/projects/{project_id}/camera-setup` |
| POST | `/cctv/projects/{project_id}/camera-setup` | `/api/v1/cctv/projects/{project_id}/camera-setup` |
| GET | `/cctv/projects/{project_id}/devices` | `/api/v1/cctv/projects/{project_id}/devices` |
| POST | `/cctv/projects/{project_id}/devices` | `/api/v1/cctv/projects/{project_id}/devices` |
| GET | `/cctv/devices/{device_id}` | `/api/v1/cctv/devices/{device_id}` |
| PATCH | `/cctv/devices/{device_id}` | `/api/v1/cctv/devices/{device_id}` |
| PUT | `/cctv/devices/{device_id}/credentials` | `/api/v1/cctv/devices/{device_id}/credentials` |
| DELETE | `/cctv/devices/{device_id}` | `/api/v1/cctv/devices/{device_id}` |
| PUT | `/cctv/devices/{device_id}/channels` | `/api/v1/cctv/devices/{device_id}/channels` |
| POST | `/cctv/devices/{device_id}/reconnect` | `/api/v1/cctv/devices/{device_id}/reconnect` |
| POST | `/cctv/devices/{device_id}/verify` | `/api/v1/cctv/devices/{device_id}/verify` |
| POST | `/cctv/devices/{device_id}/channels/discover` | `/api/v1/cctv/devices/{device_id}/channels/discover` |
| PUT | `/cctv/devices/{device_id}/channels/discovered` | `/api/v1/cctv/devices/{device_id}/channels/discovered` |
| GET | `/cctv/channels/{channel_id}` | `/api/v1/cctv/channels/{channel_id}` |
| PATCH | `/cctv/channels/{channel_id}` | `/api/v1/cctv/channels/{channel_id}` |
| GET | `/cctv/channels/{channel_id}/status` | `/api/v1/cctv/channels/{channel_id}/status` |
| POST | `/cctv/channels/{channel_id}/playback` | `/api/v1/cctv/channels/{channel_id}/playback` |
| POST | `/cctv/channels/{channel_id}/recordings/search` | `/api/v1/cctv/channels/{channel_id}/recordings/search` |
| POST | `/cctv/channels/{channel_id}/recordings/playback` | `/api/v1/cctv/channels/{channel_id}/recordings/playback` |
| POST | `/cctv/playback/{session_id}/renew` | `/api/v1/cctv/playback/{session_id}/renew` |
| DELETE | `/cctv/playback/{session_id}` | `/api/v1/cctv/playback/{session_id}` |
| POST | `/internal/cctv/media-gateway/auth` | `/api/v1/internal/cctv/media-gateway/auth` |

### app.shared.contact.routes.contact_routes

| Method | Old path | New path |
| --- | --- | --- |
| POST | `/contact` | `/api/v1/contact` |

### app.shared.equipment_supply.routes.equipment_supply_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/equipment/items` | `/api/v1/equipment/items` |
| POST | `/equipment/items` | `/api/v1/equipment/items` |
| PATCH | `/equipment/items/{item_id}` | `/api/v1/equipment/items/{item_id}` |
| DELETE | `/equipment/items/{item_id}` | `/api/v1/equipment/items/{item_id}` |
| GET | `/equipment/requests` | `/api/v1/equipment/requests` |
| POST | `/equipment/requests/{request_id}/accept` | `/api/v1/equipment/requests/{request_id}/accept` |
| POST | `/equipment/requests/{request_id}/reject` | `/api/v1/equipment/requests/{request_id}/reject` |
| POST | `/equipment/requests/{request_id}/complete` | `/api/v1/equipment/requests/{request_id}/complete` |
| GET | `/projects/{project_id}/equipment-suppliers/{supplier_id}/items` | `/api/v1/projects/{project_id}/equipment-suppliers/{supplier_id}/items` |
| POST | `/projects/{project_id}/equipment-requests` | `/api/v1/projects/{project_id}/equipment-requests` |
| GET | `/projects/{project_id}/equipment-requests` | `/api/v1/projects/{project_id}/equipment-requests` |
| POST | `/equipment-requests/{request_id}/cancel` | `/api/v1/equipment-requests/{request_id}/cancel` |
| GET | `/equipment-requests/{request_id}/usage` | `/api/v1/equipment-requests/{request_id}/usage` |
| PUT | `/equipment-requests/{request_id}/usage/{usage_date}` | `/api/v1/equipment-requests/{request_id}/usage/{usage_date}` |

### app.shared.files.routes.file_routes

| Method | Old path | New path |
| --- | --- | --- |
| POST | `/files/upload` | `/api/v1/files/upload` |
| GET | `/files/{file_id}` | `/api/v1/files/{file_id}` |

### app.shared.labor_supply.routes.labor_supply_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/labor/trades` | `/api/v1/labor/trades` |
| GET | `/labor/services` | `/api/v1/labor/services` |
| POST | `/labor/services` | `/api/v1/labor/services` |
| PATCH | `/labor/services/{service_id}` | `/api/v1/labor/services/{service_id}` |
| DELETE | `/labor/services/{service_id}` | `/api/v1/labor/services/{service_id}` |
| GET | `/labor/requests` | `/api/v1/labor/requests` |
| POST | `/labor/requests/{request_id}/accept` | `/api/v1/labor/requests/{request_id}/accept` |
| POST | `/labor/requests/{request_id}/reject` | `/api/v1/labor/requests/{request_id}/reject` |
| GET | `/labor/requests/{request_id}/daily-records` | `/api/v1/labor/requests/{request_id}/daily-records` |
| GET | `/projects/{project_id}/labor-suppliers/{supplier_id}/services` | `/api/v1/projects/{project_id}/labor-suppliers/{supplier_id}/services` |
| POST | `/projects/{project_id}/labor-requests` | `/api/v1/projects/{project_id}/labor-requests` |
| GET | `/projects/{project_id}/labor-requests` | `/api/v1/projects/{project_id}/labor-requests` |
| POST | `/labor-requests/{request_id}/cancel` | `/api/v1/labor-requests/{request_id}/cancel` |
| POST | `/labor-requests/{request_id}/complete` | `/api/v1/labor-requests/{request_id}/complete` |
| PATCH | `/labor-requests/{request_id}` | `/api/v1/labor-requests/{request_id}` |
| GET | `/labor-requests/{request_id}/daily-records` | `/api/v1/labor-requests/{request_id}/daily-records` |
| PUT | `/labor-requests/{request_id}/daily-records/{work_date}` | `/api/v1/labor-requests/{request_id}/daily-records/{work_date}` |

### app.shared.marketplace.routes.marketplace_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/contractors/nearby` | `/api/v1/contractors/nearby` |
| GET | `/contractors/{contractor_id}/profile` | `/api/v1/contractors/{contractor_id}/profile` |
| GET | `/contractors/find-clients` | `/api/v1/contractors/find-clients` |
| GET | `/suppliers/nearby` | `/api/v1/suppliers/nearby` |
| GET | `/suppliers/{supplier_id}/profile` | `/api/v1/suppliers/{supplier_id}/profile` |
| GET | `/suppliers/find-clients` | `/api/v1/suppliers/find-clients` |
| GET | `/engineers/find` | `/api/v1/engineers/find` |
| GET | `/engineers/{engineer_id}/profile` | `/api/v1/engineers/{engineer_id}/profile` |

### app.shared.messaging.routes.event_routes

| Method | Old path | New path |
| --- | --- | --- |
| WS | `/events/ws` | `/api/v1/events/ws` |

### app.shared.messaging.routes.message_routes

| Method | Old path | New path |
| --- | --- | --- |
| POST | `/messages/send` | `/api/v1/messages/send` |
| PUT | `/messages/{message_id}` | `/api/v1/messages/{message_id}` |
| POST | `/messages/start` | `/api/v1/messages/start` |
| GET | `/messages/conversations` | `/api/v1/messages/conversations` |
| GET | `/messages/conversation/{conversation_id}` | `/api/v1/messages/conversation/{conversation_id}` |
| WS | `/messages/ws/{conversation_id}` | `/api/v1/messages/ws/{conversation_id}` |

### app.shared.notifications.routes.notification_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/notifications` | `/api/v1/notifications` |
| POST | `/notifications/read-all` | `/api/v1/notifications/read-all` |
| POST | `/notifications/read-module` | `/api/v1/notifications/read-module` |
| POST | `/notifications/{notification_id}/read` | `/api/v1/notifications/{notification_id}/read` |

### app.shared.project_requests.routes.project_request_routes

| Method | Old path | New path |
| --- | --- | --- |
| POST | `/project-requests/send` | `/api/v1/project-requests/send` |
| GET | `/project-requests/incoming` | `/api/v1/project-requests/incoming` |
| POST | `/project-requests/accept` | `/api/v1/project-requests/accept` |
| POST | `/project-requests/assign` | `/api/v1/project-requests/assign` |
| POST | `/project-requests/assign-engineer` | `/api/v1/project-requests/assign-engineer` |
| POST | `/project-requests/confirm-assignment` | `/api/v1/project-requests/confirm-assignment` |
| POST | `/project-requests/reject` | `/api/v1/project-requests/reject` |
| POST | `/project-requests/withdraw` | `/api/v1/project-requests/withdraw` |

### app.shared.project_suppliers.routes.project_supplier_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/contractors/my-suppliers` | `/api/v1/contractors/my-suppliers` |
| POST | `/projects/{project_id}/assign-supplier` | `/api/v1/projects/{project_id}/assign-supplier` |
| POST | `/projects/{project_id}/unassign-supplier` | `/api/v1/projects/{project_id}/unassign-supplier` |
| GET | `/projects/{project_id}/suppliers` | `/api/v1/projects/{project_id}/suppliers` |
| GET | `/projects/{project_id}/team-suppliers` | `/api/v1/projects/{project_id}/team-suppliers` |
| GET | `/suppliers/my-projects` | `/api/v1/suppliers/my-projects` |

### app.shared.projects.routes.project_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/owners/projects` | `/api/v1/owners/projects` |
| POST | `/projects/create` | `/api/v1/projects/create` |
| POST | `/projects/create-with-image` | `/api/v1/projects/create-with-image` |
| GET | `/projects/{project_id}` | `/api/v1/projects/{project_id}` |
| DELETE | `/projects/{project_id}` | `/api/v1/projects/{project_id}` |
| PATCH | `/projects/{project_id}/progress` | `/api/v1/projects/{project_id}/progress` |
| PATCH | `/projects/{project_id}/requirement` | `/api/v1/projects/{project_id}/requirement` |
| GET | `/projects/{project_id}/photos` | `/api/v1/projects/{project_id}/photos` |
| DELETE | `/project-photos/{photo_id}` | `/api/v1/project-photos/{photo_id}` |
| POST | `/timelines/create` | `/api/v1/timelines/create` |
| GET | `/timelines/project/{project_id}` | `/api/v1/timelines/project/{project_id}` |

### app.shared.property.routes.property_routes

| Method | Old path | New path |
| --- | --- | --- |
| POST | `/property-listings` | `/api/v1/property-listings` |
| GET | `/property-listings/mine` | `/api/v1/property-listings/mine` |
| GET | `/property-listings` | `/api/v1/property-listings` |
| GET | `/property-listings/{listing_id}` | `/api/v1/property-listings/{listing_id}` |
| PATCH | `/property-listings/{listing_id}` | `/api/v1/property-listings/{listing_id}` |
| PUT | `/property-listings/{listing_id}/images` | `/api/v1/property-listings/{listing_id}/images` |
| PATCH | `/property-listings/{listing_id}/status` | `/api/v1/property-listings/{listing_id}/status` |
| DELETE | `/property-listings/{listing_id}` | `/api/v1/property-listings/{listing_id}` |
| POST | `/property-listings/{listing_id}/request` | `/api/v1/property-listings/{listing_id}/request` |
| GET | `/property-listings/{listing_id}/requests` | `/api/v1/property-listings/{listing_id}/requests` |

### app.shared.reports.routes.report_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/report-categories` | `/api/v1/report-categories` |
| POST | `/reports` | `/api/v1/reports` |
| GET | `/reports/mine` | `/api/v1/reports/mine` |

### app.shared.shop.routes.material_request_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/supplier/material-requests` | `/api/v1/supplier/material-requests` |
| POST | `/supplier/material-requests/{request_id}/respond` | `/api/v1/supplier/material-requests/{request_id}/respond` |
| POST | `/supplier/purchase-requests/{request_code}/respond` | `/api/v1/supplier/purchase-requests/{request_code}/respond` |
| POST | `/material-requests` | `/api/v1/material-requests` |
| GET | `/material-requests/mine` | `/api/v1/material-requests/mine` |

### app.shared.shop.routes.shop_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/cart` | `/api/v1/cart` |
| DELETE | `/cart` | `/api/v1/cart` |
| POST | `/cart/items` | `/api/v1/cart/items` |
| PATCH | `/cart/items/{item_id}` | `/api/v1/cart/items/{item_id}` |
| DELETE | `/cart/items/{item_id}` | `/api/v1/cart/items/{item_id}` |
| POST | `/cart/checkout` | `/api/v1/cart/checkout` |
| GET | `/shop/products` | `/api/v1/shop/products` |

### app.shared.support.routes.support_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/support/config` | `/api/v1/support/config` |
| POST | `/support/tickets` | `/api/v1/support/tickets` |
| GET | `/support/tickets` | `/api/v1/support/tickets` |
| GET | `/support/tickets/{reference}` | `/api/v1/support/tickets/{reference}` |
| POST | `/support/tickets/{reference}/messages` | `/api/v1/support/tickets/{reference}/messages` |
| GET | `/support/tickets/{reference}/attachment` | `/api/v1/support/tickets/{reference}/attachment` |

### app.shared.translation.routes.translation_routes

| Method | Old path | New path |
| --- | --- | --- |
| POST | `/translate` | `/api/v1/translate` |

### app.shared.vastu.routes.vastu_routes

| Method | Old path | New path |
| --- | --- | --- |
| POST | `/vastu/plan-analysis` | `/api/v1/vastu/plan-analysis` |

### app.site_engineer.routes.daily_cost_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/cost-tool/projects/{project_id}/summary` | `/api/v1/cost-tool/projects/{project_id}/summary` |
| GET | `/owners/projects/{project_id}/analysis` | `/api/v1/owners/projects/{project_id}/analysis` |
| POST | `/cost-tool/registers` | `/api/v1/cost-tool/registers` |
| POST | `/cost-tool/registers/{register_id}/labour` | `/api/v1/cost-tool/registers/{register_id}/labour` |
| POST | `/cost-tool/registers/{register_id}/material-usage` | `/api/v1/cost-tool/registers/{register_id}/material-usage` |
| POST | `/cost-tool/registers/{register_id}/material-purchases` | `/api/v1/cost-tool/registers/{register_id}/material-purchases` |
| POST | `/cost-tool/registers/{register_id}/expenses` | `/api/v1/cost-tool/registers/{register_id}/expenses` |
| POST | `/cost-tool/registers/{register_id}/machinery` | `/api/v1/cost-tool/registers/{register_id}/machinery` |
| POST | `/cost-tool/registers/{register_id}/payments` | `/api/v1/cost-tool/registers/{register_id}/payments` |
| POST | `/materials/create` | `/api/v1/materials/create` |
| POST | `/labour/create` | `/api/v1/labour/create` |
| POST | `/projects/{project_id}/daily-workflow` | `/api/v1/projects/{project_id}/daily-workflow` |

### app.site_engineer.routes.engineer_team_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/projects/{project_id}/specialist-team` | `/api/v1/projects/{project_id}/specialist-team` |
| GET | `/projects/{project_id}/specialist-candidates` | `/api/v1/projects/{project_id}/specialist-candidates` |
| POST | `/projects/{project_id}/specialist-request` | `/api/v1/projects/{project_id}/specialist-request` |
| POST | `/engineers/invite` | `/api/v1/engineers/invite` |
| POST | `/engineers/invite/revoke` | `/api/v1/engineers/invite/revoke` |
| POST | `/engineers/send-request` | `/api/v1/engineers/send-request` |
| GET | `/engineers/my-team` | `/api/v1/engineers/my-team` |
| POST | `/engineers/join-team` | `/api/v1/engineers/join-team` |
| POST | `/engineers/request-join` | `/api/v1/engineers/request-join` |
| POST | `/engineers/join-request/respond` | `/api/v1/engineers/join-request/respond` |
| GET | `/engineers/opportunities` | `/api/v1/engineers/opportunities` |
| POST | `/engineers/opportunities/{project_id}/apply` | `/api/v1/engineers/opportunities/{project_id}/apply` |
| GET | `/engineers/my-projects` | `/api/v1/engineers/my-projects` |
| POST | `/projects/{project_id}/assign-engineer` | `/api/v1/projects/{project_id}/assign-engineer` |
| POST | `/projects/{project_id}/unassign-engineer` | `/api/v1/projects/{project_id}/unassign-engineer` |
| GET | `/projects/{project_id}/engineer` | `/api/v1/projects/{project_id}/engineer` |

### app.store_manager.routes.store_manager_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/store-manager/overview` | `/api/v1/store-manager/overview` |
| GET | `/store-manager/projects` | `/api/v1/store-manager/projects` |
| GET | `/store-manager/items` | `/api/v1/store-manager/items` |
| POST | `/store-manager/items` | `/api/v1/store-manager/items` |
| PATCH | `/store-manager/items/{item_id}` | `/api/v1/store-manager/items/{item_id}` |
| POST | `/store-manager/items/{item_id}/stock` | `/api/v1/store-manager/items/{item_id}/stock` |
| GET | `/store-manager/items/{item_id}/movements` | `/api/v1/store-manager/items/{item_id}/movements` |
| GET | `/store-manager/requests` | `/api/v1/store-manager/requests` |
| POST | `/store-manager/requests/{request_id}/approve` | `/api/v1/store-manager/requests/{request_id}/approve` |
| POST | `/store-manager/requests/{request_id}/reject` | `/api/v1/store-manager/requests/{request_id}/reject` |
| GET | `/store-manager/requests/{request_id}/purchase-options` | `/api/v1/store-manager/requests/{request_id}/purchase-options` |
| POST | `/store-manager/requests/{request_id}/issue` | `/api/v1/store-manager/requests/{request_id}/issue` |
| GET | `/store-manager/purchases` | `/api/v1/store-manager/purchases` |
| POST | `/store-manager/purchases/lines/{line_id}/receive` | `/api/v1/store-manager/purchases/lines/{line_id}/receive` |
| GET | `/store-manager/buy/products` | `/api/v1/store-manager/buy/products` |
| POST | `/store-manager/purchases/checkout` | `/api/v1/store-manager/purchases/checkout` |
| POST | `/store-manager/purchases/verify` | `/api/v1/store-manager/purchases/verify` |
| POST | `/store-manager/purchases/failure` | `/api/v1/store-manager/purchases/failure` |
| POST | `/store-manager/purchases/payments/{payment_id}/check` | `/api/v1/store-manager/purchases/payments/{payment_id}/check` |
| POST | `/store-manager/purchases/mock-checkout` | `/api/v1/store-manager/purchases/mock-checkout` |
| GET | `/store-manager/payments` | `/api/v1/store-manager/payments` |
| POST | `/store-manager/payments` | `/api/v1/store-manager/payments` |
| GET | `/store/site-stores` | `/api/v1/store/site-stores` |
| POST | `/store/site-requests` | `/api/v1/store/site-requests` |
| POST | `/store/site-requests/{request_id}/cancel` | `/api/v1/store/site-requests/{request_id}/cancel` |
| GET | `/store/site-requests/mine` | `/api/v1/store/site-requests/mine` |
| GET | `/store-builder-requests` | `/api/v1/store-builder-requests` |
| POST | `/store-builder-requests` | `/api/v1/store-builder-requests` |
| POST | `/store-builder-requests/{request_id}/respond` | `/api/v1/store-builder-requests/{request_id}/respond` |
| POST | `/store-builder-requests/{request_id}/withdraw` | `/api/v1/store-builder-requests/{request_id}/withdraw` |

### app.subscription.coupon_admin

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/admin/coupons` | `/api/v1/admin/coupons` |
| POST | `/admin/coupons` | `/api/v1/admin/coupons` |
| PATCH | `/admin/coupons/{coupon_id}` | `/api/v1/admin/coupons/{coupon_id}` |
| POST | `/admin/coupons/{coupon_id}/status` | `/api/v1/admin/coupons/{coupon_id}/status` |

### app.subscription.payment_history_admin

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/admin/subscription-payments` | `/api/v1/admin/subscription-payments` |
| GET | `/admin/subscription-payments/summary` | `/api/v1/admin/subscription-payments/summary` |

### app.subscription.router

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/subscriptions/plans` | `/api/v1/subscriptions/plans` |
| GET | `/subscriptions/badges` | `/api/v1/subscriptions/badges` |
| GET | `/subscriptions/me` | `/api/v1/subscriptions/me` |
| POST | `/subscriptions/orders` | `/api/v1/subscriptions/orders` |
| POST | `/subscriptions/reconcile` | `/api/v1/subscriptions/reconcile` |
| POST | `/subscriptions/orders/{payment_id}/reconcile` | `/api/v1/subscriptions/orders/{payment_id}/reconcile` |
| PATCH | `/subscriptions/signup-plan` | `/api/v1/subscriptions/signup-plan` |
| POST | `/subscriptions/coupons/validate` | `/api/v1/subscriptions/coupons/validate` |
| POST | `/subscriptions/verify` | `/api/v1/subscriptions/verify` |
| POST | `/subscriptions/failures` | `/api/v1/subscriptions/failures` |
| POST | `/subscriptions/mock/checkout` | `/api/v1/subscriptions/mock/checkout` |
| POST | `/subscriptions/webhooks/razorpay` | `/api/v1/subscriptions/webhooks/razorpay` |
| GET | `/builder/portfolio` | `/api/v1/builder/portfolio` |
| GET | `/builder/portfolio/export.csv` | `/api/v1/builder/portfolio/export.csv` |
| GET | `/projects/{project_id}/summary.csv` | `/api/v1/projects/{project_id}/summary.csv` |
| GET | `/cost-tool/registers/{register_id}/builder-adjustments` | `/api/v1/cost-tool/registers/{register_id}/builder-adjustments` |
| POST | `/cost-tool/registers/{register_id}/builder-adjustments` | `/api/v1/cost-tool/registers/{register_id}/builder-adjustments` |

### app.supplier.routes.supplier_product_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/supplier-products` | `/api/v1/supplier-products` |
| POST | `/supplier-products` | `/api/v1/supplier-products` |
| POST | `/supplier-products/from-catalog` | `/api/v1/supplier-products/from-catalog` |
| PATCH | `/supplier-products/{product_id}/price` | `/api/v1/supplier-products/{product_id}/price` |
| PATCH | `/supplier-products/{product_id}` | `/api/v1/supplier-products/{product_id}` |
| GET | `/supplier-products/{product_id}/bulk-pricing` | `/api/v1/supplier-products/{product_id}/bulk-pricing` |
| PUT | `/supplier-products/{product_id}/bulk-pricing` | `/api/v1/supplier-products/{product_id}/bulk-pricing` |
| DELETE | `/supplier-products/{product_id}` | `/api/v1/supplier-products/{product_id}` |

### app.weather.routes.weather_routes

| Method | Old path | New path |
| --- | --- | --- |
| GET | `/weather/projects` | `/api/v1/weather/projects` |
| GET | `/weather/projects/{project_id}/current` | `/api/v1/weather/projects/{project_id}/current` |
| GET | `/weather/projects/{project_id}/forecast/hourly` | `/api/v1/weather/projects/{project_id}/forecast/hourly` |
| GET | `/weather/projects/{project_id}/forecast/daily` | `/api/v1/weather/projects/{project_id}/forecast/daily` |
| GET | `/weather/projects/{project_id}/alerts` | `/api/v1/weather/projects/{project_id}/alerts` |
| GET | `/weather/alerts/history` | `/api/v1/weather/alerts/history` |
| POST | `/weather/alerts/{alert_id}/acknowledge` | `/api/v1/weather/alerts/{alert_id}/acknowledge` |
| GET | `/weather/projects/{project_id}/location` | `/api/v1/weather/projects/{project_id}/location` |
| PUT | `/weather/projects/{project_id}/location` | `/api/v1/weather/projects/{project_id}/location` |
| GET | `/weather/projects/{project_id}/location/search` | `/api/v1/weather/projects/{project_id}/location/search` |
| GET | `/weather/me/current` | `/api/v1/weather/me/current` |
| GET | `/weather/me/forecast/hourly` | `/api/v1/weather/me/forecast/hourly` |
| GET | `/weather/me/forecast/daily` | `/api/v1/weather/me/forecast/daily` |
| GET | `/weather/me/alerts` | `/api/v1/weather/me/alerts` |
| GET | `/weather/me/location` | `/api/v1/weather/me/location` |
| PUT | `/weather/me/location` | `/api/v1/weather/me/location` |
| GET | `/weather/me/location/search` | `/api/v1/weather/me/location/search` |
| GET | `/weather/summary` | `/api/v1/weather/summary` |
| GET | `/weather/public` | `/api/v1/weather/public` |
| GET | `/weather/public/places` | `/api/v1/weather/public/places` |
| GET | `/weather/public/describe` | `/api/v1/weather/public/describe` |

## 2. Tables

From technical-architecture.md section 10, checked against both codebases: every old table is in the map and every target exists in the new models.

| Domain | Old table | New table | Change |
| --- | --- | --- | --- |
| Accounts | `account_deletion_requests` | `account_deletion_requests` | UUID |
| Accounts | `admin_profiles` | `admin_profiles` | UUID |
| Accounts | `builder_profiles` | `builder_profiles` | UUID; FK `user_id` CASCADE |
| Accounts | `engineer_profiles` | `engineer_profiles` | UUID; add `category` (SITE\_ENGINEER / STORE\_MANAGER) |
| Accounts | `owner_profiles` | `owner_profiles` | UUID; FK `user_id` CASCADE |
| Accounts | `supplier_profiles` | `supplier_profiles` | UUID; FK `user_id` CASCADE |
| Admin | `advertisement_daily_stats` | `ad_daily_stats` | Rename, UUID; FK `ad_id` CASCADE |
| Admin | `advertisements` | `ads` | Rename, UUID |
| Admin | `audit_events` | `admin_audit_logs` | Rename, UUID; `target_id` stays text |
| Admin | `reports` | `user_reports` | Rename, UUID |
| Billing | `builder_subscriptions` | `builder_subscriptions` | No change |
| Billing | `payment_orders` | `booking_payment_orders` | Rename; FK `booking_id` → `partner.bookings` RESTRICT |
| Billing | `payment_receipts` | `booking_payment_receipts` | Rename |
| Billing | `payment_transactions` | `booking_payment_transactions` | Rename |
| Billing | `subscription_coupon_redemptions` | `subscription_coupon_redemptions` | UUID |
| Billing | `subscription_coupons` | `subscription_coupons` | UUID |
| Billing | `subscription_payments` | `subscription_payments` | No change |
| Billing | `subscription_plan_prices` | `subscription_plan_prices` | UUID |
| Billing | `subscription_webhook_events` | `payment_webhook_events` | Rename, UUID; used by both webhooks |
| Cameras | `cctv_audit_events` | `cctv_audit_events` | Add FK to `projects`, `users` where missing |
| Cameras | `cctv_channels` | `cctv_channels` | Add FK to `projects`, `users` where missing |
| Cameras | `cctv_device_credentials` | `cctv_device_credentials` | Add FK to `projects`, `users` where missing |
| Cameras | `cctv_devices` | `cctv_devices` | Add FK to `projects`, `users` where missing |
| Cameras | `cctv_discovery_results` | `cctv_discovery_results` | Add FK to `projects`, `users` where missing |
| Cameras | `cctv_playback_sessions` | `cctv_playback_sessions` | Add FK to `projects`, `users` where missing |
| Cameras | `cctv_project_access` | `cctv_project_access` | Add FK to `projects`, `users` where missing |
| Cameras | `cctv_rate_limit_events` | `cctv_rate_limit_events` | UUID |
| Catalog | `master_brands` | `catalog_brands` | Rename, UUID |
| Catalog | `master_categories` | `catalog_categories` | Rename, UUID |
| Catalog | `master_product_images` | `catalog_product_media` | Rename, UUID; FK `file_id` |
| Catalog | `master_product_variants` | `catalog_product_variants` | Rename, UUID |
| Catalog | `master_products` | `catalog_products` | Rename, UUID |
| Catalog | `master_subcategories` | `catalog_subcategories` | Rename, UUID |
| Catalog | `master_units` | `catalog_units` | Rename, UUID |
| Equipment supply | `equipment_items` | `equipment_listings` | Rename, UUID |
| Equipment supply | `equipment_requests` | `equipment_requests` | UUID; `contractor_id` → `builder_id` |
| Equipment supply | `equipment_usage_logs` | `equipment_usage_logs` | UUID |
| Files | `uploaded_files` | `files` | Rename, UUID |
| Identity | `auth_sessions` | `user_sessions` | Rename; add `csrf_secret_hash` |
| Identity | `email_verifications` | `email_verification_codes` | Rename, UUID |
| Identity | `oauth_identities` | `user_oauth_identities` | Rename |
| Identity | `phone_otp_send_events` | `otp_send_events` | Rename, UUID |
| Identity | `phone_verifications` | `phone_verification_codes` | Rename, UUID |
| Identity | `users` | `users` | Add `deleted_at`; role values in 7.1 |
| Identity | `verification_records` | `user_verification_reviews` | Rename, UUID |
| Labour supply | `labor_daily_records` | `labour_attendance_records` | Rename, UUID |
| Labour supply | `labor_requests` | `labour_requests` | Rename, UUID; `contractor_id` → `builder_id` |
| Labour supply | `labor_services` | `labour_services` | Rename (spelling), UUID |
| Marketplace | `cart_items` | `cart_items` | UUID; FK `listing_id` |
| Marketplace | `material_order_items` | split into `purchase_orders`, `purchase_order_items` | Split: one order per `request_code` and supplier (`order_number`), lines below it; UUID |
| Marketplace | `supplier_bulk_pricing` | `supplier_listing_price_tiers` | Rename, UUID |
| Marketplace | `supplier_products` | `supplier_listings` | Rename, UUID; FKs to catalog product and variant |
| Messaging | `conversation_participants` | `conversation_participants` | UUID; unique (conversation, user) |
| Messaging | `conversations` | `conversations` | UUID |
| Messaging | `messages` | `messages` | UUID |
| Messaging | `notifications` | `notifications` | UUID |
| Projects | `award_offers` | `project_award_offers` | Rename, UUID |
| Projects | `builder_engineer_invitations` | `team_invitations` | Rename, UUID |
| Projects | `builder_engineer_memberships` | `team_memberships` | Rename, UUID |
| Projects | `escrow_milestones` | `project_escrow_milestones` | Rename, UUID; written on project create and award (kept: in use) |
| Projects | `estimates` | `cost_estimates` | Rename, UUID |
| Projects | `project_awards` | `project_awards` | UUID; FK `agreed_offer_id` |
| Projects | `project_engineer_assignments` | `project_engineer_assignments` | UUID |
| Projects | `project_media` | `project_photos` | Rename, UUID; FK `timeline_entry_id` SET NULL |
| Projects | `project_supplier_assignments` | `project_supplier_assignments` | UUID; `contractor_id` → `builder_id` |
| Projects | `project_timelines` | `project_timeline_entries` | Rename, UUID |
| Projects | `projects` | `projects` | UUID; rename `contractor_id` → `builder_id`; add `deleted_at` |
| Projects | `requests` | split into `project_requests`, `property_enquiries` | Split by kind: project rows and property rows; UUID |
| Projects | `reviews` | `project_reviews` | Rename, UUID; read by nearby-contractor search (kept: in use) |
| Property | `property_listing_images` | `property_listing_images` | UUID |
| Property | `property_listings` | `property_listings` | UUID; hard delete kept (no `deleted_at`: the seller's delete removes the listing, its photos and enquiries, as before) |
| Site operations | `builder_offline_suppliers` | `builder_offline_suppliers` | UUID |
| Site operations | `builder_workers` | `builder_workers` | UUID |
| Site operations | `daily_record_adjustments` | `site_daily_record_adjustments` | Rename, UUID |
| Site operations | `daily_site_records` | `site_daily_records` | Rename, UUID; `contractor_id` → `builder_id` |
| Site operations | `labour_logs` | `legacy_labour_logs` | Rename, UUID; deprecated with its endpoint |
| Site operations | `material_logs` | `legacy_material_logs` | Rename, UUID; deprecated with its endpoint |
| Site operations | `project_material_inventory` | `project_material_stock` | Rename, UUID |
| Site operations | `site_expenses` | `site_expenses` | UUID; FK `daily_record_id` CASCADE |
| Site operations | `site_labour_entries` | `site_labour_entries` | UUID; FK `daily_record_id` CASCADE |
| Site operations | `site_machinery_usages` | `site_machinery_usages` | UUID; FK `daily_record_id` CASCADE |
| Site operations | `site_material_purchases` | `site_material_purchases` | UUID; FK `daily_record_id` CASCADE |
| Site operations | `site_material_usages` | `site_material_usages` | UUID; FK `daily_record_id` CASCADE |
| Site operations | `site_payments` | `site_payments` | UUID; FK `daily_record_id` CASCADE |
| Store | `store_builder_requests` | `store_builder_requests` | UUID |
| Store | `store_items` | `store_items` | UUID; add `version` |
| Store | `store_payment_records` | `store_payments` | Rename; `transaction_uuid` becomes `id` |
| Store | `store_purchase_receipts` | `store_goods_receipts` | Rename, UUID; FK `purchase_order_item_id` |
| Store | `store_site_request_lines` | `store_site_request_items` | Rename, UUID |
| Store | `store_site_requests` | `store_site_requests` | UUID; `public_request_id` becomes `id` |
| Store | `store_stock_movements` | `store_stock_movements` | UUID |
| Support | `support_ticket_messages` | `support_ticket_messages` | UUID; FK CASCADE |
| Support | `support_tickets` | `support_tickets` | UUID; `reference` stays the public code |
| Weather | `weather_alert_acknowledgements` | `weather_alert_acknowledgements` | UUID |
| Weather | `weather_alerts` | `weather_alerts` | UUID |
| Weather | `weather_geocode_cache` | `weather_geocode_cache` | UUID |
| Weather | `weather_site_locations` | `weather_site_locations` | UUID |
| Weather | `weather_snapshots` | `weather_snapshots` | UUID |
