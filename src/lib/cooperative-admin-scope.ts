/**
 * Which cooperative an administrator may act on.
 *
 * Returns null for platform-wide access and a cooperative id for a scoped
 * admin. Every action in cooperative/_admin.ts calls it — it was a private
 * helper there until that 1,770-line file was split by domain.
 *
 * NOT EXPORTED FROM A "use server" MODULE, DELIBERATELY
 * ----------------------------------------------------
 * Sharing it between the new domain files meant exporting it, and every export
 * of a "use server" module is a callable endpoint. Its parameters are
 * (userId, userRoles) — both of which a remote caller would then be supplying —
 * and its answer decides how much of the cooperative estate an admin screen
 * shows. An endpoint that takes the roles it is meant to check is not a check.
 *
 * A plain module cannot be called from a client. The callers pass the SESSION's
 * id and roles, as they always did.
 *
 * Same reasoning as @/lib/cooperative-provisioning (#204).
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

export async function getAdminScope(userId: string, userRoles: string[]): Promise<string | null> {
    // Super Admins and Platform Admins see everything
    if (userRoles.includes("super_admin") || userRoles.includes("admin")) return null;

    // Check if admin is restricted to a cooperative
    // We assume admins with a 'cooperativeId' in their profile are scoped.
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const data = userDoc.data();

    // If they have a cooperativeId, they are scoped
    if (data?.cooperativeId) {
        return data.cooperativeId;
    }

    // Platform Admins (role 'admin' but no coopId) see everything
    return null;
}
