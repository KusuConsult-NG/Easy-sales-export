"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/types/firestore";
import { z } from "zod";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { revalidatePath } from "next/cache";

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

import type { ExportWindow, ExportOnboardingApplication } from "@/lib/types/firestore";

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

        // 🔒 SECURITY: KYC & Compliance Enforcement
        // 1. Check if user is verified (KYC)
        // Note: We need to fetch the fresh user doc to be sure, session might be stale.
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        if (!userData?.isVerified) {
            return { error: "Compliance Error: You must complete KYC verification to create Export Windows.", success: false };
        }

        // 2. Check for Service Registration (CAC/NEPC)
        const exportReg = userData?.serviceRegistrations?.export;
        const serviceNumber = exportReg?.registrationNumber || userData?.cacNumber; // Fallback to general CAC

        if (!serviceNumber && userData?.serviceRegistrations?.export?.status !== "approved") {
            // Strict: Must have explicit export registration OR at least a verified CAC on file if we allow that.
            // Plan said "Validate serviceRegistrationNumber is present".
            return { error: "Compliance Error: Missing Export Service Registration (NEPC/CAC).", success: false };
        }

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

        revalidatePath("/export");
        revalidatePath("/dashboard/export");

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
// Update Export Window Details Action
// ============================================

export async function updateExportWindowAction(
    exportId: string,
    updateData: Partial<ExportWindow>
): Promise<{ error: string | null; success: boolean }> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        // Verify Admin
        if (!session.user.roles?.includes("admin")) {
            return { error: "Unauthorized access", success: false };
        }

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);

        // Remove undefined fields
        const cleanData = JSON.parse(JSON.stringify(updateData));
        delete cleanData.id;
        delete cleanData.createdAt;
        delete cleanData.updatedAt;

        await exportRef.update({
            ...cleanData,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { error: null, success: true };
    } catch (error: any) {
        logger.error("Update export window error:", error);
        return { error: "Failed to update export window", success: false };
    }
}

// ============================================
// Get Export Windows Action
// ============================================

export async function getExportWindowsAction(
    statusFilter?: string,
    fromDate?: string,
    toDate?: string,
    limit: number = 20,
    lastId?: string
): Promise<{
    error: string | null;
    success: boolean;
    data?: ExportWindow[];
    lastId?: string | null;
}> {
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

        // Apply Cursor
        if (lastId) {
            const lastDoc = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(lastId).get();
            if (lastDoc.exists) {
                exportsQuery = exportsQuery.startAfter(lastDoc);
            }
        }

        // Apply Limit
        exportsQuery = exportsQuery.limit(limit);

        const snapshot = await exportsQuery.get();

        let exports: ExportWindow[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                orderId: data.orderId,
                commodity: data.commodity,
                quantity: data.quantity,
                amount: data.amount,
                roi: data.roi || "N/A",
                duration: data.duration || "N/A",
                status: data.status,
                userId: data.userId,
                // Deep data
                description: data.description,
                specifications: data.specifications || [],
                benefits: data.benefits || [],
                documents: data.documents || [],
                timeline: data.timeline || [],

                startDate: data.startDate?.toDate(),
                endDate: data.endDate?.toDate(),
                deliveryDate: data.deliveryDate?.toDate(),
                createdAt: data.createdAt?.toDate() || new Date(),
                updatedAt: data.updatedAt?.toDate() || new Date(),
            };
        });

        // Apply client-side date filtering (Note: This breaks pagination if used with limit. 
        // For now we keep it but warn that date filtering + pagination is complex in NoSQL without composite indexes)
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

        const lastDocId = snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].id : null;

        return {
            error: null,
            success: true,
            data: exports,
            lastId: lastDocId
        };
    } catch (error: any) {
        logger.error("Get export windows error:", error);
        return { error: "Failed to fetch export windows", success: false };
    }
}

// ============================================
// Get Export Window Details Action
// ============================================

export const getExportRequestByIdAction = getExportWindowDetailsAction; // Alias

export async function getExportWindowDetailsAction(
    exportId: string
): Promise<{ error: string | null; success: boolean; data?: ExportWindow; export?: ExportWindow }> {
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
            roi: data.roi || "N/A",
            duration: data.duration || "N/A",
            status: data.status,
            userId: data.userId,
            // Deep data
            description: data.description,
            specifications: data.specifications || [],
            benefits: data.benefits || [],
            documents: data.documents || [],
            timeline: data.timeline || [],

            startDate: data.startDate?.toDate(),
            endDate: data.endDate?.toDate(),
            deliveryDate: data.deliveryDate?.toDate(),
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
        };

        return {
            error: null,
            success: true,
            data: exportWindow,
            export: exportWindow // For compatibility
        };
    } catch (error: any) {
        logger.error("Get export details error:", error);
        return { error: "Failed to fetch export details", success: false };
    }
}

// ============================================
// Submit Export Onboarding Action
// ============================================

