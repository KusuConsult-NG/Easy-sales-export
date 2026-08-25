/**
 * Feature Toggles System
 * 
 * Database-driven feature flags for controlling feature rollout and A/B testing.
 */



export interface FeatureToggle {
    id: string; // e.g., "farm_nation_purchases"
    name: string; // Human-readable name
    description: string;
    enabled: boolean;
    createdAt?: any;
    updatedAt?: any;
    createdBy?: string; // Admin user ID
    updatedBy?: string; // Admin user ID
    targetRoles?: string[]; // ["admin", "user", "premium"]
    targetUsers?: string[]; // Specific user IDs for testing
}

/**
 * Default toggle states for all features
 * These are used as fallback if database is unavailable
 */
export const DEFAULT_TOGGLES: Record<string, boolean> = {
    // Core features (enabled by default)
    farm_nation_purchases: true,
    escrow_messaging: true,
    digital_id_system: true,
    wave_program: true,
    cooperative_loans: true,
    land_verification: true,
    academy_courses: true,

    // Beta features (disabled by default)
    ai_assistant: true,         // Phase 13: Enabled — module-aware chatbot deployed
    chatbot_persistence: true,  // Phase 13: Save conversations to Firestore
    advanced_analytics: false,
    social_features: false,
    mobile_app_integration: false,

    // Experimental features
    blockchain_verification: false,
    ml_credit_scoring: false,

    // Wallet features (disabled for production rollout)
    wallet_deposits: false,
    wallet_withdrawals: false,
    // Disabled, exactly as the hard-coded return in withdrawEarningsAction was.
    // A toggle rather than a `return` so it can be turned back on without a
    // deploy, and so the page can tell a member before they fill in the form.
    wave_withdrawals: false,
};

/**
 * What a toggle is worth, given what the database said.
 *
 *   #245 A KILL SWITCH FAILED OPEN ON A DATABASE ERROR.
 *
 *        Both readers — getFeatureToggle and hasFeatureAccess in
 *        actions/feature-toggles.ts, plus getFeatureTogglesAction in
 *        actions/health.ts — caught any read failure and returned
 *        DEFAULT_TOGGLES. Seven of the defaults above are `true`, so an admin
 *        who had DISABLED one of them — farm_nation_purchases, escrow_messaging,
 *        cooperative_loans, land_verification, academy_courses, wave_program,
 *        digital_id_system — had that decision silently reversed by any
 *        transient database error.
 *
 *        A kill switch exists for the moment something is going wrong. A
 *        database error is that moment. Turning the feature back ON then is
 *        precisely backwards, and it is invisible: the catch logs and returns a
 *        plausible boolean, so nothing downstream can tell the difference
 *        between "the admin left it on" and "we could not ask".
 *
 *        The money toggles were safe only by luck of their defaults being
 *        false (wallet_deposits, wallet_withdrawals, wave_withdrawals). Safety
 *        that depends on which way a default happens to point is not a control.
 *
 * The three cases, and only the third changes:
 *
 *   a stored value        → that value, always. The admin's decision.
 *   no document           → DEFAULT_TOGGLES. Legitimate: never configured.
 *   THE READ FAILED       → false. We do not know, so we do not enable.
 *
 * One rule, one place, because there are three readers — the duplication
 * pattern this audit keeps finding (see lib/storage-backend.ts,
 * lib/latest-application.ts, lib/registration-progress.ts).
 */
export function resolveToggle(
    featureName: string,
    outcome: { stored?: boolean | undefined; readFailed?: boolean },
): boolean {
    if (outcome.readFailed) return false;
    if (typeof outcome.stored === "boolean") return outcome.stored;
    return DEFAULT_TOGGLES[featureName] ?? false;
}

/**
 * Feature categories for organization
 */
export const FEATURE_CATEGORIES = {
    CORE: "Core Features",
    BETA: "Beta Features",
    EXPERIMENTAL: "Experimental",
    ADMIN: "Admin Tools",
} as const;

