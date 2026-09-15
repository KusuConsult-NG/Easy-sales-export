/**
 * What the forensic scan can actually repair, and what it must not.
 *
 *   #757 THE SCAN REPORTED TEN DEFECT CLASSES AND REPAIRED NONE OF THEM, WHILE
 *        THE REPAIRS FOR THREE OF THEM ALREADY EXISTED IN THIS CODEBASE.
 *
 *   Reported by the owner: "I want you to fix all the issues on forensic scan so
 *   that when admin scan all the defects should be healed."
 *
 *   `runForensicScanAction` is read-only. It finds ghost accounts, orphaned
 *   products and approval drift, lists the affected ids, and stops — while
 *
 *       lib/orphaned-user-repair.ts        repairOrphanedUser(uid)
 *                                          repairAllOrphanedUsers()
 *       actions/data-recovery.ts           runServiceRegistrationRecoveryAction()
 *
 *   sit in the same tree, fully built and reachable from nowhere the scan
 *   knows about. The diagnosis and the cure were written by different findings
 *   and never introduced.
 *
 * ── AND WHY "HEAL EVERYTHING" IS NOT WHAT THIS DOES ─────────────────────────
 *
 *   The owner's standing instruction on this audit is that data must be safe —
 *   "you can't delete or destroy anything... rather fix the errors and ensure
 *   all data are safe". Several of the scan's checks CANNOT be healed by a
 *   machine without violating that:
 *
 *     Financial Reconciliation     a balance disagreeing with its transactions
 *                                  is either a missing transaction or a wrong
 *                                  balance. Writing one to match the other
 *                                  destroys the evidence of which.
 *     Eligibility Paradox          a WAVE applicant recorded as male, or under
 *                                  age, is a person whose record is wrong OR an
 *                                  application that should not stand. Only a
 *                                  human knows which.
 *     Investment Cap Breach        money already moved. The repair is a refund
 *                                  decision, not a field.
 *     Duplicate Profiles           which of two profiles is the person is the
 *                                  whole question; #724 built a tool for an
 *                                  ADMIN to answer it.
 *     Phone Data Drift             two recorded numbers disagree; neither is
 *                                  automatically the true one.
 *     Profiles With No Email       there is no source to recover it from.
 *
 *   A button that "heals" any of those would silently manufacture a fact. So
 *   each check declares whether it is repairable and, when it is not, SAYS WHY
 *   on the screen — which is more useful than a button that does nothing, and
 *   far more useful than one that does the wrong thing.
 */

/** How a finding can be put right, if it can. */
export interface RepairOffer {
    /** The repair to run. Absent when there is none. */
    kind?: RepairKind;
    /** Whether a machine may do this without a human deciding anything. */
    safe: boolean;
    /** Shown on the screen when `safe` is false. Never blank. */
    reason?: string;
}

export type RepairKind =
    /** Create the missing profile for an auth account that has none. */
    | "orphaned_users"
    /** Take a deleted seller's listings off sale. */
    | "orphaned_products"
    /** Rebuild a user's serviceRegistrations from their applications. */
    | "service_registration_drift";

/**
 * The repair offer for each check, BY THE CHECK'S OWN NAME.
 *
 * Keyed on the string the scan already puts in `ScanResult.check`, so a check
 * renamed without updating this map falls through to "no repair offered"
 * rather than to the wrong repair — which is the failure direction that costs
 * nothing.
 */
export const REPAIR_BY_CHECK: Readonly<Record<string, RepairOffer>> = {
    "Ghost Users (Auth exists, No Profile)": {
        kind: "orphaned_users",
        safe: true,
    },
    "Orphaned Products (Deleted Seller)": {
        kind: "orphaned_products",
        safe: true,
    },
    "Approval Drift (User Record vs Application)": {
        kind: "service_registration_drift",
        safe: true,
    },

    //   Everything below is reported and NOT repaired, each with the reason an
    //   administrator needs in order to act on it themselves.
    "Financial Reconciliation (Balance vs Txs)": {
        safe: false,
        reason: "A balance and its transactions disagree. Writing either one to "
            + "match the other would destroy the evidence of which is wrong — "
            + "this needs a human to reconcile.",
    },
    "Eligibility Paradox (Gender/Age)": {
        safe: false,
        reason: "Either the member's record is wrong or the application should "
            + "not stand. Only a person can decide which, and correcting the "
            + "wrong one would either exclude a real member or admit an "
            + "ineligible one.",
    },
    "Investment Cap Breach": {
        safe: false,
        reason: "Money has already moved. Putting this right is a refund or a "
            + "cap decision, not a field to rewrite.",
    },
    "Duplicate Profiles (One Address, Several Accounts)": {
        safe: false,
        reason: "Which profile is the person is the whole question. Use the "
            + "duplicate-profile tool, which shows both records side by side.",
    },
    "Phone Data Drift (Profile vs Verified)": {
        safe: false,
        reason: "Two recorded numbers disagree and neither is automatically the "
            + "true one. Confirm with the member.",
    },
    "Profiles With No Email Address": {
        safe: false,
        reason: "There is no source to recover an address from. These accounts "
            + "need one supplied before they can be contacted.",
    },
    "Enrollment Audit (Access vs Plan)": {
        safe: false,
        reason: "Granting or removing course access changes what somebody paid "
            + "for. Settle the plan first, then adjust access.",
    },
};

/**
 * What to offer for a check, including one this map has never heard of.
 *
 * A check added later with no entry here is reported with no repair and a
 * reason saying so, rather than silently appearing to be fine.
 */
export function repairFor(check: string): RepairOffer {
    return REPAIR_BY_CHECK[check] ?? {
        safe: false,
        reason: "No automatic repair is defined for this check.",
    };
}

/** Every kind a caller may legitimately ask for. */
export const REPAIR_KINDS: readonly RepairKind[] = [
    "orphaned_users",
    "orphaned_products",
    "service_registration_drift",
];

export function isRepairKind(value: unknown): value is RepairKind {
    return typeof value === "string" && (REPAIR_KINDS as readonly string[]).includes(value);
}
