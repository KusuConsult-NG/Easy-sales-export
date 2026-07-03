"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
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

        // Verify ownership (unless admin)
        const exportData = exportDoc.data()!;
        const roles = session.user.roles || [];
        const hasExportAccess = roles.some(r => r === "admin" || r === "super_admin" || r === "export_admin");
        if (exportData.userId !== session.user.id && !hasExportAccess) { return { error: "Unauthorized to update this export", success: false as const, data: null, meta: null };
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
