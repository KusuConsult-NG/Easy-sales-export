"use server";

import { ActionResponse } from "@/lib/safe-action";

import { requireSession } from "@/lib/session-guard";
import { requireAdmin } from "@/lib/require-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { hasAnyRole } from "@/lib/role-utils";
import { createAdminAuditLog } from "@/lib/audit-log";
import { createNotificationAction } from "@/app/actions/notifications";
import { serializeValue } from "@/lib/firestore-serialize";
import { safeCollection } from "@/lib/firestore-utils";

/**
 * Fetch all admin and super_admin users — used to populate the assignment dropdown.
 */
export async function getAdminUsersAction(): Promise<ActionResponse<any[]>> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthenticated", data: null };

        // Must be an admin to list other admins
        const adminCheck = await requireAdmin("users:read");
        if ("error" in adminCheck) return { success: false as const, error: adminCheck.error, data: null };

        // Query users who have admin or super_admin in their roles array
        const [adminSnap, superAdminSnap] = await Promise.all([
            safeCollection(db, COLLECTIONS.USERS, { limit: 100 }).where("roles", "array-contains", "admin").get(),
            safeCollection(db, COLLECTIONS.USERS, { limit: 100 }).where("roles", "array-contains", "super_admin").get(),
        ]);

        // Merge + deduplicate by id
        const seen = new Set<string>();
        const admins: { id: string; name: string; email: string; role: string }[] = [];

        for (const doc of [...adminSnap.docs, ...superAdminSnap.docs]) { if (seen.has(doc.id)) continue;
            seen.add(doc.id);
            const d = doc.data();
            admins.push(serializeValue({
                id: doc.id,
                name: d.displayName || d.name || d.email || "Admin",
                email: d.email || "",
                role: (d.roles as string[])?.includes("super_admin") ? "super_admin" : "admin" }));
        }

        return { success: true as const, data: admins, error: null };
    } catch (error: any) { return { success: false as const, error: error.message, data: null };
    }
}

/**
 * Assign an escalated dispute to a specific admin for resolution.
 */
export async function assignDisputeAction(
    disputeId: string,
    assigneeId: string,
    assigneeName: string
): Promise<ActionResponse<null>> { try {
        const adminCheck = await requireAdmin("finance:resolve_disputes");
        if ("error" in adminCheck) return { success: false as const, error: adminCheck.error, data: null };

        const adminId = (adminCheck as { userId: string }).userId;

        // Verify the assignee is an admin
        const assigneeDoc = await db.collection(COLLECTIONS.USERS).doc(assigneeId).get();
        if (!assigneeDoc.exists) return { success: false as const, error: "Assignee not found", data: null };
        const assigneeData = assigneeDoc.data();

        // A super_admin is a valid assignee.
        //
        // hasRole is a literal includes("admin"), so a super_admin who does not
        // also hold the plain 'admin' role was refused — while
        // getAdminUsersAction, forty lines above, deliberately queries for
        // super_admin and returns them tagged `role: "super_admin"` to populate
        // this very dropdown. The picker offered people the assignment then
        // rejected, with "Assignee is not an admin" about an administrator.
        const assigneeRoles = assigneeData?.roles || [];
        if (!hasAnyRole(assigneeRoles, ["admin", "super_admin"] as any)) {
            return { success: false as const, error: "Assignee is not an admin", data: null };
        }

        // The name on the record comes from the record.
        //
        // assigneeName arrived as a parameter and was written to the dispute as
        // assignedAdminName and into the audit log — while the assignee's own
        // document was already loaded, one line up, to check their role. So the
        // attribution on an escalated dispute was whatever the caller typed, and
        // the audit entry agreed with it.
        //
        // Same shape as the certificate title in #116 and the property title in
        // #103: a value the server already holds, taken from the client instead.
        const verifiedAssigneeName =
            assigneeData?.displayName || assigneeData?.name || assigneeData?.email || assigneeName || "Admin";

        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);
        const disputeDoc = await disputeRef.get();
        if (!disputeDoc.exists) return { success: false as const, error: "Dispute not found", data: null };

        await disputeRef.update({ assignedAdminId: assigneeId,
            assignedAdminName: verifiedAssigneeName,
            assignedAt: FieldValue.serverTimestamp(),
            assignedBy: adminId,
            updatedAt: FieldValue.serverTimestamp() });

        // Audit log
        await createAdminAuditLog({ action: "dispute_escalated",
            userId: adminId,
            targetId: disputeId,
            targetType: "dispute",
            metadata: { assignedTo: assigneeId, assigneeName: verifiedAssigneeName } });

        // Notify the assigned admin in-app
        await createNotificationAction({
            userId: assigneeId,
            title: "Dispute Assigned to You",
            message: `Dispute #${disputeId.slice(0, 8).toUpperCase()} has been assigned to you for senior review.`,
            type: "info",
            link: `/admin/marketplace/disputes/${disputeId}` });

        return { success: true as const, error: null, data: null };
    } catch (error: any) { return { success: false as const, error: error.message, data: null };
    }
}
