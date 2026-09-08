export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { createAdminAuditLog } from "@/lib/audit-log";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { includesPrivilegedRole, isSuperAdmin } from "@/lib/admin-permissions";
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
 * The caller's roles as the DATABASE has them — #526.
 *
 * requireAdmin re-reads and gates but returns only a userId, and the
 * super-admin comparisons below need the roles themselves. A second read on a
 * role-granting endpoint is a fair price for not asking the token.
 */
async function liveRolesOf(userId: string): Promise<string[]> {
    const snap = await getAdminDb().collection(COLLECTIONS.USERS).doc(userId).get();
    return (snap.data()?.roles as string[]) ?? [];
}


/**
 * POST /api/admin/add-roles
 * Body: { userId: string, roles: UserRole[] }
 *
 * Grants roles to a user. Only super_admin can assign super_admin or admin roles.
 * Regular admins can assign module-level roles (e.g. cooperative_admin, wave_admin).
 */
export async function POST(req: NextRequest) {
    try {
        /**
         *   #526 THE ROLE-GRANTING ENDPOINT TRUSTED THE JWT.
         *
         *   `isPlatformAdmin(session.user.roles)` reads the roles baked into the
         *   token, which #356 established are stale for up to eight hours after
         *   a revocation — so a just-revoked admin could still grant roles, on
         *   the endpoint that grants roles. requireAdmin exists for exactly this
         *   and says so in its own step 2: "Re-fetch roles live from Firestore
         *   (bypasses the stale JWT)". It also refuses a banned or suspended
         *   account while it has the document, which this route never checked.
         *
         *   `users:update` is the permission held by super_admin and admin and
         *   nobody else, so the gate is the same one — asked of the live record.
         */
        const authCheck = await requireAdmin("users:update");
        if ("error" in authCheck) {
            return NextResponse.json({ error: authCheck.error }, { status: 401 });
        }
        const callerRoles = await liveRolesOf(authCheck.userId);

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

        /**
         *   #526 THE CHECK LOOKED AT THE ROLES BEING GRANTED, NOT AT WHO WAS
         *   BEING CHANGED.
         *
         *   #499 found and fixed this exact shape in updateUserRolesAction — a
         *   plain admin could edit a super_admin's roles there — and the fix it
         *   added is one line: refuse when the TARGET holds a privileged role
         *   and the caller is not a super_admin. This route, which is the other
         *   door onto the same operation, never got it. Granting a
         *   non-privileged role to a super_admin passed every check above,
         *   because every check above is about the roles in the request.
         */
        if (includesPrivilegedRole(currentRoles) && !isSuperAdmin(callerRoles)) {
            return NextResponse.json(
                { error: "Only a super admin can change an admin's roles" },
                { status: 403 }
            );
        }

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
                grantedBy: authCheck.userId,
                grantedAt: new Date().toISOString(),
            }, { merge: true });
        }

        //   #526. A role change is what an audit log is for, and the sibling
        //   action records one with the previous roles on it. This wrote a log
        //   LINE — which is not a record anybody can query later.
        await createAdminAuditLog({
            action: "user_role_change",
            userId: authCheck.userId,
            targetId: userId,
            targetType: "user",
            metadata: { change: "grant", granted: roles, previousRoles: currentRoles, resultingRoles: mergedRoles },
        });

        logger.info(`[add-roles] User ${userId} granted roles [${roles.join(", ")}]`);

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
        /**
         *   #526 THE ROLE-GRANTING ENDPOINT TRUSTED THE JWT.
         *
         *   `isPlatformAdmin(session.user.roles)` reads the roles baked into the
         *   token, which #356 established are stale for up to eight hours after
         *   a revocation — so a just-revoked admin could still grant roles, on
         *   the endpoint that grants roles. requireAdmin exists for exactly this
         *   and says so in its own step 2: "Re-fetch roles live from Firestore
         *   (bypasses the stale JWT)". It also refuses a banned or suspended
         *   account while it has the document, which this route never checked.
         *
         *   `users:update` is the permission held by super_admin and admin and
         *   nobody else, so the gate is the same one — asked of the live record.
         */
        const authCheck = await requireAdmin("users:update");
        if ("error" in authCheck) {
            return NextResponse.json({ error: authCheck.error }, { status: 401 });
        }
        const callerRoles = await liveRolesOf(authCheck.userId);

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

        //   #526, the other half. Revoking a NON-privileged role from a
        //   super_admin passed the check above, because that check reads the
        //   roles in the request.
        if (includesPrivilegedRole(currentRoles) && !isSuperAdmin(callerRoles)) {
            return NextResponse.json(
                { error: "Only a super admin can change an admin's roles" },
                { status: 403 }
            );
        }

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
                    ...retirementPatch(authCheck.userId, adminSnap.data()?.status),
                });
            }
        }

        await createAdminAuditLog({
            action: "user_role_change",
            userId: authCheck.userId,
            targetId: userId,
            targetType: "user",
            metadata: { change: "revoke", revoked: roles, previousRoles: currentRoles, resultingRoles: updatedRoles },
        });

        logger.info(`[add-roles] Roles [${roles.join(", ")}] revoked from ${userId}`);

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
