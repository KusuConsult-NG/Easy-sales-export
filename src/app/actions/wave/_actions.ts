/**
 * Last Hardened: 2026-05-09 (Reconciliation Sync)
 */

"use server";

import { ActionResponse } from "@/lib/safe-action";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { debitJsonbBalance } from "@/lib/wallet-ledger";
import { z } from "zod";
import { strictNameSchema, strictEmailSchema, strictPhoneSchema } from "@/lib/schemas";
import { Resend } from "resend";
import { serializeDocs } from "@/lib/firestore-serialize";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { isAdmin } from "@/lib/role-utils";
import { checkModuleAccess } from "@/lib/module-access-check";
import { hashData } from "@/lib/security";

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

// Validation Schema for WAVE Application (OFFICIAL BENEFICIARY APPLICATION FORM)
const waveApplicationSchema = z.object({ // SECTION A: Personal Identification
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
    nin: z.string().optional().or(z.literal("")),
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
    bvn: z.string().optional().or(z.literal("")),
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
    consentGiven: z.boolean() });

/**
 * Check WAVE application status for current user
 */
async function _checkWaveStatusAction(): Promise<ActionResponse<{ status: string | null }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const registration = userData?.serviceRegistrations?.wave;

        // ── AUTHORITATIVE CHECK: Check real application record ──────
        // If status is not approved, check the source of truth for WAVE applications.
        let status = registration?.status;
        if (status !== "approved") {
            let appDoc: any = null;
            const appSnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("userId", "==", session.user.id)
                .get();

            if (!appSnap.empty) {
                const sortedDocs = appSnap.docs.sort((a, b) => {
                    const aVal = a.data().applicationDate || a.data().createdAt;
                    const bVal = b.data().applicationDate || b.data().createdAt;
                    const aTime = aVal?.toMillis?.() || aVal?.seconds * 1000 || (aVal ? new Date(aVal).getTime() : 0);
                    const bTime = bVal?.toMillis?.() || bVal?.seconds * 1000 || (bVal ? new Date(bVal).getTime() : 0);
                    return bTime - aTime;
                });
                appDoc = sortedDocs[0];
            } else if (registration?.applicationId) {
                const directDoc = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(registration.applicationId).get();
                if (directDoc.exists) {
                    appDoc = directDoc;
                    // Self-healing: backfill userId on direct application doc if missing
                    const appData = directDoc.data()!;
                    if (!appData.userId) {
                        await directDoc.ref.update({ userId: session.user.id });
                    }
                }
            } else if (session.user.email || userData?.email) {
                const userEmail = (session.user.email || userData?.email || "").toLowerCase().trim();
                if (userEmail) {
                    let emailQuery = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                        .where("userEmail", "==", userEmail)
                        .limit(1)
                        .get();
                    if (emailQuery.empty) {
                        emailQuery = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                            .where("email", "==", userEmail)
                            .limit(1)
                            .get();
                    }
                    if (!emailQuery.empty) {
                        appDoc = emailQuery.docs[0];
                        // Self-healing: backfill userId on direct application doc if missing
                        const appData = appDoc.data()!;
                        if (!appData.userId) {
                            await appDoc.ref.update({ userId: session.user.id });
                        }
                    }
                }
            }

            if (appDoc) {
                const appData = appDoc.data()!;
                if (appData.status === "approved") {
                    status = "approved";
                    // Proactively backfill for performance in future logins
                    await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
                        "serviceRegistrations.wave.status": "approved",
                        "serviceRegistrations.wave.syncedAt": new Date().toISOString()
                    });
                } else if (appData.status) {
                    status = appData.status;
                }
            }
        }

        if (status) {
            return { error: null, success: true as const, data: { status } };
        }

        // ── FALLBACK: Legacy Sync ──────
        const legacySnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
            .where('userId', '==', session.user.id)
            .get();

        if (!legacySnap.empty) {
            const sortedDocs = legacySnap.docs.map(d => d.data()).sort((a: any, b: any) => {
                const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
                const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
                return bTime - aTime;
            });
            const legacyData = sortedDocs[0];
            const legacyStatus = legacyData?.status ?? 'pending';

            await db.collection(COLLECTIONS.USERS).doc(session.user.id).update(
                {
                    "serviceRegistrations.wave.status": legacyStatus,
                    "serviceRegistrations.wave.syncedFromLegacy": true,
                    "serviceRegistrations.wave.syncedAt": new Date().toISOString()
                }
            );

            logger.info(`[checkWaveStatus] Backfilled legacy wave status '${legacyStatus}' for user ${session.user.id}`);
            return { error: null, success: true as const, data: { status: legacyStatus } };
        }
        return { error: null, success: true as const, data: { status: null } };
    } catch (error) {
        logger.error("Check WAVE status error:", error);
        return { success: false as const, error: "Failed to check status", data: null };
    }
}
export const checkWaveStatusAction = withFlexibleSafeAction("checkWaveStatusAction", _checkWaveStatusAction);

/**
 * Check if user is eligible for WAVE (female only)
 */
