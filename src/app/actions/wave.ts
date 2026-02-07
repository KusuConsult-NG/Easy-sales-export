"use server";

import { doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAuditLog } from "@/lib/audit-log";

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
    uploadedAt: Timestamp;
    uploadedBy: string;
    downloads: number;
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

/**
 * Check if user is eligible for WAVE (female only)
 */
export async function checkWaveEligibilityAction(userId: string): Promise<{
    eligible: boolean;
    reason?: string;
}> {
    try {
        const userRef = doc(db, COLLECTIONS.USERS, userId);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            return { eligible: false, reason: "User not found" };
        }

        const userData = userDoc.data();

        if (userData.gender !== "female") {
            return {
                eligible: false,
                reason: "WAVE program is exclusively for women entrepreneurs"
            };
        }

        return { eligible: true };
    } catch (error) {
        console.error("WAVE eligibility check error:", error);
        return { eligible: false, reason: "Failed to check eligibility" };
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
        const eligibility = await checkWaveEligibilityAction(userId);

        if (!eligibility.eligible) {
            return { success: false, error: eligibility.reason };
        }

        await setDoc(
            doc(db, "wave_members", userId),
            {
                enrolledAt: Timestamp.now(),
                active: true,
            },
            { merge: true }
        );

        await createAuditLog({
            action: "user_update",
            userId,
            targetType: "wave_enrollment",
        });

        return { success: true };
    } catch (error) {
        console.error("WAVE enrollment error:", error);
        return { success: false, error: "Failed to enroll in WAVE program" };
    }
}

/**
 * Get WAVE resources
 */
export async function getWaveResourcesAction(category?: string): Promise<WaveResource[]> {
    try {
        let q = query(collection(db, "wave_resources"));

        if (category) {
            q = query(q, where("category", "==", category));
        }

        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as WaveResource[];
    } catch (error) {
        console.error("Failed to fetch WAVE resources:", error);
        return [];
    }
}

/**
 * Get upcoming WAVE training events
 */
export async function getWaveTrainingEventsAction(): Promise<WaveTrainingEvent[]> {
    try {
        const q = query(
            collection(db, "wave_training_events"),
            where("status", "in", ["upcoming", "ongoing"])
        );

        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as WaveTrainingEvent[];
    } catch (error) {
        console.error("Get training events error:", error);
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
        const shipmentsQuery = query(
            collection(db, "wave_shipments"),
            where("memberId", "==", userId)
        );

        const snapshot = await getDocs(shipmentsQuery);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ShipmentTracking[];
    } catch (error) {
        console.error("Get shipment tracking error:", error);
        return [];
    }
}

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
        const shipmentRef = doc(db, "wave_shipments", shipmentId);
        const shipmentDoc = await getDoc(shipmentRef);

        if (!shipmentDoc.exists()) {
            return { success: false, error: "Shipment not found" };
        }

        const shipmentData = shipmentDoc.data() as ShipmentTracking;

        const newUpdate = {
            timestamp: new Date(),
            location,
            status,
            note,
        };

        await setDoc(
            shipmentRef,
            {
                status,
                updates: [...(shipmentData.updates || []), newUpdate],
                ...(status === "delivered" && { actualDelivery: Timestamp.now() }),
            },
            { merge: true }
        );

        return { success: true };
    } catch (error: any) {
        console.error("Update shipment error:", error);
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
        const salesQuery = query(
            collection(db, "marketplace_orders"),
            where("sellerId", "==", userId)
        );

        const snapshot = await getDocs(salesQuery);
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
                date: order.createdAt?.toDate() || new Date(),
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
        console.error("Calculate earnings error:", error);
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
        const userRef = doc(db, COLLECTIONS.USERS, userId);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            return { success: false, error: "User not found" };
        }

        const userData = userDoc.data();
        const certNumber = `WAVE-${new Date().getFullYear()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const certId = `cert_${userId}_${Date.now()}`;

        const certificate: WaveCertificate = {
            id: certId,
            memberId: userId,
            memberName: userData.name || "Member",
            certificateType,
            programName,
            issuedDate: new Date(),
            certificateNumber: certNumber,
            verificationUrl: `/wave/verify-certificate/${certNumber}`,
        };

        await setDoc(doc(db, "wave_certificates", certId), certificate);

        await createAuditLog({
            action: "user_update",
            userId,
            targetId: certId,
            targetType: "wave_certificate",
        });

        return { success: true, certificate };
    } catch (error: any) {
        console.error("Generate certificate error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get member certificates
 */
export async function getMemberCertificatesAction(userId: string): Promise<WaveCertificate[]> {
    try {
        const certsQuery = query(
            collection(db, "wave_certificates"),
            where("memberId", "==", userId)
        );

        const snapshot = await getDocs(certsQuery);
        return snapshot.docs.map(doc => doc.data()) as WaveCertificate[];
    } catch (error) {
        console.error("Get certificates error:", error);
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
        const resourceId = `resource_${Date.now()}`;
        const resourceData: WaveResource = {
            ...resource,
            id: resourceId,
            uploadedAt: Timestamp.now(),
            downloads: 0,
        };

        await setDoc(doc(db, "wave_resources", resourceId), resourceData);

        return { success: true, resourceId };
    } catch (error: any) {
        console.error("Upload resource error:", error);
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
        const resourceRef = doc(db, "wave_resources", resourceId);
        const resourceDoc = await getDoc(resourceRef);

        if (!resourceDoc.exists()) {
            return { success: false, error: "Resource not found" };
        }

        const currentDownloads = (resourceDoc.data() as WaveResource).downloads || 0;

        await setDoc(
            resourceRef,
            { downloads: currentDownloads + 1 },
            { merge: true }
        );

        return { success: true };
    } catch (error: any) {
        console.error("Increment download error:", error);
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
        const eventRef = doc(db, "wave_training_events", eventId);
        const eventDoc = await getDoc(eventRef);

        if (!eventDoc.exists()) {
            return { success: false, error: "Event not found" };
        }

        const event = eventDoc.data() as WaveTrainingEvent;

        if (event.currentParticipants >= event.maxParticipants) {
            return { success: false, error: "Event is full" };
        }

        await addDoc(collection(db, "wave_training_registrations"), {
            userId,
            eventId,
            registeredAt: Timestamp.now(),
            attended: false,
        });

        await createAuditLog({
            action: "user_update",
            userId,
            targetId: eventId,
            targetType: "training_registration",
        });

        return { success: true };
    } catch (error) {
        console.error("Training registration error:", error);
        return { success: false, error: "Failed to register for training" };
    }
}
