"use server";

import { requireSession } from "@/lib/session-guard";
import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { hasRole } from "@/lib/role-utils";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { createNotificationAction } from "@/app/actions/notifications";

/**
 * Fetch all admin and super_admin users — used to populate the assignment dropdown.
 */
export async function getAdminUsersAction(): Promise<{
    success: true | false;
    admins?: { id: string; name: string; email: string; role: string }[];
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthenticated" };

        // Must be an admin to list other admins
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { success: false as const, error: adminCheck.error };

        // Query users who have admin or super_admin in their roles array
        const [adminSnap, superAdminSnap] = await Promise.all([
            db.collection(COLLECTIONS.USERS).where("roles", "array-contains", "admin").get(),
            db.collection(COLLECTIONS.USERS).where("roles", "array-contains", "super_admin").get(),
        ]);

        // Merge + deduplicate by id
        const seen = new Set<string>();
        const admins: { id: string; name: string; email: string; role: string }[] = [];

        for (const doc of [...adminSnap.docs, ...superAdminSnap.docs]) {
            if (seen.has(doc.id)) continue;
            seen.add(doc.id);
            const d = doc.data();
            admins.push({
                id: doc.id,
                name: d.displayName || d.name || d.email || "Admin",
                email: d.email || "",
                role: (d.roles as string[])?.includes("super_admin") ? "super_admin" : "admin",
            });
        }

        return { success: true as const, admins };
    } catch (error: any) {
        return { success: false as const, error: error.message };
    }
}

/**
 * Assign an escalated dispute to a specific admin for resolution.
 */
export async function assignDisputeAction(
    disputeId: string,
    assigneeId: string,
    assigneeName: string
): Promise<{ success: true | false; error?: string }> {
    try {
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { success: false as const, error: adminCheck.error };

        const adminId = (adminCheck as { userId: string }).userId;

        // Verify the assignee is an admin
        const assigneeDoc = await db.collection(COLLECTIONS.USERS).doc(assigneeId).get();
        if (!assigneeDoc.exists) return { success: false as const, error: "Assignee not found" };
        const assigneeData = assigneeDoc.data();
        if (!hasRole(assigneeData?.roles || [], "admin")) {
            return { success: false as const, error: "Assignee is not an admin" };
        }

        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);
        const disputeDoc = await disputeRef.get();
        if (!disputeDoc.exists) return { success: false as const, error: "Dispute not found" };

        await disputeRef.update({
            assignedAdminId: assigneeId,
            assignedAdminName: assigneeName,
            assignedAt: FieldValue.serverTimestamp(),
            assignedBy: adminId,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Audit log
        await createAdminAuditLog({
            action: "dispute_escalated",
            userId: adminId,
            targetId: disputeId,
            targetType: "dispute",
            metadata: { assignedTo: assigneeId, assigneeName },
        });

        // Notify the assigned admin in-app
        await createNotificationAction({
            userId: assigneeId,
            title: "Dispute Assigned to You",
            message: `Dispute #${disputeId.slice(0, 8).toUpperCase()} has been assigned to you for senior review.`,
            type: "info",
            link: `/admin/marketplace/disputes/${disputeId}`,
        });

        return { success: true };
    } catch (error: any) {
        return { success: false as const, error: error.message };
    }
}
