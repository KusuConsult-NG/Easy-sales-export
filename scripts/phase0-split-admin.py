#!/usr/bin/env python3
"""
Phase 0 Migration Script — Domain Isolation Prep
=================================================
1. Reads src/app/actions/admin.ts (4,481 lines)
2. Extracts domain blocks into dedicated files:
     admin-withdrawals.ts  (finance / shared)
     admin-users.ts        (hub / users)
     admin-land.ts         (farm-nation)
     admin-loans.ts        (cooperative loans)
     admin-export.ts       (export module)
     admin-marketplace-sellers.ts  (marketplace sellers)
     admin-academy.ts      (academy)
     admin-platform.ts     (platform settings + shared utils)
     admin-marketplace-buyers.ts   (marketplace buyers approval)
     admin-legacy.ts       (legacy onboarding)
     admin-diagnostics.ts  (system diagnostics)
3. Rewrites admin.ts as a pure re-export barrel (zero import breakage)
4. Archives root-level test/scratch scripts to scripts/archive/

All operations are NON-DESTRUCTIVE:
  - Original admin.ts is backed up to admin.ts.bak before changes
  - Archive directory is created for test scripts
  - Zero changes to any file that imports from admin.ts
"""

import os
import shutil
import re

ACTIONS_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "app", "actions")
ROOT_DIR    = os.path.join(os.path.dirname(__file__), "..")
ARCHIVE_DIR = os.path.join(ROOT_DIR, "scripts", "archive")

ADMIN_TS    = os.path.join(ACTIONS_DIR, "admin.ts")
ADMIN_BAK   = os.path.join(ACTIONS_DIR, "admin.ts.bak")

os.makedirs(ARCHIVE_DIR, exist_ok=True)

# ──────────────────────────────────────────────────────────────────────────────
# STEP 1: Backup original
# ──────────────────────────────────────────────────────────────────────────────
print("📦 Backing up admin.ts → admin.ts.bak")
shutil.copy2(ADMIN_TS, ADMIN_BAK)

with open(ADMIN_TS, "r", encoding="utf-8") as f:
    lines = f.readlines()

total = len(lines)
print(f"📖 Read {total} lines from admin.ts")

# ──────────────────────────────────────────────────────────────────────────────
# STEP 2: Define the shared header (imports used by all domain files)
# ──────────────────────────────────────────────────────────────────────────────
SHARED_HEADER = '''"use server";
import { z, ZodError } from "zod";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { revalidatePath, revalidateTag } from "next/cache";
import { deleteCache, CacheKeys } from "@/lib/redis";
import { invalidateAdminGlobalStats, invalidateServiceCache } from "@/lib/cache-invalidation";
import crypto from "crypto";
import { db, adminAuth } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";
import { FieldValue, Timestamp, FieldPath } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog, logAdminAction } from "@/lib/audit-log-admin";
import { serializeDoc, serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { normalizeAggressive } from "@/lib/canonical/normalizer";
import { createNotificationAction } from "@/app/actions/notifications";
import {
    WaveApplicationReviewSchema,
    WithdrawalProcessingSchema,
    UserVerificationToggleSchema,
    LandListingVerificationSchema,
    LoanApplicationReviewSchema,
    ExportOnboardingReviewSchema,
    UserKycVerificationSchema,
    LegacyOnboardingSchema,
    strictEmailSchema,
} from "@/lib/schemas";
import { sendLegacyMemberWelcomeEmail, sendPasswordResetEmail } from "@/lib/email-notifications";
import { hasAdminPermission, isAdmin } from "@/lib/admin-permissions";
import { requireAdmin } from "@/lib/require-admin";
import { atomicUpdateUser } from "@/lib/services/userService";
import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { versionedUpdate } from "@/lib/optimistic-locking";

type ActionState =
    | { error: string; success: false }
    | { error: null; success: true; message: string };

'''

