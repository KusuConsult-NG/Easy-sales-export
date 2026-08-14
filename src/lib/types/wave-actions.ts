/**
 * WAVE types as the SERVER ACTIONS use them.
 *
 * These five were declared inside wave/_actions.ts and referred to across it,
 * so splitting that 1,903-line file by domain would have left them in whichever
 * piece happened to keep them.
 *
 * WHY THIS IS NOT src/lib/types/wave.ts
 * -------------------------------------
 * That file already exists and already declares WaveResource and
 * WaveCertificate — under the same names, with different shapes:
 *
 *                     types/wave.ts          here (from _actions.ts)
 *     category        string                 "document" | "video" | "template" | "guide"
 *     downloads       downloadCount?: number downloads: number
 *     uploadedAt      Date                   FieldValue | Timestamp
 *     fileName        absent                 required
 *     uploadedByName  absent                 required
 *
 * One describes a resource as a caller receives it, the other as it is written
 * to and read from the database, where a timestamp may still be a sentinel and
 * the category is constrained to what the upload form offers.
 *
 * Reconciling them is a real change — the union would start rejecting stored
 * categories outside it, and `downloads` and `downloadCount` are two names for
 * one number — and it is not something to do while moving code. The same
 * duplication exists between types/academy.ts and types/academy-actions.ts and
 * is recorded there for the same reason (#205).
 *
 * A plain module, not one under src/app/actions: everything there must carry
 * "use server" and a session guard, which a file of interfaces cannot honestly
 * do.
 */

import type { FieldValue, Timestamp } from "@/lib/firestore-compat";

/**
 * WAVE (Women in Agribusiness Ventures & Exports) Actions
 * Female-only enforcement and resource management
 */

export interface WaveResource { id?: string;
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
    isActive: boolean; }


export interface WaveTrainingEvent { id?: string;
    title: string;
    description: string;
    instructor: string;
    date: FieldValue | Timestamp | Date | string;
    duration: string;
    maxParticipants: number;
    currentParticipants: number;
    meetingLink?: string;
    status: "upcoming" | "ongoing" | "completed" | "cancelled";
    videoUrl?: string;
    createdAt: FieldValue | Timestamp | Date | string; }


// ============================================================================
// SHIPMENT TRACKING
// ============================================================================

export interface ShipmentTracking { id: string;
    memberId: string;
    memberName?: string;
    memberEmail?: string;
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


// ============================================================================
// EARNINGS CALCULATION
// ============================================================================

export interface MemberEarnings { memberId: string;
    totalSales: number;
    totalEarnings: number;
    commissionRate: number;
    pendingAmount: number;
    paidAmount: number;
    totalWithdrawn?: number;
    transactions: {
        date: Date;
        orderId: string;
        saleAmount: number;
        commission: number;
        status: "pending" | "paid";
    }[];
}


// ============================================================================
// CERTIFICATE GENERATION
// ============================================================================

export interface WaveCertificate { id: string;
    memberId: string;
    memberName: string;
    certificateType: "training" | "achievement" | "completion";
    programName: string;
    issuedDate: Date;
    certificateNumber: string;
    verificationUrl: string; }
