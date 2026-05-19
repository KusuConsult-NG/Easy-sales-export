export const EXPORT_WINDOW_STATUS = {
    PENDING: "pending",
    OPEN: "open",
    ACTIVE: "active",
    COMPLETED: "completed",
    CLOSED: "closed",
    IN_TRANSIT: "in_transit",
    DELIVERED: "delivered"
} as const;

export type ExportWindowStatus = typeof EXPORT_WINDOW_STATUS[keyof typeof EXPORT_WINDOW_STATUS];

export const EXPORT_ONBOARDING_STATUS = {
    PENDING_REVIEW: "pending_review",
    APPROVED: "approved",
    REJECTED: "rejected"
} as const;

export type ExportOnboardingStatus = typeof EXPORT_ONBOARDING_STATUS[keyof typeof EXPORT_ONBOARDING_STATUS];

export const EXPORT_INVESTMENT_STATUS = {
    PENDING: "pending",
    ACTIVE: "active",
    COMPLETED: "completed",
    CANCELLED: "cancelled"
} as const;

export type ExportInvestmentStatus = typeof EXPORT_INVESTMENT_STATUS[keyof typeof EXPORT_INVESTMENT_STATUS];