async function _checkWaveEligibilityAction(userId: string): Promise<ActionResponse<{ eligible: boolean; reason?: string } | null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        // Allow checking own eligibility or admin checking others
        if (session.user.id !== userId && (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

        if (!userDoc.exists) {
            return { error: null, success: true as const, data: null };
        }

        const userData = userDoc.data();
        const roles = userData?.roles || [];
        const { isAdmin } = await import("@/lib/admin-permissions");
        const isUserAdmin = isAdmin(roles);

        // Check if the user is an Academy Elite member
        const academyReg = userData?.serviceRegistrations?.academy;
        const isAcademyElite = academyReg?.plan === 'elite' && (academyReg?.status === 'approved' || academyReg?.status === 'active');

        // 🔒 SECURITY: Strict Gender Enforcement for standard users
        // Admins (including module-specific admins) and Academy Elite members are always eligible.
        const existingGender = userData?.gender;
        const hasWaveRole = roles.includes("wave_participant");
        const hasWaveReg = userData?.serviceRegistrations?.wave?.status !== undefined;
        
        // Only explicitly block male users who do not have admin, elite, or pre-existing WAVE status/role.
        const isMale = existingGender?.toLowerCase() === "male";

        const userCreatedAt = userData?.createdAt;
        const CUTOFF_DATE = new Date("2026-06-17T00:00:00.000Z");
        let registeredOnOrAfterCutoff = false;
        if (userCreatedAt) {
            const dateVal = typeof userCreatedAt.toDate === "function" 
                ? userCreatedAt.toDate() 
                : (userCreatedAt.seconds ? new Date(userCreatedAt.seconds * 1000) : new Date(userCreatedAt));
            registeredOnOrAfterCutoff = dateVal >= CUTOFF_DATE;
        }
        const isNewMaleUser = isMale && registeredOnOrAfterCutoff;

        // Block if male AND (new user OR doesn't have pre-existing wave access)
        const isWaveBlocked = isMale && (isNewMaleUser || (!hasWaveRole && !hasWaveReg));
        
        if (isWaveBlocked && !isUserAdmin && !isAcademyElite) {
            return {
                error: null,
                success: true as const,
                data: {
                    eligible: false,
                    reason: "WAVE program is exclusively for women entrepreneurs"
                }
            };
        }

        return { error: null, success: true as const, data: { eligible: true } };
    } catch (error) {
        logger.error("WAVE eligibility check error:", error);
        return { success: false as const, error: "Failed to check eligibility", data: null };
    }
}
export const checkWaveEligibilityAction = withFlexibleSafeAction("checkWaveEligibilityAction", _checkWaveEligibilityAction);

/**
 * Submit multi-step WAVE application
 * Accepts object data from multi-step form (not FormData)
 */
