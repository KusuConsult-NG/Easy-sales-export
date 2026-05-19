export const PROPERTY_STATUS = {
    AVAILABLE: "available",
    PENDING: "pending",
    SOLD: "sold",
    LEASED: "leased",
    DELETED: "deleted"
} as const;

export type PropertyStatus = typeof PROPERTY_STATUS[keyof typeof PROPERTY_STATUS];

export const PROPERTY_CATEGORY = {
    ARABLE: "farming-arable",
    IRRIGATED: "farming-irrigated",
    COMMERCIAL: "farming-commercial",
    MIXED: "farming-mixed",
    LEASING: "leasing",
    POULTRY: "poultry",
    FISHERY: "fishery",
    GREENHOUSE: "greenhouse",
    MIXED_USE: "mixed-use"
} as const;

export type PropertyCategory = typeof PROPERTY_CATEGORY[keyof typeof PROPERTY_CATEGORY];

export const PROPERTY_TYPE = {
    SALE: "sale",
    LEASE: "lease"
} as const;

export type PropertyType = typeof PROPERTY_TYPE[keyof typeof PROPERTY_TYPE];
