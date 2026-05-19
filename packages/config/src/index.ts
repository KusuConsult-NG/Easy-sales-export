/**
 * @easy-sales/config
 *
 * Shared platform configuration, constants, and collection names.
 * This package is the canonical source of truth for Firestore collection paths.
 *
 * Usage:
 *   import { COLLECTIONS } from "@easy-sales/config/collections";
 *   import { PLATFORM_NAME, SUPPORT_EMAIL } from "@easy-sales/config/constants";
 */

export { COLLECTIONS } from "./collections";
export * from "./constants";

export type ActionResponse<T = unknown, M = any> = {
    success: true;
    error: null;
    data: T;
    lastDocId?: string | null;
    hasMore?: boolean;
    meta?: M;
} | {
    success: false;
    error: string;
    data: null;
    lastDocId?: string | null;
    hasMore?: boolean;
    meta?: M;
};