async function _submitMultiStepWaveApplicationAction(applicationData: z.infer<typeof waveApplicationSchema>): Promise<ActionResponse<{ applicationId: string }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        // Validate with Zod
        const validation = waveApplicationSchema.safeParse(applicationData);
        if (!validation.success) {
            return { success: false as const, error: validation.error.issues[0]?.message || "Validation failed", data: null };
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

        if (calculatedAge < 18) {
            return { success: false as const, error: `You must be at least 18 years old to apply. (Calculated age based on DOB: ${calculatedAge})`, data: null };
        }

        if (Math.abs(calculatedAge - validatedData.age) > 1) {
            return { success: false as const, error: `Date of Birth does not match the declared age (${validatedData.age}). Please check your inputs.`, data: null };
        }

        const applicantEmail = (session.user.email || validatedData.email || '').toLowerCase().trim();
        const applicantPhone = validatedData.phone.replace(/\s+/g, '').trim();
        const applicantNin = validatedData.nin ? validatedData.nin.trim() : "";
        const applicantBvn = validatedData.bvn ? validatedData.bvn.trim() : "";

        const [userDoc, phoneSnap, ninSnap] = await Promise.all([
            db.collection(COLLECTIONS.USERS).doc(session.user.id).get(),
            db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("phone", "==", applicantPhone)
                .limit(1)
                .get(),
            applicantNin ? db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("nin", "==", hashData(applicantNin))
                .limit(1)
                .get() : Promise.resolve(null),
        ]);

        let emailSnap = null;
        if (applicantEmail !== "") {
            emailSnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("userEmail", "==", applicantEmail)
                .limit(1)
                .get();
        }

        const userData = userDoc.data();
        const userRoles = userData?.roles || [];
        const isUserAdmin = userRoles.includes("admin") || userRoles.includes("super_admin");
        const academyReg = userData?.serviceRegistrations?.academy;
        const isAcademyElite = academyReg?.plan === 'elite' && (academyReg?.status === 'approved' || academyReg?.status === 'active');
        const hasWaveRole = userRoles.includes("wave_participant");
        const hasWaveReg = userData?.serviceRegistrations?.wave?.status !== undefined;

        const applicantGender = userData?.gender;
        const isMale = applicantGender?.toLowerCase() === "male";
        if (isMale && !isUserAdmin && !isAcademyElite && !hasWaveRole && !hasWaveReg) {
            return { success: false as const, error: "Only female applicants are eligible to enroll in the WAVE program.", data: null };
        }

        const existingStatus = userData?.serviceRegistrations?.wave?.status;

        if (existingStatus === 'pending' || existingStatus === 'under_review') {
            return { success: false as const, error: "Your previous application is still being processed.", data: null };
        }
        if (existingStatus === 'approved') {
            return { success: false as const, error: "You are already enrolled in the WAVE program.", data: null };
        }

        const checkDuplicate = (snap: any, field: string) => {
            if (!snap || snap.empty) return null;
            for (const doc of snap.docs) {
                const data = doc.data();
                if (data.userId !== session.user.id) {
                    return `An application with this ${field} already exists in the WAVE program under a different account.`;
                }
                if (data.status !== 'rejected' && data.status !== 'revision_required') {
                    return `Your application using this ${field} is currently ${data.status}.`;
                }
            }
            return null;
        };

        const emailErr = checkDuplicate(emailSnap, 'email address');
        if (emailErr) return { success: false as const, error: emailErr, data: null };

        const phoneErr = checkDuplicate(phoneSnap, 'phone number');
        if (phoneErr) return { success: false as const, error: phoneErr, data: null };

        const ninErr = applicantNin ? checkDuplicate(ninSnap, 'NIN') : null;
        if (ninErr) return { success: false as const, error: ninErr, data: null };

        let applicationId = userDoc.data()?.serviceRegistrations?.wave?.applicationId;
        if (!applicationId) {
            applicationId = `WAVE-${Date.now()}-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
        }

        await db.runTransaction(async (transaction) => {
            transaction.set(db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId), {
                ...validatedData,
                bvn: applicantBvn ? hashData(applicantBvn) : null,
                nin: applicantNin ? hashData(applicantNin) : null,
                age: calculatedAge,
                userId: session.user.id,
                userEmail: session.user.email || validatedData.email,
                status: "pending",
                applicationDate: FieldValue.serverTimestamp(),
                reviewedAt: null,
                reviewedBy: null,
                rejectionReason: null,
                updatedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp()
            });

            transaction.update(db.collection(COLLECTIONS.USERS).doc(session.user.id), {
                "serviceRegistrations.wave.status": "pending",
                "serviceRegistrations.wave.paymentStatus": "completed",
                "serviceRegistrations.wave.applicationId": applicationId,
                "serviceRegistrations.wave.submittedAt": FieldValue.serverTimestamp(),
                firstName: validatedData.firstName,
                lastName: validatedData.surname,
                otherName: validatedData.otherNames || null,
                fullName: [validatedData.firstName, validatedData.otherNames, validatedData.surname]
                    .filter(Boolean).join(" ").trim(),
                phone: applicantPhone,
                gender: "Female",
                stateOfOrigin: validatedData.stateOfOrigin,
                residentialState: validatedData.stateOfResidence,
                lga: validatedData.lgaOfOrigin,
                residentialAddress: validatedData.residentialAddress,
                // Populate KYC
                bvn: applicantBvn ? hashData(applicantBvn) : null,
                nin: applicantNin ? hashData(applicantNin) : null,
                "kyc.bvn": applicantBvn ? hashData(applicantBvn) : null,
                "kyc.nin": applicantNin ? hashData(applicantNin) : null,
                "kyc.bvnVerified": applicantBvn ? true : false,
                "kyc.ninVerified": applicantNin ? true : false,
                // Next of Kin
                nextOfKinName: validatedData.nextOfKinName,
                nextOfKinPhone: validatedData.nextOfKinPhone,
                nextOfKinRelationship: validatedData.nextOfKinRelationship,
                nextOfKinAddress: "",
                nextOfKin: {
                    name: validatedData.nextOfKinName,
                    phone: validatedData.nextOfKinPhone,
                    relationship: validatedData.nextOfKinRelationship,
                    address: ""
                },
                // Bank Details
                bankAccountNumber: validatedData.accountNumber,
                bankAccountName: [validatedData.firstName, validatedData.otherNames, validatedData.surname]
                    .filter(Boolean).join(" ").trim(),
                bankDetails: {
                    accountNumber: validatedData.accountNumber,
                    bankName: validatedData.bankName,
                    accountName: [validatedData.firstName, validatedData.otherNames, validatedData.surname]
                        .filter(Boolean).join(" ").trim(),
                    bankCode: ""
                },
                updatedAt: FieldValue.serverTimestamp()
            });
        });

        createAdminAuditLog({
            action: "user_update",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "wave_application",
            metadata: {
                surname: validatedData.surname,
                firstName: validatedData.firstName,
                stateOfResidence: validatedData.stateOfResidence,
                ageVerification: `Verified 18+ (Auto-calculated: ${calculatedAge})`
            }
        }).catch(err => logger.error("Deferred audit log failed (WAVE):", err));

        try {
            const resend = new Resend(process.env.RESEND_API_KEY);
            const applicantEmail = session.user.email || validatedData.email;
            const adminEmail = process.env.ADMIN_EMAIL || 'admin@easysalesexport.com';
            const applicantName = `${validatedData.firstName} ${validatedData.surname}`;

            if (applicantEmail) {
                await resend.emails.send({
                    from: process.env.EMAIL_FROM || 'RH-WAVE 774 <info@easysalesexport.com>',
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
                    `
                });
            }

            const { notifyAdmins } = await import("@/lib/admin-notifications");
            await notifyAdmins({
                type: "wave",
                title: "New WAVE Application",
                message: `New WAVE application submitted by ${applicantName} (ID: ${applicationId}, State: ${validatedData.stateOfResidence}).`,
                link: "/admin/wave",
                linkText: "Review Application"
            });
        } catch (emailError) {
            logger.error("WAVE application admin notification failed (non-blocking):", emailError);
        }

        try {
            await invalidateUserCache(session.user.id);
        } catch (err) {
            logger.error("Failed to invalidate cache after WAVE application:", err);
        }
        return { error: null, success: true as const, data: { applicationId } };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("WAVE application submission error:", error);
        return { success: false as const, error: "Failed to submit application. Please try again.", data: null as any };
    }
}
export const submitMultiStepWaveApplicationAction = withFlexibleSafeAction("submitMultiStepWaveApplicationAction", _submitMultiStepWaveApplicationAction);

/**
 * Enroll user in WAVE program
 */
async function _enrollInWaveAction(userId: string): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (session.user.id !== userId) {
            return { success: false as const, error: "Cannot enroll on behalf of another user", data: null };
        }

        const eligibility = await checkWaveEligibilityAction(userId);

        if (!eligibility.success || !eligibility.data?.eligible) {
            return { success: false as const, error: eligibility.error || eligibility.data?.reason || "Not eligible", data: null };
        }

        await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(userId).set({
            enrolledAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            active: true
        }, { merge: true });
        
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const existingApplicationId = userData?.serviceRegistrations?.wave?.applicationId || `WAVE-ENROLL-${Date.now()}`;

        // Ensure user registration is also updated
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            "serviceRegistrations.wave.status": "approved",
            "serviceRegistrations.wave.paymentStatus": "completed",
            "serviceRegistrations.wave.applicationId": existingApplicationId,
            "serviceRegistrations.wave.updatedAt": FieldValue.serverTimestamp()
        });

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetType: "wave_enrollment"
        });

        return { error: null, success: true as const, data: null };
    } catch (error) {
        logger.error("WAVE enrollment error:", error);
        return { success: false as const, error: "Failed to enroll in WAVE program", data: null };
    }
}
export const enrollInWaveAction = withFlexibleSafeAction("enrollInWaveAction", _enrollInWaveAction);

