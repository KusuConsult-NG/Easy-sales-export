export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import type { UserRole } from "@/lib/types/roles";

const VALID_ROLES: UserRole[] = [
    "admin",
    "super_admin",
    "field_officer",
    "general_user",
    "buyer",
    "seller",
    "land_owner",
    "farmer",
    "investor",
    "export_participant",
    "cooperative_member",
    "wave_participant",
    "academy_participant",
];

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
        const isAdmin = callerRoles.includes("admin") || callerRoles.includes("super_admin");

        if (!isAdmin) {
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

        // Only super_admin can promote to admin or super_admin
        const privilegedRoles: UserRole[] = ["admin", "super_admin"];
        const requestingPrivileged = roles.some((r) => privilegedRoles.includes(r));
        if (requestingPrivileged && !callerRoles.includes("super_admin")) {
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
        if (roles.some((r) => privilegedRoles.includes(r))) {
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
        const isSuperAdmin = callerRoles.includes("super_admin");
        const isAdmin = callerRoles.includes("admin") || isSuperAdmin;

        if (!isAdmin) {
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

        const privilegedRoles: UserRole[] = ["admin", "super_admin"];
        const revokingPrivileged = roles.some((r) => privilegedRoles.includes(r));
        if (revokingPrivileged && !isSuperAdmin) {
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

        // Remove from admin_users if all privileged roles revoked
        const stillPrivileged = updatedRoles.some((r) => privilegedRoles.includes(r));
        if (!stillPrivileged) {
            await db.collection(COLLECTIONS.ADMIN_USERS).doc(userId).delete();
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