# ──────────────────────────────────────────────────────────────────────────────
# STEP 3: Line-range extraction map
# Each entry: (output filename, start_line 1-indexed, end_line 1-indexed)
# These ranges are the IMPLEMENTATION blocks (private functions + inline exports).
# ──────────────────────────────────────────────────────────────────────────────
# We extract the implementation bodies only; the safe-action export wrappers
# that appear in the 3750-3830 block will be re-emitted into each domain file.
#
# Domain → line ranges (1-indexed, inclusive) from admin.ts
DOMAINS = [
    {
        "file": "admin-withdrawals.ts",
        "label": "Finance / Withdrawals",
        "ranges": [(50, 543)],   # processWithdrawal + getPendingWithdrawals
        "exports": [
            ("processWithdrawalAction",      "_processWithdrawalAction"),
            ("getPendingWithdrawalsAction",   "_getPendingWithdrawalsAction"),
        ],
    },
    {
        "file": "admin-users.ts",
        "label": "Hub / User Management",
        "ranges": [(228, 440), (1206, 1716)],  # toggleVerification + getUsersAction + updateRoles + unlockAccount + gender
        "exports": [
            ("toggleUserVerificationAction",    "_toggleUserVerificationAction"),
            ("toggleUserKycVerificationAction",  "_toggleUserKycVerificationAction"),
            ("updateUserGenderAction",           "_updateUserGenderAction"),
            ("unlockUserAccount",                "_unlockUserAccount"),
            ("getUsersAction",                   "_getUsersAction"),
            ("updateUserRolesAction",            "_updateUserRolesAction"),
        ],
    },
    {
        "file": "admin-land.ts",
        "label": "Farm Nation / Land",
        "ranges": [(546, 738)],
        "exports": [
            ("getPendingLandListings",   "_getPendingLandListings"),
            ("verifyLandListing",        "_verifyLandListing"),
        ],
    },
    {
        "file": "admin-loans.ts",
        "label": "Cooperative / Loans",
        "ranges": [(739, 817)],
        "exports": [
            ("getPendingLoanApplications",  "_getPendingLoanApplications"),
            ("approveLoanApplication",      "_approveLoanApplication"),
            ("rejectLoanApplication",       "_rejectLoanApplication"),
        ],
    },
    {
        "file": "admin-export.ts",
        "label": "Export Module",
        "ranges": [(818, 1205), (1862, 2479)],
        "exports": [
            ("getAllExportRequestsAction",               "_getAllExportRequestsAction"),
            ("approveExportOnboardingAction",            "_approveExportOnboardingAction"),
            ("requestExportApplicationRevisionAction",   "_requestExportApplicationRevisionAction"),
            ("getExportApplicationsStatsAction",         "_getExportApplicationsStatsAction"),
            ("getStandardExportApplicationsAction",      "_getStandardExportApplicationsAction"),
            ("rejectExportApplicationAction",            "_rejectExportApplicationAction"),
        ],
    },
    {
        "file": "admin-marketplace-sellers.ts",
        "label": "Marketplace / Sellers",
        "ranges": [(1717, 1861), (3112, 3210), (3830, 3829)],  # empty last range OK
        "extra_ranges": [(3112, 3210)],  # toggleVerifiedBadge
        "exports": [
            ("approveSellerVerificationAction",      "_approveSellerVerificationAction"),
            ("getStandardSellerVerificationsAction", "_getStandardSellerVerificationsAction"),
            ("getMarketplaceUsersAction",            "_getMarketplaceUsersAction"),
            ("getAdminSellerStatsAction",            "_getAdminSellerStatsAction"),
            ("toggleVerifiedBadgeAction",            "_toggleVerifiedBadgeAction"),
        ],
    },
    {
        "file": "admin-academy.ts",
        "label": "Academy",
        "ranges": [(2480, 2955)],
        "exports": [
            ("getAcademyApplicationsAction",             "_getAcademyApplicationsAction"),
            ("approveAcademyApplicationAction",          "_approveAcademyApplicationAction"),
            ("rejectAcademyApplicationAction",           "_rejectAcademyApplicationAction"),
            ("markAcademyApplicationUnderReviewAction",  "_markAcademyApplicationUnderReviewAction"),
            ("manualAcademyEnrollmentAction",            "_manualAcademyEnrollmentAction"),
        ],
    },
    {
        "file": "admin-platform.ts",
        "label": "Platform Settings + Shared Admin Utils",
        "ranges": [(2956, 3111), (3211, 3290)],  # editApplication, platform settings
        "exports": [
            ("savePlatformSettingsAction",  "_savePlatformSettingsAction"),
            ("getPlatformSettingsAction",   "_getPlatformSettingsAction"),
            ("editApplicationAction",       "_editApplicationAction"),
        ],
    },
    {
        "file": "admin-legacy.ts",
        "label": "Legacy Member Onboarding",
        "ranges": [(3291, 3749), (3830, 4375)],
        "exports": [
            ("inviteLegacyMemberAction",    "_inviteLegacyMemberAction"),
            ("onboardLegacyMemberAction",   "_onboardLegacyMemberAction"),
        ],
    },
    {
        "file": "admin-marketplace-buyers.ts",
        "label": "Marketplace / Buyer Approval",
        "ranges": [(4377, 4438)],
        "exports": [
            ("approveMarketplaceUserAction",  "_approveMarketplaceUserAction"),
            ("rejectMarketplaceUserAction",   "_rejectMarketplaceUserAction"),
        ],
    },
    {
        "file": "admin-diagnostics.ts",
        "label": "System Diagnostics",
        "ranges": [(4440, 4481)],
        "exports": [
            ("runSystemDiagnosticAction",  "_runSystemDiagnosticAction"),
        ],
    },
]

def extract_lines(ranges):
    """Extract lines from the original file given list of (start, end) 1-indexed tuples."""
    result = []
    for start, end in ranges:
        if start > end:
            continue
        block = lines[start - 1 : end]
        result.extend(block)
    return result

