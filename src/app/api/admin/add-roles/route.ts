export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { includesPrivilegedRole, isPlatformAdmin, isSuperAdmin } from "@/lib/admin-permissions";
import { ALL_USER_ROLES, type UserRole } from "@/lib/types/roles";
import { retirementPatch } from "@/lib/record-retirement";

/**
 * Assignable roles.
 *
 * This was a hand-written list of thirteen that omitted all six module-admin
 * roles — while the doc comment below said "Regular admins can assign
 * module-level roles (e.g. cooperative_admin, wave_admin)". Both of the names
 * it gives as examples were rejected as "Invalid role(s)".
 *
 * It is the canonical list now, so the type and the validation cannot disagree.
 * cooperative_admin is grantable only by a super_admin, which is enforced by
 * the privileged-role check below rather than by leaving it off the list —
 * absence from a list produces a confusing "invalid role" where the real answer
 * is "not by you".
 */
const VALID_ROLES: readonly UserRole[] = ALL_USER_ROLES;

/**
 * POST /api/admin/add-roles
 * Body: { userId: string, roles: UserRole[] }
 *
 * Grants roles to a user. Only super_admin can assign super_admin or admin roles.
 * Regular admins can assign module-level roles (e.g. cooperative_admin, wave_admin).
 */
export async function POST(req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        const callerRoles = session?.user?.roles ?? [];
        if (!isPlatformAdmin(callerRoles)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { userId, roles } = body as { userId: string; roles: UserRole[] };

        if (!userId || !Array.isArray(roles) || roles.length === 0) {
            return NextResponse.json(
                { error: "userId and a non-empty roles array are required" },
                { status: 400 }
            );
        }

        // Validate all requested roles
        const invalid = roles.filter((r) => !VALID_ROLES.includes(r));
        if (invalid.length > 0) {
            return NextResponse.json(
                { error: `Invalid role(s): ${invalid.join(", ")}` },
                { status: 400 }
            );
        }

        // Only a super_admin can grant a role that can do something the
        // granter cannot. The set is derived from PERMISSION_MATRIX rather than
        // listed here — a local `["admin", "super_admin"]` is what went stale in
        // admin-permissions.ts when the module-admin roles were added.
        if (includesPrivilegedRole(roles) && !isSuperAdmin(callerRoles)) {
            return NextResponse.json(
                { error: "Only super_admin can assign admin or super_admin roles." },
                { status: 403 }
            );
        }

        const db = getAdminDb();
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const currentRoles: UserRole[] = (userDoc.data()?.roles as UserRole[]) ?? [];

        // Merge without duplicates
        const mergedRoles = Array.from(new Set([...currentRoles, ...roles]));

        await userRef.update({
            roles: mergedRoles,
            updatedAt: new Date().toISOString(),
        });

        // Also update admin_users collection if promoting to admin-level roles
        if (includesPrivilegedRole(roles)) {
            await db.collection(COLLECTIONS.ADMIN_USERS).doc(userId).set({
                userId,
                email: userDoc.data()?.email ?? "",
                roles: mergedRoles,
                grantedBy: session?.user?.id,
                grantedAt: new Date().toISOString(),
            }, { merge: true });
        }

        logger.info(`[add-roles] User ${userId} granted roles [${roles.join(", ")}] by ${session?.user?.email}`);

        // Invalidate cache
        try {
            const { invalidateUserCache, invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
            await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Add Roles Route Cache] Cache clear error:', cacheError);
        }

        return NextResponse.json({
            success: true,
            message: `Roles [${roles.join(", ")}] granted to user ${userId}`,
            currentRoles: mergedRoles,
        });
    } catch (error) {
        logger.error("POST /api/admin/add-roles error:", error);
        return NextResponse.json({ error: "Failed to assign roles" }, { status: 500 });
    }
}

/**
 * DELETE /api/admin/add-roles
 * Body: { userId: string, roles: UserRole[] }
 *
 * Revokes specific roles from a user.
 */
export async function DELETE(req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        const callerRoles = session?.user?.roles ?? [];
        if (!isPlatformAdmin(callerRoles)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { userId, roles } = body as { userId: string; roles: UserRole[] };

        if (!userId || !Array.isArray(roles) || roles.length === 0) {
            return NextResponse.json(
                { error: "userId and a non-empty roles array are required" },
                { status: 400 }
            );
        }

        if (includesPrivilegedRole(roles) && !isSuperAdmin(callerRoles)) {
            return NextResponse.json(
                { error: "Only super_admin can revoke admin or super_admin roles." },
                { status: 403 }
            );
        }

        const db = getAdminDb();
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const currentRoles: UserRole[] = (userDoc.data()?.roles as UserRole[]) ?? [];
        const updatedRoles = currentRoles.filter((r) => !roles.includes(r));

        await userRef.update({
            roles: updatedRoles,
            updatedAt: new Date().toISOString(),
        });

        /**
         *   #303 REVOKING ADMIN DESTROYED THE RECORD THAT THEY HAD BEEN ONE.
         *
         *        `ADMIN_USERS.doc(userId).delete()`. The privileges had already
         *        been removed from the user row two statements above, which is
         *        what actually revokes access — this row is the register of who
         *        held admin, and destroying it means an audit of past admin
         *        activity has no roster to check the actor against.
         *
         *        Retired instead: the row stays, marked, and carries what it
         *        used to hold so a reader can see who revoked it and when.
         */
        const stillPrivileged = includesPrivilegedRole(updatedRoles);
        if (!stillPrivileged) {
            const adminRef = db.collection(COLLECTIONS.ADMIN_USERS).doc(userId);
            const adminSnap = await adminRef.get();
            if (adminSnap.exists) {
                await adminRef.update({
                    active: false,
                    revokedRoles: roles,
                    ...retirementPatch(session?.user?.id ?? "system", adminSnap.data()?.status),
                });
            }
        }

        logger.info(`[add-roles] Roles [${roles.join(", ")}] revoked from ${userId} by ${session?.user?.email}`);

        // Invalidate cache
        try {
            const { invalidateUserCache, invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
            await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Revoke Roles Route Cache] Cache clear error:', cacheError);
        }

        return NextResponse.json({
            success: true,
            message: `Roles [${roles.join(", ")}] revoked from user ${userId}`,
            currentRoles: updatedRoles,
        });
    } catch (error) {
        logger.error("DELETE /api/admin/add-roles error:", error);
        return NextResponse.json({ error: "Failed to revoke roles" }, { status: 500 });
    }
}
