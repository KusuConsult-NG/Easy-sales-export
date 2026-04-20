"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { z } from "zod";
import { strictNameSchema, strictEmailSchema, strictPhoneSchema } from "@/lib/schemas";
import { Resend } from "resend";
import { serializeDocs } from "@/lib/firestore-serialize";

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
    surname: strictNameSchema,
    firstName: strictNameSchema,
    otherNames: strictNameSchema.optional().or(z.literal("")),
    dateOfBirth: z.string(),
    age: z.number().min(18).max(100),
    phone: strictPhoneSchema,
    alternativePhone: strictPhoneSchema.optional().or(z.literal("")),
    email: strictEmailSchema.optional().or(z.literal("")),
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
    votersCardNumber: z.string().optional().or(z.literal("")),
    pollingUnit: z.string().optional(),
    ward: z.string().optional(),
    yearOfVoterRegistration: z.string().optional(),
    votedInLastElection: z.boolean().optional(),

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
    hasBankAccount: z.boolean().optional(),
    bankName: z.string().min(2, "Bank name is required"),
    accountNumber: z.string().min(10, "Valid 10-digit account number required"),
    bvn: z.string().min(11, "BVN is required (11 digits)"),
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
export async function checkWaveStatusAction(): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: "Unauthorized" };

        // ── PRIMARY: Check central user document for service registration ──
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        const registration = userData?.serviceRegistrations?.wave;

        if (registration?.status) {
            return { success: true, data: registration.status };
        }

        // ── FALLBACK: Returning student whose data predates V2 schema ──────
        const legacySnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
            .where('userId', '==', session.user.id)
            .limit(1)
            .get();

        if (!legacySnap.empty) {
            const legacyData = legacySnap.docs[0].data();
            const legacyStatus = legacyData?.status ?? 'pending';

            await db.collection(COLLECTIONS.USERS).doc(session.user.id).set(
                { serviceRegistrations: { wave: { status: legacyStatus, syncedFromLegacy: true, syncedAt: new Date().toISOString() } } },
                { merge: true }
            );

            logger.info(`[checkWaveStatus] Backfilled legacy wave status '${legacyStatus}' for user ${session.user.id}`);
            return { success: true, data: legacyStatus };
        }

        return { success: true, data: null };
    } catch (error) {
        logger.error("Check WAVE status error:", error);
        return { success: false, error: "Failed to check status" };
    }
}

/**
 * Check if user is eligible for WAVE (female only)
 */
export async function checkWaveEligibilityAction(userId: string): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        // Allow checking own eligibility or admin checking others
        if (session.user.id !== userId && (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

        if (!userDoc.exists) {
            return { success: true, data: { eligible: false, reason: "User not found" } };
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
                success: true,
                data: {
                    eligible: false,
                    reason: "WAVE program is exclusively for women entrepreneurs"
                }
            };
        }

        // Double check: If they are female but somehow missed the role, we should probably allow them (as long as gender is correct)
        // But let's stick to the gender field as the source of truth for eligibility.

        return { success: true, data: { eligible: true } };
    } catch (error) {
        logger.error("WAVE eligibility check error:", error);
        return { success: false, error: "Failed to check eligibility" };
    }
}

/**
 * Submit multi-step WAVE application
 * Accepts object data from multi-step form (not FormData)
 */