/**
 * Get WAVE resources
 */
async function _getWaveResourcesAction(
    category?: string,
    cursor?: string | null,
    limit = 20
): Promise<ActionResponse<WaveResource[], { cursor: string | null; hasMore: boolean }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", meta: { cursor: null, hasMore: false }, data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", meta: { cursor: null, hasMore: false }, data: null };

        // STRICT ENROLLMENT CHECK
        const memberDoc = await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(session.user.id).get();
        const { isAdmin } = await import("@/lib/admin-permissions");
        
        let isAuthorized = false;
        if (memberDoc.exists && memberDoc.data()?.active) {
            isAuthorized = true;
        } else if (isAdmin(session.user.roles)) {
            isAuthorized = true;
        } else {
            // Academy Elite users also bypass strict enrollment checks
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                const academyReg = userData?.serviceRegistrations?.academy;
                const isAcademyElite = academyReg?.plan === 'elite' && (academyReg?.status === 'approved' || academyReg?.status === 'active');
                if (isAcademyElite) {
                    isAuthorized = true;
                }
            }
        }

        if (!isAuthorized) {
            logger.warn(`Unauthorized WAVE resource access attempt by ${session.user.id}`);
            return { success: false as const, error: "Access denied: Not enrolled in WAVE", meta: { cursor: null, hasMore: false }, data: null };
        }

        const pageSize = Math.min(Math.max(limit, 1), 50);

        let queryRef: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.WAVE_RESOURCES)
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

        return { error: null, success: true as const, data, meta: { cursor: nextCursor, hasMore } };
    } catch (error) {
        logger.error("Failed to fetch WAVE resources:", error);
        return { success: false as const, error: "Failed to fetch resources", meta: { cursor: null, hasMore: false }, data: null };
    }
}
export const getWaveResourcesAction = withFlexibleSafeAction("getWaveResourcesAction", _getWaveResourcesAction);

/**
 * Get upcoming WAVE training events
 */
async function _getWaveTrainingEventsAction(
    cursor?: string | null,
    limit = 20,
    includeAllStatuses = false
): Promise<ActionResponse<WaveTrainingEvent[], { cursor: string | null; hasMore: boolean }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", meta: { cursor: null, hasMore: false }, data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", meta: { cursor: null, hasMore: false }, data: null };

        const pageSize = Math.min(Math.max(limit, 1), 50);

        let queryRef: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS);

        if (!includeAllStatuses) {
            queryRef = queryRef.where("status", "in", ["upcoming", "ongoing"]);
        }

        queryRef = queryRef
            .orderBy("date", "asc")
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
            ? docs[docs.length - 1].data().date?.toDate?.()?.toISOString() ?? null
            : null;

        return { error: null, success: true as const, data, meta: { cursor: nextCursor, hasMore } };
    } catch (error) {
        logger.error("Get training events error:", error);
        return { success: false as const, error: "Failed to fetch training events", meta: { cursor: null, hasMore: false }, data: null };
    }
}
export async function getWaveTrainingEventsAction(...args: Parameters<typeof _getWaveTrainingEventsAction>) {
    return withFlexibleSafeAction("getWaveTrainingEventsAction", _getWaveTrainingEventsAction)(...args);
}

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

/**
 * Get user's shipment tracking info
 */
async function _getShipmentTrackingAction(userId: string): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        // Users can only see their own shipments
        if (session.user.id !== userId) return { success: false as const, error: "Unauthorized to view other shipments", data: null };

        const snapshot = await db.collection(COLLECTIONS.WAVE_SHIPMENTS)
            .where("memberId", "==", userId)
            .get();

        return { error: null, success: true as const, data: serializeDocs<ShipmentTracking>(snapshot.docs) };
    } catch (error) {
        logger.error("Get shipment tracking error:", error);
        return { success: false as const, error: "Failed to fetch shipment tracking", data: null };
    }
}
export const getShipmentTrackingAction = withFlexibleSafeAction("getShipmentTrackingAction", _getShipmentTrackingAction);

/**
 * Update shipment status (admin only)
 */
import { getLogisticsProvider } from "@/lib/logistics";

// ... existing code ...

/**
 * Update shipment status (admin only)
 */
async function _updateShipmentStatusAction(
    shipmentId: string,
    status: ShipmentTracking["status"],
    location: string,
    note?: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const { isAdmin } = await import("@/lib/admin-permissions");
        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Admin access required", data: null };
        }

        const shipmentRef = db.collection(COLLECTIONS.WAVE_SHIPMENTS).doc(shipmentId);
        const shipmentDoc = await shipmentRef.get();

        if (!shipmentDoc.exists) {
            return { success: false as const, error: "Shipment not found", data: null };
        }

        const shipmentData = shipmentDoc.data() as ShipmentTracking;

        const newUpdate = {
            timestamp: new Date(),
            location,
            status,
            note
        };

        const updateData: any = {
            status,
            updates: [...(shipmentData.updates || []), newUpdate]
        };

        if (status === "delivered") {
            updateData.actualDelivery = FieldValue.serverTimestamp();
        }

        await shipmentRef.update(updateData);

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Update shipment error:", error);
        return { success: false as const, error: message, data: null };
    }
}
export const updateShipmentStatusAction = withFlexibleSafeAction("updateShipmentStatusAction", _updateShipmentStatusAction);