// ============================================
// Submit Export Onboarding Action
// ============================================

import { uploadFileToStorage } from "@/lib/storage-admin";

export async function submitExportOnboardingAction(
    prevState: any,
    formData: FormData
): Promise<{ error: string | null; success: boolean; applicationId?: string }> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const userId = session.user.id;

        // Check for existing application
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.export?.status;

        if (existingStatus === 'pending_approval' || existingStatus === 'under_review') {
            return {
                success: false,
                error: "Your previous application is still being processed."
            };
        }
        if (existingStatus === 'approved') {
            return {
                success: false,
                error: "You are already registered for Export."
            };
        }

        // Extract Data
        const profile = JSON.parse(formData.get("profile") as string || "{}");
        const kycData = JSON.parse(formData.get("kycData") as string || "{}");
        const bank = JSON.parse(formData.get("bank") as string || "{}");
        const terms = JSON.parse(formData.get("terms") as string || "{}");

        const idDocument = formData.get("idDocument") as File | null;
        const proofOfAddress = formData.get("proofOfAddress") as File | null;

        // Upload Documents
        const documents: any = {};

        if (idDocument && idDocument.size > 0) {
            documents.idDocument = await uploadFileToStorage(
                idDocument,
                `export-kyc/${userId}/id-document`
            );
        }

        if (proofOfAddress && proofOfAddress.size > 0) {
            documents.proofOfAddress = await uploadFileToStorage(
                proofOfAddress,
                `export-kyc/${userId}/proof-of-address`
            );
        }

        // Generate unique application ID
        const applicationId = `EXPORT-ONBOARD-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        // Combine all onboarding data
        const fullApplication = {
            applicationId,
            userId,
            userEmail: session.user.email,
            profile,
            kyc: {
                ...kycData,
                documents: documents // Now contains URLs
            },
            bank,
            terms,
            status: "pending_review",
            submittedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        // Save to Firestore
        const onboardingRef = db.collection("export_onboarding").doc();
        await onboardingRef.set(fullApplication);

        // Update user document to mark export service registration with safe dot notation
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        await userRef.update({
            "serviceRegistrations.export.status": "pending_approval",
            "serviceRegistrations.export.applicationId": applicationId,
            "serviceRegistrations.export.appliedAt": FieldValue.serverTimestamp(),
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

export async function getUserExportInvestmentsAction(
    limit: number = 10,
    lastId?: string
): Promise<{
    error: string | null;
    success: boolean;
    data?: Array<{
        id: string;
        commodity: string;
        amount: number;
        expectedReturn: number;
        status: string;
        daysRemaining: number;
        startDate: Date;
        endDate: Date;
    }>;
    lastId?: string | null;
}> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const userId = session.user.id;

        // Fetch user's export windows
        let query = db.collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("userId", "==", userId)
            .where("status", "in", ["pending", "in_transit", "delivered"])
            .orderBy("createdAt", "desc");

        if (lastId) {
            const lastDoc = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(lastId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(limit);

        const snapshot = await query.get();

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
                startDate: data.startDate?.toDate() || new Date(),
                endDate: data.endDate?.toDate() || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // Fallback
            };
        });

        const lastDocId = snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].id : null;

        return {
            error: null,
            success: true,
            data: investments,
            lastId: lastDocId
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

// ============================================
// Check Export Application Status Action
// ============================================

export async function checkExportStatusAction(): Promise<string | null> {
    try {
        const session = await auth();
        if (!session?.user) return null;

        // Check user document for service registration
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        const registration = userData?.serviceRegistrations?.export;

        if (registration?.status) {
            return registration.status;
        }

        return null;
    } catch (error) {
        logger.error("Error checking export status:", error);
        return null;
    }
}

// ============================================
// Invest in Export Window
// ============================================

export async function investInExportAction(
    exportId: string,
    amount: number
): Promise<{ success: boolean; error?: string; data?: { authorizationUrl: string; reference: string } }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        const exportDoc = await exportRef.get();

        if (!exportDoc.exists) {
            return { success: false, error: "Export window not found" };
        }

        const exportData = exportDoc.data();
        if (exportData?.status !== "open" && exportData?.status !== "active") {
            return { success: false, error: "This export window is not open for investment" };
        }

        // Validate Minimum Investment (assuming 'amount' in window is unit price or min investment)
        const minInvestment = exportData?.amount || 50000; // Default fallback
        if (amount < minInvestment) {
            return { success: false, error: `Minimum investment is ₦${minInvestment.toLocaleString()}` };
        }

        // Check Funding Limit (Optional - if totalSpots defined)
        if (exportData?.totalSpots && exportData?.spotsFilled >= exportData?.totalSpots) {
            return { success: false, error: "Investment slots are full" };
        }

        // Initialize Paystack
        const { initializePaystackPayment } = await import("@/lib/paystack-server");
        const initResult = await initializePaystackPayment(
            session.user.email || "",
            Math.round(amount * 100), // Kobo
            {
                type: "export_investment",
                exportId,
                userId: session.user.id,
                amount,
                email: session.user.email
            },
            `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/export/verify`
        );

        return { success: true, data: initResult };

    } catch (error: any) {
        logger.error("Invest in export error:", error);
        return { success: false, error: error.message || "Investment initialization failed" };
    }
}

// ============================================
// Verify Export Investment
// ============================================

export async function verifyExportInvestmentAction(reference: string): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        const { verifyPaystackPayment } = await import("@/lib/paystack-server");
        const verify = await verifyPaystackPayment(reference);

        if (!verify.status || verify.data.status !== "success") {
            return { success: false, error: "Payment verification failed" };
        }

        const metadata = verify.data.metadata;
        if (metadata.type !== "export_investment") {
            return { success: false, error: "Invalid payment type" };
        }

        const userId = metadata.userId;
        const exportId = metadata.exportId;
        const amount = metadata.amount;

        if (userId !== session.user.id) return { success: false, error: "User mismatch" };

        // Check already processed
        const processedRef = db.collection("processedPayments").doc(reference);
        const processedDoc = await processedRef.get();
        if (processedDoc.exists) return { success: false, error: "Payment already processed" };

        await db.runTransaction(async (t) => {
            // 1. Create Investment Record (Slot)
            const slotRef = db.collection(COLLECTIONS.EXPORT_SLOTS).doc();
            t.set(slotRef, {
                userId,
                exportId,
                amount,
                status: "active",
                paymentReference: reference,
                purchaseDate: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                roi: "15-20%", // Should fetch from window
                expectedReturn: amount * 1.20, // Simplified logic
            });

            // 2. Update Export Window Stats
            const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
            t.update(exportRef, {
                spotsFilled: FieldValue.increment(1),
                fundedAmount: FieldValue.increment(amount),
                updatedAt: FieldValue.serverTimestamp()
            });

            // 3. Mark Payment Processed
            t.set(processedRef, {
                reference,
                type: "export_investment",
                userId,
                exportId,
                amount,
                processedAt: FieldValue.serverTimestamp()
            });

            // 4. Create Audit Log (Manual since inside transaction we need to be careful with side effects, 
            // but audit log helper is outside tx usually. Let's do it after.)
        });

        await createAdminAuditLog({
            action: "export_investment",
            userId,
            targetId: exportId,
            targetType: "export_window",
            metadata: { amount, reference }
        });

        revalidatePath("/dashboard/export");
        revalidatePath(`/export/windows/${exportId}`);

        return { success: true };

    } catch (error: any) {
        logger.error("Verify export investment error:", error);
        return { success: false, error: "Failed to verify investment" };
    }
}

// ============================================
// Get My Investments (Revised for Investors)
// ============================================

export async function getMyExportInvestmentsAction() {
    try {
        const session = await auth();
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        const snapshot = await db.collection(COLLECTIONS.EXPORT_SLOTS)
            .where("userId", "==", session.user.id)
            .orderBy("createdAt", "desc")
            .get();

        const investments = await Promise.all(snapshot.docs.map(async (doc) => {
            const data = doc.data();
            // Fetch window details for display
            const windowDoc = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(data.exportId).get();
            const windowData = windowDoc.data();

            return {
                id: doc.id,
                ...data,
                windowTitle: windowData?.title || windowData?.commodity || "Export Investment",
                createdAt: data.createdAt?.toDate(),
            };
        }));

        return { success: true, data: investments };
    } catch (error) {
        logger.error("Get my investments error:", error);
        return { success: false, error: "Failed to fetch investments" };
    }
}

/**
 * Extend Escrow Period (Admin Only)
 * Used when shipping delays or disputes occur
 */
export async function extendEscrowAction(
    exportId: string,
    days: number,
    reason: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        // Check admin role
        if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        const exportDoc = await exportRef.get();

        if (!exportDoc.exists) {
            return { success: false, error: "Export window not found" };
        }

        const currentReleaseDate = exportDoc.data()?.escrowReleaseDate?.toDate() || new Date();
        const newReleaseDate = new Date(currentReleaseDate);
        newReleaseDate.setDate(newReleaseDate.getDate() + days);

        await exportRef.update({
            escrowReleaseDate: newReleaseDate,
            updatedAt: FieldValue.serverTimestamp(),
            // We might want to track extensions in a subcollection or array, but for now just audit log
        });

        // 📜 Audit Log
        const { logAuditAction } = await import("@/lib/audit");
        await logAuditAction({
            userId: session.user.id,
            action: "EXTEND_ESCROW",
            details: `Extended escrow for ${exportId} by ${days} days. Reason: ${reason}`,
            metadata: { exportId, days, reason, oldDate: currentReleaseDate, newDate: newReleaseDate }
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Extend escrow error:", error);
        return { success: false, error: error.message };
    }
}
