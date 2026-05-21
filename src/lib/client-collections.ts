/**
 * Client-safe Firestore Database Collections Constants
 * This file contains raw string collection names to decouple client-side
 * components from complex server-side database schema definitions.
 */
export const COLLECTIONS = {
    USERS: "users",
    NOTIFICATIONS: "notifications",
    COOPERATIVE_MEMBERS: "cooperative_members",
    COOPERATIVE_LOANS: "cooperative_loans",
    WAVE_APPLICATIONS: "wave_applications",
    ACADEMY_APPLICATIONS: "academy_applications",
    EXPORT_APPLICATIONS: "export_onboarding_applications",
    LAND_LISTINGS: "land_listings",
    CONVERSATIONS: "conversations",
    SELLER_VERIFICATIONS: "seller_verifications",
} as const;
