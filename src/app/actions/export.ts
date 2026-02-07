"use server";

import { db } from "@/lib/firebase";
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    setDoc,
    updateDoc,
    serverTimestamp,
    orderBy,
    getDoc
} from "firebase/firestore";
import { auth } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/types/firestore";
import { z } from "zod";

/**
 * Server Actions for Export Window Management
 * 
 * Handles CRUD operations for export windows including creation,
 * status updates, and listing with filters.
 */

// Export Window Schema
export const exportWindowSchema = z.object({
    commodity: z.enum(["yam", "sesame", "hibiscus", "other"], {
        message: "Please select a valid commodity",
    }),
    quantity: z.string().min(1, "Quantity is required"),
    amount: z.number().positive("Amount must be greater than 0"),
    deliveryDate: z.string().optional(),
});

export type ExportWindowFormData = z.infer<typeof exportWindowSchema>;

// Type definitions
type ExportWindow = {
    id: string;
    orderId: string;
    commodity: string;
    quantity: string;
    amount: number;
    status: "pending" | "in_transit" | "delivered" | "completed";
    userId: string;
    orderDate: Date;
    deliveryDate?: Date;
    escrowReleaseDate?: Date;
    createdAt: Date;
    updatedAt: Date;
};

type ActionErrorState = {
    error: string;
    success: false;
};

type CreateExportSuccessState = {
    error: null;
    success: true;
    message: string;
    orderId: string;
};

type UpdateStatusSuccessState = {
    error: null;
    success: true;
    message: string;
};

type GetExportsSuccessState = {
    error: null;
    success: true;
    data: ExportWindow[];
};

export type CreateExportActionState = ActionErrorState | CreateExportSuccessState;
export type UpdateStatusActionState = ActionErrorState | UpdateStatusSuccessState;
export type UpdateExportStatusState = UpdateStatusActionState; // Alias for compatibility
export type GetExportsActionState = ActionErrorState | GetExportsSuccessState;

// ============================================
// Create Export Window Action
// ============================================

