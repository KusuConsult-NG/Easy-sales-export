"use server";

import { z } from "zod";
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
import { createAdminAuditLog } from "@/lib/audit-log";
import { LegacyOnboardingSchema } from "@/lib/schemas";
import { sendLegacyMemberWelcomeEmail } from "@/lib/email-notifications";
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
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const { error: emailError } = await resend.emails.send({
                    from: process.env.EMAIL_FROM || "Easy Sales Cooperative <info@easysalesexport.com>",
                    to: email,
                    subject: "You're Invited to the Cooperative!",
                    html: `
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
                    `
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
        const adminCheck = await requireAdmin();
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

        if (!emailCheck.empty) {
            if (targetUid) {
                // If Auth user exists, the Firestore document ID MUST match targetUid.
                const matchingDoc = emailCheck.docs.find(doc => doc.id === targetUid);
                
                // If there are other documents with the same email but different UIDs:
                // These are duplicate stubs/ghost documents.
                const stubs = emailCheck.docs.filter(doc => doc.id !== targetUid);
                if (stubs.length > 0) {
                    if (matchingDoc) {
                        // The primary document is already aligned. We can safely delete duplicate stubs.
                        const cleanBatch = db.batch();
                        stubs.forEach(doc => cleanBatch.delete(doc.ref));
                        await cleanBatch.commit();
                        logger.info(`[Legacy Onboarding] Deleted ${stubs.length} duplicate stubs for aligned user ${targetUid}`);
                    } else {
                        // Auth user exists (targetUid), but no Firestore document exists with targetUid.
                        // We choose the first stub/legacy document to serve as the source of data.
                        const sourceDoc = stubs[0];
                        oldUidToMigrate = sourceDoc.id;
                        
                        logger.info(`[Legacy Onboarding] Firestore data conflict detected for ${data.email}. Migrating doc ${oldUidToMigrate} to match Auth UID ${targetUid}`);
                        
                        // Migrate user document to targetUid
                        const userData = sourceDoc.data();
                        await db.collection(COLLECTIONS.USERS).doc(targetUid).set({
                            ...userData,
                            uid: targetUid,
                            updatedAt: FieldValue.serverTimestamp()
                        }, { merge: true });

                        // Clean up all the old stubs matching this email
                        const cleanBatch = db.batch();
                        stubs.forEach(doc => cleanBatch.delete(doc.ref));
                        await cleanBatch.commit();
                    }
                }
            } else {
                // No Auth user exists yet. We adopt the UID of the first Firestore document.
                const primaryDoc = emailCheck.docs[0];
                targetUid = primaryDoc.id;
                
                // Delete any additional duplicate stubs matching this email
                const stubs = emailCheck.docs.filter(doc => doc.id !== targetUid);
                if (stubs.length > 0) {
                    const cleanBatch = db.batch();
                    stubs.forEach(doc => cleanBatch.delete(doc.ref));
                    await cleanBatch.commit();
                    logger.info(`[Legacy Onboarding] Deleted ${stubs.length} duplicate stubs for unaligned user ${targetUid}`);
                }
            }
        }

        // Migrate associated module documents from oldUidToMigrate to targetUid
        if (oldUidToMigrate && targetUid) {
            const migrationBatch = db.batch();
            
            // 1. Direct document IDs based on userId
            const directCollections = [
                COLLECTIONS.COOPERATIVE_MEMBERS,
                COLLECTIONS.VENDOR_SETTINGS,
                COLLECTIONS.ACADEMY_ENROLLMENTS,
                COLLECTIONS.WAVE_MEMBERS
            ];
            for (const col of directCollections) {
                const docSnap = await db.collection(col).doc(oldUidToMigrate).get();
                if (docSnap.exists) {
                    migrationBatch.set(db.collection(col).doc(targetUid), {
                        ...docSnap.data(),
                        userId: targetUid,
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });
                    migrationBatch.delete(db.collection(col).doc(oldUidToMigrate));
                }
            }

            // 2. Legacy prefixed document IDs (legacy_{userId})
            const prefixedCollections = [
                COLLECTIONS.EXPORT_APPLICATIONS,
                COLLECTIONS.WAVE_APPLICATIONS,
                COLLECTIONS.FARM_NATION_APPLICATIONS,
                COLLECTIONS.ACADEMY_APPLICATIONS
            ];
            for (const col of prefixedCollections) {
                const docSnap = await db.collection(col).doc(`legacy_${oldUidToMigrate}`).get();
                if (docSnap.exists) {
                    migrationBatch.set(db.collection(col).doc(`legacy_${targetUid}`), {
                        ...docSnap.data(),
                        userId: targetUid,
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });
                    migrationBatch.delete(db.collection(col).doc(`legacy_${oldUidToMigrate}`));
                }
            }
            
            await migrationBatch.commit();
            logger.info(`[Legacy Onboarding] Successfully migrated child documents from ${oldUidToMigrate} to ${targetUid}`);
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
            roles: data.roles,
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
            nin: data.nin,
            ninVerified: !!data.nin,
            bvn: data.bvn,
            bvnVerified: !!data.bvn,
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
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
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
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
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
                submittedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
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
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
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
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
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
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
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