export async function submitMultiStepWaveApplicationAction(applicationData: z.infer<typeof waveApplicationSchema>): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

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

        // 🔒 STRICT DEDUPLICATION: Check per-user status AND collection-level uniqueness
        const applicantEmail = (session.user.email || validatedData.email || '').toLowerCase().trim();
        const applicantPhone = validatedData.phone.replace(/\s+/g, '').trim();
        const applicantNin   = validatedData.nin.trim();

        const [userDoc, phoneSnap, ninSnap] = await Promise.all([
            db.collection(COLLECTIONS.USERS).doc(session.user.id).get(),
            db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("phone", "==", applicantPhone)
                .limit(1)
                .get(),
            db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("nin", "==", applicantNin)
                .limit(1)
                .get(),
        ]);

        let emailSnap = null;
        if (applicantEmail !== "") {
            emailSnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("userEmail", "==", applicantEmail)
                .limit(1)
                .get();
        }

        const existingStatus = userDoc.data()?.serviceRegistrations?.wave?.status;

        if (existingStatus === 'pending' || existingStatus === 'under_review') {
            return {
                success: false,
                error: "Your previous application is still being processed."
            };
        }
        if (existingStatus === 'approved') {
            return {
                success: false,
                error: "You are already enrolled in the WAVE program."
            };
        }

        // 🔒 Collection-level uniqueness checks (catches multi-account fraud)
        if (emailSnap && !emailSnap.empty) {
            return {
                success: false,
                error: "An application with this email address already exists in the WAVE program."
            };
        }
        if (!phoneSnap.empty) {
            return {
                success: false,
                error: "An application with this phone number already exists in the WAVE program."
            };
        }
        if (!ninSnap.empty) {
            return {
                success: false,
                error: "An application with this NIN already exists in the WAVE program."
            };
        }

        // Allow users with revision_required status to resubmit — handled below

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
            createdAt: FieldValue.serverTimestamp(),
        });

        // CRITICAL: Update user.serviceRegistrations using dot notation to prevent cross-module data loss
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            "serviceRegistrations.wave.status": "pending",
            "serviceRegistrations.wave.applicationId": applicationId,
            "serviceRegistrations.wave.submittedAt": FieldValue.serverTimestamp(),
            // Sync KYC name fields for Admin Communication Hub & admin portal
            firstName: validatedData.firstName,
            lastName: validatedData.surname,
            otherName: validatedData.otherNames || null,
            fullName: [validatedData.firstName, validatedData.otherNames, validatedData.surname]
                .filter(Boolean).join(" ").trim(),
            // Sync other PII for Communication Hub
            phone: applicantPhone,
            gender: "female", // WAVE is exclusive to females
            stateOfOrigin: validatedData.stateOfOrigin,       // ← correct: origin state
            residentialState: validatedData.stateOfResidence, // ← separate residence field
            lga: validatedData.lgaOfOrigin,
            residentialAddress: validatedData.residentialAddress,
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

        // Send email notifications (non-blocking — don't fail submission if email fails)
        try {
            const resend = new Resend(process.env.RESEND_API_KEY);
            const applicantEmail = session.user.email || validatedData.email;
            const adminEmail = process.env.ADMIN_EMAIL || 'admin@easysalesexport.com';

            const applicantName = `${validatedData.firstName} ${validatedData.surname}`;

            // Email to applicant
            if (applicantEmail) {
                const { error: applicantError } = await resend.emails.send({
                    from: 'RH-WAVE 774 <noreply@easysalesexport.com>',
                    to: applicantEmail,
                    subject: 'Your WAVE Application Has Been Received — RH-WAVE 774',
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                            <div style="background:linear-gradient(135deg,#166534,#16a34a);padding:32px;border-radius:12px;text-align:center;margin-bottom:24px;">
                                <h1 style="color:white;margin:0;font-size:24px;">RH-WAVE 774</h1>
                                <p style="color:#bbf7d0;margin:8px 0 0;">Women Agro-Value Expansion Programme</p>
                            </div>
                            <h2 style="color:#166534;">Application Received!</h2>
                            <p style="color:#374151;">Dear <strong>${applicantName}</strong>,</p>
                            <p style="color:#374151;">Thank you for applying to the <strong>RH-WAVE 774 Women Agro-Value Expansion Programme</strong>. Your application has been successfully submitted and is now under review.</p>
                            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0;">
                                <p style="margin:0;color:#166534;"><strong>Application ID:</strong> ${applicationId}</p>
                                <p style="margin:8px 0 0;color:#166534;"><strong>Status:</strong> Pending Review</p>
                            </div>
                            <p style="color:#374151;">Our team will review your application and contact you with next steps. You can also check your application status at any time by logging into your dashboard.</p>
                            <p style="color:#374151;">Thank you for being part of this national movement.
                            <br/><br/><strong style="color:#166534;">RH-WAVE 774 Team</strong><br/>Easy Sales Export Nigeria Ltd</p>
                        </div>
                    `,
                });
                if (applicantError) {
                    logger.error("Resend API Error (WAVE applicant email):", applicantError);
                }
            }

            // Email to admin
            const { error: adminError } = await resend.emails.send({
                from: 'RH-WAVE 774 System <noreply@easysalesexport.com>',
                to: adminEmail,
                subject: `New WAVE Application: ${applicantName} — ${applicationId}`,
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                        <h2 style="color:#166534;">New WAVE Application Received</h2>
                        <table style="width:100%;border-collapse:collapse;">
                            <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>Name</strong></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${applicantName}</td></tr>
                            <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>Application ID</strong></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${applicationId}</td></tr>
                            <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>Email</strong></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${applicantEmail || 'N/A'}</td></tr>
                            <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>Phone</strong></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${validatedData.phone}</td></tr>
                            <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>State</strong></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${validatedData.stateOfResidence}</td></tr>
                            <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>LGA</strong></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${validatedData.lgaOfResidence}</td></tr>
                            <tr><td style="padding:8px;"><strong>Submitted</strong></td><td style="padding:8px;">${new Date().toLocaleString('en-NG')}</td></tr>
                        </table>
                        <p style="margin-top:16px;"><a href="https://easysalesexport.com/admin/wave" style="background:#166534;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">Review in Admin Panel</a></p>
                    </div>
                `,
            });
            if (adminError) {
                logger.error("Resend API Error (WAVE admin email):", adminError);
            }
        } catch (emailError) {
            logger.error("WAVE application email notification failed (non-blocking):", emailError);
        }

        return {
            success: true,
            data: { applicationId },
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
export async function enrollInWaveAction(userId: string): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (session.user.id !== userId) {
            return { success: false, error: "Cannot enroll on behalf of another user" };
        }

        const eligibility = await checkWaveEligibilityAction(userId);

        if (!eligibility.data?.eligible) {
            return { success: false, error: eligibility.data?.reason || "Not eligible" };
        }

        await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(userId).set({
            enrolledAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
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
export async function getWaveResourcesAction(
    category?: string,
    cursor?: string | null,
    limit = 20
): Promise<{ success: boolean; data?: WaveResource[]; error?: string; meta: { cursor: string | null; hasMore: boolean } }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized", meta: { cursor: null, hasMore: false } };
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: "Unauthorized", meta: { cursor: null, hasMore: false } };

        // STRICT ENROLLMENT CHECK
        const memberDoc = await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(session.user.id).get();
        if (!memberDoc.exists || !memberDoc.data()?.active) {
            if ((!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
                logger.warn(`Unauthorized WAVE resource access attempt by ${session.user.id}`);
                return { success: false, error: "Access denied: Not enrolled in WAVE", meta: { cursor: null, hasMore: false } };
            }
        }

        const pageSize = Math.min(Math.max(limit, 1), 50);

        let queryRef: FirebaseFirestore.Query = db.collection(COLLECTIONS.WAVE_RESOURCES)
            .orderBy("createdAt", "desc")
            .limit(pageSize + 1);

        if (category) {
            queryRef = db.collection(COLLECTIONS.WAVE_RESOURCES)
                .where("category", "==", category)
                .orderBy("createdAt", "desc")
                .limit(pageSize + 1);
        }

        if (cursor) {
            const cursorDate = new Date(cursor);
            if (!isNaN(cursorDate.getTime())) {
                queryRef = queryRef.startAfter(cursorDate);
            }
        }

        const snapshot = await queryRef.get();
        const hasMore = snapshot.docs.length > pageSize;
        const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;

        const data = serializeDocs<WaveResource>(docs);
        const nextCursor = hasMore && docs.length > 0
            ? docs[docs.length - 1].data().createdAt?.toDate?.()?.toISOString() ?? null
            : null;

        return { success: true, data, meta: { cursor: nextCursor, hasMore } };
    } catch (error) {
        logger.error("Failed to fetch WAVE resources:", error);
        return { success: false, error: "Failed to fetch resources", meta: { cursor: null, hasMore: false } };
    }
}

/**
 * Get upcoming WAVE training events
 */
export async function getWaveTrainingEventsAction(
    cursor?: string | null,
    limit = 20
): Promise<{ success: boolean; data?: WaveTrainingEvent[]; error?: string; meta: { cursor: string | null; hasMore: boolean } }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized", meta: { cursor: null, hasMore: false } };
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: "Unauthorized", meta: { cursor: null, hasMore: false } };

        const pageSize = Math.min(Math.max(limit, 1), 50);

        let queryRef: FirebaseFirestore.Query = db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS)
            .where("status", "in", ["upcoming", "ongoing"])
            .orderBy("scheduledAt", "asc")
            .limit(pageSize + 1);

        if (cursor) {
            const cursorDate = new Date(cursor);
            if (!isNaN(cursorDate.getTime())) {
                queryRef = queryRef.startAfter(cursorDate);
            }
        }

        const snapshot = await queryRef.get();
        const hasMore = snapshot.docs.length > pageSize;
        const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;

        const data = serializeDocs<WaveTrainingEvent>(docs);
        const nextCursor = hasMore && docs.length > 0
            ? docs[docs.length - 1].data().scheduledAt?.toDate?.()?.toISOString() ?? null
            : null;

        return { success: true, data, meta: { cursor: nextCursor, hasMore } };
    } catch (error) {
        logger.error("Get training events error:", error);
        return { success: false, error: "Failed to fetch training events", meta: { cursor: null, hasMore: false } };
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
export async function getShipmentTrackingAction(userId: string): Promise<{ success: boolean; data?: ShipmentTracking[]; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: "Unauthorized" };

        // Users can only see their own shipments
        if (session.user.id !== userId) return { success: false, error: "Unauthorized to view other shipments" };

        const snapshot = await db.collection(COLLECTIONS.WAVE_SHIPMENTS)
            .where("memberId", "==", userId)
            .get();

        return { success: true, data: serializeDocs<ShipmentTracking>(snapshot.docs) };
    } catch (error) {
        logger.error("Get shipment tracking error:", error);
        return { success: false, error: "Failed to fetch shipment tracking" };
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
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        // Check admin role
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Admin access required" };
        }

        const shipmentRef = db.collection(COLLECTIONS.WAVE_SHIPMENTS).doc(shipmentId);
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
export async function syncShipmentWithCarrierAction(shipmentId: string): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const shipmentRef = db.collection(COLLECTIONS.WAVE_SHIPMENTS).doc(shipmentId);
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
    totalWithdrawn?: number;
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
export async function calculateEarningsAction(userId: string): Promise<{ success: boolean; data?: MemberEarnings; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (session.user.id !== userId && (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            throw new Error("Unauthorized");
        }

        const snapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
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

        // Fetch past withdrawals to subtract from paidAmount to get true available balance
        const withdrawalsSnap = await db.collection(COLLECTIONS.WAVE_WITHDRAWALS)
            .where("userId", "==", userId)
            .where("status", "in", ["pending", "approved", "completed"])
            .get();
        
        let withdrawnAmount = 0;
        withdrawalsSnap.docs.forEach(doc => {
            const w = doc.data();
            withdrawnAmount += (w.amount || 0);
        });

        const availableBalance = Math.max(0, paidAmount - withdrawnAmount);

        return { success: true, data: {
            memberId: userId,
            totalSales,
            totalEarnings,
            commissionRate,
            pendingAmount,
            paidAmount: availableBalance, // Actually available to withdraw
            totalWithdrawn: withdrawnAmount, // newly added for clarity
            transactions: transactions.sort((a: any, b: any) => b.date.getTime() - a.date.getTime()),
        } };
    } catch (error) {
        logger.error("Calculate earnings error:", error);
        return { success: false, error: "Failed to calculate earnings" };
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
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

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

        await db.collection(COLLECTIONS.WAVE_CERTIFICATES).doc(certId).set(certificate);

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: certId,
            targetType: "wave_certificate",
        });

        return { success: true, data: { certificate } };
    } catch (error: any) {
        logger.error("Generate certificate error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get member certificates
 */
export async function getMemberCertificatesAction(userId: string): Promise<{ success: boolean; data?: WaveCertificate[]; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: "Unauthorized" };

        // Allow reading own certificates
        if (session.user.id !== userId) return { success: false, error: "Unauthorized" };

        const snapshot = await db.collection(COLLECTIONS.WAVE_CERTIFICATES)
            .where("memberId", "==", userId)
            .get();

        return { success: true, data: snapshot.docs.map(doc => doc.data()) as WaveCertificate[] };
    } catch (error) {
        logger.error("Get certificates error:", error);
        return { success: false, error: "Failed to load certificates" };
    }
}