/**
 * Sync shipment with carrier (Admin or Automator)
 * This fetches real-time updates from the Logistics Provider (GIG/Kwik)
 */
async function _syncShipmentWithCarrierAction(shipmentId: string): Promise<ActionResponse<null>> {
    try {
        const shipmentRef = db.collection(COLLECTIONS.WAVE_SHIPMENTS).doc(shipmentId);
        const shipmentDoc = await shipmentRef.get();

        if (!shipmentDoc.exists) {
            return { success: false as const, error: "Shipment not found", data: null };
        }

        const shipmentData = shipmentDoc.data() as ShipmentTracking;

        if (!shipmentData.trackingNumber) {
            return { success: false as const, error: "No tracking number explicitly linked", data: null };
        }

        const provider = getLogisticsProvider();
        const updates = await provider.trackShipment(shipmentData.trackingNumber);

        if (updates.length > 0) {
            const latest = updates[updates.length - 1];
            const existingUpdates = shipmentData.updates || [];
            const mergedUpdates = [...existingUpdates];

            for (const carrierUpdate of updates) {
                const isDuplicate = existingUpdates.some(
                    ex => ex.status === carrierUpdate.status && ex.location === carrierUpdate.location
                );

                if (!isDuplicate) {
                    mergedUpdates.push(carrierUpdate);
                }
            }

            mergedUpdates.sort((a, b) => {
                const timeA = (a.timestamp as any)?.toDate ? (a.timestamp as any).toDate().getTime() : new Date(a.timestamp).getTime();
                const timeB = (b.timestamp as any)?.toDate ? (b.timestamp as any).toDate().getTime() : new Date(b.timestamp).getTime();
                return timeA - timeB;
            });

            await shipmentRef.update({
                status: latest.status,
                updates: mergedUpdates,
                lastSyncedAt: FieldValue.serverTimestamp()
            });

            return { error: null, success: true as const, data: null };
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Sync shipment error:", error);
        return { success: false as const, error: message, data: null };
    }
}
export const syncShipmentWithCarrierAction = withFlexibleSafeAction("syncShipmentWithCarrierAction", _syncShipmentWithCarrierAction);

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

/**
 * Calculate member earnings from sales
 */
async function _calculateEarningsAction(userId: string): Promise<ActionResponse<MemberEarnings>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (session.user.id !== userId && (!isAdmin(session.user.roles))) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const waveReg = userData?.serviceRegistrations?.wave;

        // Source of Truth: Persistent Balance
        let availableBalance = waveReg?.waveEarningsBalance;

        // Heavy calculation for Transaction History and Initial Backfill
        const snapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("sellerId", "==", userId)
            .get();

        const commissionRate = 0.05;
        let totalSales = 0;
        let totalEarnings = 0;
        let pendingAmount = 0;
        let calculatedPaidAmount = 0;
        const transactions: any[] = [];

        snapshot.docs.forEach(doc => {
            const order = doc.data();
            const saleAmount = order.totalAmount || 0;
            const commission = saleAmount * commissionRate;
            const isPaid = order.paymentStatus === "paid" || order.status === "completed";

            totalSales += saleAmount;
            totalEarnings += commission;

            if (isPaid) {
                calculatedPaidAmount += commission;
            } else {
                pendingAmount += commission;
            }

            transactions.push({
                date: order.createdAt?.toDate ? order.createdAt.toDate() : new Date(),
                orderId: doc.id,
                saleAmount,
                commission,
                status: isPaid ? "paid" : "pending"
            });
        });

        const withdrawalsSnap = await db.collection(COLLECTIONS.WAVE_WITHDRAWALS)
            .where("userId", "==", userId)
            .where("status", "in", ["pending", "approved", "approved_pending_payout", "completed"])
            .get();
        
        let withdrawnAmount = 0;
        withdrawalsSnap.docs.forEach(doc => {
            const w = doc.data();
            withdrawnAmount += (w.amount || 0);
        });

        // AUTO-BACKFILL: If persistent balance is missing, initialize it
        if (availableBalance === undefined) {
            availableBalance = Math.max(0, calculatedPaidAmount - withdrawnAmount);
            await userRef.update({
                'serviceRegistrations.wave.waveEarningsBalance': availableBalance,
                updatedAt: FieldValue.serverTimestamp()
            });
            logger.info(`Backfilled WAVE earnings balance for user ${userId}: ${availableBalance}`);
        }

        const result: MemberEarnings = {
            memberId: userId,
            totalSales,
            totalEarnings,
            commissionRate,
            pendingAmount,
            paidAmount: availableBalance, // Use the persistent source
            totalWithdrawn: withdrawnAmount,
            transactions: transactions
                .sort((a: any, b: any) => b.date.getTime() - a.date.getTime())
                .map(t => ({
                    ...t,
                    date: t.date.toISOString()
                }))
        };

        const { serializeValue } = await import("@/lib/firestore-serialize");
        return { error: null, success: true as const, data: serializeValue(result) as any };
    } catch (error) {
        logger.error("Calculate earnings error:", error);
        return { success: false as const, error: "Failed to calculate earnings", data: null };
    }
}
export const calculateEarningsAction = withFlexibleSafeAction("calculateEarningsAction", _calculateEarningsAction);

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

/**
 * Generate certificate for member
 */