export async function createExportWindowAction(
    prevState: CreateExportActionState,
    formData: FormData
): Promise<CreateExportActionState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in to create an export window", success: false };
        }

        // Extract and validate form data
        const exportData = {
            commodity: formData.get("commodity") as string,
            quantity: formData.get("quantity") as string,
            amount: parseFloat(formData.get("amount") as string),
            deliveryDate: formData.get("deliveryDate") as string | undefined,
        };

        // Validate with Zod
        const validatedData = exportWindowSchema.parse(exportData);

        // Generate unique order ID
        const orderId = `EXP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        // Calculate escrow release date (30 days after delivery)
        let escrowReleaseDate = null;
        if (validatedData.deliveryDate) {
            const deliveryDate = new Date(validatedData.deliveryDate);
            escrowReleaseDate = new Date(deliveryDate);
            escrowReleaseDate.setDate(escrowReleaseDate.getDate() + 30);
        }

        // Save to Firestore
        const exportWindowRef = doc(collection(db, COLLECTIONS.EXPORT_WINDOWS));
        await setDoc(exportWindowRef, {
            orderId,
            commodity: validatedData.commodity,
            quantity: validatedData.quantity,
            amount: validatedData.amount,
            status: "pending",
            userId: session.user.id,
            orderDate: serverTimestamp(),
            deliveryDate: validatedData.deliveryDate ? new Date(validatedData.deliveryDate) : null,
            escrowReleaseDate: escrowReleaseDate,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        return {
            error: null,
            success: true,
            message: `Export window created successfully! Order ID: ${orderId}`,
            orderId,
        };
    } catch (error: any) {
        console.error("Create export window error:", error);

        if (error.name === "ZodError") {
            return { error: "Please fill in all required fields correctly", success: false };
        }

        return { error: "Failed to create export window. Please try again.", success: false };
    }
}

// ============================================
// Update Export Status Action
// ============================================

export async function updateExportStatusAction(
    exportId: string,
    newStatus: "pending" | "in_transit" | "delivered" | "completed"
): Promise<UpdateStatusActionState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const exportRef = doc(db, COLLECTIONS.EXPORT_WINDOWS, exportId);
        const exportDoc = await getDoc(exportRef);

        if (!exportDoc.exists()) {
            return { error: "Export window not found", success: false };
        }

        // Verify ownership (unless admin)
        if (exportDoc.data().userId !== session.user.id && !session.user.roles?.includes("admin")) {
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
            message: `Status updated to ${newStatus}`,
        };
    } catch (error: any) {
        console.error("Update export status error:", error);
        return { error: "Failed to update status", success: false };
    }
}

// ============================================
// Get Export Windows Action
// ============================================

export async function getExportWindowsAction(
    statusFilter?: string,
    fromDate?: string,
    toDate?: string
): Promise<GetExportsActionState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const userId = session.user.id;

        // Build query
        let exportsQuery = query(
            collection(db, COLLECTIONS.EXPORT_WINDOWS),
            where("userId", "==", userId),
            orderBy("createdAt", "desc")
        );

        // Apply status filter if provided
        if (statusFilter && statusFilter !== "all") {
            exportsQuery = query(
                collection(db, COLLECTIONS.EXPORT_WINDOWS),
                where("userId", "==", userId),
                where("status", "==", statusFilter),
                orderBy("createdAt", "desc")
            );
        }

        const snapshot = await getDocs(exportsQuery);

        let exports: ExportWindow[] = snapshot.docs.map(doc => ({
            id: doc.id,
            orderId: doc.data().orderId,
            commodity: doc.data().commodity,
            quantity: doc.data().quantity,
            amount: doc.data().amount,
            status: doc.data().status,
            userId: doc.data().userId,
            orderDate: doc.data().orderDate?.toDate() || new Date(),
            deliveryDate: doc.data().deliveryDate?.toDate(),
            escrowReleaseDate: doc.data().escrowReleaseDate?.toDate(),
            createdAt: doc.data().createdAt?.toDate() || new Date(),
            updatedAt: doc.data().updatedAt?.toDate() || new Date(),
        }));

        // Apply client-side date filtering
        if (fromDate || toDate) {
            exports = exports.filter(exp => {
                const createdDate = exp.createdAt;

                if (fromDate && toDate) {
                    return createdDate >= new Date(fromDate) && createdDate <= new Date(toDate);
                } else if (fromDate) {
                    return createdDate >= new Date(fromDate);
                } else if (toDate) {
                    return createdDate <= new Date(toDate);
                }

                return true;
            });
        }

        return {
            error: null,
            success: true,
            data: exports,
        };
    } catch (error: any) {
        console.error("Get export windows error:", error);
        return { error: "Failed to fetch export windows", success: false };
    }
}

// ============================================
// Get Export Window Details Action
// ============================================

export async function getExportWindowDetailsAction(
    exportId: string
): Promise<{ error: string | null; success: boolean; data?: ExportWindow }> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const exportRef = doc(db, COLLECTIONS.EXPORT_WINDOWS, exportId);
        const exportDoc = await getDoc(exportRef);

        if (!exportDoc.exists()) {
            return { error: "Export window not found", success: false };
        }

        // Verify ownership (unless admin)
        if (exportDoc.data().userId !== session.user.id && !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized to view this export", success: false };
        }

        const data = exportDoc.data();
        const exportWindow: ExportWindow = {
            id: exportDoc.id,
            orderId: data.orderId,
            commodity: data.commodity,
            quantity: data.quantity,
            amount: data.amount,
            status: data.status,
            userId: data.userId,
            orderDate: data.orderDate?.toDate() || new Date(),
            deliveryDate: data.deliveryDate?.toDate(),
            escrowReleaseDate: data.escrowReleaseDate?.toDate(),
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
        };

        return {
            error: null,
            success: true,
            data: exportWindow,
        };
    } catch (error: any) {
        console.error("Get export details error:", error);
        return { error: "Failed to fetch export details", success: false };
    }
}
