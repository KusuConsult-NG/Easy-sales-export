"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue } from "firebase-admin/firestore";
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
    destination: z.enum(["europe", "north_america", "asia", "middle_east", "africa", "other"], {
        message: "Please select a valid destination",
    }).optional(),
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
            destination: formData.get("destination") as string | undefined,
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
        const exportWindowRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc();
        await exportWindowRef.set({
            orderId,
            commodity: validatedData.commodity,
            quantity: validatedData.quantity,
            amount: validatedData.amount,
            destination: validatedData.destination || "other",
            status: "pending",
            userId: session.user.id,
            orderDate: FieldValue.serverTimestamp(),
            deliveryDate: validatedData.deliveryDate ? new Date(validatedData.deliveryDate) : null,
            escrowReleaseDate: escrowReleaseDate,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            error: null,
            success: true,
            message: `Export window created successfully! Order ID: ${orderId}`,
            orderId,
        };
    } catch (error: any) {
        logger.error("Create export window error:", error);

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

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        const exportDoc = await exportRef.get();

        if (!exportDoc.exists) {
            return { error: "Export window not found", success: false };
        }

        const data = exportDoc.data();
        // Verify ownership (unless admin)
        if (data?.userId !== session.user.id && !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized to update this export", success: false };
        }

        // Update status
        await exportRef.update({
            status: newStatus,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            error: null,
            success: true,
            message: `Status updated to ${newStatus}`,
        };
    } catch (error: any) {
        logger.error("Update export status error:", error);
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
        let exportsQuery = db.collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("userId", "==", userId);

        // Apply status filter if provided
        if (statusFilter && statusFilter !== "all") {
            exportsQuery = exportsQuery.where("status", "==", statusFilter);
        }

        // Apply sorting
        exportsQuery = exportsQuery.orderBy("createdAt", "desc");

        const snapshot = await exportsQuery.get();

        let exports: ExportWindow[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
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
        });

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
        logger.error("Get export windows error:", error);
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

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        const exportDoc = await exportRef.get();

        if (!exportDoc.exists) {
            return { error: "Export window not found", success: false };
        }

        const data = exportDoc.data();
        if (!data) {
            return { error: "Export window data is missing", success: false };
        }

        // Verify ownership (unless admin)
        if (data.userId !== session.user.id && !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized to view this export", success: false };
        }

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
        logger.error("Get export details error:", error);
        return { error: "Failed to fetch export details", success: false };
    }
}

// ============================================
// Submit Export Onboarding Action
// ============================================

export async function submitExportOnboardingAction(
    onboardingData: {
        profile: any;
        kyc: any;
        bank: any;
        terms: any;
    }
): Promise<{ error: string | null; success: boolean; applicationId?: string }> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const userId = session.user.id;

        // Generate unique application ID
        const applicationId = `EXPORT-ONBOARD-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        // Combine all onboarding data
        const fullApplication = {
            applicationId,
            userId,
            userEmail: session.user.email,
            profile: onboardingData.profile,
            kyc: onboardingData.kyc,
            bank: onboardingData.bank,
            terms: onboardingData.terms,
            status: "pending_review",
            submittedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        // Save to Firestore
        const onboardingRef = db.collection("export_onboarding").doc();
        await onboardingRef.set(fullApplication);

        // Update user document to mark export service registration
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        await userRef.update({
            serviceRegistrations: {
                export: {
                    status: "pending_approval",
                    applicationId,
                    appliedAt: FieldValue.serverTimestamp(),
                },
            },
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            error: null,
            success: true,
            applicationId,
        };
    } catch (error: any) {
        logger.error("Submit export onboarding error:", error);
        return { error: "Failed to submit onboarding application", success: false };
    }
}

// ============================================
// Get User Export Investments Action
// ============================================

export async function getUserExportInvestmentsAction(): Promise<{
    error: string | null;
    success: boolean;
    data?: Array<{
        id: string;
        commodity: string;
        amount: number;
        expectedReturn: number;
        status: string;
        daysRemaining: number;
    }>;
}> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const userId = session.user.id;

        // Fetch user's export windows
        const snapshot = await db.collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("userId", "==", userId)
            .where("status", "in", ["pending", "in_transit", "delivered"])
            .orderBy("createdAt", "desc")
            .get();

        const investments = snapshot.docs.map(doc => {
            const data = doc.data();

            // Calculate days remaining until delivery
            let daysRemaining = 0;
            if (data.deliveryDate) {
                const delivery = data.deliveryDate.toDate();
                const now = new Date();
                const diffTime = delivery.getTime() - now.getTime();
                daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
            }

            // Calculate expected return (assume 20% ROI for now)
            const expectedReturn = data.amount * 0.20;

            return {
                id: doc.id,
                commodity: data.commodity || "Export",
                amount: data.amount,
                expectedReturn,
                status: data.status,
                daysRemaining,
            };
        });

        return {
            error: null,
            success: true,
            data: investments,
        };
    } catch (error: any) {
        logger.error("Get user export investments error:", error);
        return { error: "Failed to fetch investments", success: false };
    }
}

// ============================================
// Get User Export Stats Action
// ============================================

export async function getUserExportStatsAction(): Promise<{
    error: string | null;
    success: boolean;
    data?: {
        totalInvested: number;
        activeInvestments: number;
        totalReturns: number;
        pendingReturns: number;
    };
}> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const userId = session.user.id;

        // Fetch all user's export windows
        const snapshot = await db.collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("userId", "==", userId)
            .get();

        let totalInvested = 0;
        let activeInvestments = 0;
        let totalReturns = 0;
        let pendingReturns = 0;

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const amount = data.amount || 0;

            totalInvested += amount;

            // Count active investments (not completed)
            if (data.status === "pending" || data.status === "in_transit" || data.status === "delivered") {
                activeInvestments++;
                // Pending returns (20% ROI assumption)
                pendingReturns += amount * 0.20;
            }

            // Total returns from completed investments
            if (data.status === "completed") {
                totalReturns += amount * 0.20;
            }
        });

        return {
            error: null,
            success: true,
            data: {
                totalInvested,
                activeInvestments,
                totalReturns,
                pendingReturns,
            },
        };
    } catch (error: any) {
        logger.error("Get user export stats error:", error);
        return { error: "Failed to fetch statistics", success: false };
    }
}