async function _generateCertificateAction(
    userId: string,
    programName: string,
    certificateType: WaveCertificate["certificateType"]
): Promise<ActionResponse<WaveCertificate>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false as const, error: "Admin access required", data: null };
        }

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) {
            return { success: false as const, error: "User not found", data: null };
        }

        const userData = userDoc.data();
        const certNumber = `WAVE-${new Date().getFullYear()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const certId = `cert_${userId}_${Date.now()}`;
        const issuedDate = new Date();

        const certificate: WaveCertificate = {
            id: certId,
            memberId: userId,
            memberName: userData?.name || "Member",
            certificateType,
            programName,
            issuedDate,
            certificateNumber: certNumber,
            verificationUrl: `/wave/verify-certificate/${certNumber}`
        };

        await db.collection(COLLECTIONS.WAVE_CERTIFICATES).doc(certId).set(certificate);

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: certId,
            targetType: "wave_certificate"
        });

        return { error: null, success: true as const, data: certificate };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Generate certificate error:", error);
        return { success: false as const, error: message, data: null };
    }
}
export const generateCertificateAction = withFlexibleSafeAction("generateCertificateAction", _generateCertificateAction);

/**
 * Get member certificates
 */
async function _getMemberCertificatesAction(userId: string): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        // Allow reading own certificates
        if (session.user.id !== userId) return { success: false as const, error: "Unauthorized", data: null };

        const snapshot = await db.collection(COLLECTIONS.WAVE_CERTIFICATES)
            .where("memberId", "==", userId)
            .get();

        return { error: null, success: true as const, data: serializeDocs<WaveCertificate>(snapshot.docs) };
    } catch (error) {
        logger.error("Get certificates error:", error);
        return { success: false as const, error: "Failed to load certificates", data: null };
    }
}
export const getMemberCertificatesAction = withFlexibleSafeAction("getMemberCertificatesAction", _getMemberCertificatesAction);

/**
 * Get current user's certificates (auth handled internally)
 */
async function _getCurrentUserCertificatesAction(): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Unauthorized", data: null };

        return await getMemberCertificatesAction(session.user.id);
    } catch (error) {
        logger.error("Get current user certificates error:", error);
        return { success: false as const, error: "Failed to load certificates", data: null };
    }
}
export const getCurrentUserCertificatesAction = withFlexibleSafeAction("getCurrentUserCertificatesAction", _getCurrentUserCertificatesAction);

// ============================================================================
// RESOURCE MANAGEMENT
// ============================================================================

/**
 * Upload resource (admin only)
 */
async function _uploadWaveResourceAction(
    resource: Omit<WaveResource, "id" | "uploadedAt" | "downloads">
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false as const, error: "Admin access required", data: null };
        }

        const resourceId = `resource_${Date.now()}`;
        const resourceData: WaveResource = {
            ...resource,
            id: resourceId,
            uploadedAt: FieldValue.serverTimestamp(),
            downloads: 0
        };

        await db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId).set(resourceData);

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Upload resource error:", error);
        return { success: false as const, error: message, data: null };
    }
}
export const uploadWaveResourceAction = withFlexibleSafeAction("uploadWaveResourceAction", _uploadWaveResourceAction);

/**
 * Increment resource download count
 */
async function _incrementResourceDownloadAction(
    resourceId: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };

        const resourceRef = db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId);

        await resourceRef.update({
            downloads: FieldValue.increment(1)
        });

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Increment download error:", error);
        return { success: false as const, error: message, data: null };
    }
}
export const incrementResourceDownloadAction = withFlexibleSafeAction("incrementResourceDownloadAction", _incrementResourceDownloadAction);

/**
 * Register for training event
 */
async function _registerForTrainingAction(
    userId: string,
    eventId: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (session.user.id !== userId) {
            return { success: false as const, error: "Cannot register for another user", data: null };
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

            const registrationRef = db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS).doc();
            transaction.set(registrationRef, {
                userId,
                eventId,
                registeredAt: FieldValue.serverTimestamp(),
                attended: false
            });

            transaction.update(eventRef, {
                currentParticipants: FieldValue.increment(1)
            });
        });

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: eventId,
            targetType: "training_registration"
        });

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Training registration error:", error);
        return { success: false as const, error: message, data: null };
    }
}
export const registerForTrainingAction = withFlexibleSafeAction("registerForTrainingAction", _registerForTrainingAction);

// ============================================================================
// EARNINGS WITHDRAWAL
// ============================================================================

/**
 * Request an earnings withdrawal.
 * Creates a pending withdrawal record in Firestore for admin processing.
 */
async function _withdrawEarningsAction(
    amount: number
): Promise<ActionResponse<null>> {
    try {
        // WAVE withdrawals are currently disabled
        return { 
            success: false as const, 
            error: "WAVE earnings withdrawals are currently disabled for maintenance. Please try again later.", 
            data: null 
        };

        const sessionResult = await requireSession();
        if (!sessionResult.session?.user?.id) {
            return { 
                success: false as const, 
                error: sessionResult.error?.error ?? "Authentication required", 
                data: null 
            };
        }
        const session = sessionResult.session!;
        const userId = session.user.id;
        const userEmail = session.user.email || "";

        if (amount < 5000) {
            return { success: false as const, error: "Minimum withdrawal amount is ₦5,000", data: null };
        }

        // PHASE 1: Balance Calculation (Snapshot)
        // Note: We calculate before the transaction because Firestore queries are not supported inside transactions in Node SDK.
        // The transactional lock (hasPendingWithdrawal) prevents race conditions.
        const earnings = await _calculateEarningsAction(userId);
        if (!earnings.success || (earnings.data?.paidAmount || 0) < amount) {
            return { success: false as const, error: earnings.error || "Insufficient available balance", data: null };
        }

        const withdrawalId = `WAVE-WD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const withdrawalRef = db.collection(COLLECTIONS.WAVE_WITHDRAWALS).doc(withdrawalId);
        const walletTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(withdrawalId);

        // PHASE 2: ATOMIC RESERVATION
        // Debit the earnings under a row lock, before recording anything.
        //
        // The sufficiency check above happens outside any transaction — it reads
        // a snapshot, releases it, and the decrement happens later. Two
        // withdrawals submitted at once both passed against the same snapshot
        // and both debited. The hasPendingWithdrawal flag was meant to prevent
        // that and could not: it was a check-then-write inside the same
        // lock-free transaction.
        //
        // Taking the money first means the second request is refused for
        // insufficient funds, which is the honest answer — the first one has it.
        const debit = await debitJsonbBalance({
            table: "users",
            id: userId,
            field: "serviceRegistrations.wave.waveEarningsBalance",
            amount,
        });

        if (!debit.ok) {
            return {
                success: false as const,
                error: debit.reason === "insufficient_funds"
                    ? "Insufficient available balance"
                    : "WAVE earnings record not found",
                data: null,
            };
        }

        await db.runTransaction(async (transaction) => {
            // Create WAVE Withdrawal Record
            transaction.set(withdrawalRef, {
                withdrawalId,
                userId,
                userEmail,
                amount,
                status: "pending",
                requestedAt: FieldValue.serverTimestamp(),
                processedAt: null,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0
            });

            // Align with Wallet Ledger System
            transaction.set(walletTxnRef, {
                walletId: userId,
                userId,
                type: "withdrawal",
                module: "wave",
                amount: -amount, // Negative for withdrawal
                description: `WAVE Earnings Withdrawal - ${withdrawalId}`,
                status: "pending",
                reference: withdrawalId,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0
            });

            // Set the pending flag. The balance was already debited above,
            // under a lock — decrementing it here as well would take it twice.
            transaction.update(userRef, {
                'serviceRegistrations.wave.hasPendingWithdrawal': true,
                'serviceRegistrations.wave.lastWithdrawalRequestedAt': FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
        });

        // AUDIT LOG
        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: withdrawalId,
            targetType: "wave_withdrawal",
            metadata: { amount, action: "withdrawal_requested" },
            details: `WAVE earnings withdrawal of ₦${amount.toLocaleString()} requested.`
        });

        return { success: true as const, error: null, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Withdraw earnings error:", error);
        return { success: false as const, error: message, data: null };
    }
}
export const withdrawEarningsAction = withFlexibleSafeAction("withdrawEarningsAction", _withdrawEarningsAction);

