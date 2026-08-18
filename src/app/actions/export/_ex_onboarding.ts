"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { hashData } from "@/lib/security";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { checkModuleAccess } from "@/lib/module-access-check";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeValue, toMillis } from "@/lib/firestore-serialize";
// ============================================
// Submit Export Onboarding Action
// ============================================

// ============================================
// Submit Export Onboarding Action
// ============================================

import { uploadFileToStorage } from "@/lib/storage-admin";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { exportOnboardingSchema } from "@/lib/types/export-actions";

export async function submitExportOnboardingAction(
    prevState: any,
    formData: FormData
) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "Authentication required", success: false as const, data: null };
        }

        const userId = session.user.id;

        // Check for existing application
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.export?.status;

        if (existingStatus === 'pending' || existingStatus === 'pending_approval' || existingStatus === 'under_review') { 
            return { success: false as const, error: "Your previous application is still being processed.", meta: null };
        }
        if (existingStatus === 'approved') { return { success: false as const, data: undefined, error: "You are already registered for Export.", meta: null };
        }

        // Extract Data — wrap JSON.parse in try/catch to guard against malformed input
        let profile: Record<string, unknown>;
        let kycData: Record<string, unknown>;
        let bank: Record<string, unknown>;
        let terms: Record<string, unknown>;
        try { profile = JSON.parse((formData.get("profile") as string | null) ?? "{}"); }
        catch { return { success: false as const, error: "Invalid profile data", meta: null }; }
        try { kycData = JSON.parse((formData.get("kycData") as string | null) ?? "{}"); }
        catch { return { success: false as const, error: "Invalid KYC data", meta: null }; }
        try { bank = JSON.parse((formData.get("bank") as string | null) ?? "{}"); }
        catch { return { success: false as const, error: "Invalid bank data", meta: null }; }
        try { terms = JSON.parse((formData.get("terms") as string | null) ?? "{}"); }
        catch { return { success: false as const, error: "Invalid terms data", meta: null }; }

        // Validate payload using Zod schema
        const validation = exportOnboardingSchema.safeParse({ profile, kycData, bank, terms });
        if (!validation.success) {
            return { success: false as const, error: validation.error.issues[0]?.message || "Validation failed", meta: null };
        }
        const validatedData = validation.data;

        const idDocument = formData.get("idDocument");
        const proofOfAddress = formData.get("proofOfAddress");

        if (!idDocument || (idDocument instanceof File && idDocument.size === 0)) {
            return { success: false as const, error: "ID Document is required", meta: null };
        }
        if (!proofOfAddress || (proofOfAddress instanceof File && proofOfAddress.size === 0)) {
            return { success: false as const, error: "Proof of Address document is required", meta: null };
        }

        // Upload Documents
        const documents: any = {};

        if (idDocument) {
            if (typeof idDocument === "string" && idDocument.startsWith("http")) {
                documents.idDocument = idDocument;
            } else if (idDocument instanceof File && idDocument.size > 0) {
                documents.idDocument = await uploadFileToStorage(
                    idDocument,
                    `export-kyc/${userId}/id-document`
                );
            }
        }

        if (proofOfAddress) {
            if (typeof proofOfAddress === "string" && proofOfAddress.startsWith("http")) {
                documents.proofOfAddress = proofOfAddress;
            } else if (proofOfAddress instanceof File && proofOfAddress.size > 0) {
                documents.proofOfAddress = await uploadFileToStorage(
                    proofOfAddress,
                    `export-kyc/${userId}/proof-of-address`
                );
            }
        }

        // Generate unique application ID
        const applicationId = `EXPORT-ONBOARD-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        // Combine all onboarding data
        const fullApplication = { applicationId,
            userId,
            userEmail: session.user.email,
            profile: validatedData.profile,
            kyc: {
                ...validatedData.kycData,
                documents: documents // Now contains URLs
            },
            bank: validatedData.bank,
            terms: validatedData.terms,
            status: "pending_review",
            submittedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() };

        const batch = db.batch();
        const onboardingRef = db.collection(COLLECTIONS.EXPORT_APPLICATIONS).doc();
        batch.set(onboardingRef, fullApplication);

        // Update user document to mark export service registration with safe dot notation.
        // ALSO mirror PII from the profile object to the root User doc so admin broadcasts,
        // Communication Hub queries, and user listings can find this user's data.
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const profileFirstName = validatedData.profile.firstName;
        const profileLastName  = validatedData.profile.lastName;
        const profileOtherName = validatedData.profile.otherName || null;
        const computedFullName = [profileFirstName, profileOtherName, profileLastName]
            .filter(Boolean).join(" ").trim();

        batch.update(userRef, { "serviceRegistrations.export.status": "pending_approval",
            "serviceRegistrations.export.paymentStatus": "completed",
            "serviceRegistrations.export.applicationId": applicationId,
            "serviceRegistrations.export.appliedAt": FieldValue.serverTimestamp(),
            // Mirror PII to root (dot-notation keeps all other fields intact)
            ...(profileFirstName  && { firstName: profileFirstName }),
            ...(profileLastName   && { lastName: profileLastName }),
            ...(profileOtherName  !== null && { otherName: profileOtherName }),
            ...(computedFullName  && { fullName: computedFullName }),
            phone: validatedData.profile.phone,
            stateOfOrigin: validatedData.profile.state,
            updatedAt: FieldValue.serverTimestamp() });

        await batch.commit();

        // FAST STATS UPDATER (Non-blocking fallback safe)
        db.collection("system_metadata").doc("export_stats")
            .set({ pending: FieldValue.increment(1) }, { merge: true })
            .catch(() => {});

        try { await invalidateUserCache(userId);
        } catch (err) { logger.error("Failed to invalidate cache after Export application:", err);
        }

        return { error: null, success: true as const,
            meta: null
        , data: { message: "Onboarding submitted" } };
    } catch (error: any) { logger.error("Submit export onboarding error:", error);
        return { error: "Failed to submit onboarding application", success: false as const, data: undefined, meta: null };
    }
}


// ============================================
// Check Export Application Status Action
// ============================================

export async function checkExportStatusAction(): Promise<string | null> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null;
        const { session } = sessionResult;
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        let status = userData?.serviceRegistrations?.export?.status;

        // ── AUTHORITATIVE CHECK: Check real application record ──────
        // If status is not approved, check the source of truth for Export applications.
        if (status !== "approved") {
            let appDoc: any = null;
            const appSnap = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
                .where("userId", "==", session.user.id)
                .get();

            if (!appSnap.empty) {
                const sortedDocs = appSnap.docs.sort((a, b) => {
                    const aVal = a.data().submittedAt || a.data().createdAt;
                    const bVal = b.data().submittedAt || b.data().createdAt;
                    const aTime = aVal?.toMillis?.() || aVal?.seconds * 1000 || (aVal ? new Date(aVal).getTime() : 0);
                    const bTime = bVal?.toMillis?.() || bVal?.seconds * 1000 || (bVal ? new Date(bVal).getTime() : 0);
                    return bTime - aTime;
                });
                appDoc = sortedDocs[0];
            } else if (userData?.serviceRegistrations?.export?.applicationId) {
                const appId = userData.serviceRegistrations.export.applicationId;
                const directDoc = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS).doc(appId).get();
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
                    let emailQuery = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
                        .where("userEmail", "==", userEmail)
                        .limit(1)
                        .get();
                    if (emailQuery.empty) {
                        emailQuery = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
                            .where("profile.email", "==", userEmail)
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
                if (appData.status === "approved" || appData.status === "approved_admin") {
                    status = "approved";
                    // Proactively backfill for performance in future logins
                    await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
                        "serviceRegistrations.export.status": "approved",
                        "serviceRegistrations.export.syncedAt": new Date().toISOString()
                    });
                } else if (appData.status) { // Normalize statuses
                    status = appData.status === "pending_review" ? "pending_approval" : appData.status;
                }
            }
        }

        if (status) { return status;
        }

        // ── FALLBACK: Legacy Sync ──────
        const legacySnap = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
            .where('userId', '==', session.user.id)
            .get();

        if (!legacySnap.empty) { const sortedDocs = legacySnap.docs.map(d => d.data()).sort((a: any, b: any) => {
                const aTime = toMillis(a.createdAt);
                const bTime = toMillis(b.createdAt);
                return bTime - aTime;
            });
            const legacyData = sortedDocs[0];
            const legacyStatus = legacyData?.status ?? 'pending';

            await db.collection(COLLECTIONS.USERS).doc(session.user.id).update(
                {
                    "serviceRegistrations.export.status": legacyStatus,
                    "serviceRegistrations.export.syncedFromLegacy": true,
                    "serviceRegistrations.export.syncedAt": new Date().toISOString()
                }
            );

            logger.info(`[checkExportStatus] Backfilled legacy export status '${legacyStatus}' for user ${session.user.id}`);
            return legacyStatus;
        }

        return null;
    } catch (error) { logger.error("Error checking export status:", error);
        return null;
    }
}


// ============================================================================
// REVISION FLOW
// ============================================================================

/**
 * Get current user's existing export onboarding application (for pre-populating edit form)
 */
export async function getExportApplicationAction(): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: 'Unauthorized'};

        const userDocRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userDocRef.get();
        const userData = userDoc.data();
        let applicationId = userData?.serviceRegistrations?.export?.applicationId;

        let appDoc: any = null;
        let foundByQuery = false;

        if (applicationId) {
            const docSnap = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS).doc(applicationId).get();
            if (docSnap.exists) {
                appDoc = docSnap;
            }
        }

        if (!appDoc) {
            const snap = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
                .where('userId', '==', session.user.id)
                .get();

            if (!snap.empty) {
                const sortedDocs = snap.docs.sort((a, b) => {
                    const aTime = toMillis(a.data().createdAt);
                    const bTime = toMillis(b.data().createdAt);
                    return bTime - aTime;
                });
                appDoc = sortedDocs[0];
                applicationId = appDoc.id;
                foundByQuery = true;
            }
        }

        if (!appDoc) return { success: false as const, error: 'No application found'};

        const appData = appDoc.data()!;
        const { serializeValue } = await import("@/lib/firestore-serialize");
        const data = serializeValue(appData);

        // Self-healing: backfill missing links
        const batch = db.batch();
        let needsCommit = false;

        if (foundByQuery || !userData?.serviceRegistrations?.export?.applicationId) {
            batch.update(userDocRef, {
                "serviceRegistrations.export.applicationId": applicationId
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
            ...data,
            data: data,
            revisionNote: data.revisionNote || null
        };
    } catch (error) { logger.error('getExportApplicationAction error:', error);
        return { success: false as const, error: 'Failed to fetch application'};
    }
}


/**
 * Admin: Request revision on an export onboarding application
 */
export async function requestExportRevisionAction(
    applicationId: string,
    reason: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) { return { success: false as const, error: 'Admin access required'};
        }

        const appRef = db.collection(COLLECTIONS.EXPORT_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();
        if (!appDoc.exists) return { success: false as const, error: 'Application not found'};

        const appData = appDoc.data();
        const userId = appData?.userId;

        const batch = db.batch();
        batch.update(appRef, { status: 'revision_required',
            revisionNote: reason,
            revisionRequestedAt: FieldValue.serverTimestamp(),
            revisionRequestedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp() });

        if (userId) { batch.update(db.collection(COLLECTIONS.USERS).doc(userId), {
                'serviceRegistrations.export.status': 'revision_required',
                updatedAt: FieldValue.serverTimestamp() });
        }
        await batch.commit();

        // Send revision email (non-blocking)
        try { const { Resend } = await import('resend');
            const resend = new Resend(process.env.RESEND_API_KEY);
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            const email = userDoc.data()?.email;
            const name = userDoc.data()?.fullName || userDoc.data()?.displayName || 'Applicant';
            if (email) {
                await resend.emails.send({
                    from: process.env.EMAIL_FROM || 'Easy Sales Export <info@easysalesexport.com>',
                    to: email,
                    subject: '⚠️ Action Required: Update Your Export Application',
                    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                        <h2 style="color:#ea580c;">Export Application — Update Required</h2>
                        <p>Dear <strong>${name}</strong>,</p>
                        <p>Our team has reviewed your Export Windows onboarding application and requires some additional information.</p>
                        <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:16px;margin:16px 0;">
                            <p style="margin:0;color:#9a3412;"><strong>Note from Admin:</strong><br/>${reason}</p>
                        </div>
                        <p>Please log in to update and resubmit your application.</p>
                        <div style="text-align:center;margin:24px 0;">
                            <a href="${process.env.NEXTAUTH_URL || 'https://easysalesexport.com'}/export/onboarding" style="background:#ea580c;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Update Application</a>
                        </div>
                    </div>` });
            }
        } catch (emailError) { logger.error('Export revision email failed (non-blocking):', emailError);
        }

        return { error: null, success: true as const , data: { message: "Revision requested" } };
    } catch (error) { logger.error('requestExportRevisionAction error:', error);
        return { success: false as const, error: 'Failed to request revision'};
    }
}


