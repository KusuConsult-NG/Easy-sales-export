"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { serializeValue } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { AcademyApplicationInputSchema, AcademyApplicationInput } from "@/lib/validations/academy";
import type { AcademyApplicationData } from "@/lib/types/academy-actions";

const ACADEMY_REGISTRATION_FEE = 0;

 // Registration is now free, users pay only for tiers

/**
 * Submit Academy learner application
 */
async function _submitAcademyApplicationAction(
    applicationData: AcademyApplicationData
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Authentication required", data: null };
        }

        const phone = applicationData.personalInfo.phone;
        const email = applicationData.personalInfo.email;
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);

        let finalApplicationId: string = "";
        let isPaid = false;

        await db.runTransaction(async (t) => {
            // Check for existing application status on the user
            const userDoc = await t.get(userRef);
            const userData = userDoc.data();
            const existingStatus = userData?.serviceRegistrations?.academy?.status;

            // Only block if an actual application was already submitted (has applicationId).
            // IMPORTANT: status="pending" is also set by the payment verification step — do NOT
            // treat it as a blocking condition unless a real application doc was also created.
            const existingApplicationId = userData?.serviceRegistrations?.academy?.applicationId;
            if (existingApplicationId && (existingStatus === 'pending' || existingStatus === 'under_review')) {
                throw new Error("Your previous application is still being processed.");
            }
            if (existingStatus === 'approved') {
                throw new Error("You are already enrolled in the Academy program.");
            }

            const existingPaymentStatus = userData?.serviceRegistrations?.academy?.paymentStatus || "pending";
            const existingPaymentAmount = userData?.serviceRegistrations?.academy?.paymentAmount || 0;

            // 🔒 DEDUP GUARD: Collection-level phone and email check within transaction
            const collectionsContext = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS);
            if (phone) {
                const phoneQuery = collectionsContext.where("personalInfo.phone", "==", phone).limit(1);
                const phoneSnap = await t.get(phoneQuery);
                if (!phoneSnap.empty) {
                    throw new Error("An Academy application with this phone number already exists.");
                }
            }

            if (email) {
                const emailQuery = collectionsContext.where("personalInfo.email", "==", email).limit(1);
                const emailSnap = await t.get(emailQuery);
                if (!emailSnap.empty) {
                    throw new Error("An Academy application with this email already exists.");
                }
            }

            // Generate unique application ID
            const applicationId = `ACADEMY-${Date.now()}-${(Date.now() / 10000000000).toString(36).substring(2, 11)}`;
            finalApplicationId = applicationId;
            const appRef = collectionsContext.doc(applicationId);

            isPaid = ["completed", "paid", "successful"].includes(existingPaymentStatus);

            // Save to Firestore
            t.set(appRef, {
                ...applicationData,
                userId: session.user.id,
                applicationId,
                status: isPaid ? "approved" : "pending",
                paymentStatus: existingPaymentStatus,
                paymentAmount: existingPaymentAmount,
                plan: "registration",
                submittedAt: FieldValue.serverTimestamp(),
                reviewedAt: isPaid ? FieldValue.serverTimestamp() : null,
                reviewedBy: isPaid ? "system_auto_approval" : null,
                notes: "",
            });

            const userUpdate: any = {
                "serviceRegistrations.academy.status": isPaid ? "approved" : "pending",
                "serviceRegistrations.academy.applicationId": applicationId,
                "serviceRegistrations.academy.submittedAt": FieldValue.serverTimestamp(),
                "serviceRegistrations.academy.paymentStatus": existingPaymentStatus,
                firstName: applicationData.personalInfo.firstName,
                lastName: applicationData.personalInfo.lastName,
                otherName: applicationData.personalInfo.otherName || null,
                fullName: [
                    applicationData.personalInfo.firstName,
                    applicationData.personalInfo.otherName,
                    applicationData.personalInfo.lastName,
                ].filter(Boolean).join(" ").trim(),
                phone: applicationData.personalInfo.phone,
                gender: applicationData.personalInfo.gender,
                stateOfOrigin: applicationData.personalInfo.state,
                lga: applicationData.personalInfo.lga,
                updatedAt: FieldValue.serverTimestamp(),
            };

            if (isPaid) {
                userUpdate["serviceRegistrations.academy.approvedAt"] = FieldValue.serverTimestamp();
                userUpdate["roles"] = FieldValue.arrayUnion("academy_participant");
                userUpdate["isVerified"] = true;
            }

            // CRITICAL: Update user.serviceRegistrations to link application with auth
            t.update(userRef, userUpdate);
        });

        // Create audit log outside transaction
        await createAdminAuditLog({
            action: "user_update",
            userId: session.user.id,
            targetId: finalApplicationId,
            targetType: "academy_application",
            details: `Learner application submitted for ${applicationData.personalInfo.firstName || ''} ${applicationData.personalInfo.lastName || applicationData.personalInfo.fullName || ''}`.trim(),
        });

        try {
            await invalidateUserCache(session.user.id);
            if (isPaid) {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache(session.user.id, 'academy');
            }
        } catch (err) {
            logger.error("Failed to invalidate cache after Academy application:", err);
        }

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Academy application submission error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to submit application. Please try again.", data: null };
    }
}


