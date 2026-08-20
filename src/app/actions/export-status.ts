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
import { normaliseExportWindowStatus, refuseExportStatusChange } from "@/lib/export-window-status";

// The four statuses now live in lib/export-window-status.ts, alongside the rule
// about who may set which of them — a local copy of the list here is how the
// sibling endpoint came to have its own.
export type { ExportWindowStatus as ExportStatus } from "@/lib/export-window-status";

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
        const newStatus = normaliseExportWindowStatus(rawStatus);
        if (!newStatus) {
            return { error: "Invalid status value", success: false as const, data: null, meta: null };
        }

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

        // The rule, shared with the other updateExportStatusAction.
        //
        // It used to live here as an inline check, which is how the sibling
        // endpoint in export/_ex_windows.ts came to apply none of it. See
        // lib/export-window-status.ts.
        const refusal = refuseExportStatusChange({
            callerId: session.user.id,
            callerRoles: roles,
            ownerId: exportData.userId,
            currentStatus: exportData.status,
            newStatus,
            window: exportData,
        });
        if (refusal) {
            return { error: refusal, success: false as const, data: null, meta: null };
        }

        // Update status
        await exportRef.update({ status: newStatus,
            updatedAt: FieldValue.serverTimestamp() });

        // Revalidate the frontend cache so the user instantly sees the update
        revalidatePath("/admin");
        revalidatePath("/marketplace/seller/orders");
        // /dashboard/export is not a route — the export dashboard is at
        // /export/dashboard (the (app) segment is a route group and does not
        // appear in the URL). revalidatePath on a path with no route behind it
        // is a silent no-op, so this invalidated nothing.
        revalidatePath("/export/dashboard");

        return { error: null, success: true as const, data: { message: `Status updated to ${newStatus.replace("_", " ")}` } };
    } catch (error: any) {
        logger.error("Update export status error:", error);
        return { error: "Failed to update status", success: false as const, data: null };
    }
}

export const updateExportStatusAction = withSafeAction("updateExportStatusAction", _updateExportStatusAction);
