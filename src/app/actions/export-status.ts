"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";

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
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const exportId = formData.get("exportId") as string;
        const newStatus = formData.get("status") as ExportStatus;

        if (!exportId || !newStatus) {
            return { error: "Missing required fields", success: false };
        }

        const exportRef = doc(db, COLLECTIONS.EXPORT_WINDOWS, exportId);
        const exportDoc = await getDoc(exportRef);

        if (!exportDoc.exists()) {
            return { error: "Export window not found", success: false };
        }

        // Verify ownership (unless admin)
        const exportData = exportDoc.data();
        if (exportData.userId !== session.user.id && session.user.role !== "admin" && session.user.role !== "super_admin") {
            return { error: "Unauthorized to update this export", success: false };
        }

        // Update status
        await updateDoc(exportRef, {
            status: newStatus,
            updatedAt: serverTimestamp(),
        });

        return {
            error: null,
            success: true,
            message: `Status updated to ${newStatus.replace("_", " ")}`,
        };
    } catch (error: any) {
        console.error("Update export status error:", error);
        return { error: "Failed to update status", success: false };
    }
}
