"use server";
import { requireSession } from "@/lib/session-guard";

import { supabaseDb as db } from "@/lib/supabase-db";
import { userErasurePatch, erasedEmailFor, erasureRetentionRecord, erasedOwnerMarker } from "@/lib/user-erasure";
import { eraseModuleApplications } from "@/lib/module-application-erasure";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { revokeAuthAccess } from "@/lib/auth-revocation";
import { logger } from "@/lib/logger";
import type { ActionResponse } from "@/lib/safe-action";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { invalidateUserCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";

/**
 * NDPR Compliant "Right to be Forgotten" Account Deletion.
 * This performs a soft-delete to maintain referential integrity (for ledgers, orders)
 * but permanently scrubs all Personally Identifiable Information (PII).
 * NOTE: Declared as async function (not const) so Next.js "use server" validator accepts it.
 */
async function _deleteUserAccountAction(): Promise<ActionResponse<null>> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized. You must be logged in.", data: null };
        }

        const userId = session.user.id;
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        const userSnap = await userRef.get();
        if (!userSnap.exists) { return { success: false as const, error: "User profile not found.", data: null };
        }

        // WHAT WAS MISSING HERE
        // ---------------------
        // Nothing checked whether the account still held money or owed any.
        // The batch below used to call `delete()` on the WALLET document
        // outright, so deleting an account with a balance destroyed it
        // silently, leaving no record of what was owed to whom. An outstanding
        // cooperative loan survived while the borrower's name and contact
        // details were scrubbed, which is worse than either outcome alone.
        //
        // #300 has since removed that delete entirely — the wallet is marked,
        // never dropped — so this guard is now the FIRST of two defences rather
        // than the only one. It stays because refusing early, with the figures
        // named, is a better answer than retiring an account that still owes or
        // is owed.
        //
        // Erasure is a right, not an escape hatch: NDPR does not require a
        // controller to forget a debt or forfeit a balance. It requires the
        // personal data to go once the relationship is settled.
        //
        // So the obligations are checked first and the user is told exactly
        // what is blocking, rather than being refused with a generic error or
        // — far worse — succeeding and losing their money.
        const blockers: string[] = [];

        const walletSnap = await db.collection(COLLECTIONS.WALLETS).doc(userId).get();
        const walletBalance = Number(walletSnap.data()?.balance || 0);
        if (walletBalance > 0) {
            blockers.push(`a wallet balance of ₦${walletBalance.toLocaleString()}`);
        }

        const memberSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();
        const savings = Number(memberSnap.data()?.savingsBalance || 0);
        const locked = Number(memberSnap.data()?.lockedBalance || 0);
        if (savings > 0) blockers.push(`₦${savings.toLocaleString()} in cooperative savings`);
        if (locked > 0) blockers.push(`₦${locked.toLocaleString()} locked in a pending withdrawal`);

        // BOTH loan collections, with the field each one actually uses.
        //
        // The first version of this guard queried only COOPERATIVE_LOANS, and
        // queried it by `userId`. Cooperative loans are CREATED in
        // LOAN_APPLICATIONS (see _loans.ts), and COOPERATIVE_LOANS keys on
        // `memberId` — so it looked in the wrong collection with the wrong
        // field and would have matched nothing. A borrower with an outstanding
        // loan would have passed the guard and been scrubbed while owing money:
        // exactly the defect this exists to prevent, inside the guard itself.
        //
        // _loans.ts checks both collections for the same reason. The status set
        // is anything not settled — a repaid or rejected loan must not block
        // erasure for ever.
        const UNSETTLED = ["pending", "reviewing", "approved", "partially_approved", "disbursed", "active"];

        const [generalLoans, coopLoans] = await Promise.all([
            db.collection(COLLECTIONS.LOAN_APPLICATIONS).where("userId", "==", userId).get(),
            db.collection(COLLECTIONS.COOPERATIVE_LOANS).where("memberId", "==", userId).get(),
        ]);

        const openLoans = [...generalLoans.docs, ...coopLoans.docs].filter((d) =>
            UNSETTLED.includes(String(d.data()?.status))
        );
        if (openLoans.length > 0) {
            blockers.push(`${openLoans.length} outstanding loan${openLoans.length > 1 ? "s" : ""}`);
        }

        // Escrow is checked on both sides: as buyer their money is held, as
        // seller they are owed it. Either way the account cannot go yet.
        const escrowSnap = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("participants", "array-contains", userId)
            .get();
        const liveEscrows = escrowSnap.docs.filter((d) =>
            ["funded", "delivered", "disputed"].includes(String(d.data()?.status))
        );
        if (liveEscrows.length > 0) {
            blockers.push(`${liveEscrows.length} escrow transaction${liveEscrows.length > 1 ? "s" : ""} still in progress`);
        }

        if (blockers.length > 0) {
            return {
                success: false as const,
                error:
                    "Your account cannot be deleted yet because it still has " +
                    blockers.join(", ") +
                    ". Please withdraw your funds and settle any outstanding items first, then try again — or contact support if you need help.",
                data: null,
            };
        }

        /**
         *   #300 THIS RETIRES RELATED RECORDS. IT USED TO DESTROY THEM.
         *
         *        Three `batch.delete` calls stood here — every KYC verification
         *        row for the user, the seller verification row, and THE WALLET.
         *
         *        The wallet one contradicted the comment fifteen lines below,
         *        which keeps the uid "so that database foreign keys do not
         *        break": a wallet is the other end of exactly those keys, and
         *        every wallet_transactions row points at it. The blocker check
         *        above already refuses to erase an account holding a balance, so
         *        no naira was lost — what was lost was the record that the
         *        account had existed.
         *
         *        Owner decision, which also settles #280 and #292: nothing is
         *        deleted. The rows are marked so a reader knows they are inert
         *        and why, and the identity-document references are copied into a
         *        server-only retention record BEFORE the user row is scrubbed —
         *        because that row was the only place recording which Cloudinary
         *        assets belonged to this person, and nothing in this codebase
         *        ever removes an asset.
         */
        const batch = db.batch();

        const kycSnap = await db.collection(COLLECTIONS.KYC_VERIFICATIONS).where("userId", "==", userId).get();
        kycSnap.docs.forEach(doc => batch.update(doc.ref, erasedOwnerMarker(userId)));

        batch.set(
            db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(userId),
            erasedOwnerMarker(userId),
            { merge: true },
        );
        batch.set(
            db.collection(COLLECTIONS.WALLETS).doc(userId),
            erasedOwnerMarker(userId),
            { merge: true },
        );

        // The index of this person's uploaded documents, kept before the user
        // row loses it. Server-only: document_collections has RLS on and no
        // policies (migration 004), so nothing in a browser can read it.

        // Scrub all PII. We retain the UID so that database foreign keys (like
        // 'sellerId' on an order or 'buyerId' on a farm purchase) do not break.
        //
        // #283 The list this comment describes used to live here, and it was
        // TEN fields. It missed bvn, nin, nextOfKin, the identity-document URLs
        // and the date of birth — and on the fields this codebase stores twice
        // it removed one copy and left the other: `address` deleted while
        // `residentialAddress` stayed, `bankDetails` deleted while
        // `bankAccountNumber`/`bankAccountName`/`bankCode` stayed, `fullName`
        // redacted while `firstName`/`lastName`/`otherName` kept the real name.
        //
        // It is a shared definition now, checked against the User type, so a
        // new PII field cannot be added without erasure learning about it. See
        // lib/user-erasure.ts.

        batch.set(
            db.collection(COLLECTIONS.ERASURE_RETENTION).doc(userId),
            erasureRetentionRecord(userId, userSnap.data()),
            { merge: true },
        );

        batch.update(userRef, {
            ...userErasurePatch(userId),

            // Track deletion status and timestamp
            deleted: true,
            deletedAt: FieldValue.serverTimestamp(),
            // The field lib/auth.ts refuses to log in. Without it, a deleted
            // account still authenticates — `deleted: true` is read by nothing
            // in the sign-in path.
            suspended: true,
            updatedAt: FieldValue.serverTimestamp()
        });

        await batch.commit();

        /**
         *   #376 THE SCRUB ABOVE REACHES ONE ROW. THE MEMBER'S IDENTITY IS ON
         *        EIGHT MORE.
         *
         *        The batch above marks the KYC verifications, the seller
         *        verification and the wallet, and scrubs the user document. It
         *        does not touch the module rows, and every module writes its own
         *        full copy at onboarding: cooperative_members holds the next of
         *        kin, the BVN and the ID-document links; seller_verifications
         *        holds the NIN, BVN and CAC in CLEAR; the export application
         *        holds kyc.nin and kyc.bvn in clear too.
         *
         *        Nothing is deleted — the rows keep their status, dates and
         *        balances and gain erasedOwnerMarker, and their document
         *        references are copied into the retention record first. See
         *        lib/module-application-erasure.ts, which owns the field lists
         *        so this is not a fourth hand-written one.
         *
         *        Reported rather than swallowed, for the same reason the auth
         *        revocation below is: telling somebody their data is gone while
         *        a collection could not be reached is the outcome this function
         *        exists to avoid.
         */
        const moduleErasure = await eraseModuleApplications(userId);
        if (!moduleErasure.ok) {
            logger.error("[NDPR Compliance] module rows could not be scrubbed", {
                userId,
                failures: moduleErasure.failures,
            });
            return {
                success: false as const,
                error: "Your profile was removed but some module records could not be reached. Please contact support.",
                data: null,
            };
        }

        // Take away the password as well as the data.
        //
        // This path scrubbed the profile and touched NO auth store at all, so
        // somebody who exercised their right to erasure kept a working email
        // and password and could sign straight back into the redacted account.
        // The admin deletion at least tried, against the wrong provider.
        //
        // Reported as a failure if the primary store cannot be revoked: telling
        // someone their account is gone while their credentials still work is
        // the outcome this whole function exists to avoid.
        const revocation = await revokeAuthAccess(userId, erasedEmailFor(userId));
        if (!revocation.primaryRevoked) {
            logger.error("[NDPR Compliance] auth revocation failed after scrubbing", { userId });
            return {
                success: false as const,
                error: "Your data was removed but sign-in could not be revoked. Please contact support.",
                data: null,
            };
        }

        logger.info(`[NDPR Compliance] User PII successfully scrubbed for UID: ${userId}`);

        // Invalidate Cache
        try { await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
        } catch (err) { logger.error("Cache invalidation failed after account deletion", err);
        }

        return { success: true as const, error: null, data: null };
    } catch (error: any) { logger.error("[NDPR Compliance] Account deletion error:", error);
        const msg = typeof error === 'string' ? error : (error?.message || "Account deletion failed");
        return { success: false as const, error: msg, data: null };
    }
}

export const deleteUserAccountAction = withFlexibleSafeAction("deleteUserAccountAction", _deleteUserAccountAction);