/**
 * Admin: Approve an export onboarding application — sets status + sends approval email
 */
/**
 * Admin: Approve an export onboarding application.
 *
 * TWO APPROVALS, DOING DIFFERENT THINGS
 * -------------------------------------
 * The platform has two export approval endpoints over the same collection, and
 * this was the weaker one. /admin/export/applications calls the other —
 * approveExportOnboardingAction in admin/_exports.ts — while this one is
 * re-exported through the export barrel and reachable regardless.
 *
 *   GUARD        canonical: hasAdminPermission(users:update) OR
 *                           export:approve_applications, then admin/super_admin
 *                this one:  the literal session-token roles admin/super_admin,
 *                           so an admin holding export:approve_applications was
 *                           allowed by one and refused by the other.
 *
 *   FIELD NAMES  canonical writes reviewedBy / reviewedAt
 *                this one wrote approvedBy / approvedAt
 *                — so who approved an application, and when, was recorded under
 *                  whichever pair of names the caller happened to reach, and a
 *                  screen reading one pair showed nothing for applications
 *                  approved through the other.
 *
 *   isVerified   canonical sets it, with verifiedBy/verifiedAt; this one did not.
 *   PAYMENT      canonical sets serviceRegistrations.export.paymentStatus and
 *                approvedAt; this one set neither.
 *   CACHE        canonical invalidates the export service cache and the global
 *                admin stats. This one invalidated nothing, so an approval did
 *                not take effect until the cache expired.
 *   LOOKUP       canonical resolves the application by document id OR by its
 *                applicationId field; this one by document id alone, so an id
 *                taken from a screen showing applicationId simply missed.
 *
 * Rather than delete a reachable endpoint, it delegates. One implementation, so
 * the two cannot drift again, and any caller still pointing here gets the
 * behaviour the platform considers correct.
 */