/**
 * Get current user's certificates (auth handled internally)
 */
export async function getCurrentUserCertificatesAction(): Promise<{ success: boolean; data?: WaveCertificate[]; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        return await getMemberCertificatesAction(session.user.id);
    } catch (error) {
        logger.error("Get current user certificates error:", error);
        return { success: false, error: "Failed to load certificates" };
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
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;

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

        await db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId).set(resourceData);

        return { success: true, data: { resourceId } };
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
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;

        const resourceRef = db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId);

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
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;

        if (session.user.id !== userId) {
            return { success: false, error: "Cannot register for another user" };
        }

        const eventRef = db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId);

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
            const registrationRef = db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS).doc();
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

// ============================================================================
// EARNINGS WITHDRAWAL
// ============================================================================

/**
 * Request an earnings withdrawal.
 * Creates a pending withdrawal record in Firestore for admin processing.
 */
export async function withdrawEarningsAction(
    amount: number
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        if (amount < 5000) {
            return { success: false, error: "Minimum withdrawal amount is ₦5,000" };
        }

        const userId = session.user.id;

        // Check available balance
        const earnings = await calculateEarningsAction(userId);
        if ((earnings.data?.paidAmount || 0) < amount) {
            return { success: false, error: "Insufficient available balance" };
        }

        // Block if there's already a pending withdrawal
        const existingSnap = await db.collection(COLLECTIONS.WAVE_WITHDRAWALS)
            .where("userId", "==", userId)
            .where("status", "==", "pending")
            .limit(1)
            .get();

        if (!existingSnap.empty) {
            return { success: false, error: "You have a pending withdrawal request. Please wait for it to be processed." };
        }

        const withdrawalId = `WD-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        await db.collection(COLLECTIONS.WAVE_WITHDRAWALS).doc(withdrawalId).set({
            withdrawalId,
            userId,
            userEmail: session.user.email,
            amount,
            status: "pending",
            requestedAt: FieldValue.serverTimestamp(),
            processedAt: null,
            createdAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: withdrawalId,
            targetType: "wave_withdrawal",
            metadata: { amount },
        });

        return { success: true, data: { withdrawalId } };
    } catch (error: any) {
        logger.error("Withdraw earnings error:", error);
        return { success: false, error: "Failed to submit withdrawal request" };
    }
}

/**
 * Get the current user's WAVE application (primarily for the review-pending page to show real submission date)
 */
export async function getWaveApplicationStatusAction(userId?: string): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: "Unauthorized" };
        const targetId = userId || session.user.id;

        // Look in wave_applications collection
        const snapshot = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
            .where("userId", "==", targetId)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

        if (snapshot.empty) {
            // Fallback: check serviceRegistrations on user doc
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(targetId).get();
            const reg = userDoc.data()?.serviceRegistrations?.wave;
            return { success: true, data: { status: reg?.status || null } };
        }

        const data = snapshot.docs[0].data();
        return {
            success: true,
            data: {
                status: data.status || null,
                submittedAt: data.createdAt || data.submittedAt || null,
            }
        };
    } catch (error) {
        logger.error("getWaveApplicationStatusAction error:", error);
        return { success: false, error: "Failed to get application status" };
    }
}

// ============================================================================
// REVISION FLOW
// ============================================================================

/**
 * Get the current user's existing WAVE application data (for pre-populating edit form)
 */
export async function getWaveApplicationAction(): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: 'Unauthorized' };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const applicationId = userDoc.data()?.serviceRegistrations?.wave?.applicationId;

        if (!applicationId) return { success: false, error: 'No application found' };

        const appDoc = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId).get();
        if (!appDoc.exists) return { success: false, error: 'Application not found' };

        const data = appDoc.data();
        return { success: true, data: { data, meta: { revisionNote: data?.revisionNote } } };
    } catch (error) {
        logger.error('getWaveApplicationAction error:', error);
        return { success: false, error: 'Failed to fetch application' };
    }
}

/**
 * Admin: Request revision from an applicant — sets status to revision_required
 */
export async function requestWaveRevisionAction(
    applicationId: string,
    reason: string
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return { success: false, error: 'Admin access required' };
        }

        const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();
        if (!appDoc.exists) return { success: false, error: 'Application not found' };

        const userId = appDoc.data()?.userId;

        await appRef.update({
            status: 'revision_required',
            revisionNote: reason,
            revisionRequestedAt: FieldValue.serverTimestamp(),
            revisionRequestedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (userId) {
            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                'serviceRegistrations.wave.status': 'revision_required',
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        await createAdminAuditLog({
            action: 'user_update',
            userId: session.user.id,
            targetId: applicationId,
            targetType: 'wave_application',
            metadata: { action: 'revision_requested', reason },
        });

        return { success: true };
    } catch (error) {
        logger.error('requestWaveRevisionAction error:', error);
        return { success: false, error: 'Failed to request revision' };
    }
}

/**
 * Resubmit (update) an existing WAVE application after revision request
 */
export async function resubmitWaveApplicationAction(
    applicationData: z.infer<typeof waveApplicationSchema>
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;

        const validation = waveApplicationSchema.safeParse(applicationData);
        if (!validation.success) {
            return { success: false, error: validation.error.issues[0]?.message || 'Validation failed' };
        }

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const applicationId = userData?.serviceRegistrations?.wave?.applicationId;
        const existingStatus = userData?.serviceRegistrations?.wave?.status;

        if (!applicationId) return { success: false, error: 'No existing application found to resubmit' };
        if (existingStatus !== 'revision_required' && existingStatus !== 'pending') {
            return { success: false, error: 'Only applications in pending or revision_required status can be resubmitted' };
        }

        const validatedData = validation.data;

        await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId).update({
            ...validatedData,
            status: 'pending',
            revisionNote: null,
            resubmittedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            'serviceRegistrations.wave.status': 'pending',
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: 'user_update',
            userId: session.user.id,
            targetId: applicationId,
            targetType: 'wave_application',
            metadata: { action: 'application_resubmitted' },
        });

        return { success: true };
    } catch (error) {
        logger.error('resubmitWaveApplicationAction error:', error);
        return { success: false, error: 'Failed to resubmit application' };
    }
}
