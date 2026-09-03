"use server";

import { ActionResponse } from "@/lib/safe-action";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission, isPlatformAdmin } from "@/lib/admin-permissions";
import { COLLECTIONS } from "@/lib/types/firestore";
import { z } from "zod";
import { strictNameSchema, strictEmailSchema, strictPhoneSchema } from "@/lib/schemas";
import { Resend } from "resend";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { hashData } from "@/lib/security";
import { checkWaveEligibility } from "@/lib/wave-eligibility";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { toMillis } from "@/lib/firestore-serialize";

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
 * The identity fields a WAVE application may write to a user record.
 *
 * Date of birth and gender are set ONCE. An application is a declaration, not a
 * correction: allowing one to overwrite a stored identity field would reopen for
 * these the door #155 closed on the profile screen, and admin.ts has the audited
 * route for fixing a record that is genuinely wrong.
 *
 * Shared by enrolment and resubmission because they had the same two-line write
 * and would otherwise drift — the shape this audit has met repeatedly.
 */
function identityFieldsToSetOnce(
    userData: Record<string, any> | undefined,
    declaredDateOfBirth: string,
    context: { userId: string; applicationId: string }
): Record<string, unknown> {
    const storedDob = String(userData?.dateOfBirth ?? "").trim();
    const storedGender = String(userData?.gender ?? "").trim();
    const fields: Record<string, unknown> = {};

    if (!storedDob) {
        fields.dateOfBirth = declaredDateOfBirth;
    } else if (storedDob !== declaredDateOfBirth) {
        // Reported, not resolved. Both values survive — the declared one on the
        // application row, the stored one on the user — and the disagreement is
        // what the forensic sweep exists to surface.
        logger.warn("[WAVE] Declared date of birth differs from the stored one; keeping the stored value", context);
    }

    if (!storedGender) {
        fields.gender = "Female";
    }

    return fields;
}


/**
 * Refuses an identity already registered under a different account.
 *
 * WHY THIS IS A SHARED FUNCTION NOW
 * ---------------------------------
 * Enrolment ran these three checks; resubmission ran none. Resubmission writes
 * the same phone, NIN and email onto the application AND onto the user record,
 * so an applicant asked for revisions could come back with a phone number or NIN
 * already registered to somebody else, and the gate that exists to stop one
 * person enrolling twice was simply not in the path. Nothing exotic was needed
 * — just editing those fields on the resubmission form.
 *
 * TWO DEFECTS IN THE CHECK ITSELF
 * -------------------------------
 * The queries were `.limit(1)` while the comparison looped over `snap.docs`. The
 * loop is the author's intent — examine every application sharing this identity
 * — and the limit made it examine exactly one, arbitrarily chosen. So when two
 * applications shared a phone number, whether the duplicate was caught depended
 * on which row the database happened to return: if it returned the caller's own
 * rejected application, the check passed and the other account's went unseen.
 *
 * The limit is raised to a small bound rather than removed. An identity legitimately
 * appears on at most a couple of applications (the applicant's own, across
 * revisions); a larger number is itself a signal, and is logged.
 */
const DUPLICATE_SCAN_LIMIT = 25;

