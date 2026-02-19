"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { auth } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/types/firestore";
import { z } from "zod";

/**
 * WAVE (Women in Agribusiness Ventures & Exports) Actions
 * Female-only enforcement and resource management
 */

export interface WaveResource {
    id?: string;
    title: string;
    description: string;
    category: "document" | "video" | "template" | "guide";
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    uploadedAt: FieldValue | Timestamp;
    uploadedBy: string;
    uploadedByName: string;
    downloads: number;
    tags?: string[];
    isActive: boolean;
}

export interface WaveTrainingEvent {
    id?: string;
    title: string;
    description: string;
    instructor: string;
    date: Date;
    duration: string;
    maxParticipants: number;
    currentParticipants: number;
    meetingLink?: string;
    status: "upcoming" | "ongoing" | "completed" | "cancelled";
    createdAt: Timestamp;
}

// Validation Schema for WAVE Application (OFFICIAL BENEFICIARY APPLICATION FORM)
const waveApplicationSchema = z.object({
    // SECTION A: Personal Identification
    surname: z.string().min(2, "Surname is required"),
    firstName: z.string().min(2, "First name is required"),
    otherNames: z.string().optional(),
    dateOfBirth: z.string(),
    age: z.number().min(18).max(100),
    phone: z.string().min(10, "Invalid phone number"),
    alternativePhone: z.string().optional(),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
    residentialAddress: z.string().min(5, "Residential address is required"),
    stateOfOrigin: z.string().min(2, "State of origin is required"),
    lgaOfOrigin: z.string().min(2, "LGA of origin is required"),
    stateOfResidence: z.string().min(2, "State of residence is required"),
    lgaOfResidence: z.string().min(2, "LGA of residence is required"),
    maritalStatus: z.enum(["single", "married", "widowed", "divorced", ""]),
    nextOfKinName: z.string().min(2, "Next of kin name is required"),
    nextOfKinPhone: z.string().min(10, "Next of kin phone is required"),
    nextOfKinRelationship: z.string().min(2, "Relationship is required"),

    // SECTION B: National Identity & Civic Status
    nin: z.string().min(11, "Valid NIN is required"),
    votersCardNumber: z.string().min(5, "Voter's card number is required"),
    pollingUnit: z.string().min(2, "Polling unit is required"),
    ward: z.string().min(2, "Ward is required"),
    yearOfVoterRegistration: z.string().min(4, "Year of registration is required"),
    votedInLastElection: z.boolean(),

    // SECTION C: Socio-Economic Profile
    highestEducation: z.enum(["none", "primary", "secondary", "tertiary", "vocational", ""]),
    currentOccupation: z.string().min(2, "Current occupation is required"),
    averageMonthlyIncome: z.enum(["below_50k", "50k_100k", "100k_250k", "above_250k", ""]),
    involvedInAgriculture: z.boolean(),
    agricultureTypes: z.array(z.enum(["farming", "processing", "trading", "export", "logistics"])).optional(),

    // SECTION D: Agricultural Interest & Value Chain
    valueChainAreas: z.array(z.enum(["crop_production", "livestock", "processing_packaging", "aggregation_trading", "export_market"])),
    preferredCommodities: z.array(z.enum(["rice", "maize", "sesame", "soybeans", "ginger", "cassava", "vegetables", "other"])),
    preferredCommodityOther: z.string().optional(),
    hasAccessToFarmland: z.boolean(),
    farmlandHectares: z.number().optional(),
    needsFarmlandAccess: z.boolean().optional(),

    // SECTION E: Financial & Cooperative Details
    hasBankAccount: z.boolean(),
    bankName: z.string().optional(),
    accountNumber: z.string().optional(),
    bvn: z.string().optional(),
    isMemberOfCooperative: z.boolean(),
    cooperativeName: z.string().optional(),
    willingToJoinCooperative: z.boolean(),

    // SECTION F: Training, Support & Commitment
    supportNeeded: z.array(z.enum(["training", "inputs", "mechanization", "finance", "market_access"])),
    willingToUndergoTraining: z.boolean(),
    willingToComplyWithStandards: z.boolean(),
    willingToParticipateInME: z.boolean(),

    // SECTION G: Declaration & Consent
    declarationAccepted: z.boolean(),
    consentGiven: z.boolean(),
});

/**
 * Check WAVE application status for current user
 */