export async function approveExportApplicationAction(
    applicationId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    // Fails fast for an anonymous caller; the AUTHORISATION decision — which
    // roles may approve — belongs to the canonical implementation alone, so
    // there is still only one answer to it. A strictly weaker precondition, not
    // a second rule that could disagree with the first.
    const sessionResult = await requireSession();
    if (!sessionResult.session?.user?.id) {
        return { success: false as const, error: 'Unauthorized', data: null, meta: null };
    }

    const { approveExportOnboardingAction } = await import("@/app/actions/admin/_exports");
    const result = await approveExportOnboardingAction(applicationId);

    return result.success
        ? { error: null, success: true as const, data: { message: "Application approved" }, meta: null }
        : { success: false as const, error: result.error ?? "Failed to approve application", data: null, meta: null };
}

// ============================================================================
// USER RESUBMIT — Export Onboarding
// ============================================================================

/**
 * Update and resubmit an export onboarding application that was rejected or flagged for revision.
 */
export async function resubmitExportApplicationAction(
    fields: Record<string, any>
) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, data: null, error: 'Unauthorized', meta: null };

        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.export?.status;
        const allowedStatuses = ['pending_approval', 'revision_required', 'rejected'];
        if (!allowedStatuses.includes(existingStatus || '')) { return { success: false as const, data: null, error: 'Your application cannot be resubmitted at this time.', meta: null };
        }

        let applicationId = userDoc.data()?.serviceRegistrations?.export?.applicationId;
        let appRef: any = null;
        let oldData: any = null;
        let foundByQuery = false;

        if (applicationId) {
            const directDoc = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS).doc(applicationId).get();
            if (directDoc.exists) {
                appRef = directDoc.ref;
                oldData = directDoc.data();
            }
        }

        if (!appRef) {
            const snap = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
                .where('userId', '==', userId)
                .get();

            if (!snap.empty) {
                const sortedDocs = snap.docs.sort((a, b) => {
                    const aTime = toMillis(a.data().createdAt);
                    const bTime = toMillis(b.data().createdAt);
                    return bTime - aTime;
                });
                appRef = sortedDocs[0].ref;
                oldData = sortedDocs[0].data();
                applicationId = appRef.id;
                foundByQuery = true;
            }
        }

        if (!appRef) return { success: false as const, data: null, error: 'No existing application found', meta: null };

        const profile = fields.profile || {};
        const kycData = fields.kyc || {};
        const bank = fields.bank || {};
        const terms = fields.terms || {};

        // Validate payload using Zod schema
        const validation = exportOnboardingSchema.safeParse({ profile, kycData, bank, terms });
        if (!validation.success) {
            return { success: false as const, error: validation.error.issues[0]?.message || "Validation failed", data: null, meta: null };
        }
        const validatedData = validation.data;

        const batch = db.batch();
        batch.update(appRef, { 
            userId, // Ensure userId is populated
            profile: validatedData.profile,
            kyc: {
                ...validatedData.kycData,
                documents: fields.kyc?.documents || {}
            },
            bank: validatedData.bank,
            terms: validatedData.terms,
            status: 'pending_review',
            revisionNote: null,
            resubmittedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() 
        });

        const profileFirstName = validatedData.profile.firstName;
        const profileLastName  = validatedData.profile.lastName;
        const profileOtherName = validatedData.profile.otherName || null;
        const computedFullName = [profileFirstName, profileOtherName, profileLastName]
            .filter(Boolean).join(" ").trim();

        batch.update(db.collection(COLLECTIONS.USERS).doc(userId), { 
            'serviceRegistrations.export.status': 'pending_approval',
            'serviceRegistrations.export.applicationId': applicationId,
            // Mirror PII to root
            ...(profileFirstName  && { firstName: profileFirstName }),
            ...(profileLastName   && { lastName: profileLastName }),
            ...(profileOtherName  !== null && { otherName: profileOtherName }),
            ...(computedFullName  && { fullName: computedFullName }),
            phone: validatedData.profile.phone,
            stateOfOrigin: validatedData.profile.state,
            // Mirror bank details
            ...(validatedData.bank.accountNumber ? {
                bankDetails: {
                    accountNumber: validatedData.bank.accountNumber,
                    bankName: validatedData.bank.bankName || "",
                    accountName: validatedData.bank.accountName || "",
                    bankCode: ""
                }
            } : {}),
            // Mirror KYC details
            // The applicant typed these. Nobody checked them.
            //
            // `ninVerified`/`bvnVerified`/`cacVerified` were set to true right
            // here, from the presence of the field. admin/users renders each as
            // a green "Verified" badge, so the reviewer deciding whether to
            // approve THIS application was told the identity had already been
            // checked — because the applicant had filled the box in. Nothing in
            // the codebase ever verified an identity document, so the badge was
            // never earned by anyone.
            //
            // The numbers are still stored, now hashed, matching kyc.ts and
            // wave/_actions.ts which both write hashData(bvn). The reviewable
            // copy is untouched in the verification record, so admin review is
            // unaffected — this replica exists for the user list, and it was the
            // only place a readable BVN sat in the users table. That is the
            // table that spent 52 days in a public repository.
            ...(validatedData.kycData.nin ? { nin: hashData(validatedData.kycData.nin) } : {}),
            ...(validatedData.kycData.bvn ? { bvn: hashData(validatedData.kycData.bvn) } : {}),
            ...(validatedData.kycData.cacNumber ? { cacNumber: validatedData.kycData.cacNumber } : {}),
            updatedAt: FieldValue.serverTimestamp() 
        });

        const oldStatus = oldData?.status;

        await batch.commit();

        // FAST STATS UPDATER (Non-blocking fallback safe)
        const updates: any = { pending: FieldValue.increment(1), resubmitted: FieldValue.increment(1) };
        if (oldStatus === 'rejected') updates.rejected = FieldValue.increment(-1);
        if (oldStatus === 'approved') updates.approved = FieldValue.increment(-1);

        db.collection("system_metadata").doc("export_stats")
            .set(updates, { merge: true })
            .catch(() => {});

        try { await invalidateUserCache(userId);
        } catch (err) { logger.error("Failed to invalidate cache after Export application resubmission:", err);
        }

        return { error: null, success: true as const, data: { message: "Application resubmitted" }, meta: null };
    } catch (error) { logger.error('resubmitExportApplicationAction error:', error);
        return { success: false as const, data: null, error: 'Failed to resubmit application', meta: null };
    }
}


/**
 * Check if the current user has access to the export module.
 * Direct Firestore service registrations check fallback is run when JWT roles are stale.
 */
export async function checkExportAccessAction(): Promise<boolean> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return false;
        return await checkModuleAccess(
            sessionResult.session.user.id,
            sessionResult.session.user.roles || [],
            "export"
        );
    } catch (error) {
        logger.error("checkExportAccessAction error:", error);
        return false;
    }
}