/**
 * Get the current user's WAVE application (primarily for the review-pending page to show real submission date)
 */
async function _getWaveApplicationStatusAction(userId?: string): Promise<ActionResponse<{ status: string; submittedAt?: any } | null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };
        const targetId = userId || session.user.id;

        const snapshot = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
            .where("userId", "==", targetId)
            .get();

        if (snapshot.empty) {
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(targetId).get();
            const reg = userDoc.data()?.serviceRegistrations?.wave;
            return { error: null, success: true as const, data: null };
        }

        const sortedDocs = snapshot.docs.map(d => d.data()).sort((a: any, b: any) => {
            const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
            const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
        });

        const data = sortedDocs[0];
        const { serializeValue } = await import("@/lib/firestore-serialize");
        return {
            error: null,
            success: true as const,
            data: {
                status: data.status || null,
                submittedAt: serializeValue(data.createdAt || data.submittedAt || null)
            }
        };
    } catch (error) {
        logger.error("getWaveApplicationStatusAction error:", error);
        return { success: false as const, error: "Failed to get application status", data: null };
    }
}
export const getWaveApplicationStatusAction = withFlexibleSafeAction("getWaveApplicationStatusAction", _getWaveApplicationStatusAction);

// ============================================================================
// REVISION FLOW
// ============================================================================

/**
 * Get the current user's existing WAVE application data (for pre-populating edit form)
 */
async function _getWaveApplicationAction(): Promise<ActionResponse<any | null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: 'Unauthorized', data: null };

        const userDocRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userDocRef.get();
        const userData = userDoc.data();
        let applicationId = userData?.serviceRegistrations?.wave?.applicationId;

        let appDoc: any = null;
        let foundByQuery = false;

        if (applicationId) {
            const docSnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId).get();
            if (docSnap.exists) {
                appDoc = docSnap;
            }
        }

        if (!appDoc) {
            // Fallback to query by userId
            const snap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where('userId', '==', session.user.id)
                .get();

            if (!snap.empty) {
                const sortedDocs = snap.docs.sort((a: any, b: any) => {
                    const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
                    const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
                    return bTime - aTime;
                });
                appDoc = sortedDocs[0];
                applicationId = appDoc.id;
                foundByQuery = true;
            }
        }

        if (!appDoc) {
            return { success: false as const, error: 'No application found', data: null };
        }

        const appData = appDoc.data()!;
        const { serializeValue } = await import("@/lib/firestore-serialize");
        const data = serializeValue(appData);

        // Self-healing: backfill missing links
        const batch = db.batch();
        let needsCommit = false;

        if (foundByQuery || !userData?.serviceRegistrations?.wave?.applicationId) {
            batch.update(userDocRef, {
                "serviceRegistrations.wave.applicationId": applicationId
            });
            needsCommit = true;
        }

        if (!appData.userId) {
            batch.update(appDoc.ref, {
                userId: session.user.id
            });
            needsCommit = true;
        }

        if (needsCommit) {
            await batch.commit();
        }

        return { 
            error: null, 
            success: true as const, 
            data,
            meta: { revisionNote: appData.revisionNote || null }
        };
    } catch (error) {
        logger.error('getWaveApplicationAction error:', error);
        return { success: false as const, error: 'Failed to fetch application', data: null };
    }
}
export const getWaveApplicationAction = withFlexibleSafeAction("getWaveApplicationAction", _getWaveApplicationAction);

/**
 * Admin: Request revision from an applicant — sets status to revision_required
 */
