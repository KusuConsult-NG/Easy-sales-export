"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { revalidatePath } from "next/cache";

import { withSafeAction, type ActionResponse } from "@/lib/safe-action";

type ExportStatus = "pending" | "in_transit" | "delivered" | "completed";

/**
 * Server action to update export status
 */
async function _updateExportStatusAction(
    prevState: ActionResponse<{ message: string }>,
    formData: FormData
): Promise<ActionResponse<{ message: string }>> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { error: sessionResult.error?.error || "Unauthorized", success: false as const, data: null, meta: null };
        const { session } = sessionResult;

        const exportId = (formData.get("exportId") as string | null)?.trim() ?? "";
        const rawStatus = (formData.get("status") as string | null)?.trim() ?? "";
        const validStatuses: ExportStatus[] = ["pending", "in_transit", "delivered", "completed"];
        if (!validStatuses.includes(rawStatus as ExportStatus)) {
            return { error: "Invalid status value", success: false as const, data: null, meta: null };
        }
        const newStatus = rawStatus as ExportStatus;

        if (!exportId || !newStatus) { return { error: "Missing required fields", success: false as const, data: null, meta: null };
        }

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        const exportDoc = await exportRef.get();

        if (!exportDoc.exists) { return { error: "Export window not found", success: false as const, data: null, meta: null };
        }

        // Verify ownership (unless admin).
        //
        // Roles are re-read from the database rather than taken from the JWT,
        // matching admin-content.ts since #114 and the escrow readers: a token
        // keeps its roles until it refreshes, and this endpoint decides who may
        // change a record the dashboard reads as escrow.
        const exportData = exportDoc.data()!;
        const callerDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const roles: string[] = callerDoc.data()?.roles ?? [];
        const hasExportAccess = roles.some(r => r === "admin" || r === "super_admin" || r === "export_admin");
        if (exportData.userId !== session.user.id && !hasExportAccess) { return { error: "Unauthorized to update this export", success: false as const, data: null, meta: null };
        }

        // An owner moves their export along. They do not settle it, and they do
        // not reopen it.
        //
        // Any of the four statuses could be set from any other, by the window's
        // owner as readily as by an admin. Two consequences worth separating:
        //
        //   "completed" is a settlement statement. An owner could declare their
        //   own export finished without an admin ever seeing it.
        //
        //   Moving OUT of "completed" reopens a settled record. dashboard.ts
        //   sums windows in in_transit/delivered as the owner's Total Escrow,
        //   so the same call that reopens the record also puts the figure back.
        //
        // Admins keep full control, including correcting a mistake in either
        // direction. This is deliberately not a full state machine — which
        // transitions are legal in the middle of the flow is a wider question
        // than this function should answer alone, the same line drawn for
        // export order status in #112.
        if (!hasExportAccess) {
            if (newStatus === "completed") {
                return { error: "Only an administrator can mark an export completed", success: false as const, data: null, meta: null };
            }
            if (exportData.status === "completed") {
                return { error: "This export is completed and can only be changed by an administrator", success: false as const, data: null, meta: null };
            }
        }

        // Update status
        await exportRef.update({ status: newStatus,
            updatedAt: FieldValue.serverTimestamp() });

        // Revalidate the frontend cache so the user instantly sees the update
        revalidatePath("/admin");
        revalidatePath("/marketplace/seller/orders");
        revalidatePath("/dashboard/export");

        return { error: null, success: true as const, data: { message: `Status updated to ${newStatus.replace("_", " ")}` } };
    } catch (error: any) {
        logger.error("Update export status error:", error);
        return { error: "Failed to update status", success: false as const, data: null };
    }
}

export const updateExportStatusAction = withSafeAction("updateExportStatusAction", _updateExportStatusAction);
