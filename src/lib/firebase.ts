import { db as clientDb } from "./supabase-client-db";

/**
 * Legacy Firebase Config Shim
 * Routes all client-side firebase references to the Supabase client-side compatibility shim.
 */
export const db = clientDb;
export const auth = {} as any;
export const storage = {} as any;