/**
 * Feature metadata for admin UI
 */
export interface FeatureMetadata {
    id: string;
    name: string;
    description: string;
    category: keyof typeof FEATURE_CATEGORIES;
    defaultEnabled: boolean;
    dependencies?: string[]; // Other features this depends on
}

export const FEATURE_METADATA: Record<string, FeatureMetadata> = {
    farm_nation_purchases: {
        id: "farm_nation_purchases",
        name: "Farm Nation Purchases",
        description: "Allow users to purchase farmland through Farm Nation",
        category: "CORE",
        defaultEnabled: true,
    },
    escrow_messaging: {
        id: "escrow_messaging",
        name: "Escrow Messaging",
        description: "In-app messaging for escrow transactions",
        category: "CORE",
        defaultEnabled: true,
    },
    digital_id_system: {
        id: "digital_id_system",
        name: "Digital ID System",
        description: "User verification via digital ID cards",
        category: "CORE",
        defaultEnabled: true,
    },
    wave_program: {
        id: "wave_program",
        name: "WAVE Program",
        description: "Women Agricultural Ventures & Empowerment program",
        category: "CORE",
        defaultEnabled: true,
    },
    cooperative_loans: {
        id: "cooperative_loans",
        name: "Cooperative Loans",
        description: "Allow members to apply for cooperative loans",
        category: "CORE",
        defaultEnabled: true,
    },
    land_verification: {
        id: "land_verification",
        name: "Land Verification",
        description: "Admin verification of land listings",
        category: "CORE",
        defaultEnabled: true,
    },
    academy_courses: {
        id: "academy_courses",
        name: "Academy Courses",
        description: "LMS course enrollment and progress tracking",
        category: "CORE",
        defaultEnabled: true,
    },
    ai_assistant: {
        id: "ai_assistant",
        name: "AI Assistant",
        description: "AI-powered chat assistant for user support",
        category: "BETA",
        defaultEnabled: false,
    },
    advanced_analytics: {
        id: "advanced_analytics",
        name: "Advanced Analytics",
        description: "Enhanced analytics and reporting for admins",
        category: "BETA",
        defaultEnabled: false,
    },
    social_features: {
        id: "social_features",
        name: "Social Features",
        description: "User profiles, following, and social interactions",
        category: "BETA",
        defaultEnabled: false,
    },
    chatbot_persistence: {
        id: "chatbot_persistence",
        name: "Chatbot Persistence",
        description: "Save AI Assistant conversations to Firebase",
        category: "BETA",
        defaultEnabled: true,
    },
    mobile_app_integration: {
        id: "mobile_app_integration",
        name: "Mobile App Integration",
        description: "Connect APIs to the companion mobile application",
        category: "BETA",
        defaultEnabled: false,
    },
    blockchain_verification: {
        id: "blockchain_verification",
        name: "Blockchain Verification",
        description: "Ethereum-based decentralized ledger for properties",
        category: "EXPERIMENTAL",
        defaultEnabled: false,
    },
    ml_credit_scoring: {
        id: "ml_credit_scoring",
        name: "ML Credit Scoring",
        description: "Machine learning algorithms for cooperative loan assessments",
        category: "EXPERIMENTAL",
        defaultEnabled: false,
    },
    wallet_deposits: {
        id: "wallet_deposits",
        name: "Wallet Deposits",
        description: "Allow users to deposit funds into their marketplace wallet",
        category: "CORE",
        defaultEnabled: false,
    },
    wallet_withdrawals: {
        id: "wallet_withdrawals",
        name: "Wallet Withdrawals",
        description: "Allow users to withdraw funds from their marketplace wallet",
        category: "CORE",
        defaultEnabled: false,
    },
    wave_withdrawals: {
        id: "wave_withdrawals",
        name: "WAVE Earnings Withdrawals",
        description: "Allow WAVE members to withdraw their commission earnings",
        category: "CORE",
        defaultEnabled: false,
    },
};
