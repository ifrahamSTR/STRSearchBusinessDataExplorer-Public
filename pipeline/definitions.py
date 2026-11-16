"""Business definitions for the 16 Nov 2026 reporting version (Supabase reporting layer).

Source precedence: the reporting layer's SQL reference ("STR Search | Reporting Semantic Layer & SQL
Reference", dated 15 Nov 2026) and the exported views > patterns verified in the export > analyst
interpretation. Every rule the SQL reference states is re-checked against the export in quality.py, so a
change upstream fails the build instead of silently changing a figure.

The archived 12 Nov 2026 version keeps its own definitions in versions/2026-11-12/pipeline/definitions.py.
"""
from __future__ import annotations

# --------------------------------------------------------------------------------------------- package
VERSION_ID = "2026-11-16"
PACKAGE_LABEL = "16 Nov 2026"
PACKAGE_TITLE = "Updated reporting"
SOURCE_FOLDER = "16 Nov UpdatedReports"
SOURCE_WORKBOOK = "New SQL Views for Reporting.xlsx"
SQL_REFERENCE = "STR Search _ Reporting Semantic Layer & SQL Reference.docx"
SQL_REFERENCE_DATE = "2026-11-15"
SHEETS = {
    "jira": "jira_reporting_base",          # one row per Jira issue (materialized view)
    "deals": "pipedrive_reporting_base",    # one row per STR Search Pipedrive deal (materialized view)
    "master": "won_clients_master",         # one row per won STR Search deal = engagement (materialized view)
    "events": "client_events",              # <= one row per deal x canonical event type (view)
    "cash": "client_cash_forecast",         # one row per won deal + modeled payments (view)
}
NOT_EXPORTED_VIEWS = ["daily_client_activity", "client_cohort_performance"]   # rebuilt in views.py from their SQL

# --------------------------------------------------------------------------------------------- Jira statuses
# The reporting layer exposes signed_up_client / active_clients / inactive_clients / hunting_clients as flags.
# These are the status lists behind them; quality.py verifies that every flag equals its list.
SIGNED_UP_STATUSES = [
    "Client Start", "2 Weeks", "4 Weeks", "6 Weeks", "8 Weeks",
    "Additional Service", "Under Contract", "Passed Inspection",
    "CLOSED", "Photography Shared", "Listed", "Paused", "Refunded", "Content Pulled",
]
INACTIVE_STATUSES = ["Refunded", "Paused", "Additional Service"]
ACTIVE_STATUSES = [s for s in SIGNED_UP_STATUSES if s not in INACTIVE_STATUSES]
HUNTING_STATUSES = ["Client Start", "2 Weeks", "4 Weeks", "6 Weeks", "8 Weeks"]
PRESALE_STATUSES = ["New Clients", "Onboarding Completed"]
DECLINED_STATUSES = ["Services Declined"]

STATUS_GROUPS = [
    ("Pre-sale onboarding", "Prospect has a Jira issue but has not bought (New Client Experience, since 27 May 2026)."),
    ("Declined", "Prospect went through onboarding but did not buy."),
    ("Hunting", "Signed client whose property search is under way (check-in cadence statuses)."),
    ("Under contract", "Client has a property under contract or through inspection."),
    ("Closed", "Client closed on a property."),
    ("Post-close", "Post-close services (photography, listing) or archived content."),
    ("Inactive", "Signed client who is paused, refunded or on an additional-service track."),
    ("Other", "Status not recognised by this build."),
]
STATUS_META = {
    "New Clients":          {"group": "Pre-sale onboarding", "order": 1,  "meaning": "Issue created at onboarding booking; normally no won deal yet."},
    "Onboarding Completed": {"group": "Pre-sale onboarding", "order": 2,  "meaning": "Onboarding call done; the linked Pipedrive deal is normally not won yet."},
    "Services Declined":    {"group": "Declined",            "order": 3,  "meaning": "Did not buy after onboarding."},
    "Client Start":         {"group": "Hunting",             "order": 4,  "meaning": "Signed client, search kicked off."},
    "2 Weeks":              {"group": "Hunting",             "order": 5,  "meaning": "Search check-in status (about two weeks in)."},
    "4 Weeks":              {"group": "Hunting",             "order": 6,  "meaning": "Search check-in status (about four weeks in)."},
    "6 Weeks":              {"group": "Hunting",             "order": 7,  "meaning": "Search check-in status (about six weeks in)."},
    "8 Weeks":              {"group": "Hunting",             "order": 8,  "meaning": "Search check-in status (eight weeks or more)."},
    "Under Contract":       {"group": "Under contract",      "order": 9,  "meaning": "Property under contract."},
    "Passed Inspection":    {"group": "Under contract",      "order": 10, "meaning": "Under-contract property passed inspection."},
    "CLOSED":               {"group": "Closed",              "order": 11, "meaning": "Client closed on a property."},
    "Photography Shared":   {"group": "Post-close",          "order": 12, "meaning": "Post-close: listing photography delivered."},
    "Listed":               {"group": "Post-close",          "order": 13, "meaning": "Post-close: property listed as an STR."},
    "Content Pulled":       {"group": "Post-close",          "order": 14, "meaning": "Older (2024-25) clients; most closed. Exact meaning unconfirmed."},
    "Paused":               {"group": "Inactive",            "order": 15, "meaning": "Signed client, search paused."},
    "Refunded":             {"group": "Inactive",            "order": 16, "meaning": "Signed client who was refunded."},
    "Additional Service":   {"group": "Inactive",            "order": 17, "meaning": "Additional-service track (not a standard search)."},
}

