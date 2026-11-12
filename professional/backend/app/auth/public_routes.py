"""The reviewed list of API routes that answer without a session (AZ-01).

Every other route of a module router requires a live session; app.api.v1.router mounts
each module router with that check. Paths are as registered, without /api/v1. Adding a
route here is a security decision: it must be reviewed.
"""

PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        # Sign-up, sign-in and the codes they need
        ("POST", "/auth/signup"),
        ("POST", "/auth/login"),
        ("POST", "/auth/refresh"),
        ("POST", "/auth/logout"),
        ("POST", "/auth/email/send-code"),
        ("POST", "/auth/email/verify-code"),
        ("GET", "/auth/phone/config"),
        ("POST", "/auth/phone/send-code"),
        ("POST", "/auth/phone/verify-code"),
        ("POST", "/auth/phone/login/send-code"),
        ("POST", "/auth/phone/login/verify-code"),
        ("POST", "/auth/password/forgot"),
        ("POST", "/auth/password/verify-code"),
        ("POST", "/auth/password/reset"),
        ("GET", "/auth/recovery/config"),
        # Google and Microsoft sign-in (the start link connects a provider when a
        # session is present, and signs in or registers when not)
        ("GET", "/auth/oauth/google/start"),
        ("GET", "/auth/oauth/google/callback"),
        ("GET", "/auth/oauth/microsoft/start"),
        ("GET", "/auth/oauth/microsoft/callback"),
        # India Post pincode lookup (the sign-up and estimate screens use it signed out)
        ("GET", "/locations/pincode/{pincode}"),
        # The public Delete Account page: its settings, and the retired request form (410)
        ("GET", "/account-deletion-requests/config"),
        ("POST", "/account-deletion-requests"),
        # Contact & Support: open to visitors; a signed-in person is recognised
        ("GET", "/support/config"),
        ("POST", "/support/tickets"),
        ("GET", "/report-categories"),
        ("POST", "/contact"),
        # Content shown before sign-in: estimate calculators, ads, the Vastu tool
        ("POST", "/estimates/calculate"),
        ("POST", "/estimates/public-calculate"),
        ("GET", "/ads"),
        ("POST", "/ads/{advert_id}/event"),
        ("GET", "/ads/{advert_id}/image"),
        ("GET", "/ad-placements"),
        ("POST", "/vastu/plan-analysis"),
        # General weather for the public pages: coordinates in, nothing stored
        ("GET", "/weather/public"),
        ("GET", "/weather/public/places"),
        ("GET", "/weather/public/describe"),
    }
)


def is_public(method: str, path: str) -> bool:
    return (method.upper(), path) in PUBLIC_ROUTES
