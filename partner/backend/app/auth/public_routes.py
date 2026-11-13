"""The reviewed list of API routes that answer without a session (AZ-01). Paths are as
registered, without /api/v1. Every other route needs a technician or a requester session.
Adding a route here is a security decision: it must be reviewed.
"""

PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/health"),
        ("GET", "/health/db"),
        # Technician registration, sign-in and the session cookie exchange
        ("POST", "/auth/signup/send-code"),
        ("POST", "/auth/signup/verify-code"),
        ("POST", "/auth/login"),
        ("POST", "/auth/refresh"),
        ("POST", "/auth/logout"),
        ("POST", "/auth/password-reset/send-code"),
        ("POST", "/auth/password-reset/verify-code"),
        ("POST", "/auth/password-reset/reset"),
        # The Book Technician hand-off from Professional, and the booking session's
        # cookie exchange
        ("POST", "/requester/session"),
        ("POST", "/requester/refresh"),
        ("POST", "/requester/logout"),
        # India Post pincode lookup for the registration and profile forms (as before)
        ("GET", "/locations/pincode/{pincode}"),
        # Weather for the public pages (landing, sign-in, registration): coordinates the
        # visitor's browser sends; nothing about any account, job or booking (as before)
        ("GET", "/weather/public"),
        ("GET", "/weather/public/places"),
        ("GET", "/weather/public/describe"),
    }
)


def is_public(method: str, path: str) -> bool:
    return (method.upper(), path) in PUBLIC_ROUTES