# --------------------------------------------------------------------------------------------- dates
NEW_EXPERIENCE_DATE = "2026-05-27"   # operational change: New Client Experience; Jira now also holds pre-sale prospects
START_RULE_DATE = "2026-06-01"       # reporting rule: issues created from this date start on the Pipedrive won date
CREATED_OFFSET_DAYS = 4              # issues created before START_RULE_DATE with no due date: created date + 4 days
START_RULE_TEXT = (
    "client_start_date (Jira): for issues created before 1 Jun 2026, the issue due date, or the issue created "
    "date + 4 days when no due date is set; for issues created from 1 Jun 2026, the Pipedrive won date. "
    "won_clients_master falls back to the won date when no Jira start exists and labels it 'Pipedrive Fallback'; "
    "fallback dates are not confirmed starts and are excluded from starts and cohorts."
)
START_RULES = {
    "due": "Jira due date (issue created before 1 Jun 2026)",
    "created+4": "Jira created date + 4 days (created before 1 Jun 2026, no due date)",
    "won": "Pipedrive won date (issue created from 1 Jun 2026)",
}

# --------------------------------------------------------------------------------------------- milestones
MILESTONES = {
    "uc": "property_uc_date: the latest currently valid Under Contract date, falling back to the first. Not immutable history: a contract that falls through can move or clear it.",
    "pi": "property_passed_inspection_date: date the property passed inspection.",
    "closed": "property_closed_date: the closing milestone. Dates after the data date are scheduled closings and are not counted as closed in this build.",
    "refund": "client_refunded_date: date the Jira status last changed to Refunded (a status proxy, not a verified refund transaction).",
}
EVENT_TYPES = [
    (1, "Deal Created"), (2, "Client Won"), (3, "Client Started"), (4, "Under Contract"),
    (5, "Passed Inspection"), (6, "Property Closed"), (7, "Client Refunded"),
]
REPORTED_EVENT_TYPES = ["Client Won", "Client Started", "Under Contract", "Passed Inspection", "Property Closed", "Client Refunded"]
# 'Deal Created' counts only deals that eventually won; the SQL reference says dashboards should omit it.

DAILY_FROM = "2024-01-01"            # daily_client_activity calendar start (cumulative net change starts here)
COHORT_WINDOWS = [14, 30, 45, 60, 90]

# --------------------------------------------------------------------------------------------- segments
HENRY_OOP_MAX = 225000               # henry_client = total_oop <= 225,000 (derived by the Jira source)
HENRY_TEXT = "HENRY = total out-of-pocket capital (Jira total_oop) of $225,000 or less. Clients without a total_oop value are 'unknown', not 'not HENRY'."

# --------------------------------------------------------------------------------------------- cash model
CASH_TEXT = (
    "Modeled contractual cash (client_cash_forecast), not verified receipts or accounting revenue. Paid In Full: "
    "100% assumed collected in the won month. Split Pay: 50% assumed collected in the won month and 50% at property "
    "close; unclosed split pay carries 50% modeled outstanding. Refund-excluded amounts zero the whole engagement "
    "when the Jira status is Refunded."
)

# --------------------------------------------------------------------------------------------- data-quality limits
# Values outside these limits are treated as entry errors: kept in the record, excluded from aggregates, flagged.
OOP_VALID_MAX = 20_000_000
BUDGET_VALID_MIN = 1_000
DEALS_SENT_VALID_MAX = 500

# --------------------------------------------------------------------------------------------- Pipedrive scope
EXCLUDED_LOST_REASONS = ["Test Lead", "Duplicate"]   # same rule as the 12 Nov FCT definitions (plus keep = false)
CAPITAL_BANDS = [(0, 100_000, "Under $100K"), (100_000, 200_000, "$100K-$200K"), (200_000, 300_000, "$200K-$300K"),
                 (300_000, 500_000, "$300K-$500K"), (500_000, float("inf"), "$500K+")]
CHANNEL_FIXES = {"ig": "Instagram", "instagram": "Instagram", "fb": "Facebook", "facebook": "Facebook"}

# Pipedrive STR Search stage order (the reporting base carries stage names only; order from the pipeline settings
# as exported in the 12 Nov package). Stages not listed sort last.
PIPELINE_STAGES = ["Call Booked", "Qualified + Deck Sent", "Manual / No Automation", "Follow Up 1", "Follow Up 2",
                   "Final follow up", "Engaged", "HOT Leads", "Long Term Followup", "Services Engaged",
                   "Onboarding Form Submitted", "Onboarding Scheduled", "Onboarding Completed", "Drafting Agreements",
                   "Contract Sent", "Contract Signed"]
