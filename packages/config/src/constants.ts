/**
 * Platform-wide constants
 *
 * @easy-sales/config/constants
 */

export const PLATFORM_NAME = "Easy Sales Export" as const;
export const PLATFORM_SHORT_NAME = "ESE" as const;
export const SUPPORT_EMAIL = "support@easysalesexport.com" as const;

/** Minimum WAVE withdrawal amount in NGN */
export const WAVE_MIN_WITHDRAWAL_NGN = 5_000;

/** Maximum file upload size (5 MB) */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Allowed document types for KYC uploads */
export const ALLOWED_DOCUMENT_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;

/** Default pagination page size */
export const DEFAULT_PAGE_SIZE = 50;

/** Maximum batch size for Firestore 'in' queries */
export const FIRESTORE_IN_LIMIT = 30;

/** Module slugs — used for routing and registration lookup */
export const MODULE_SLUGS = {
    WAVE: "wave",
    ACADEMY: "academy",
    MARKETPLACE: "marketplace",
    COOPERATIVE: "cooperative",
    FARM_NATION: "farm_nation",
    EXPORT: "export",
    HUB: "hub",
} as const;

export type ModuleSlug = typeof MODULE_SLUGS[keyof typeof MODULE_SLUGS];