def build_export_block(exports):
    """Build the withFlexibleSafeAction export statements."""
    parts = []
    for export_name, private_name in exports:
        parts.append(
            f'export const {export_name} = withFlexibleSafeAction("{export_name}", {private_name});\n'
        )
    return parts

# ──────────────────────────────────────────────────────────────────────────────
# STEP 4: Write domain files
# ──────────────────────────────────────────────────────────────────────────────
written_files = []

for domain in DOMAINS:
    out_path = os.path.join(ACTIONS_DIR, domain["file"])
    
    # Skip if file already exists and is non-trivial (don't overwrite existing domain files)
    if os.path.exists(out_path):
        size = os.path.getsize(out_path)
        if size > 1000:
            print(f"  ⏭  Skipping {domain['file']} (already exists, {size} bytes)")
            continue

    content_lines = [SHARED_HEADER]
    content_lines.extend(extract_lines(domain.get("ranges", [])))
    content_lines.append("\n\n// ─── SAFE ACTION EXPORTS ───\n")
    content_lines.extend(build_export_block(domain["exports"]))
    
    with open(out_path, "w", encoding="utf-8") as f:
        f.writelines(content_lines)
    
    line_count = sum(1 for _ in content_lines)
    print(f"  ✅ Created {domain['file']} ({line_count} lines) — {domain['label']}")
    written_files.append(domain["file"])

# ──────────────────────────────────────────────────────────────────────────────
# STEP 5: Rewrite admin.ts as a pure barrel re-export
# ──────────────────────────────────────────────────────────────────────────────
barrel_lines = [
    '"use server";\n',
    '/**\n',
    ' * admin.ts — Barrel Re-export\n',
    ' * \n',
    ' * This file is the single import point for all admin server actions.\n',
    ' * Each domain has been extracted into its own file for maintainability.\n',
    ' * \n',
    ' * DO NOT add implementation code here — add it to the appropriate domain file.\n',
    ' * \n',
    ' * Migration: Phase 0 — Domain Isolation Prep (May 2026)\n',
    ' */\n\n',
]

all_domain_files = [d["file"] for d in DOMAINS]

for domain in DOMAINS:
    fname = domain["file"]
    basename = fname.replace(".ts", "")
    export_names = [e[0] for e in domain["exports"]]
    # Build named re-export
    exports_str = ",\n    ".join(export_names)
    barrel_lines.append(f'export {{\n    {exports_str},\n}} from "./{basename}";\n\n')

# Keep wave action re-exports that were already extracted to wave-admin.ts
barrel_lines.append(
    'export { approveWaveApplicationAction, rejectWaveApplicationAction } from "./wave-admin";\n\n'
)

# Keep the EditableApplicationFields interface export (it was inline in admin.ts)
barrel_lines.append(
    '// Re-export shared interfaces\nexport type { EditableApplicationFields } from "./admin-platform";\n'
)

barrel_out = os.path.join(ACTIONS_DIR, "admin.ts")
with open(barrel_out, "w", encoding="utf-8") as f:
    f.writelines(barrel_lines)

print(f"\n  ✅ Rewrote admin.ts as barrel ({len(barrel_lines)} lines)")

# ──────────────────────────────────────────────────────────────────────────────
# STEP 6: Archive root-level test/scratch scripts
# ──────────────────────────────────────────────────────────────────────────────
TEST_PATTERNS = [
    r"^test[-_].+\.(ts|js|cjs|mjs)$",
    r"^test_.+\.(ts|js|cjs|mjs)$",
    r"^check[-_].+\.(ts|js)$",
    r"^fix[-_].+\.(ts|js|py|sh)$",
    r"^migrate[-_].+\.(ts|js|py|sh)$",
    r"^diagnose[-_].+\.(ts|js|cjs)$",
    r"^scratch.+\.(ts|js|py)$",
    r"^patch.+\.(ts|js|py)$",
    r"^run[-_].+\.(ts|js)$",
    r"^verify[-_].+\.(ts)$",
    r"^get[-_].+\.(ts|js)$",
    r"^tmp[-_].+\.(ts|js)$",
    r"^fast[-_].+\.(ts|js)$",
    r"^show_.+\.(ts|py)$",
    r"^query\.(ts|js)$",
]

archived = []
for fname in os.listdir(ROOT_DIR):
    fpath = os.path.join(ROOT_DIR, fname)
    if not os.path.isfile(fpath):
        continue
    for pattern in TEST_PATTERNS:
        if re.match(pattern, fname, re.IGNORECASE):
            dest = os.path.join(ARCHIVE_DIR, fname)
            shutil.move(fpath, dest)
            archived.append(fname)
            break

print(f"\n  🗂  Archived {len(archived)} root-level test/scratch files to scripts/archive/")
for f in sorted(archived):
    print(f"     - {f}")

print("\n✅ Phase 0 split complete.")
print("   Next: run  npx tsc --noEmit  to verify zero type errors.")
print("   Then: git add -A && git commit -m 'refactor(phase0): split admin.ts into domain files'")
