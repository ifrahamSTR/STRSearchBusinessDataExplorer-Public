"""Business definitions used by the Business Data Explorer build.

Everything that encodes a business rule lives here, so a definition change is a one-line,
reviewable diff. Source precedence (from the 13 Nov 2026 handoff): latest Carson instruction >
verified source data & scripts > Q1-2026 onboarding docs > analyst interpretation.
"""
from __future__ import annotations

# --------------------------------------------------------------------------------------
# Carson's Jira status classification: preserved verbatim (handoff PDF, Section 05).
# Both case variants of Under Contract are intentional: 'under Contract' is a historical
# status name that still appears in Jira changelog fields (previous_status / latest_status).
# --------------------------------------------------------------------------------------
SIGNED_UP_STATUSES = [
    "Client Start", "2 Weeks", "4 Weeks", "6 Weeks", "8 Weeks",
    "Additional Service", "under Contract", "Passed Inspection",
    "CLOSED", "Photography Shared", "Listed", "Paused",
    "Under Contract", "Refunded", "Content Pulled",
]
INACTIVE_STATUSES = ["Refunded", "Paused", "Additional Service"]
ACTIVE_STATUSES = [s for s in SIGNED_UP_STATUSES if s not in INACTIVE_STATUSES]

# Carson's effective client start: COALESCE(issue_due_date, issue_created_date)
EFFECTIVE_START_RULE = "COALESCE(issue_due_date, issue_created_date)"

# --------------------------------------------------------------------------------------
# Status metadata for presentation. 'group' orders the lifecycle; 'meaning' is what the data
# shows (not an official definition). Statuses outside Carson's lists are flagged.
# --------------------------------------------------------------------------------------
STATUS_GROUPS = [
    ("Pre-sale onboarding", "Prospect has a Jira issue but has not bought (New Client Experience, since late May 2026)."),
    ("Declined", "Prospect went through onboarding but did not buy."),
    ("Searching", "Signed client, property search under way (check-in cadence statuses)."),
    ("Under contract", "Client has a property under contract / through inspection."),
    ("Closed", "Client closed on a property."),
    ("Post-close", "Post-close services (photography, listing) or archived content."),
    ("Inactive", "Signed client who is paused, refunded or on an additional-service track."),
    ("Other", "Status not recognised by this build."),
]

STATUS_META = {
    "New Clients":          {"group": "Pre-sale onboarding", "order": 1,  "meaning": "Issue created at onboarding booking; usually no status history yet and no won deal."},
    "Onboarding Completed": {"group": "Pre-sale onboarding", "order": 2,  "meaning": "Onboarding call done; the linked Pipedrive deal is normally not won yet."},
    "Services Declined":    {"group": "Declined",            "order": 3,  "meaning": "Did not buy after onboarding; linked deal is lost or still in follow-up."},
    "Client Start":         {"group": "Searching",           "order": 4,  "meaning": "Signed client, search kicked off."},
    "2 Weeks":              {"group": "Searching",           "order": 5,  "meaning": "Search check-in status (about two weeks in)."},
    "4 Weeks":              {"group": "Searching",           "order": 6,  "meaning": "Search check-in status (about four weeks in)."},
    "6 Weeks":              {"group": "Searching",           "order": 7,  "meaning": "Search check-in status (about six weeks in)."},
    "8 Weeks":              {"group": "Searching",           "order": 8,  "meaning": "Search check-in status (eight weeks or more)."},
    "Under Contract":       {"group": "Under contract",      "order": 9,  "meaning": "Property under contract."},
    "under Contract":       {"group": "Under contract",      "order": 9,  "meaning": "Historical spelling of Under Contract (changelog only)."},
    "Passed Inspection":    {"group": "Under contract",      "order": 10, "meaning": "Under-contract property passed inspection."},
    "CLOSED":               {"group": "Closed",              "order": 11, "meaning": "Client closed on a property."},
    "Photography Shared":   {"group": "Post-close",          "order": 12, "meaning": "Post-close: listing photography delivered."},
    "Listed":               {"group": "Post-close",          "order": 13, "meaning": "Post-close: property listed as an STR."},
    "Content Pulled":       {"group": "Post-close",          "order": 14, "meaning": "Older (2024-25) clients; most closed. Exact meaning unconfirmed."},
    "Paused":               {"group": "Inactive",            "order": 15, "meaning": "Signed client, search paused."},
    "Refunded":             {"group": "Inactive",            "order": 16, "meaning": "Signed client who was refunded."},
    "Additional Service":   {"group": "Inactive",            "order": 17, "meaning": "Additional-service track (not a standard search)."},
}

# Date the Pipedrive "Deal Experience" option names: "New Client Experience 5.27.26".
NEW_EXPERIENCE_DATE = "2026-05-27"

# --------------------------------------------------------------------------------------
# Pipedrive scope and the official PD_Deals filter (FCT Daily Reporting 'Definitions' sheet
# + 'Documentation for BI Tables').
# --------------------------------------------------------------------------------------
STR_SEARCH_PIPELINE_ID = 3
EXCLUDED_LOST_REASONS = ["Test Lead", "Duplicate"]
INTERNAL_EMAIL_DOMAINS = ["@strsearch.com", "@adclass.com", "@techvestor.com", "@strcribs.com", "@pointanalytics"]
OFFICIAL_QUALIFIED_STAGES = ["Contract Sent", "Contract Signed", "Drafting Agreements", "Qualified + Deck Sent"]

# Pipedrive enum option IDs -> labels. Only mappings backed by evidence are listed here.
SEARCH_PRODUCT_OPTIONS = {
    "203": {"label": "Complete", "evidence": "Raw_Pipedrive (Supabase EDA, Meta Campaign Reporting Tables) labels 131 of 132 labelled [203] deals 'Complete'."},
    "202": {"label": "Core", "evidence": "Raw_Pipedrive (Supabase EDA) labels 43 of 45 labelled [202] deals 'Core'."},
}
# No text label for Payment Type exists in any extract. The labels below are an INFERENCE (flagged in the UI):
# [214] is 92.7% of coded wins, consistent with Carson's statement that most clients choose Split Pay.
PAYMENT_TYPE_OPTIONS: dict[str, dict] = {
    "214": {"label": "Likely Split Pay [214]", "evidence": "Inferred, unconfirmed: 92.7% of coded wins; Carson says most clients choose Split Pay."},
    "215": {"label": "Likely Full Pay [215]", "evidence": "Inferred, unconfirmed: the remaining coded option."},
}

# Lead-source spelling fixes (observed typos in PD_Source)
SOURCE_FIXES = {"Partnerhip": "Partnership", "DIrect": "Direct"}