async function _requestWaveRevisionAction(
    applicationId: string,
    reason: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return { success: false as const, error: 'Admin access required', data: null };
        }

        const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();
        if (!appDoc.exists) return { success: false as const, error: 'Application not found', data: null };

        const userId = appDoc.data()?.userId;

        await db.runTransaction(async (transaction) => {
            transaction.update(appRef, {
                status: 'revision_required',
                revisionNote: reason,
                revisionRequestedAt: FieldValue.serverTimestamp(),
                revisionRequestedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp()
            });

            if (userId) {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                transaction.update(userRef, {
                    'serviceRegistrations.wave.status': 'revision_required',
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        });

        await createAdminAuditLog({
            action: 'user_update',
            userId: session.user.id,
            targetId: applicationId,
            targetType: 'wave_application',
            metadata: { action: 'revision_requested', reason }
        });

        return { error: null, success: true as const, data: null };
    } catch (error) {
        logger.error('requestWaveRevisionAction error:', error);
        return { success: false as const, error: 'Failed to request revision', data: null };
    }
}
export const requestWaveRevisionAction = withFlexibleSafeAction("requestWaveRevisionAction", _requestWaveRevisionAction);

/**
 * Resubmit (update) an existing WAVE application after revision request
 */
async function _resubmitWaveApplicationAction(
    applicationData: z.infer<typeof waveApplicationSchema>
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const validation = waveApplicationSchema.safeParse(applicationData);
        if (!validation.success) {
            return { success: false as const, error: validation.error.issues[0]?.message || 'Validation failed', data: null };
        }

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const applicationId = userData?.serviceRegistrations?.wave?.applicationId;
        const existingStatus = userData?.serviceRegistrations?.wave?.status;

        if (!applicationId) return { success: false as const, error: 'No existing application found to resubmit', data: null };
        if (existingStatus !== 'revision_required' && existingStatus !== 'pending') {
            return { success: false as const, error: 'Only applications in pending or revision_required status can be resubmitted', data: null };
        }

        const validatedData = validation.data;
        const applicantPhone = validatedData.phone.replace(/\s+/g, '').trim();
        const applicantNin = validatedData.nin ? validatedData.nin.trim() : "";
        const applicantBvn = validatedData.bvn ? validatedData.bvn.trim() : "";

        await db.runTransaction(async (transaction) => {
            const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
            const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);

            transaction.update(appRef, {
                ...validatedData,
                bvn: applicantBvn ? hashData(applicantBvn) : null,
                nin: applicantNin ? hashData(applicantNin) : null,
                status: 'pending',
                revisionNote: null,
                resubmittedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            transaction.update(userRef, {
                'serviceRegistrations.wave.status': 'pending',
                'serviceRegistrations.wave.paymentStatus': 'completed',
                'serviceRegistrations.wave.submittedAt': FieldValue.serverTimestamp(),
                firstName: validatedData.firstName,
                lastName: validatedData.surname,
                otherName: validatedData.otherNames || null,
                fullName: [validatedData.firstName, validatedData.otherNames, validatedData.surname]
                    .filter(Boolean).join(" ").trim(),
                phone: applicantPhone,
                gender: "Female",
                stateOfOrigin: validatedData.stateOfOrigin,
                residentialState: validatedData.stateOfResidence,
                lga: validatedData.lgaOfOrigin,
                residentialAddress: validatedData.residentialAddress,
                // Populate KYC
                bvn: applicantBvn ? hashData(applicantBvn) : null,
                nin: applicantNin ? hashData(applicantNin) : null,
                "kyc.bvn": applicantBvn ? hashData(applicantBvn) : null,
                "kyc.nin": applicantNin ? hashData(applicantNin) : null,
                "kyc.bvnVerified": applicantBvn ? true : false,
                "kyc.ninVerified": applicantNin ? true : false,
                // Next of Kin
                nextOfKinName: validatedData.nextOfKinName,
                nextOfKinPhone: validatedData.nextOfKinPhone,
                nextOfKinRelationship: validatedData.nextOfKinRelationship,
                nextOfKinAddress: "",
                nextOfKin: {
                    name: validatedData.nextOfKinName,
                    phone: validatedData.nextOfKinPhone,
                    relationship: validatedData.nextOfKinRelationship,
                    address: ""
                },
                // Bank Details
                bankAccountNumber: validatedData.accountNumber,
                bankAccountName: [validatedData.firstName, validatedData.otherNames, validatedData.surname]
                    .filter(Boolean).join(" ").trim(),
                bankDetails: {
                    accountNumber: validatedData.accountNumber,
                    bankName: validatedData.bankName,
                    accountName: [validatedData.firstName, validatedData.otherNames, validatedData.surname]
                        .filter(Boolean).join(" ").trim(),
                    bankCode: ""
                },
                updatedAt: FieldValue.serverTimestamp()
            });
        });

        await createAdminAuditLog({
            action: 'user_update',
            userId: session.user.id,
            targetId: applicationId,
            targetType: 'wave_application',
            metadata: { action: 'application_resubmitted' }
        });

        return { error: null, success: true as const, data: null };
    } catch (error) {
        logger.error('resubmitWaveApplicationAction error:', error);
        return { success: false as const, error: 'Failed to resubmit application', data: null };
    }
}
export const resubmitWaveApplicationAction = withFlexibleSafeAction("resubmitWaveApplicationAction", _resubmitWaveApplicationAction);

async function _checkWaveAccessAction(): Promise<ActionResponse<boolean>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: "Session expired", data: null };
        }
        const hasAccess = await checkModuleAccess(
            sessionResult.session.user.id,
            sessionResult.session.user.roles || [],
            "wave"
        );
        return { success: true as const, error: null, data: hasAccess };
    } catch (error) {
        logger.error("checkWaveAccessAction error:", error);
        return { success: false as const, error: "Failed to verify access", data: null };
    }
}
export const checkWaveAccessAction = withFlexibleSafeAction("checkWaveAccessAction", _checkWaveAccessAction);