async function findConflictingApplication(params: {
    callerId: string;
    email: string;
    phone: string;
    nin: string;
    /**
     * The caller's own application, excluded from the same-owner status check.
     *
     * Resubmission needs this and enrolment does not. The status half of the
     * check refuses an identity whose application is already `pending` — that is
     * the point on the enrolment path, where a second application is not wanted.
     * On resubmission the pending row IS the row being updated, and
     * _resubmitWaveApplicationAction deliberately allows resubmitting from
     * `pending`, so without this exclusion the shared check would refuse every
     * resubmission with "your application is currently pending".
     *
     * Only the status half is relaxed. A foreign owner is still a conflict.
     */
    ignoreApplicationId?: string;
}): Promise<string | null> {
    const { callerId, email, phone, nin, ignoreApplicationId } = params;

    const [phoneSnap, ninSnap, emailSnap] = await Promise.all([
        phone
            ? db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("phone", "==", phone).limit(DUPLICATE_SCAN_LIMIT).get()
            : Promise.resolve(null),
        nin
            ? db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("nin", "==", hashData(nin)).limit(DUPLICATE_SCAN_LIMIT).get()
            : Promise.resolve(null),
        email
            ? db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("userEmail", "==", email).limit(DUPLICATE_SCAN_LIMIT).get()
            : Promise.resolve(null),
    ]);

    const checkDuplicate = (snap: any, field: string): string | null => {
        if (!snap || snap.empty) return null;

        if (snap.docs.length >= DUPLICATE_SCAN_LIMIT) {
            logger.warn(
                `[WAVE] ${snap.docs.length} applications share one ${field}; ` +
                `only the first ${DUPLICATE_SCAN_LIMIT} were checked.`
            );
        }

        // Another account's application always wins, whichever order the rows
        // arrive in — so the whole set is scanned for a foreign owner before any
        // same-owner row is allowed to clear the check.
        for (const doc of snap.docs) {
            if (doc.data().userId !== callerId) {
                return `An application with this ${field} already exists in the WAVE program under a different account.`;
            }
        }

        for (const doc of snap.docs) {
            if (ignoreApplicationId && doc.id === ignoreApplicationId) continue;
            const status = doc.data().status;
            if (status !== "rejected" && status !== "revision_required") {
                return `Your application using this ${field} is currently ${status}.`;
            }
        }

        return null;
    };

    return checkDuplicate(emailSnap, "email address")
        ?? checkDuplicate(phoneSnap, "phone number")
        ?? (nin ? checkDuplicate(ninSnap, "NIN") : null);
}


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

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const userRoles = userData?.roles || [];
        const isUserAdmin = isPlatformAdmin(userRoles);
        const academyReg = userData?.serviceRegistrations?.academy;
        const isAcademyElite = academyReg?.plan === 'elite' && (academyReg?.status === 'approved' || academyReg?.status === 'active');
        const hasWaveRole = userRoles.includes("wave_participant");
        const hasWaveReg = userData?.serviceRegistrations?.wave?.status !== undefined;

        /**
         * Eligibility through the shared rule.
         *
         * This was the loosest of four copies: no date cutoff, so a male account
         * created after WAVE closed to new male participants was admitted as long
         * as it held `wave_participant` or a wave registration. Both gates in front
         * of this action — the /wave/application page and
         * /api/wave/check-eligibility — applied the cutoff and reported such an
         * account ineligible, while this accepted its application. A gate refusing
         * what the action behind it allows is the worse of the two arrangements,
         * because a server action is reachable without the page.
         *
         * Now the same rule as the gates. See wave-eligibility.ts for the four
         * copies and which behaviour was adopted.
         */
        const eligibility = checkWaveEligibility(userData);
        if (!eligibility.eligible) {
            return {
                success: false as const,
                error: eligibility.reason ?? "Only female applicants are eligible to enroll in the WAVE program.",
                data: null,
            };
        }

        const existingStatus = userData?.serviceRegistrations?.wave?.status;

        if (existingStatus === 'pending' || existingStatus === 'under_review') {
            return { success: false as const, error: "Your previous application is still being processed.", data: null };
        }
        if (existingStatus === 'approved') {
            return { success: false as const, error: "You are already enrolled in the WAVE program.", data: null };
        }

        const conflict = await findConflictingApplication({
            callerId: session.user.id,
            email: applicantEmail,
            phone: applicantPhone,
            nin: applicantNin,
        });
        if (conflict) return { success: false as const, error: conflict, data: null };

        let applicationId = userDoc.data()?.serviceRegistrations?.wave?.applicationId;
        if (!applicationId) {
            applicationId = `WAVE-${Date.now()}-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
        }

        // The date of birth this function just validated is recorded on the user
        // now, and the gender is no longer overwritten.
        //
        // THE DATE
        //
        // The age gate above computes calculatedAge from
        // validatedData.dateOfBirth and refuses anyone under 18. That date went
        // onto the WAVE_APPLICATIONS row (through the spread below) and nowhere
        // else, so the user document — which is what forensics.ts sweeps for
        // under-age participants — had no date to check. Registration writes
        // none either, so the age half of that sweep checked nobody. See #156.
        //
        // SET ONCE, LIKE GENDER
        //
        // Both are written only where the user record has no value yet. An
        // application is a declaration, not a correction: letting one overwrite
        // a stored identity field would reopen for date of birth the door #155
        // closed for gender, and admin.ts already has the audited route for
        // fixing a record that is genuinely wrong.
        //
        // `gender: "Female"` was written unconditionally, which matters more
        // than it looks. Reaching this line does not prove the applicant is
        // female: the eligibility check exempts admins, Academy Elite members
        // and anyone holding a pre-existing WAVE role or registration. A male
        // applicant in any of those categories passed and then had his user
        // record rewritten to Female — and after #155 he could not correct it
        // himself.
        //
        // A mismatch is left alone rather than resolved. The declared value
        // stays on the application row, the stored value stays on the user, and
        // the two disagreeing is the sort of thing the forensic sweep exists to
        // surface. Silently picking a winner would erase the signal.
        const identityFieldsToSet = identityFieldsToSetOnce(
            userData,
            validatedData.dateOfBirth,
            { userId: session.user.id, applicationId }
        );

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
                ...identityFieldsToSet,
                stateOfOrigin: validatedData.stateOfOrigin,
                residentialState: validatedData.stateOfResidence,
                lga: validatedData.lgaOfOrigin,
                residentialAddress: validatedData.residentialAddress,
                // Populate KYC
                bvn: applicantBvn ? hashData(applicantBvn) : null,
                nin: applicantNin ? hashData(applicantNin) : null,
                "kyc.bvn": applicantBvn ? hashData(applicantBvn) : null,
                "kyc.nin": applicantNin ? hashData(applicantNin) : null,
                // "kyc.bvnVerified" / "kyc.ninVerified" are deliberately NOT
                // written here.
                //
                // They were set from `applicantBvn ? true : false`, which is
                // self-assertion in both directions. True: an applicant marked
                // her own identity verified by typing eleven digits, and
                // updateOverallKYCStatus in kyc.ts reads exactly these two
                // fields to decide the account's overall KYC state. False: an
                // applicant resubmitting WITHOUT a BVN wiped a verification that
                // had already been recorded, so filling in less of the form
                // downgraded her.
                //
                // The numbers are still stored above, hashed. Only something
                // that actually checks an identity may say it was checked.
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
 * Get the current user's WAVE application (primarily for the review-pending page to show real submission date)
 */
async function _getWaveApplicationStatusAction(userId?: string): Promise<ActionResponse<{ status: string; submittedAt?: any } | null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        /**
         * Whose application this is.
         *
         * It was `userId || session.user.id`, with nothing checking the two
         * against each other — so any authenticated caller could pass any user id
         * and read that person's WAVE application status and submission date.
         *
         * There is no UI caller, which is why it went unnoticed and is not why it
         * was safe: an exported server action is an HTTP endpoint, reachable by
         * anyone with a session whether a page calls it or not.
         *
         * The parameter is kept so existing callers compile, and an admin may
         * still use it — the admin screens have a legitimate need to look up an
         * applicant. Anyone else asking about somebody else is refused rather than
         * silently redirected to their own record, so a caller cannot mistake
         * another person's status for their own.
         */
        const { isAdmin } = await import("@/lib/admin-permissions");
        const requestedId = userId?.trim();
        if (requestedId && requestedId !== session.user.id && !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }
        const targetId = requestedId || session.user.id;

        const snapshot = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
            .where("userId", "==", targetId)
            .get();

        if (snapshot.empty) {
            /**
             * No application row, but the registration may still record a status.
             *
             * This branch read the user's `serviceRegistrations.wave` into a
             * variable called `reg` and then returned null without looking at it.
             * The dead read is the clue to what was meant: the review-pending page
             * calls this to show an applicant where she stands, and an applicant
             * whose registration says `pending` while no application row can be
             * found was told nothing at all.
             *
             * That combination is reachable — the enrolment path writes the
             * application and the registration in one transaction, but
             * `_getWaveApplicationAction` right below this exists precisely to
             * repair broken links between the two, so the codebase already knows
             * they come apart.
             *
             * The registration status is reported with no date, because there is
             * no application row to take one from and inventing one would be worse
             * than showing none.
             */
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(targetId).get();
            const reg = userDoc.data()?.serviceRegistrations?.wave;

            if (reg?.status) {
                const { serializeValue } = await import("@/lib/firestore-serialize");
                return {
                    error: null,
                    success: true as const,
                    data: {
                        status: String(reg.status),
                        submittedAt: serializeValue(reg.submittedAt ?? null),
                    },
                };
            }

            return { error: null, success: true as const, data: null };
        }

        const sortedDocs = snapshot.docs.map(d => d.data()).sort((a: any, b: any) => {
            const aTime = toMillis(a.createdAt);
            const bTime = toMillis(b.createdAt);
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
                    const aTime = toMillis(a.data().createdAt);
                    const bTime = toMillis(b.data().createdAt);
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
        // #265 wave_admin holds wave:approve_applications and was refused
        // here, while the rest of the WAVE admin surface admits it.
        if (!hasAdminPermission(session?.user?.roles, "wave:approve_applications")) {
            return { success: false as const, error: 'Unauthorized: wave:approve_applications required', data: null };
        }

        const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();
        if (!appDoc.exists) return { success: false as const, error: 'Application not found', data: null };

        const userId = appDoc.data()?.userId;

        /**
         * A revision may only be asked for on an application still under review.
         *
         * This was an existence check followed by an unconditional write — the
         * third verdict on this collection, and the only one without a guard.
         * approveWaveApplicationAction and rejectWaveApplicationAction both claim
         * from ["pending", "under_review"] precisely because they raced each
         * other; this one could overwrite either of their outcomes afterwards.
         *
         * On an APPROVED application the damage goes past the record. It also
         * writes `serviceRegistrations.wave.status` on the user, and
         * module-access-check.ts Layer 2 admits a member on
         * `status === "approved"` — so asking a live member for revisions revoked
         * her access to the programme she had been admitted to, while leaving her
         * `wave_participant` role and WAVE_MEMBERS row in place. A half-enrolled
         * member is harder to notice than a rejected one.
         *
         * `revision_required` is included so an admin can correct the note on a
         * request already sent.
         */
        const claim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.WAVE_APPLICATIONS,
            id: applicationId,
            fromAny: ['pending', 'under_review', 'revision_required'],
            to: 'revision_required',
            patch: {
                revisionNote: reason,
                revisionRequestedAt: new Date().toISOString(),
                revisionRequestedBy: session.user.id,
                updatedAt: new Date().toISOString(),
            },
            recordPreviousAs: 'statusBeforeRevisionRequest',
        });

        if (!claim.claimed) {
            return {
                success: false as const,
                error: claim.status === null
                    ? (claim.exists
                        ? 'This application has no status recorded, so a revision cannot be requested on it.'
                        : 'Application not found')
                    : `This application is '${claim.status}' and a revision cannot be requested on it. ` +
                      `An approved or rejected application has already been decided.`,
                data: null,
            };
        }

        if (userId) {
            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                'serviceRegistrations.wave.status': 'revision_required',
                updatedAt: FieldValue.serverTimestamp()
            });
        }

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
        const applicantEmail = (session.user.email || validatedData.email || '').toLowerCase().trim();

        // The same duplicate gate as enrolment, which this path did not have.
        //
        // Resubmission writes phone, NIN and email onto both the application and
        // the user record, so without this an applicant asked for revisions could
        // return with an identity already registered to another account — walking
        // straight around the check enrolment performs. Nothing clever was
        // required: just editing those fields on the revision form.
        const resubmitConflict = await findConflictingApplication({
            callerId: session.user.id,
            email: applicantEmail,
            phone: applicantPhone,
            nin: applicantNin,
            ignoreApplicationId: applicationId,
        });
        if (resubmitConflict) {
            return { success: false as const, error: resubmitConflict, data: null };
        }

        /**
         * The APPLICATION's status decides whether it may be resubmitted, not the
         * user record's copy of it.
         *
         * The guard above reads `serviceRegistrations.wave.status` off the user
         * document — a derived duplicate that the two admin verdict paths write
         * separately, AFTER their claim on the application succeeds. So the two
         * can disagree, and `_getWaveApplicationAction` further down this file
         * exists specifically to repair broken links between them, which is the
         * codebase already saying they come apart.
         *
         * When they disagreed the wrong one won: a user record still reading
         * `revision_required` while the application had since been APPROVED let a
         * resubmission overwrite the approval and put the applicant back to
         * pending — undoing an admin decision from the applicant's side.
         *
         * `allowSameStatus` covers pending → pending, which this action
         * deliberately permits. It does not weaken the guard against racing a
         * verdict: an application already moved to `approved` or `rejected`
         * matches neither starting status and is refused.
         */
        const resubmitClaim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.WAVE_APPLICATIONS,
            id: applicationId,
            fromAny: ['revision_required', 'pending'],
            to: 'pending',
            patch: { resubmitClaimedAt: new Date().toISOString() },
            allowSameStatus: true,
        });

        if (!resubmitClaim.claimed) {
            return {
                success: false as const,
                error: resubmitClaim.status === null
                    ? (resubmitClaim.exists
                        ? 'This application has no status recorded and cannot be resubmitted.'
                        : 'No existing application found to resubmit')
                    : `This application is '${resubmitClaim.status}' and can no longer be resubmitted. ` +
                      `Only an application awaiting review or asked for revisions can be.`,
                data: null,
            };
        }

        await db.runTransaction(async (transaction) => {
            const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
            const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);

            // Same set-once rule as enrolment, and it matters more here.
            //
            // This path runs no eligibility check at all — it only requires the
            // application to be pending or revision_required — so an applicant
            // who reached it through one of the exemptions could rewrite their
            // stored gender to Female on every resubmission.
            const resubmitUserSnap = await transaction.get(userRef);
            const identityFieldsToSet = identityFieldsToSetOnce(
                resubmitUserSnap.data(),
                validatedData.dateOfBirth,
                { userId: session.user.id, applicationId }
            );

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
                ...identityFieldsToSet,
                stateOfOrigin: validatedData.stateOfOrigin,
                residentialState: validatedData.stateOfResidence,
                lga: validatedData.lgaOfOrigin,
                residentialAddress: validatedData.residentialAddress,
                // Populate KYC
                bvn: applicantBvn ? hashData(applicantBvn) : null,
                nin: applicantNin ? hashData(applicantNin) : null,
                "kyc.bvn": applicantBvn ? hashData(applicantBvn) : null,
                "kyc.nin": applicantNin ? hashData(applicantNin) : null,
                // "kyc.bvnVerified" / "kyc.ninVerified" are deliberately NOT
                // written here.
                //
                // They were set from `applicantBvn ? true : false`, which is
                // self-assertion in both directions. True: an applicant marked
                // her own identity verified by typing eleven digits, and
                // updateOverallKYCStatus in kyc.ts reads exactly these two
                // fields to decide the account's overall KYC state. False: an
                // applicant resubmitting WITHOUT a BVN wiped a verification that
                // had already been recorded, so filling in less of the form
                // downgraded her.
                //
                // The numbers are still stored above, hashed. Only something
                // that actually checks an identity may say it was checked.
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
