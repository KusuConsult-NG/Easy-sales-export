"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { serializeValue, toMillis } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { AcademyApplicationInputSchema, AcademyApplicationInput } from "@/lib/validations/academy";
import { normaliseAcademyPlan } from "@/lib/academy-plan";
import { normalisePhone } from "@/lib/phone";
import { isDecidedAgainst } from "@/lib/registration-progress";
import type { AcademyApplicationData } from "@/lib/types/academy-actions";

const ACADEMY_REGISTRATION_FEE = 0;

/**
 * How many rows sharing one identity the dedup guard examines.
 *
 * The check used `.limit(1)`, so whichever row the database returned first
 * decided the answer. With one of the caller's own rows and one belonging to
 * somebody else, the outcome depended on row order.
 */
const DUPLICATE_SCAN_LIMIT = 20;

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
        // Lowercased and trimmed, because that is the form every other reader
        // looks for. See the dedup guard below.
        const normalisedEmail = String(applicationData.personalInfo.email ?? "").trim().toLowerCase() || null;
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

            // The tier the learner actually bought — not the literal "registration".
            //
            // This row used to be written with `plan: "registration"` unconditionally.
            // The application form pays FIRST: step 5 only renders the Submit button
            // once paymentStatus is "paid", so by the time this runs the learner has
            // already been charged for foundation, standard or elite. And because no
            // application document existed at payment time, both fulfilment paths
            // skipped their `if (appDoc)` update — so nothing ever corrected it.
            //
            // The result was that the admin applications screen, its plan badge and
            // its CSV export said "Registration" for EVERY learner, including
            // everyone who paid the ₦270,000 elite fee. The amount column was right
            // beside it and disagreed.
            //
            // null, not a placeholder, when there is genuinely no tier: registration
            // itself is free (ACADEMY_REGISTRATION_FEE above), so "applied without
            // buying a tier" is a real state and deserves an honest absence rather
            // than a word that reads like a product.
            const existingPlan = normaliseAcademyPlan(
                userData?.serviceRegistrations?.academy?.plan
            );

            // 🔒 DEDUP GUARD: Collection-level phone and email check within transaction
            //
            // WHAT WAS WRONG
            // --------------
            // Both halves refused on ANY match, including the caller's own row.
            //
            // _rejectAcademyApplicationAction sets the application to "rejected"
            // and emails the applicant a list headed "What You Can Do" whose last
            // item is "Re-apply after making necessary improvements". Neither of
            // the blocks above stops a rejected applicant — line 52 only blocks
            // pending/under_review, line 55 only blocks approved — so they reach
            // here, their own rejected row matches on phone, and they are told
            // "An Academy application with this phone number already exists."
            // The platform invited them to reapply and then made it impossible,
            // permanently, with a message that reads like someone else took
            // their number.
            //
            // The rule below is the one WAVE already uses
            // (_wv_applications.ts): another account's application is always a
            // conflict, and the caller's own is a conflict only while it is
            // still live. `rejected` and `revision_required` are finished, so
            // they do not block a fresh application.
            //
            // AND THE MATCHES WERE LITERAL
            // ----------------------------
            // The form stores what the applicant typed. Three separate lookups —
            // checkAcademyStatusAction, checkAcademyPaymentStatusAction and
            // module-access-check Layer 2.7, which GRANTS academy access — query
            // `personalInfo.email == userData.email.toLowerCase()`, and user
            // emails are lowercased at registration. So an applicant who typed a
            // capital letter was invisible to all three, and could also submit a
            // second application by varying the case. The email is normalised
            // before it is stored and before it is queried; the phone is matched
            // in both the typed and the E.164 form, since rows already exist in
            // each.
            const collectionsContext = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS);

            /**
             * Refuses a live application, whoever owns it — and refuses another
             * account's application whatever its status.
             */
            const conflict = (snap: any, field: string): string | null => {
                if (!snap || snap.empty) return null;

                // A foreign owner wins whichever order the rows arrive in, so the
                // whole set is scanned before any of the caller's own rows can
                // clear the check.
                for (const doc of snap.docs) {
                    if (doc.data()?.userId && doc.data().userId !== session.user.id) {
                        return `An Academy application with this ${field} already exists under a different account.`;
                    }
                }

                for (const doc of snap.docs) {
                    const status = doc.data()?.status;
                    if (status !== "rejected" && status !== "revision_required") {
                        return `Your Academy application using this ${field} is currently ${status || "open"}.`;
                    }
                }

                return null;
            };

            if (phone) {
                const phoneForms = [...new Set([phone, normalisePhone(phone)].filter(Boolean))] as string[];
                const phoneSnap = await t.get(
                    collectionsContext.where("personalInfo.phone", "in", phoneForms).limit(DUPLICATE_SCAN_LIMIT)
                );
                const message = conflict(phoneSnap, "phone number");
                if (message) throw new Error(message);
            }

            if (normalisedEmail) {
                const emailSnap = await t.get(
                    collectionsContext.where("personalInfo.email", "==", normalisedEmail).limit(DUPLICATE_SCAN_LIMIT)
                );
                const message = conflict(emailSnap, "email address");
                if (message) throw new Error(message);
            }

            // Generate unique application ID
            const applicationId = `ACADEMY-${Date.now()}-${(Date.now() / 10000000000).toString(36).substring(2, 11)}`;
            finalApplicationId = applicationId;
            const appRef = collectionsContext.doc(applicationId);

            // A REAPPLICATION AFTER A REJECTION WENT STRAIGHT PAST THE ADMIN.
            //
            // `isPaid` is the auto-approval switch: a paid applicant's
            // application is written `status: "approved"`, `reviewedBy:
            // "system_auto_approval"`, with `academy_participant` granted. That
            // is the intended model for a first application — paying the
            // registration fee is what admits a learner, and no admin need
            // review it.
            //
            // But the registration fee is paid ONCE, and the duplicate guard
            // above deliberately lets a rejected applicant reapply — the
            // rejection email invites exactly that ("Re-apply after making
            // necessary improvements"). So the applicant an admin had just
            // rejected submitted a new form and was auto-approved by their old
            // payment, in the same request, with the role back. The admin who
            // rejected them had no way to make it stick.
            //
            // A reapplication that follows a decision goes to the admin instead.
            // Nothing is lost: the payment is still recorded and the admin can
            // approve, which is the outcome auto-approval would have produced —
            // it just cannot happen without them. Fifth instance of the shape
            // fixed in #207, #225, #227 and #229.
            const previouslyDecidedAgainst = isDecidedAgainst(existingStatus);

            isPaid = !previouslyDecidedAgainst
                && ["completed", "paid", "successful"].includes(existingPaymentStatus);

            // Save to Firestore
            t.set(appRef, {
                ...applicationData,
                // Overwrites the typed casing from the spread above. The three
                // recovery lookups all query the lowercased form, and one of
                // them grants academy module access.
                personalInfo: {
                    ...applicationData.personalInfo,
                    email: normalisedEmail,
                },
                userId: session.user.id,
                applicationId,
                status: isPaid ? "approved" : "pending",
                paymentStatus: existingPaymentStatus,
                paymentAmount: existingPaymentAmount,
                plan: existingPlan,
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
                    const aTime = a.data().submittedAt?.toMillis?.() || a.data().submittedAt?.seconds * 1000 || toMillis(a.data().createdAt);
                    const bTime = b.data().submittedAt?.toMillis?.() || b.data().submittedAt?.seconds * 1000 || toMillis(b.data().createdAt);
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
 * Admin: Approve an academy application.
 *
 * TWO APPROVALS, DOING DIFFERENT THINGS
 * -------------------------------------
 * There are two functions with this name. academy/index.ts says so, and calls
 * the one in _ac_admin_review.ts "canonical" while excluding this one from the
 * barrel as "a legacy duplicate".
 *
 * Excluding it from the barrel does nothing. This file is "use server", so every
 * export of it is a reachable HTTP endpoint whether the barrel names it or not
 * — the same reasoning that applies to autoEnrollPaidUser in _ac_enrollment.ts.
 * So the platform had two live approval endpoints that did not agree:
 *
 *   GUARD          canonical: hasAdminPermission(users:update) OR academy_admin
 *                  this one:  the literal roles 'admin' or 'super_admin'
 *                  — an academy_admin could approve through one and not the
 *                    other.
 *
 *   FIELD NAMES    canonical writes reviewedAt / reviewedBy
 *                  this one wrote approvedAt / approvedBy
 *                  — so which admin approved an application, and when, was
 *                    recorded under whichever pair of names the caller happened
 *                    to hit, and a screen reading one pair showed nothing for
 *                    applications approved through the other.
 *
 *   isVerified     canonical sets it; this one did not.
 *   CACHE          canonical invalidates the academy service cache; this one did
 *                  not, so the approval did not take effect until it expired.
 *   AUDIT LOG      canonical writes one; this one wrote nothing at all.
 *
 * Rather than delete a reachable endpoint, it delegates. One implementation, so
 * the two cannot drift again, and any caller still pointing here gets the
 * behaviour the platform considers correct.
 */
async function _approveAcademyApplicationAction(
    applicationId: string
): Promise<ActionResponse<null>> {
    // Fails fast for an anonymous caller; the AUTHORISATION decision — which
    // roles may approve — belongs to the canonical implementation alone, so
    // there is still only one answer to it. This is a strictly weaker
    // precondition, not a second rule that could disagree with the first.
    const sessionResult = await requireSession();
    if (!sessionResult.session?.user?.id) {
        return { success: false as const, error: 'Unauthorized', data: null };
    }

    const { approveAcademyApplicationAction: canonical } = await import("./_ac_admin_review");
    return canonical(applicationId) as Promise<ActionResponse<null>>;
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
                const aTime = toMillis(aData.createdAt);
                const bTime = toMillis(bData.createdAt);
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
