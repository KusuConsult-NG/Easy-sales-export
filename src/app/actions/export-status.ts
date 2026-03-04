"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { revalidatePath } from "next/cache";

type UpdateExportStatusState =
    | { error: string; success: false }
    | { error: null; success: true; message: string };

type ExportStatus = "pending" | "in_transit" | "delivered" | "completed";

/**
 * Server action to update export status
 */
export async function updateExportStatusAction(
    prevState: UpdateExportStatusState,
    formData: FormData
): Promise<UpdateExportStatusState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;

        const exportId = formData.get("exportId") as string;
        const newStatus = formData.get("status") as ExportStatus;

        if (!exportId || !newStatus) {
            return { error: "Missing required fields", success: false };
        }

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        const exportDoc = await exportRef.get();

        if (!exportDoc.exists) {
            return { error: "Export window not found", success: false };
        }

        // Verify ownership (unless admin)
        const exportData = exportDoc.data()!;
        if (exportData.userId !== session.user.id && !session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { error: "Unauthorized to update this export", success: false };
        }

        // Update status
        await exportRef.update({
            status: newStatus,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Revalidate the frontend cache so the user instantly sees the update
        revalidatePath("/admin");
        revalidatePath("/vendor/orders");
        revalidatePath("/dashboard/export");

        return {
            error: null,
            success: true,
            message: `Status updated to ${newStatus.replace("_", " ")}`,
        };
    } catch (error: any) {
        logger.error("Update export status error:", error);
        return { error: "Failed to update status", success: false };
    }
}