export async function checkWaveStatusAction(): Promise<string | null> {
    try {
        const session = await auth();
        if (!session?.user) return null;

        // Check user document for service registration
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        const registration = userData?.serviceRegistrations?.wave;

        if (registration?.status) {
            return registration.status;
        }

        return null;
    } catch (error) {
        logger.error("Check WAVE status error:", error);
        return null;
    }
}

/**
 * Check if user is eligible for WAVE (female only)
 */
export async function checkWaveEligibilityAction(userId: string): Promise<{
    eligible: boolean;
    reason?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { eligible: false, reason: "Unauthorized" };
        }

        // Allow checking own eligibility or admin checking others
        if (session.user.id !== userId && !session.user.roles?.includes("admin")) {
            return { eligible: false, reason: "Unauthorized" };
        }

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

        if (!userDoc.exists) {
            return { eligible: false, reason: "User not found" };
        }

        const userData = userDoc.data();

        // 🔒 SECURITY FIX: Strict Gender Enforcement
        // Verify gender is female AND ensure the user role is consistent if set.
        if (userData?.gender !== "female") {
            // Edge case: If they SOMEHOW have the role but are not female, this is a data integrity violation.
            if (userData?.roles?.includes("wave_participant")) {
                logger.error(`WAVE Eligibility Violation: User ${userId} has 'wave_participant' role but gender is '${userData?.gender}'`);
            }
            return {
                eligible: false,
                reason: "WAVE program is exclusively for women entrepreneurs"
            };
        }

        // Double check: If they are female but somehow missed the role, we should probably allow them (as long as gender is correct)
        // But let's stick to the gender field as the source of truth for eligibility.

        return { eligible: true };
    } catch (error) {
        logger.error("WAVE eligibility check error:", error);
        return { eligible: false, reason: "Failed to check eligibility" };
    }
}

/**
 * Submit multi-step WAVE application
 * Accepts object data from multi-step form (not FormData)
 */