export const submitAcademyApplicationAction = withFlexibleSafeAction("submitAcademyApplicationAction", _submitAcademyApplicationAction);


// ============================================================================
// REVISION FLOW
// ============================================================================

/**
 * Get the current user's existing academy application data (for pre-populating edit form)
 */
async function _getAcademyApplicationAction(): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: 'Unauthorized', data: null };

        const userDocRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userDocRef.get();
        const userData = userDoc.data();
        let applicationId = userData?.serviceRegistrations?.academy?.applicationId;

        let appDoc: any = null;
        let foundByQuery = false;

        if (applicationId) {
            const docSnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId).get();
            if (docSnap.exists) {
                appDoc = docSnap;
            }
        }

        if (!appDoc) {
            const snap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where('userId', '==', session.user.id)
                .get();

            if (!snap.empty) {
                const sortedDocs = snap.docs.sort((a: any, b: any) => {
                    const aTime = a.data().submittedAt?.toMillis?.() || a.data().submittedAt?.seconds * 1000 || a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
                    const bTime = b.data().submittedAt?.toMillis?.() || b.data().submittedAt?.seconds * 1000 || b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
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
        const data = serializeValue(appData);

        // Self-healing: backfill missing links
        const batch = db.batch();
        let needsCommit = false;

        if (foundByQuery || !userData?.serviceRegistrations?.academy?.applicationId) {
            batch.update(userDocRef, {
                "serviceRegistrations.academy.applicationId": applicationId
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

        return { success: true, error: null, data };
    } catch (error) {
        logger.error("getAcademyApplicationAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch application", data: null };
    }
}


export const getAcademyApplicationAction = withFlexibleSafeAction("getAcademyApplicationAction", _getAcademyApplicationAction);


/**
 * Admin: Request revision on an academy application
 */
async function _requestAcademyRevisionAction(
    applicationId: string,
    reason: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return { success: false as const, error: 'Admin access required', data: null };
        }

        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();
        if (!appDoc.exists) return { success: false as const, error: 'Application not found', data: null };

        const appData = appDoc.data();
        const userId = appData?.userId;

        await appRef.update({
            status: 'revision_required',
            revisionNote: reason,
            revisionRequestedAt: FieldValue.serverTimestamp(),
            revisionRequestedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (userId) {
            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                'serviceRegistrations.academy.status': 'revision_required',
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        if (userId) {
            try {
                const { Resend } = await import('resend');
                const resend = new Resend(process.env.RESEND_API_KEY);
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
                const email = userDoc.data()?.email;
                const name = appData?.personalInfo?.firstName ? `${appData.personalInfo.firstName} ${appData.personalInfo.lastName || ''}`.trim() : appData?.personalInfo?.fullName || 'Applicant';
                if (email) {
                const { data, error } = await resend.emails.send({
                    from: process.env.EMAIL_FROM || 'Easy Sales Export Academy <info@easysalesexport.com>',
                    to: email,
                    subject: 'Action Required: Update Your Academy Application',
                    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;"><h2 style="color:#2563eb;">Academy Application Update Required</h2><p>Dear <strong>${name}</strong>,</p><p>Our team requires some updates before your application can be approved.</p><div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:16px;margin:16px 0;"><p style="margin:0;color:#1d4ed8;"><strong>Note:</strong><br/>${reason}</p></div><p>Please <a href="${process.env.NEXTAUTH_URL || 'https://easysalesexport.com'}/academy/application">log in to update your application</a>.</p></div>`,
                });
                if (error) {
                    logger.error("Resend API Error (Academy revision email):", error);
                }
            }
            } catch (emailError) {
                logger.error('Academy revision email failed (non-blocking):', emailError);
            }
        }

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error('requestAcademyRevisionAction error:', error);
        return { success: false as const, error: 'Failed to request revision', data: null };
    }
}


export const requestAcademyRevisionAction = withFlexibleSafeAction("requestAcademyRevisionAction", _requestAcademyRevisionAction);


/**
 * Admin: Approve an academy application — sets status + sends approval email
 */
async function _approveAcademyApplicationAction(
    applicationId: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return { success: false as const, error: 'Admin access required', data: null };
        }

        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        let userId: string | undefined;
        let appData: any;

        // Atomic update using a transaction
        await db.runTransaction(async (transaction) => {
            const appDoc = await transaction.get(appRef);
            if (!appDoc.exists) throw new Error('Application not found');

            appData = appDoc.data();
            userId = appData?.userId;

            // 1. Update application status
            transaction.update(appRef, {
                status: 'approved',
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp(),
            });

            // 2. Update user document
            if (userId) {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                transaction.update(userRef, {
                    'serviceRegistrations.academy.status': 'approved',
                    roles: FieldValue.arrayUnion('academy_participant'),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
        });

        if (userId) {
            try {
                const { Resend } = await import('resend');
                const resend = new Resend(process.env.RESEND_API_KEY);
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
                const email = userDoc.data()?.email;
            const name = appData?.personalInfo?.firstName ? `${appData.personalInfo.firstName} ${appData.personalInfo.lastName || ''}`.trim() : appData?.personalInfo?.fullName || 'Learner';
            if (email) {
                const { data, error } = await resend.emails.send({
                    from: process.env.EMAIL_FROM || 'Easy Sales Export Academy <info@easysalesexport.com>',
                    to: email,
                    subject: 'Congratulations! Your Academy Application is Approved',
                    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;"><div style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:32px;border-radius:12px;text-align:center;margin-bottom:24px;"><h1 style="color:white;margin:0;">You are Accepted!</h1></div><p>Dear <strong>${name}</strong>,</p><p>Your <strong>Easy Sales Export Academy</strong> application has been <strong>approved</strong>!</p><div style="text-align:center;margin:24px 0;"><a href="${process.env.NEXTAUTH_URL || 'https://easysalesexport.com'}/academy/dashboard" style="background:#2563eb;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Go to Academy Dashboard</a></div></div>`,
                });
                if (error) {
                    logger.error("Resend API Error (Academy approval email):", error);
                }
            }
            } catch (emailError) {
                logger.error('Academy approval email failed (non-blocking):', emailError);
            }
        }

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error('approveAcademyApplicationAction error:', error);
        return { success: false as const, error: 'Failed to approve application' , data: null };
    }
}


export const approveAcademyApplicationAction = withFlexibleSafeAction("approveAcademyApplicationAction", _approveAcademyApplicationAction);


/**
 * Resubmit academy application after revision request
 */
async function _resubmitAcademyApplicationAction(
    data: AcademyApplicationInput
): Promise<ActionResponse<null>> {
    try {
        // Validate input
        const validation = AcademyApplicationInputSchema.safeParse(data);
        if (!validation.success) {
            return { success: false as const, error: validation.error.issues[0]?.message || "Validation failed", data: null };
        }

        const validatedData = validation.data;

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: 'Unauthorized' , data: null };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.academy?.status;

        const allowedStatuses = ['pending', 'revision_required'];
        if (!allowedStatuses.includes(existingStatus)) {
            return { success: false as const, error: 'Your application cannot be resubmitted at this time.' , data: null };
        }

        // Atomic update using a transaction
        await db.runTransaction(async (transaction) => {
            const snap = await transaction.get(db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where('userId', '==', session.user.id));

            if (snap.empty) throw new Error('No existing application found');

            const sortedDocs = snap.docs.sort((a, b) => {
                const aData = a.data();
                const bData = b.data();
                const aTime = aData.createdAt?.toMillis?.() || aData.createdAt?.seconds * 1000 || 0;
                const bTime = bData.createdAt?.toMillis?.() || bData.createdAt?.seconds * 1000 || 0;
                return bTime - aTime;
            });

            const latestDoc = sortedDocs[0];

            // 1. Update application
            transaction.update(latestDoc.ref, {
                ...validatedData,
                status: 'pending',
                revisionNote: null,
                resubmittedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // 2. Update user status and synchronize profile details
            const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
            transaction.update(userRef, {
                'serviceRegistrations.academy.status': 'pending',
                firstName: validatedData.personalInfo.firstName,
                lastName: validatedData.personalInfo.lastName,
                otherName: validatedData.personalInfo.otherName || null,
                fullName: [
                    validatedData.personalInfo.firstName,
                    validatedData.personalInfo.otherName,
                    validatedData.personalInfo.lastName,
                ].filter(Boolean).join(" ").trim(),
                phone: validatedData.personalInfo.phone,
                gender: validatedData.personalInfo.gender,
                stateOfOrigin: validatedData.personalInfo.state,
                lga: validatedData.personalInfo.lga,
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error('resubmitAcademyApplicationAction error:', error);
        return { success: false as const, error: 'Failed to resubmit application' , data: null };
    }
}


export const resubmitAcademyApplicationAction = withFlexibleSafeAction("resubmitAcademyApplicationAction", _resubmitAcademyApplicationAction);
