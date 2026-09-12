"use server";

import { z } from "zod";
import { html } from "@/lib/utils";
import { withFlexibleSafeAction, ActionResponse, type ActionState } from "@/lib/safe-action";
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import crypto from 'crypto';
import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { chooseProfileForAuthAccount } from "@/lib/profile-choice";
import { createAdminAuditLog } from "@/lib/audit-log";
import { LegacyOnboardingSchema } from "@/lib/schemas";
import { sendLegacyMemberWelcomeEmail, sendEmailNotification } from "@/lib/email-notifications";
import { hasAdminPermission, includesPrivilegedRole, isSuperAdmin } from "@/lib/admin-permissions";
import { requireAdmin } from "@/lib/require-admin";
// ============================================
// Import Legacy Cooperative Member
// ============================================

import { strictEmailSchema } from "@/lib/schemas";

const InviteLegacyMemberSchema = z.object({
    email: strictEmailSchema,
    firstName: z.string().min(1, "First name is optional but recommended for personalization").optional(),
});

async function _inviteLegacyMemberAction(
    data: z.infer<typeof InviteLegacyMemberSchema>
): Promise<ActionResponse<null>> {
    /* Original implementation below (deprecated and causing build errors)
    try {
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { error: (adminCheck as any).error, success: false as const };

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;

        if (!session?.user || !hasAdminPermission(session.user.roles, "users:create")) {
             if (!hasAdminPermission(session.user.roles, "cooperatives:approve_members")) {
                return { error: "Unauthorized: Permission required - cooperatives:approve_members", success: false as const };
             }
        }

        const valid = InviteLegacyMemberSchema.safeParse(data);
        if (!valid.success) {
        // 1. Check if user is already a fully onboarded cooperative member
        let existingUid: string | null = null;
        try {
            const existing = await adminAuth.getUserByEmail(email);
            existingUid = existing.uid;
        } catch (err: any) {
            // User doesn't exist in Auth, which is fine. They will create an account during onboarding.
        }

        if (existingUid) {
            const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(existingUid);
            const memberDoc = await memberRef.get();
            if (memberDoc.exists && memberDoc.data()?.onboardingCompleted === true) {
                return { error: "User is already a fully onboarded cooperative member.", success: false as const };
            }
        }

        // 2. Map existing active tokens for this email to revoked
        const invitesQuery = await db.collection(COLLECTIONS.COOPERATIVES_INVITES)
            .where("email", "==", email)
            .where("status", "==", "pending")
            .get();

        const batch = db.batch();
        invitesQuery.docs.forEach(doc => {
            batch.update(doc.ref, { status: "revoked", updatedAt: FieldValue.serverTimestamp() });
        });

        // 3. Generate secure token
        const token = crypto.randomBytes(32).toString('hex');
        const now = FieldValue.serverTimestamp();

        // 4. Validate and construct URL
        const inviteRef = db.collection(COLLECTIONS.COOPERATIVES_INVITES).doc(token);
        batch.set(inviteRef, {
            email,
            token,
            status: "pending",
            invitedBy: session.user.id,
            createdAt: now,
            updatedAt: now,
        });

        // 5. Commit Firestore
        await batch.commit();

        // 6. Send Email
        const onboardingLink = `https://www.easysalesexport.com/cooperatives/onboarding?token=${token}`;

        if (process.env.RESEND_API_KEY) {
            try {

                const { error: emailError } = await sendEmailNotification({
                    from: process.env.EMAIL_FROM || "Easy Sales Cooperative <info@easysalesexport.com>",
                    to: email,
                    subject: "You're Invited to the Cooperative!",
                    message: html`
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                            <h2 style="color: #6366f1;">Welcome to the Cooperative!</h2>
                            <p>Hello ${firstName || "Member"},</p>
                            <p>You have been invited to formally complete your cooperative onboarding on the Easy Sales Export platform. Because you're an existing member, <strong>your registration fee has already been waived</strong> when you use this direct link.</p>
                            <div style="background: #eef2ff; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #c7d2fe;">
                                <p style="margin: 0; color: #4338ca;">Click the button below to join:</p>
                            </div>

                            <div style="text-align: center; margin-top: 30px;">
                                <a href="${onboardingLink}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Complete Onboarding</a>
                            </div>

                            <p style="margin-top: 30px; font-size: 12px; color: #6b7280;">If the button doesn't work, copy and paste this link into your browser:<br/>${onboardingLink}</p>
                        </div>
                    `,
                    metadata: { type: "legacy_onboarding" },
                });

                if (emailError) {
                    logger.error("Resend API Error (Coop Invite):", emailError);
                    return { error: "Invite created but failed to send email. Link: " + onboardingLink, success: true as const }; // Partial success
                }
            } catch (err: any) {
                logger.error("Resend Error (Coop Invite):", err);
                return { error: "Invite created but failed to send email.", success: true as const };
            }
        } else {
             logger.warn("RESEND_API_KEY is not set. Assuming development mode. Invite created silently.");
        }

        // 7. Audit Log
        await createAdminAuditLog({
            action: "legacy_member_invited",
            userId: session.user.id,
            targetId: token,
            targetType: "cooperative_member",
            metadata: { email: email },
        });

        return { error: null, success: true as const };
    } catch (error: any) {
        logger.error("Failed to send cooperative invite:", error);
        return { error: error.message || "Failed to invite member", success: false as const };
    }
    */
    return { error: "Method deprecated", success: false as const, data: null };
}

export const inviteLegacyMemberAction = withFlexibleSafeAction("inviteLegacyMemberAction", _inviteLegacyMemberAction);

// ============================================
// Onboard Legacy Member
// ============================================

/**
 * Onboard Legacy Member Action
 * Allows admins to pre-register existing members and pre-fill their profile data.
 * Sends a welcome email with a temporary password.
 */