export async function submitMultiStepWaveApplicationAction(applicationData: z.infer<typeof waveApplicationSchema>): Promise<{ success: boolean; error?: string; applicationId?: string }> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "You must be logged in to apply" };
        }

        // Validate with Zod
        const validation = waveApplicationSchema.safeParse(applicationData);
        if (!validation.success) {
            return {
                success: false,
                error: validation.error.issues[0]?.message || "Validation failed"
            };
        }

        const validatedData = validation.data;

        // 🔒 AGE INTEGRITY CHECK: Calculate age from DOB
        const dob = new Date(validatedData.dateOfBirth);
        const today = new Date();
        let calculatedAge = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
            calculatedAge--;
        }

        // 1. Verify calculated age matches declared age (within reasonable margin of 1 year for birthday edge cases)
        // or just enforce the 18+ rule strictly on the DOB.
        if (calculatedAge < 18) {
            return {
                success: false,
                error: `You must be at least 18 years old to apply. (Calculated age based on DOB: ${calculatedAge})`
            };
        }

        // 2. Prevent "Age Paradox" (Declared 25, DOB indicates 15)
        if (Math.abs(calculatedAge - validatedData.age) > 1) {
            return {
                success: false,
                error: `Date of Birth does not match the declared age (${validatedData.age}). Please check your inputs.`
            };
        }

        // 🔒 LOGIC FIX: Prevent Duplicate Applications
        // 🔒 LOGIC FIX: Prevent Duplicate Applications
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.wave?.status;

        if (existingStatus === 'pending') {
            // IDEMPOTENCY CHECK: If already pending, treat as success (likely double-submission)
            // This prevents the "You already have a pending application" error when users double-click
            // or when network latency causes retries.
            return {
                success: true,
                applicationId: userDoc.data()?.serviceRegistrations?.wave?.applicationId
            };
        }
        if (existingStatus === 'approved') {
            return {
                success: false,
                error: "You are already enrolled in the WAVE program."
            };
        }

        // Generate application ID
        const applicationId = `WAVE-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        // Save to Firestore
        await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId).set({
            ...validatedData,
            age: calculatedAge, // Enforce truth: Save calculated age, not user input
            userId: session.user.id,
            userEmail: session.user.email || validatedData.email,
            status: "pending", // pending | approved | rejected
            applicationDate: FieldValue.serverTimestamp(),
            reviewedAt: null,
            reviewedBy: null,
            rejectionReason: null,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // CRITICAL: Update user.serviceRegistrations using dot notation to prevent cross-module data loss
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            "serviceRegistrations.wave.status": "pending",
            "serviceRegistrations.wave.applicationId": applicationId,
            "serviceRegistrations.wave.submittedAt": FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Audit log
        await createAdminAuditLog({
            action: "user_update",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "wave_application",
            metadata: {
                surname: validatedData.surname,
                firstName: validatedData.firstName,
                stateOfResidence: validatedData.stateOfResidence,
                ageVerification: `Verified 18+ (Auto-calculated: ${calculatedAge})`
            },
        });

        return {
            success: true,
            applicationId,
        };
    } catch (error: any) {
        logger.error("WAVE application submission error:", error);
        return {
            success: false,
            error: "Failed to submit application. Please try again."
        };
    }
}

/**
 * Enroll user in WAVE program
 */
export async function enrollInWaveAction(userId: string): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "Unauthorized" };
        }

        if (session.user.id !== userId) {
            return { success: false, error: "Cannot enroll on behalf of another user" };
        }

        const eligibility = await checkWaveEligibilityAction(userId);

        if (!eligibility.eligible) {
            return { success: false, error: eligibility.reason };
        }

        await db.collection("wave_members").doc(userId).set({
            enrolledAt: FieldValue.serverTimestamp(),
            active: true,
        }, { merge: true });

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetType: "wave_enrollment",
        });

        return { success: true };
    } catch (error) {
        logger.error("WAVE enrollment error:", error);
        return { success: false, error: "Failed to enroll in WAVE program" };
    }
}

/**
 * Get WAVE resources
 */
export async function getWaveResourcesAction(category?: string): Promise<WaveResource[]> {
    try {
        const session = await auth();
        if (!session?.user) return [];

        // STRICT ENROLLMENT CHECK
        const memberDoc = await db.collection("wave_members").doc(session.user.id).get();
        if (!memberDoc.exists || !memberDoc.data()?.active) {
            // Check if admin, otherwise deny
            if (!session.user.roles?.includes("admin")) {
                logger.warn(`Unauthorized WAVE resource access attempt by ${session.user.id}`);
                return [];
            }
        }

        let q = db.collection("wave_resources");
        let queryRef;

        if (category) {
            queryRef = q.where("category", "==", category);
        } else {
            queryRef = q;
        }

        const snapshot = await queryRef.get();

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as WaveResource[];
    } catch (error) {
        logger.error("Failed to fetch WAVE resources:", error);
        return [];
    }
}

/**
 * Get upcoming WAVE training events
 */
export async function getWaveTrainingEventsAction(): Promise<WaveTrainingEvent[]> {
    try {
        const session = await auth();
        if (!session?.user) return [];

        // Optional: Check enrollment here too if trainings are exclusive
        // For now, allowing visibility but restricting registration

        const snapshot = await db.collection("wave_training_events")
            .where("status", "in", ["upcoming", "ongoing"])
            .get();

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...(doc.data() as any),
            // Handle date conversion if needed, Firestore timestamps need .toDate()
            date: doc.data().date?.toDate ? doc.data().date.toDate() : doc.data().date
        })) as WaveTrainingEvent[];
    } catch (error) {
        logger.error("Get training events error:", error);
        return [];
    }
}

// ============================================================================
// SHIPMENT TRACKING
// ============================================================================

export interface ShipmentTracking {
    id: string;
    memberId: string;
    orderId: string;
    productName: string;
    destination: string;
    carrier: string;
    trackingNumber: string;
    status: "pending" | "in_transit" | "delivered" | "cancelled";
    estimatedDelivery: Date;
    actualDelivery?: Date;
    updates: {
        timestamp: Date;
        location: string;
        status: string;
        note?: string;
    }[];
    createdAt: Timestamp;
}

/**
 * Get user's shipment tracking info
 */
export async function getShipmentTrackingAction(userId: string): Promise<ShipmentTracking[]> {
    try {
        const session = await auth();
        if (!session?.user) return [];

        // Users can only see their own shipments
        if (session.user.id !== userId) return [];

        const snapshot = await db.collection("wave_shipments")
            .where("memberId", "==", userId)
            .get();

        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ShipmentTracking[];
    } catch (error) {
        logger.error("Get shipment tracking error:", error);
        return [];
    }
}

/**
 * Update shipment status (admin only)
 */
import { getLogisticsProvider } from "@/lib/logistics";

// ... existing code ...

/**
 * Update shipment status (admin only)
 */
export async function updateShipmentStatusAction(
    shipmentId: string,
    status: ShipmentTracking["status"],
    location: string,
    note?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "Unauthorized" };
        }

        // Check admin role
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Admin access required" };
        }

        const shipmentRef = db.collection("wave_shipments").doc(shipmentId);
        const shipmentDoc = await shipmentRef.get();

        if (!shipmentDoc.exists) {
            return { success: false, error: "Shipment not found" };
        }

        const shipmentData = shipmentDoc.data() as ShipmentTracking;

        const newUpdate = {
            timestamp: new Date(),
            location,
            status,
            note,
        };

        const updateData: any = {
            status,
            updates: [...(shipmentData.updates || []), newUpdate],
        };

        if (status === "delivered") {
            updateData.actualDelivery = FieldValue.serverTimestamp();
        }

        await shipmentRef.update(updateData);

        return { success: true };
    } catch (error: any) {
        logger.error("Update shipment error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Sync shipment with carrier (Admin or Automator)
 * This fetches real-time updates from the Logistics Provider (GIG/Kwik)
 */
export async function syncShipmentWithCarrierAction(shipmentId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const shipmentRef = db.collection("wave_shipments").doc(shipmentId);
        const shipmentDoc = await shipmentRef.get();

        if (!shipmentDoc.exists) {
            return { success: false, error: "Shipment not found" };
        }

        const shipmentData = shipmentDoc.data() as ShipmentTracking;

        if (!shipmentData.trackingNumber) {
            return { success: false, error: "No tracking number explicitly linked" };
        }

        const provider = getLogisticsProvider();
        const updates = await provider.trackShipment(shipmentData.trackingNumber);

        // Merge updates? Or just append new ones? 
        // For simplicity, we just take the latest status from the provider
        if (updates.length > 0) {
            const latest = updates[updates.length - 1];

            await shipmentRef.update({
                status: latest.status,
                updates: updates, // Overwrite with authoritative history from carrier
                lastSyncedAt: FieldValue.serverTimestamp()
            });

            return { success: true };
        }

        return { success: true }; // No updates found
    } catch (error: any) {
        logger.error("Sync shipment error:", error);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// EARNINGS CALCULATION
// ============================================================================

export interface MemberEarnings {
    memberId: string;
    totalSales: number;
    totalEarnings: number;
    commissionRate: number;
    pendingAmount: number;
    paidAmount: number;
    transactions: {
        date: Date;
        orderId: string;
        saleAmount: number;
        commission: number;
        status: "pending" | "paid";
    }[];
}

/**
 * Calculate member earnings from sales
 */
export async function calculateEarningsAction(userId: string): Promise<MemberEarnings> {
    try {
        const session = await auth();
        if (!session?.user) {
            throw new Error("Unauthorized");
        }

        if (session.user.id !== userId && !session.user.roles?.includes("admin")) {
            throw new Error("Unauthorized");
        }

        const snapshot = await db.collection("marketplace_orders")
            .where("sellerId", "==", userId)
            .get();

        const commissionRate = 0.05; // 5% commission

        let totalSales = 0;
        let totalEarnings = 0;
        let pendingAmount = 0;
        let paidAmount = 0;
        const transactions: MemberEarnings["transactions"] = [];

        snapshot.docs.forEach(doc => {
            const order = doc.data();
            const saleAmount = order.totalAmount || 0;
            const commission = saleAmount * commissionRate;
            const isPaid = order.paymentStatus === "paid";

            totalSales += saleAmount;
            totalEarnings += commission;

            if (isPaid) {
                paidAmount += commission;
            } else {
                pendingAmount += commission;
            }

            transactions.push({
                date: order.createdAt?.toDate ? order.createdAt.toDate() : new Date(),
                orderId: doc.id,
                saleAmount,
                commission,
                status: isPaid ? "paid" : "pending",
            });
        });

        return {
            memberId: userId,
            totalSales,
            totalEarnings,
            commissionRate,
            pendingAmount,
            paidAmount,
            transactions: transactions.sort((a, b) => b.date.getTime() - a.date.getTime()),
        };
    } catch (error) {
        logger.error("Calculate earnings error:", error);
        return {
            memberId: userId,
            totalSales: 0,
            totalEarnings: 0,
            commissionRate: 0.05,
            pendingAmount: 0,
            paidAmount: 0,
            transactions: [],
        };
    }
}

// ============================================================================
// CERTIFICATE GENERATION
// ============================================================================

export interface WaveCertificate {
    id: string;
    memberId: string;
    memberName: string;
    certificateType: "training" | "achievement" | "completion";
    programName: string;
    issuedDate: Date;
    certificateNumber: string;
    verificationUrl: string;
}

/**
 * Generate certificate for member
 */
export async function generateCertificateAction(
    userId: string,
    programName: string,
    certificateType: WaveCertificate["certificateType"]
): Promise<{ success: boolean; certificate?: WaveCertificate; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "Unauthorized" };
        }

        // Check admin role
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Admin access required" };
        }

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

        if (!userDoc.exists) {
            return { success: false, error: "User not found" };
        }

        const userData = userDoc.data();
        const certNumber = `WAVE-${new Date().getFullYear()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const certId = `cert_${userId}_${Date.now()}`;

        // Ensure date is valid for storage
        const issuedDate = new Date();

        const certificate: WaveCertificate = {
            id: certId,
            memberId: userId,
            memberName: userData?.name || "Member",
            certificateType,
            programName,
            issuedDate,
            certificateNumber: certNumber,
            verificationUrl: `/wave/verify-certificate/${certNumber}`,
        };

        await db.collection("wave_certificates").doc(certId).set(certificate);

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: certId,
            targetType: "wave_certificate",
        });

        return { success: true, certificate };
    } catch (error: any) {
        logger.error("Generate certificate error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get member certificates
 */
export async function getMemberCertificatesAction(userId: string): Promise<WaveCertificate[]> {
    try {
        const session = await auth();
        if (!session?.user) return [];

        // Allow reading own certificates
        if (session.user.id !== userId) return [];

        const snapshot = await db.collection("wave_certificates")
            .where("memberId", "==", userId)
            .get();

        return snapshot.docs.map(doc => doc.data()) as WaveCertificate[];
    } catch (error) {
        logger.error("Get certificates error:", error);
        return [];
    }
}

/**
 * Get current user's certificates (auth handled internally)
 */
export async function getCurrentUserCertificatesAction(): Promise<WaveCertificate[]> {
    try {
        const session = await auth();
        if (!session?.user?.id) return [];

        return await getMemberCertificatesAction(session.user.id);
    } catch (error) {
        logger.error("Get current user certificates error:", error);
        return [];
    }
}

// ============================================================================
// RESOURCE MANAGEMENT
// ============================================================================

/**
 * Upload resource (admin only)
 */
export async function uploadWaveResourceAction(
    resource: Omit<WaveResource, "id" | "uploadedAt" | "downloads">
): Promise<{ success: boolean; resourceId?: string; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "Unauthorized" };
        }

        // Check admin role
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Admin access required" };
        }

        const resourceId = `resource_${Date.now()}`;
        const resourceData: WaveResource = {
            ...resource,
            id: resourceId,
            uploadedAt: FieldValue.serverTimestamp(),
            downloads: 0,
        };

        await db.collection("wave_resources").doc(resourceId).set(resourceData);

        return { success: true, resourceId };
    } catch (error: any) {
        logger.error("Upload resource error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Increment resource download count
 */
export async function incrementResourceDownloadAction(
    resourceId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "Unauthorized" };
        }

        const resourceRef = db.collection("wave_resources").doc(resourceId);

        await resourceRef.update({
            downloads: FieldValue.increment(1)
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Increment download error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Register for training event
 */
export async function registerForTrainingAction(
    userId: string,
    eventId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "Unauthorized" };
        }

        if (session.user.id !== userId) {
            return { success: false, error: "Cannot register for another user" };
        }

        const eventRef = db.collection("wave_training_events").doc(eventId);

        await db.runTransaction(async (transaction) => {
            const eventDoc = await transaction.get(eventRef);
            if (!eventDoc.exists) {
                throw new Error("Event not found");
            }

            const event = eventDoc.data() as WaveTrainingEvent;

            if (event.currentParticipants >= event.maxParticipants) {
                throw new Error("Event is full");
            }

            // Create registration
            const registrationRef = db.collection("wave_training_registrations").doc();
            transaction.set(registrationRef, {
                userId,
                eventId,
                registeredAt: FieldValue.serverTimestamp(),
                attended: false,
            });

            // Update participant count
            transaction.update(eventRef, {
                currentParticipants: FieldValue.increment(1)
            });
        });

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: eventId,
            targetType: "training_registration",
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Training registration error:", error);
        return { success: false, error: error.message || "Failed to register for training" };
    }
}
