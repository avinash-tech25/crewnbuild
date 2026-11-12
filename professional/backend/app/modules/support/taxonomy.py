"""The guided support form's choices: account types, issue categories, issues,
and the extra fields each issue asks for. Ported unchanged from the old
app/shared/support/taxonomy.py, except that the Builder role is now BUILDER.

Taken from the CREWNBUILD Support Flow developer brief (Guided Support Flow,
sections 1-3). It lives here, on the server, so that the page shows exactly what
the API accepts: GET /support/config sends it, POST /support/tickets validates
against it. Changing the taxonomy is a change to this file only.
"""

from typing import Any

# Extra fields an issue may ask for. Each is optional text the person types;
# none is a link to a record (a ticket never grants access to a project/order).
FIELD_PROJECT_REFERENCE = "project_reference"
FIELD_ORDER_REFERENCE = "order_reference"
FIELD_PRODUCT_NAME = "product_name"
FIELD_TRANSACTION_REFERENCE = "transaction_reference"
FIELD_PAYMENT_DATE = "payment_date"
FIELD_JOB_REFERENCE = "job_reference"
FIELD_DEVICE = "device"

DETAIL_FIELDS = {
    FIELD_PROJECT_REFERENCE: {"label": "Project ID or name", "max_length": 120},
    FIELD_ORDER_REFERENCE: {"label": "Order or booking ID", "max_length": 120},
    FIELD_PRODUCT_NAME: {"label": "Product or service name", "max_length": 160},
    FIELD_TRANSACTION_REFERENCE: {"label": "Transaction reference", "max_length": 120},
    FIELD_PAYMENT_DATE: {"label": "Payment date", "max_length": 10, "type": "date"},
    FIELD_JOB_REFERENCE: {"label": "Job ID or application reference", "max_length": 120},
    FIELD_DEVICE: {"label": "Device and browser", "max_length": 160},
}

ACCOUNT_TYPES = {
    "HOMEOWNER": "Homeowner",
    "BUILDER": "Builder",
    "ENGINEER": "Engineer",
    "SUPPLIER": "Supplier",
    "SERVICE_PARTNER": "Service Partner",
    "OTHER": "Other",
}

# A signed-in account's role, as the account type the form starts on.
ROLE_ACCOUNT_TYPES = {
    "OWNER": "HOMEOWNER",
    "BUILDER": "BUILDER",
    "ENGINEER": "ENGINEER",
    "SUPPLIER": "SUPPLIER",
}

_PROJECT = (FIELD_PROJECT_REFERENCE,)
_ORDER = (FIELD_ORDER_REFERENCE, FIELD_PRODUCT_NAME)
_PAYMENT = (FIELD_TRANSACTION_REFERENCE, FIELD_PAYMENT_DATE)
_JOB = (FIELD_JOB_REFERENCE,)
_TECH = (FIELD_DEVICE,)

# category -> label, issues {key: (label, extra fields)}
CATEGORIES = {
    "ACCOUNT": {
        "label": "Account & Registration",
        "issues": {
            "SIGN_UP": ("Sign-up issue", ()),
            "LOGIN": ("Login issue", ()),
            "OTP": ("OTP issue", ()),
            "PROFILE": ("Profile issue", ()),
            "VERIFICATION": ("Verification issue", ()),
        },
    },
    "PROJECTS": {
        "label": "Projects & Listings",
        "issues": {
            "CREATE_PROJECT": ("Create project", _PROJECT),
            "EDIT_PROJECT": ("Edit project", _PROJECT),
            "PROJECT_VISIBILITY": ("Project visibility", _PROJECT),
            "LISTING": ("Listing issue", _PROJECT),
        },
    },
    "LEADS": {
        "label": "Leads & Opportunities",
        "issues": {
            "LEAD_NOT_RECEIVED": ("Lead not received", _PROJECT),
            "LEAD_DETAILS": ("Lead details", _PROJECT),
            "JOB_APPLICATION": ("Job application", _JOB),
        },
    },
    "ORDERS": {
        "label": "Materials, Orders & Services",
        "issues": {
            "CATALOGUE": ("Product catalogue", (FIELD_PRODUCT_NAME,)),
            "ORDER": ("Order issue", _ORDER),
            "BOOKING": ("Booking issue", _ORDER),
            "DELIVERY": ("Delivery issue", _ORDER),
        },
    },
    "PAYMENTS": {
        "label": "Payments & Subscription",
        "issues": {
            "PAYMENT_FAILURE": ("Payment failure", _PAYMENT),
            "INVOICE": ("Invoice", _PAYMENT),
            "SUBSCRIPTION_PLAN": ("Subscription plan", ()),
            "RENEWAL": ("Renewal", _PAYMENT),
            "REFUND": ("Refund", _PAYMENT),
        },
    },
    "TECHNICAL": {
        "label": "Technical Issues",
        "issues": {
            "PAGE_ERROR": ("App/page error", _TECH),
            "UPLOAD": ("Upload issue", _TECH),
            "PERFORMANCE": ("Performance issue", _TECH),
            "BUG": ("Bug report", _TECH),
        },
    },
    "OTHER": {
        "label": "Other Enquiries",
        "issues": {
            "GENERAL": ("General question", ()),
            "FEEDBACK": ("Feedback", ()),
            "PARTNERSHIP": ("Partnership", ()),
        },
    },
}