/**
 * What onboarding an existing member actually did — #290.
 *
 * ActionState's success arm is `{ error: null; success: true; message: string }`
 * and is shared by every admin action, so it is not widened for this one. This
 * action has three outcomes rather than one, and a caller that has to read
 * English prose to tell them apart will not bother — ImportLegacyModal did not,
 * for as long as the feature has existed.
 *
 *   isNewUser          false when the email already had an account. NO EMAIL IS
 *                      SENT in that case, and the existing password stands.
 *   emailSent          whether the welcome email with the temporary PIN
 *                      actually left. False does NOT mean failure: the member
 *                      exists either way, which is why success stays true.
 *   temporaryPassword  present ONLY when isNewUser && !emailSent — the case
 *                      where the admin has to hand the PIN over themselves. It
 *                      is the same value `message` has always embedded in that
 *                      case, in a field a screen can render.
 */
export type LegacyOnboardingState =
    | { error: string; success: false }
    | {
        error: null;
        success: true;
        message: string;
        isNewUser: boolean;
        emailSent: boolean;
        temporaryPassword: string | null;
    };

async function _onboardLegacyMemberAction(
    formData: any
): Promise<LegacyOnboardingState> {
    try {
        const adminCheck = await requireAdmin("users:create");
        if ("error" in adminCheck) return { error: adminCheck.error, success: false as const };

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const { session } = sessionResult;

        // Permission check with live roles fallback
        let roles = session.user.roles;
        if (!hasAdminPermission(roles, "users:create")) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (hasAdminPermission(liveRoles, "users:create")) {
                roles = liveRoles;
            } else {
                return { error: "Unauthorized: Permission users:create required", success: false as const };
            }
        }

        // Validate input
        const validated = LegacyOnboardingSchema.safeParse(formData);
        if (!validated.success) {
            return { error: validated.error.issues[0].message, success: false as const };
        }

        const data = validated.data;

        /**
         * THE THIRD ROLE-WRITER, and the one that had no escalation guard.
         *
         * admin-permissions.ts's includesPrivilegedRole exists because both
         * role-writing endpoints accepted whatever list they were handed, and
         * its header names them: bulkAssignRolesAction and
         * updateUserRolesAction. Both route through it now.
         *
         * This is a third. `data.roles` is written wholesale onto the user
         * document below, LegacyOnboardingSchema's UserRoleSchema accepts
         * "admin" and "super_admin" as values, and the only gate in front of it
         * is `users:create` — which PERMISSION_MATRIX gives to plain `admin`.
         *
         * So an admin could open the legacy-onboarding screen, type any email
         * address, tick super_admin, and mint an account holding exactly the
         * permissions the matrix withholds from them — collecting them on a new
         * identity rather than their own, which is if anything harder to notice.
         *
         * Same rule, same helper, so the three cannot drift: any resulting role
         * set containing a privileged role needs a super_admin to write it.
         */
        if (includesPrivilegedRole(data.roles) && !isSuperAdmin(roles)) {
            return {
                error: "Only a super admin can onboard a member with admin roles",
                success: false as const,
            };
        }
        data.email = data.email.toLowerCase(); // Permanent Fix: Force lowercase normalization

        // 1. Resolve Identity and Enforce Uniqueness (with Auto-Resolution)
        let targetUid: string | null = null;
        let oldUidToMigrate: string | null = null;

        // Check Firebase Auth by email
        let authRecord = await adminAuth.getUserByEmail(data.email).catch(() => null);
        if (authRecord) {
            targetUid = authRecord.uid;
        }

        // Check Firestore by email to prevent ghost documents and handle duplicate stubs
        const emailCheck = await db.collection(COLLECTIONS.USERS)
            .where("email", "==", data.email)
            .get();

        /**
         *   #681 LEGACY IMPORT DELETED A MEMBER'S OTHER PROFILE DOCUMENTS, AND
         *        PICKED THE SURVIVOR ARBITRARILY.
         *
         *        Three sites in this block called every user document sharing
         *        the email — other than the one it had settled on — a
         *        "duplicate stub" or "ghost document", and did
         *        `cleanBatch.delete(doc.ref)`. Nothing checked whether those
         *        rows carried roles, balances, module registrations or a
         *        payment history. "We can safely delete duplicate stubs" was
         *        asserted, never established.
         *
         *        IT CONTRADICTS FOUR THINGS THIS PLATFORM HAS ALREADY SETTLED:
         *
         *          · the standing instruction that nothing here is deleted or
         *            destroyed — #292, and #675 which guards the Cloudinary
         *            half of it;
         *          · #300, where erasure MARKS a row and keeps its status,
         *            dates and balances, precisely so a payout still owed can
         *            still be found;
         *          · #490, which found 95 addresses in production holding more
         *            than one profile and recorded that TWO ROWS PER MIGRATED
         *            PERSON IS BY DESIGN — `migrateLegacyUserData` copies the
         *            profile forward and TOMBSTONES the original. This was
         *            deleting the tombstones that design depends on;
         *          · #490 again: "This does not decide which row is the person,
         *            and must not: that is a judgement about somebody's records,
         *            and the platform has no basis for it."
         *
         *        AND THE SURVIVOR WAS `docs[0]` OF AN UNORDERED QUERY. Whichever
         *        row the database happened to return first became the person. In
         *        the branch below that copies data forward it took `stubs[0]` as
         *        the source and then deleted the rest, so a member with three
         *        profiles kept whatever was in one of them and lost the other
         *        two. #476 and #477 built `chooseProfileForAuthAccount` for
         *        exactly this question and it was not used here.
         *
         *   WHAT IT DOES NOW. It chooses by evidence, through the shared
         *   chooser, and it SUPERSEDES the rows it does not choose instead of
         *   removing them — `_migratedTo`, the same tombstone
         *   `migrateLegacyUserData` writes and `profile-choice.ts` already knows
         *   how to skip. So the login path, the ghost scan and the forensic all
         *   behave as they already do for a migrated member, because this is
         *   not a new contract; it is the one that existed.
         */
        if (!emailCheck.empty) {
            /** Mark a row as superseded by `winner`. Never removes it — #681. */
            const supersede = async (docs: { id: string; ref: any }[], winner: string) => {
                if (docs.length === 0) return;
                const batch = db.batch();
                for (const doc of docs) {
                    batch.update(doc.ref, {
                        _migratedTo: winner,
                        _supersededAt: FieldValue.serverTimestamp(),
                        _supersededBy: "legacy-import",
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }
                await batch.commit();
                logger.info(
                    `[Legacy Onboarding] Superseded ${docs.length} profile row(s) for ${winner} — `
                    + `marked with _migratedTo, not deleted (#681).`,
                );
            };

            if (targetUid) {
                // If Auth user exists, the Firestore document ID MUST match targetUid.
                const matchingDoc = emailCheck.docs.find(doc => doc.id === targetUid);
                const others = emailCheck.docs.filter(doc => doc.id !== targetUid);

                if (others.length > 0) {
                    if (matchingDoc) {
                        //   The row carrying the auth id is the person by
                        //   identity, not by inference. The rest are pointed at
                        //   it and kept.
                        await supersede(others, targetUid);
                    } else {
                        /*
                         *   No row carries the auth id yet. WHICH ROW'S DATA
                         *   MOVES FORWARD IS A REAL QUESTION, and `stubs[0]`
                         *   was not an answer to it — it was whatever the
                         *   database listed first.
                         *
                         *   `chooseProfileForAuthAccount` ranks by evidence and
                         *   reports `ambiguous` when nothing identifies the
                         *   account outright, which is logged so the operator
                         *   can see a judgement was made on their behalf.
                         */
                        const choice = chooseProfileForAuthAccount(others, targetUid);
                        const sourceDoc = choice.chosen ?? others[0];
                        oldUidToMigrate = sourceDoc.id;

                        if (choice.ambiguous) {
                            logger.warn(
                                `[Legacy Onboarding] No profile identifies itself with ${targetUid}. `
                                + `Chose ${sourceDoc.id} from ${choice.candidates} row(s) by evidence `
                                + `(#477) — these rows need reconciling.`,
                            );
                        }

                        logger.info(`[Legacy Onboarding] Firestore data conflict detected for ${data.email}. Migrating doc ${oldUidToMigrate} to match Auth UID ${targetUid}`);

                        // Migrate user document to targetUid
                        const userData = sourceDoc.data();
                        await db.collection(COLLECTIONS.USERS).doc(targetUid).set({
                            ...userData,
                            uid: targetUid,
                            updatedAt: FieldValue.serverTimestamp()
                        }, { merge: true });

                        //   Every row that was not copied forward is kept and
                        //   pointed at the winner — including the source, whose
                        //   data now lives under targetUid as well.
                        await supersede(others, targetUid);
                    }
                }
            } else {
                /*
                 *   No Auth user exists yet, so there is no identity to match
                 *   and evidence is all there is. It took `docs[0]`; it asks
                 *   the shared chooser now, and says when the answer was a
                 *   judgement rather than a fact.
                 */
                const choice = chooseProfileForAuthAccount(emailCheck.docs, "");
                const primaryDoc = choice.chosen ?? emailCheck.docs[0];
                targetUid = primaryDoc.id;

                if (choice.ambiguous && emailCheck.docs.length > 1) {
                    logger.warn(
                        `[Legacy Onboarding] ${emailCheck.docs.length} profiles share ${data.email} and none `
                        + `carries an auth id. Adopted ${targetUid} by evidence (#477) — these rows need `
                        + `reconciling.`,
                    );
                }

                await supersede(
                    emailCheck.docs.filter(doc => doc.id !== targetUid),
                    targetUid,
                );
            }
        }

        /**
         *   #682 THE MODULE MIGRATION MERGED ONE MEMBERSHIP ROW ONTO ANOTHER
         *        AND THEN DELETED THE EVIDENCE.
         *
         *        Each of these eight collections was moved with
         *
         *            set(target, { ...source.data() }, { merge: true })
         *            delete(source)
         *
         *        and `merge: true` means THE SOURCE'S FIELDS WIN. Nothing
         *        checked whether the target already existed.
         *
         *        MEASURED, not reasoned about. A `cooperative_members` row at
         *        the target id holding `savingsBalance: 50000`, merged with a
         *        source row holding `savingsBalance: 0`, leaves 0 — and the
         *        source is then deleted, so the only other copy of the number
         *        is gone too. That collection carries `savingsBalance` and
         *        `lockedBalance`; this is a member's cooperative savings.
         *
         *        It is reachable: `oldUidToMigrate` is set when no USERS
         *        document carries the auth id, which says nothing at all about
         *        whether a cooperative_members or wave_members row does.
         *
         *   WHAT IT DOES NOW. A target that already exists is a CONFLICT, not
         *   an opportunity to merge: two rows carry a version of this person's
         *   record in that module, and which one is right is exactly the
         *   judgement #490 says the platform has no basis for making
         *   unattended. Both rows are left alone and the operator is told.
         *
         *   WHERE THE TARGET IS ABSENT the move is unchanged, and that is not
         *   a deletion in the sense #681 is about: the data provably lands at
         *   the new id in the same commit. It is a rename. Superseding instead
         *   would leave two membership rows for one member, and the readers of
         *   THESE collections are not tombstone-aware the way
         *   profile-choice.ts is — so it would trade a rare loss for a
         *   guaranteed ambiguity.
         *
         *   THE BATCH IS STILL NOT ATOMIC (#679), which is survivable here for
         *   the same reason: each collection's set and delete sit next to each
         *   other, so a failure part-way leaves earlier collections moved and
         *   later ones untouched, and re-running the import completes it.
         */
        if (oldUidToMigrate && targetUid) {
            const migrationBatch = db.batch();
            const conflicts: string[] = [];

            /** Move one document, unless something is already at the destination. */
            const moveOrReportConflict = async (col: string, fromId: string, toId: string) => {
                const docSnap = await db.collection(col).doc(fromId).get();
                if (!docSnap.exists) return;

                const existing = await db.collection(col).doc(toId).get();
                if (existing.exists) {
                    //   Neither row is touched. Named so the operator can look
                    //   at the two of them; a count could not be acted on.
                    conflicts.push(`${col}: ${fromId} → ${toId}`);
                    logger.error(
                        `[Legacy Onboarding] REFUSED to merge ${col}/${fromId} onto ${col}/${toId} — `
                        + `both rows exist and merging would let the source's fields overwrite the `
                        + `target's, including balances (#682). Both rows are left as they are and `
                        + `need reconciling by hand.`,
                    );
                    return;
                }

                migrationBatch.set(db.collection(col).doc(toId), {
                    ...docSnap.data(),
                    userId: targetUid,
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });
                migrationBatch.delete(db.collection(col).doc(fromId));
            };

            // 1. Direct document IDs based on userId
            const directCollections = [
                COLLECTIONS.COOPERATIVE_MEMBERS,
                COLLECTIONS.VENDOR_SETTINGS,
                COLLECTIONS.ACADEMY_ENROLLMENTS,
                COLLECTIONS.WAVE_MEMBERS
            ];
            for (const col of directCollections) {
                await moveOrReportConflict(col, oldUidToMigrate, targetUid);
            }

            // 2. Legacy prefixed document IDs (legacy_{userId})
            const prefixedCollections = [
                COLLECTIONS.EXPORT_APPLICATIONS,
                COLLECTIONS.WAVE_APPLICATIONS,
                COLLECTIONS.FARM_NATION_APPLICATIONS,
                COLLECTIONS.ACADEMY_APPLICATIONS
            ];
            for (const col of prefixedCollections) {
                await moveOrReportConflict(col, `legacy_${oldUidToMigrate}`, `legacy_${targetUid}`);
            }

            await migrationBatch.commit();

            if (conflicts.length > 0) {
                logger.error(
                    `[Legacy Onboarding] ${conflicts.length} module row(s) were NOT migrated from `
                    + `${oldUidToMigrate} to ${targetUid} because a record already existed at the `
                    + `destination: ${conflicts.join("; ")}`,
                );
            }
            logger.info(`[Legacy Onboarding] Migrated child documents from ${oldUidToMigrate} to ${targetUid}`);
        }

        // 2. 🔒 DEDUP GUARD: Check Firestore by phone (Fraud Prevention)
        const phoneCheck = await db.collection(COLLECTIONS.USERS)
            .where("phone", "==", data.phone)
            .limit(1)
            .get();
        if (!phoneCheck.empty) {
            const phoneDoc = phoneCheck.docs[0];
            const phoneData = phoneDoc.data();
            const phoneUid = phoneDoc.id;
            
            // If it belongs to the same email, safely align targetUid.
            if (phoneData.email?.toLowerCase() === data.email.toLowerCase()) {
                if (!targetUid) {
                    targetUid = phoneUid;
                }
            } else {
                logger.warn(`[Legacy Onboarding] Duplicate phone number (${data.phone}) detected under a different email: ${phoneData.email}. Proceeding anyway as requested.`);
            }
        }

        const isNewUser = !authRecord;

        // 3. Generate default numeric PIN (6 digits)
        const tempPassword = Math.floor(100000 + Math.random() * 900000).toString(); 

        // 4. Create Firebase Auth user if not exists
        if (!authRecord) {
            const createParams: any = {
                email: data.email,
                password: tempPassword,
                displayName: data.fullName,
                emailVerified: true,
            };
            if (targetUid) {
                createParams.uid = targetUid; // Link to existing Firestore document
            }
            authRecord = await adminAuth.createUser(createParams);
            targetUid = authRecord.uid;
        }

        if (!targetUid) {
            return { error: "System Error: Failed to resolve user identity.", success: false as const };
        }

        const userRecord = { uid: targetUid };

        // 5. Prepare structured name
        const nameParts = data.fullName.trim().split(/\s+/);
        const firstName = nameParts[0] || "";
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
        const otherName = nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : "";

        // 6. Initialize Service Registrations
        const serviceRegistrations: any = {};
        const now = FieldValue.serverTimestamp();

        if (data.services?.marketplace || data.roles.includes("seller") || data.roles.includes("marketplace_buyer")) {
            // Determine account type from roles
            let accountType = "buyer";
            if (data.roles.includes("seller")) {
                accountType = data.roles.includes("marketplace_buyer") ? "both" : "seller";
            }

            serviceRegistrations.marketplace = { 
                status: "approved", 
                accountType,
                paymentStatus: "completed",
                onboardingCompleted: true,
                approvedAt: now 
            };
        }

        if (data.services?.export || data.roles.includes("export_participant")) {
            serviceRegistrations.export = { 
                status: "approved", 
                paymentStatus: "completed",
                onboardingCompleted: true,
                approvedAt: now, 
                appliedAt: now 
            };
        }

        if (data.services?.cooperative || data.roles.includes("cooperative_member")) {
            const coopState = { 
                status: "approved", 
                paymentStatus: "completed",
                onboardingCompleted: true,
                approvedAt: now 
            };
            // Support both singular and plural keys for maximum compatibility
            serviceRegistrations.cooperative = coopState;
            serviceRegistrations.cooperatives = coopState;
        }

        if (data.services?.wave || data.roles.includes("wave_participant")) {
            serviceRegistrations.wave = { 
                status: "approved", 
                paymentStatus: "completed",
                onboardingCompleted: true,
                approvedAt: now 
            };
        }

        if (data.services?.academy || data.roles.includes("academy_participant")) {
            serviceRegistrations.academy = { 
                status: "approved", 
                accountType: "learner",
                plan: data.academyPlan || "foundation", // Dynamic tier selection
                paymentStatus: "completed",
                onboardingCompleted: true,
                enrolledAt: now 
            };
        }

        if (data.services?.farmNation || data.roles.includes("farmer")) {
            const farmNationState = { 
                status: "approved", 
                paymentStatus: "completed",
                onboardingCompleted: true,
                approvedAt: now 
            };
            // Write BOTH keys so farm_nation-based queries (broadcast-logic) and farmNation-based
            // queries (admin actions) both resolve correctly.
            serviceRegistrations.farmNation = farmNationState;
            serviceRegistrations.farm_nation = farmNationState;
        }

        /**
         *   #685 A RE-IMPORT REPLACED THE MEMBER'S ROLES WITH WHATEVER THE FORM
         *        HAD TICKED.
         *
         *        `roles: data.roles` is written with `set(..., { merge: true })`,
         *        and merge protects fields the payload OMITS — an array it
         *        NAMES is replaced outright. ImportLegacyModal builds that array
         *        from its own checkboxes, whose initial state ticks ONLY THE
         *        MODULE THE ADMIN OPENED IT FROM:
         *
         *            services: { cooperative: module === "cooperative",
         *                        academy:     module === "academy", ... }
         *
         *        It never reads the person being imported. So importing an
         *        existing cooperative member from the WAVE screen rewrote their
         *        roles to ["general_user", "wave_participant"], and their
         *        cooperative_member role was gone.
         *
         *   WHAT IT DOES AND DOES NOT COST — measured against the readers.
         *
         *        Their MONEY IS SAFE. canTransactAsMember reads the membership
         *        ROW's status, not the role, and checkModuleAccess Layer 2 reads
         *        serviceRegistrations, which is deep-merged and survives.
         *
         *        What they lose is being COUNTED and CONTACTED as that kind of
         *        member: the broadcast audiences and the forensic samples both
         *        key on `roles array-contains cooperative_member`. They quietly
         *        stop receiving cooperative messages and stop appearing in the
         *        checks meant to notice problems with their account.
         *
         *   THE PLATFORM ALREADY HAS THE ANSWER. user-migration.ts merges roles
         *   by UNION — `Array.from(new Set([...activeRoles, ...legacyRoles]))`,
         *   minus anything privileged — precisely so a migration cannot remove
         *   what somebody already holds. Two paths, one contract, disagreeing.
         *
         *   REMOVING A ROLE IS NOT THIS SCREEN'S JOB. updateUserRolesAction
         *   exists for that, with its own gate and its own audit row. An import
         *   adds what it is importing.
         */
        const existingUserSnap = await db.collection(COLLECTIONS.USERS).doc(userRecord.uid).get();
        const existingRoles: string[] = (() => {
            const raw = existingUserSnap.exists ? (existingUserSnap.data() ?? {}).roles : undefined;
            return Array.isArray(raw) ? raw.filter((r: unknown): r is string => typeof r === 'string') : [];
        })();
        const requestedRoles = data.roles as unknown as string[];
        const mergedRoles = Array.from(new Set([...existingRoles, ...requestedRoles])) as typeof data.roles;

        const kept = existingRoles.filter((r) => !requestedRoles.includes(r));
        if (kept.length > 0) {
            logger.info(
                `[Legacy Onboarding] Kept ${kept.join(', ')} on ${userRecord.uid} — an import adds ` +
                `roles, it does not remove them (#685).`,
            );
        }

        // 7. Create User Document
        const userDoc: any = {
            uid: userRecord.uid,
            fullName: data.fullName,
            firstName,
            lastName,
            otherName: otherName || undefined,
            email: data.email,
            phone: data.phone,
            gender: data.gender,
            dateOfBirth: data.dateOfBirth,
            occupation: data.occupation,
            //   #685 The union, not the form's checkboxes. See the note above.
            roles: mergedRoles,
            isVerified: true,
            verified: true,
            stateOfOrigin: data.state,
            lga: data.lga,
            residentialAddress: data.address,
            address: {
                street: data.address,
                city: data.city || "",
                state: data.state,
                lga: data.lga,
                country: "Nigeria",
            },
            // Next of Kin
            nextOfKin: (data.nextOfKinName || data.nextOfKinPhone) ? {
                name: data.nextOfKinName || "",
                phone: data.nextOfKinPhone || "",
                relationship: data.nextOfKinRelationship || "",
                address: data.nextOfKinAddress || "",
            } : undefined,
            // Financials
            bankAccountNumber: data.accountNumber,
            bankAccountName: data.accountName,
            bankCode: data.bankCode,
            bankDetails: data.accountNumber ? {
                accountNumber: data.accountNumber,
                bankName: data.bankName || "",
                accountName: data.accountName || data.fullName || "",
                bankCode: data.bankCode || "",
            } : undefined,
            // KYC
            //   #485 `!!data.nin` — the same presence-is-verification rule,
            //   applied to every record a legacy import brings in.
            nin: data.nin,
            ninVerified: !!data.nin,
            ninVerificationMethod: data.nin ? 'self_declared' : null,
            bvn: data.bvn,
            bvnVerified: !!data.bvn,
            bvnVerificationMethod: data.bvn ? 'self_declared' : null,
            // Verification Documents (uploaded by admin during legacy onboarding)
            documents: (data.validIdUrl || data.passportPhotoUrl || data.proofOfAddressUrl) ? {
                validId: data.validIdUrl ? { url: data.validIdUrl, name: "ID Document", uploadedAt: new Date().toISOString() } : undefined,
                passportPhoto: data.passportPhotoUrl ? { url: data.passportPhotoUrl, name: "Passport Photo", uploadedAt: new Date().toISOString() } : undefined,
                proofOfAddress: data.proofOfAddressUrl ? { url: data.proofOfAddressUrl, name: "Proof of Address", uploadedAt: new Date().toISOString() } : undefined,
            } : undefined,
            isVerifiedBadge: true, 
            // Security & Onboarding
            serviceRegistrations,
            onboardingCompleted: true, 
            consentVersion: "1.0.0",
            consentDate: FieldValue.serverTimestamp(),
            notifications: {
                email: true,
                push: true,
                sms: true
            },
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            legacyOnboardedBy: session.user.id,
            legacyOnboardedAt: FieldValue.serverTimestamp(),
            _system_safe_write: true, // Mark as hardened
        };

        if (isNewUser) {
            userDoc.requiresPasswordChange = true;
        }

        /**
         * WHAT THIS SCREEN MUST NOT DO IS RE-INITIALISE SOMEBODY.
         *
         * Every provisioning block below is a `set(..., { merge: true })`, and
         * `merge` protects fields the payload OMITS — not fields it names. The
         * payloads named `savingsBalance: 0`, `loanBalance: 0`,
         * `totalContributions: 0`, `points: 0`, `paymentAmount: 0` and a fresh
         * `createdAt`, unconditionally.
         *
         * So running this action a second time on somebody who is already a
         * cooperative member — to add a module, to correct a phone number, to
         * attach a document — set their savings balance, their loan balance and
         * their lifetime contributions to ZERO, and reported "successfully
         * updated". A member with ₦300,000 contributed lost the record of it,
         * silently, and the same call reset their WAVE points and their join
         * dates.
         *
         * It is also reachable through the migration path above: an unaligned
         * document is moved to the auth UID with its balances intact, and then
         * this block zeroes them.
         *
         * The zeroes are correct for a member who does not exist yet — a new
         * record starts at zero — so they are applied only then. `existing`
         * below is read once per collection and decides it.
         *
         *   #684 AND THAT REACHED THREE PROVISIONING BLOCKS OF TEN.
         *
         *        The MONEY half landed where it mattered — savingsBalance,
         *        loanBalance, totalContributions and points are all guarded.
         *        The DATES were not. Six blocks went on writing
         *        `createdAt: serverTimestamp()` unconditionally, and the
         *        academy application also rewrote `submittedAt`:
         *
         *            seller_verifications      createdAt
         *            vendor_settings           createdAt
         *            academy_applications      createdAt, submittedAt
         *            export_applications       createdAt
         *            wave_applications         createdAt
         *            farm_nation_applications  createdAt
         *
         *        This comment already named "a fresh `createdAt`" and "their
         *        join dates" as part of the defect, so the rule was stated and
         *        then applied to a third of the places it names — which is the
         *        shape this audit files more often than any other.
         *
         *        WHAT IT COSTS. `submittedAt` is what the Farm Nation and WAVE
         *        registrant screens ORDER BY, so re-importing a member to
         *        correct a phone number moved their application to the front of
         *        somebody's review queue. `createdAt` is tenure: it is what
         *        "member since" reads, and #673 has just finished paying for a
         *        query that ordered by it.
         *
         *        None of this loses money. It rewrites history, silently, on a
         *        screen whose whole purpose is to be re-run.
         */
        const readExisting = async (collection: string, id: string) => {
            const snap = await db.collection(collection).doc(id).get();
            return snap.exists ? (snap.data() ?? {}) : null;
        };

        /**
         * The fields that must survive a re-run. Present on a NEW document,
         * absent on an existing one — so `merge: true` leaves whatever is there.
         */
        const initialOnly = (existing: Record<string, any> | null, fields: Record<string, any>) =>
            (existing ? {} : fields);

        const existingCoopMember = (data.services?.cooperative || data.roles.includes("cooperative_member"))
            ? await readExisting(COLLECTIONS.COOPERATIVE_MEMBERS, userRecord.uid)
            : null;

        //   #684 The six that the original repair did not reach. Read here
        //   beside the first so the list is in one place and a seventh block
        //   cannot be added without meeting it.
        const legacyId = `legacy_${userRecord.uid}`;
        const existingSellerVerification = await readExisting(COLLECTIONS.SELLER_VERIFICATIONS, legacyId);
        const existingVendorSettings = await readExisting(COLLECTIONS.VENDOR_SETTINGS, userRecord.uid);
        const existingAcademyApp = await readExisting(COLLECTIONS.ACADEMY_APPLICATIONS, legacyId);
        const existingExportApp = await readExisting(COLLECTIONS.EXPORT_APPLICATIONS, legacyId);
        const existingWaveApp = await readExisting(COLLECTIONS.WAVE_APPLICATIONS, legacyId);
        const existingFarmApp = await readExisting(COLLECTIONS.FARM_NATION_APPLICATIONS, legacyId);

        const batch = db.batch();
        batch.set(db.collection(COLLECTIONS.USERS).doc(userRecord.uid), userDoc, { merge: true });

        // 8. 🏗️ DEEP PROVISIONING: Initialize Service Documents
        // Cooperative Member Document
        if (data.services?.cooperative || data.roles.includes("cooperative_member")) {
            batch.set(db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userRecord.uid), {
                userId: userRecord.uid,
                fullName: data.fullName,
                firstName,
                lastName,
                email: data.email,
                phone: data.phone,
                gender: data.gender,
                dateOfBirth: data.dateOfBirth,
                occupation: data.occupation,
                stateOfOrigin: data.state,
                lga: data.lga,
                residentialAddress: data.address,
                nextOfKin: (data.nextOfKinName || data.nextOfKinPhone) ? {
                    name: data.nextOfKinName || "",
                    phone: data.nextOfKinPhone || "",
                    relationship: data.nextOfKinRelationship || "",
                    address: data.nextOfKinAddress || "",
                } : undefined,
                documents: (data.validIdUrl || data.passportPhotoUrl || data.proofOfAddressUrl) ? {
                    validId: data.validIdUrl ? { url: data.validIdUrl, name: "ID Document" } : undefined,
                    passportPhoto: data.passportPhotoUrl ? { url: data.passportPhotoUrl, name: "Passport Photo" } : undefined,
                    proofOfAddress: data.proofOfAddressUrl ? { url: data.proofOfAddressUrl, name: "Proof of Address" } : undefined,
                } : undefined,
                bvn: data.bvn,
                // Zeroed only for a member who does not exist yet — see the note
                // above `readExisting`. A re-run must not wipe a real balance.
                ...initialOnly(existingCoopMember, {
                    savingsBalance: 0,
                    loanBalance: 0,
                    totalContributions: 0,
                    tier: "tier1",
                    createdAt: FieldValue.serverTimestamp(),
                }),
                membershipStatus: "active",
                paymentStatus: "completed",
                isLegacy: true,
                onboardingCompleted: true,
                bankAccountNumber: data.accountNumber,
                bankName: data.bankName,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        }

        // Vendor Settings / Seller Profile Document
        if (data.services?.marketplace || data.roles.includes("seller")) {
            // Mark as active/verified seller if role is present
            const sellerStatus = data.roles.includes("seller") ? "approved" : "pending";
            batch.set(db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(`legacy_${userRecord.uid}`), {
                id: `legacy_${userRecord.uid}`,
                userId: userRecord.uid,
                status: sellerStatus,
                businessName: `${firstName}'s Enterprise`,
                phone: data.phone,
                location: {
                    state: data.state,
                    lga: data.lga,
                    address: data.address,
                },
                bankAccount: data.accountNumber ? {
                    accountNumber: data.accountNumber,
                    bankName: data.bankName || "",
                    accountName: data.accountName || "",
                    bankCode: data.bankCode || "",
                } : undefined,
                bankDetails: data.accountNumber ? {
                    accountNumber: data.accountNumber,
                    bankName: data.bankName || "",
                    accountName: data.accountName || data.fullName || "",
                    bankCode: data.bankCode || "",
                } : undefined,
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
                //   #684 The dates a re-run must not rewrite. `merge` protects
                //   fields the payload OMITS, so naming them unconditionally reset
                //   them on every re-import.
                ...initialOnly(existingSellerVerification, {
                    createdAt: FieldValue.serverTimestamp(),
                }),
            }, { merge: true });

            batch.set(db.collection(COLLECTIONS.VENDOR_SETTINGS).doc(userRecord.uid), {
                userId: userRecord.uid,
                storeInfo: {
                    name: `${firstName}'s Store`,
                    contactEmail: data.email,
                    phone: data.phone,
                },
                paymentConfig: data.accountNumber ? {
                    accountNumber: data.accountNumber,
                    bankName: data.bankName,
                    accountName: data.accountName,
                    bankCode: data.bankCode,
                } : {},
                notifications: {
                    newOrders: true,
                    payments: true
                },
                updatedAt: FieldValue.serverTimestamp(),
                //   #684 The dates a re-run must not rewrite. `merge` protects
                //   fields the payload OMITS, so naming them unconditionally reset
                //   them on every re-import.
                ...initialOnly(existingVendorSettings, {
                    createdAt: FieldValue.serverTimestamp(),
                }),
            }, { merge: true });
        }

        await batch.commit();

        // 8b. 🎓 ACADEMY DEEP-PROVISIONING: Create Enrollment & Application docs for legacy academy members
        //     so the admin panel surfaces them and status checks never fall through.
        if (data.services?.academy || data.roles.includes("academy_participant")) {
            const academyBatch = db.batch();

            // Enrollment record — queried by getAcademyEnrollmentsAction
            const enrollmentRef = db.collection(COLLECTIONS.ACADEMY_ENROLLMENTS).doc(userRecord.uid);
            const existingEnrolment = await readExisting(COLLECTIONS.ACADEMY_ENROLLMENTS, userRecord.uid);
            academyBatch.set(enrollmentRef, {
                userId: userRecord.uid,
                studentName: data.fullName,
                studentEmail: data.email,
                studentPhone: data.phone,
                plan: data.academyPlan || "foundation",
                status: "active",
                paymentStatus: "completed",
                onboardingCompleted: true,
                // The amount a learner actually paid, and when they enrolled,
                // are not this screen's to reset on a re-run.
                ...initialOnly(existingEnrolment, {
                    paymentAmount: 0,
                    enrolledAt: FieldValue.serverTimestamp(),
                    createdAt: FieldValue.serverTimestamp(),
                }),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
                _legacyOnboardedBy: session.user.id,
            }, { merge: true });

            // Application record — queried by checkAcademyStatusAction & admin application panels
            const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(`legacy_${userRecord.uid}`);
            academyBatch.set(appRef, {
                userId: userRecord.uid,
                status: "approved",
                paymentStatus: "completed",
                plan: data.academyPlan || "foundation",
                personalInfo: {
                    fullName: data.fullName,
                    email: data.email,
                    phone: data.phone,
                },
                reviewedBy: session.user.id,
                reviewedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
                //   #684 The dates a re-run must not rewrite. `merge` protects
                //   fields the payload OMITS, so naming them unconditionally reset
                //   them on every re-import.
                ...initialOnly(existingAcademyApp, {
                    submittedAt: FieldValue.serverTimestamp(),
                    createdAt: FieldValue.serverTimestamp(),
                }),
            }, { merge: true });

            await academyBatch.commit();
        }

        // 8c. 🌍 EXPORT DEEP-PROVISIONING
        if (data.services?.export || data.roles.includes("export_participant")) {
            const exportBatch = db.batch();
            const exportAppRef = db.collection(COLLECTIONS.EXPORT_APPLICATIONS).doc(`legacy_${userRecord.uid}`);
            exportBatch.set(exportAppRef, {
                userId: userRecord.uid,
                status: "approved",
                profile: {
                    firstName,
                    lastName,
                    otherName,
                    email: data.email,
                    phone: data.phone,
                    gender: data.gender,
                    dateOfBirth: data.dateOfBirth,
                },
                companyInfo: {
                    companyName: data.exportInfo?.companyName || `${firstName}'s Export Co.`,
                    rcNumber: data.exportInfo?.rcNumber || "LEGACY-N/A",
                    yearEstablished: data.exportInfo?.yearEstablished || new Date().getFullYear().toString(),
                    businessType: data.exportInfo?.businessType || "sole_proprietorship",
                    industry: data.exportInfo?.industry || "agriculture",
                },
                state: data.state || "",
                lga: data.lga || "",
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
                //   #684 The dates a re-run must not rewrite. `merge` protects
                //   fields the payload OMITS, so naming them unconditionally reset
                //   them on every re-import.
                ...initialOnly(existingExportApp, {
                    createdAt: FieldValue.serverTimestamp(),
                }),
            }, { merge: true });
            await exportBatch.commit();
        }

        // 8d. 🌊 WAVE DEEP-PROVISIONING
        if (data.services?.wave || data.roles.includes("wave_participant")) {
            const waveBatch = db.batch();
            // WAVE Application
            const waveAppRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(`legacy_${userRecord.uid}`);
            waveBatch.set(waveAppRef, {
                userId: userRecord.uid,
                userEmail: data.email,
                firstName,
                surname: data.waveInfo?.surname || lastName,
                email: data.email,
                phoneNumber: data.phone,
                state: data.state || "",
                residentialState: data.waveInfo?.residentialState || data.state || "",
                status: "approved",
                applicationDate: FieldValue.serverTimestamp(),
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
                //   #684 The dates a re-run must not rewrite. `merge` protects
                //   fields the payload OMITS, so naming them unconditionally reset
                //   them on every re-import.
                ...initialOnly(existingWaveApp, {
                    createdAt: FieldValue.serverTimestamp(),
                }),
            }, { merge: true });
            
            // WAVE Member Profile
            const waveMemberRef = db.collection(COLLECTIONS.WAVE_MEMBERS).doc(userRecord.uid);
            const existingWaveMember = await readExisting(COLLECTIONS.WAVE_MEMBERS, userRecord.uid);
            waveBatch.set(waveMemberRef, {
                userId: userRecord.uid,
                email: data.email,
                name: data.fullName,
                phone: data.phone,
                status: "active",
                // Points earned and the date they joined survive a re-run.
                ...initialOnly(existingWaveMember, {
                    joinDate: FieldValue.serverTimestamp(),
                    tier: "standard",
                    points: 0,
                    createdAt: FieldValue.serverTimestamp(),
                }),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
            }, { merge: true });
            await waveBatch.commit();
        }

        // 8e. 🧑‍🌾 FARM NATION DEEP-PROVISIONING
        if (data.services?.farmNation || data.roles.includes("farmer")) {
            const farmBatch = db.batch();
            const farmAppRef = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).doc(`legacy_${userRecord.uid}`);
            farmBatch.set(farmAppRef, {
                userId: userRecord.uid,
                status: "approved",
                role: data.farmNationInfo?.role || "farmer",
                farmSize: data.farmNationInfo?.farmSize || undefined,
                cropTypes: data.farmNationInfo?.cropTypes || undefined,
                propertyTypes: data.farmNationInfo?.propertyTypes || undefined,
                listingTypes: data.farmNationInfo?.listingTypes || undefined,
                totalAcreage: data.farmNationInfo?.totalAcreage || undefined,
                profile: {
                    fullName: data.fullName,
                    firstName,
                    lastName,
                    email: data.email,
                    phone: data.phone,
                },
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
                //   #684 The dates a re-run must not rewrite. `merge` protects
                //   fields the payload OMITS, so naming them unconditionally reset
                //   them on every re-import.
                ...initialOnly(existingFarmApp, {
                    createdAt: FieldValue.serverTimestamp(),
                }),
            }, { merge: true });
            await farmBatch.commit();
        }

        // 9. Send Welcome Email with the temporary PIN included
        // 9. Send Welcome Email with the temporary PIN included (only for new users)
        // They will use this to log in, and getPostLoginRedirect will force them
        // to change their password via /auth/reset-legacy-password
        let emailSent = true;
        if (isNewUser) {
            try {
                const emailResult = await sendLegacyMemberWelcomeEmail(data.email, data.fullName, tempPassword);
                if (emailResult && !emailResult.success) {
                    logger.warn(`[Legacy Onboarding] Failed to send welcome email for ${data.email}:`, { error: emailResult.error });
                    emailSent = false;
                }
            } catch (emailErr: any) {
                logger.error(`[Legacy Onboarding] Exception while sending welcome email for ${data.email}:`, emailErr);
                emailSent = false;
            }
        }

        // 10. Audit Log
        try {
            await createAdminAuditLog({
                action: "legacy_member_onboarded",
                userId: session.user.id,
                targetId: userRecord.uid,
                targetType: "user",
                metadata: {
                    targetEmail: data.email,
                    roles: data.roles,
                    services: data.services,
                },
            });
        } catch (auditErr: any) {
            logger.warn(`[Legacy Onboarding] Failed to create audit log for onboarded user ${userRecord.uid}:`, auditErr);
        }

        // 11. Invalidate Redis Cache
        try {
            const { invalidateUserCache } = await import("@/lib/cache-invalidation");
            await invalidateUserCache(userRecord.uid);
            await invalidateAdminGlobalStats();
            logger.info(`[Legacy Onboarding] Invalidated Redis cache and global stats for onboarded user: ${userRecord.uid}`);
        } catch (cacheErr: any) {
            logger.warn(`[Legacy Onboarding] Failed to invalidate cache for ${userRecord.uid}:`, cacheErr);
        }

        /**
         *   #290 THE OUTCOME WAS SAID IN PROSE AND THE SCREEN DID NOT LISTEN.
         *
         *        This return has always distinguished three outcomes, and
         *        ImportLegacyModal — the only caller, rendered by five admin
         *        pages — read `result.success` and discarded `message`
         *        entirely, then printed one hardcoded sentence:
         *
         *            "A welcome email with a secure password setup link has
         *             been sent to {email}."
         *
         *        For the middle case that sentence is false AND it destroys
         *        the only way into the account: the email did not send, and
         *        the temporary PIN this message exists to hand over was never
         *        shown to anybody. For an EXISTING member no email is sent at
         *        all, and the admin was told one was.
         *
         *        The three outcomes are now also returned as FIELDS, because a
         *        caller that has to parse prose to find out what happened will
         *        go on not doing it. `message` is unchanged — four tests and
         *        any other reader still see exactly what they saw.
         *
         *        temporaryPassword is present ONLY when the admin has to relay
         *        it, which is the same condition under which the message
         *        already contained it. It is not new exposure; it is the same
         *        value in a field the screen can actually render.
         */
        return {
            error: null, success: true as const,
            isNewUser,
            emailSent: isNewUser ? emailSent : false,
            temporaryPassword: isNewUser && !emailSent ? tempPassword : null,
            message: isNewUser
                ? (emailSent
                    ? `Legacy member ${data.fullName} successfully onboarded. Default PIN sent to ${data.email}.`
                    : `Legacy member ${data.fullName} successfully onboarded, but the welcome email failed to send. Please share the temporary PIN (${tempPassword}) with the member manually.`)
                : `Legacy member ${data.fullName} successfully updated.`
        };

    } catch (error: any) {
        logger.error("Legacy onboarding error:", error);
        return { success: false as const, error: error.message || "Failed to onboard legacy member" };
    }
}

export async function onboardLegacyMemberAction(data: Parameters<typeof _onboardLegacyMemberAction>[0]) {
    return withFlexibleSafeAction("onboardLegacyMemberAction", _onboardLegacyMemberAction)(data);
}