# Which categories each account type is offered (brief, Step 1: the example
# support context per account type).
ACCOUNT_TYPE_CATEGORIES = {
    "HOMEOWNER": ("ACCOUNT", "PROJECTS", "ORDERS", "PAYMENTS", "TECHNICAL", "OTHER"),
    "BUILDER": ("ACCOUNT", "PROJECTS", "LEADS", "ORDERS", "PAYMENTS", "TECHNICAL", "OTHER"),
    "ENGINEER": ("ACCOUNT", "PROJECTS", "LEADS", "PAYMENTS", "TECHNICAL", "OTHER"),
    "SUPPLIER": ("ACCOUNT", "LEADS", "ORDERS", "PAYMENTS", "TECHNICAL", "OTHER"),
    "SERVICE_PARTNER": ("ACCOUNT", "LEADS", "ORDERS", "PAYMENTS", "TECHNICAL", "OTHER"),
    "OTHER": ("ACCOUNT", "PAYMENTS", "TECHNICAL", "OTHER"),
}

STATUS_LABELS = {
    "OPEN": "Open",
    "IN_PROGRESS": "In Progress",
    "WAITING_FOR_USER": "Waiting for You",
    "RESOLVED": "Resolved",
    "CLOSED": "Closed",
}

DESCRIPTION_MIN_LENGTH = 10
DESCRIPTION_MAX_LENGTH = 2000
REPLY_MAX_LENGTH = 2000


def category_allowed(account_type: str, category: str) -> bool:
    return category in ACCOUNT_TYPE_CATEGORIES.get(account_type, ())


def issue_fields(category: str, issue: str) -> tuple[str, ...] | None:
    """The extra fields an issue asks for, or None when the issue is unknown."""
    entry = CATEGORIES.get(category, {}).get("issues", {}).get(issue)
    return entry[1] if entry else None


def issue_label(category: str, issue: str) -> str:
    entry = CATEGORIES.get(category, {}).get("issues", {}).get(issue)
    return entry[0] if entry else issue


def category_label(category: str) -> str:
    return CATEGORIES.get(category, {}).get("label", category)


def public_taxonomy() -> dict[str, Any]:
    """The taxonomy as the page reads it, in display order."""
    return {
        "account_types": [{"key": key, "label": label} for key, label in ACCOUNT_TYPES.items()],
        "account_type_categories": {key: list(value) for key, value in ACCOUNT_TYPE_CATEGORIES.items()},
        "categories": [
            {
                "key": key,
                "label": entry["label"],
                "issues": [
                    {"key": issue, "label": label, "fields": list(fields)}
                    for issue, (label, fields) in entry["issues"].items()
                ],
            }
            for key, entry in CATEGORIES.items()
        ],
        "detail_fields": [{"key": key, **spec} for key, spec in DETAIL_FIELDS.items()],
        "statuses": [{"key": key, "label": label} for key, label in STATUS_LABELS.items()],
        "description": {"min_length": DESCRIPTION_MIN_LENGTH, "max_length": DESCRIPTION_MAX_LENGTH},
        "reply_max_length": REPLY_MAX_LENGTH,
    }
