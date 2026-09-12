"use server";

/**
 * KYC Server Actions
 *
 * Records the BVN, NIN and Voter's Card a member supplies, and persists the
 * result to the user's document.
 *
 * #485 — NOT "verification". No automated identity provider is in service; see
 * lib/identity-verification.ts, which states that once and says what each
 * stored flag actually means.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { votersCardField, VOTERS_CARD_ERROR_MESSAGE } from "@/lib/kyc-validators";
import { runQueryWithRetry } from '@/lib/firestore-utils';
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { logger } from '@/lib/logger';
import { requireSession } from '@/lib/session-guard';
import { withSafeAction, type ActionResponse } from '@/lib/safe-action';
import { isObviouslyFakeId, fakeIdErrorMessage } from '@/lib/kyc-validators';
import { atomicUpdateUser } from '@/lib/services/userService';
import { invalidateUserCache } from '@/lib/cache-invalidation';
import { hashData } from '@/lib/security';

// ─── Types ────────────────────────────────────────────────────────────────────

export type KYCVerificationResult = ActionResponse<{ isMatch: boolean; status?: string }>;

export interface SubmitKYCPayload { firstName: string;
    lastName: string;
    /** 11-digit BVN (optional — only verified when provided) */
    bvn?: string;
    /** 11-digit NIN (optional — only verified when provided) */
    nin?: string; }

// ─── Verify BVN ──────────────────────────────────────────────────────────────

/**
 * Record a member's BVN. #485 — this header said the result was confirmed
 * against an external record; nothing here has ever done that. It stores what
 * the member supplied, marked self_declared.
 */
async function _verifyBVNAction(payload: { bvn: string;
    firstName: string;
    lastName: string; }): Promise<KYCVerificationResult> { 
    try {
        const sessionResult = await requireSession();
        const { session } = sessionResult;
        const userId = session?.user?.id;
        if (!userId) return { success: false as const, error: 'Not authenticated', data: null };

        const { bvn } = payload;

        // An empty submission is not a submission.
        //
        // There was no check at all, and the write below stores
        // hashData('00000000000') when bvn is falsy. updateOverallKYCStatus
        // then treats that exact fallback as "no BVN provided" — so calling
        // this with an empty string set bvnVerified: true against a placeholder
        // and left the account counting as having supplied nothing.
        //
        // Combined with the completeness rule below, that marked an account
        // KYC-verified having submitted no identity document whatsoever.
        //
        // This is separate from #485's finding: that one is "we record what the
        // member types and call it self-declared". This was "we mark verified
        // when the member types nothing", which nobody decided.
        if (!/^\d{11}$/.test(String(bvn ?? "").trim())) {
            return { success: false as const, error: 'A BVN must be 11 digits', data: null };
        }

        // #357 this module imported isObviouslyFakeId and fakeIdErrorMessage
        // and called NEITHER. The wire is run now. It is a no-op while
        // KYC_REJECT_FAKE_IDS is unset, which is today's behaviour and the
        // owner's testing requirement — see lib/kyc-validators.ts.
        if (isObviouslyFakeId(String(bvn).trim())) {
            return { success: false as const, error: fakeIdErrorMessage('BVN'), data: null };
        }

        /**
         *   #485 THIS WROTE 'verified' FOR SOMETHING NOTHING VERIFIED.
         *
         *        No check runs above this line and none is configured — the
         *        automated provider is parked. `bvnVerified` keeps its value because
         *        onboarding gates and updateOverallKYCStatus depend on it (see
         *        lib/identity-verification.ts for why changing it would stop
         *        onboarding), but the STATUS now says what happened, and the
         *        method is recorded so a screen can render "Self-declared"
         *        instead of a green tick an operator will act on.
         */
        await runQueryWithRetry(() => atomicUpdateUser(userId, { 
            'kyc.bvn': bvn ? hashData(bvn) : hashData('00000000000'),
            'kyc.bvnVerified': true,
            'kyc.bvnVerifiedAt': FieldValue.serverTimestamp(),
            'kyc.bvnStatus': 'self_declared',
            'kyc.bvnVerificationMethod': 'self_declared'
        }));

        // Update overall KYC status if BVN now verified
        await updateOverallKYCStatus(userId);

        await invalidateUserCache(userId);

        logger.info('BVN recorded as self-declared — no automated identity check is configured', { userId });
        return { success: true, error: null, data: { isMatch: true } };
    } catch (error) { 
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        logger.error('BVN verification action error', error);
        const isTransient = message.includes("Premature close") || 
                            message.includes("socket hang up") || 
                            message.includes("ECONNRESET") ||
                            message.includes("Client network socket disconnected") ||
                            message.includes("FetchError") ||
                            message.includes("fetch failed") ||
                            message.includes("Connection closed") ||
                            message.includes("Socket closed") ||
                            message.includes("UNAVAILABLE") ||
                            message.includes("stream terminated") ||
                            message.includes("ERR_STREAM_PREMATURE_CLOSE");
        const userFriendlyMessage = isTransient 
            ? "A temporary connection issue occurred. Please try again." 
            : message;
        return { success: false as const, error: userFriendlyMessage, data: null };
    }
}
export const verifyBVNAction = withSafeAction("verifyBVNAction", _verifyBVNAction);

// ─── Verify NIN ──────────────────────────────────────────────────────────────

/**
 * Record a member's NIN (#485 — self-declared, nothing checks it) and save
 * the result to Firestore.
 */
async function _verifyNINAction(payload: { nin: string;
    firstName: string;
    lastName: string; }): Promise<KYCVerificationResult> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Not authenticated', data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const { nin } = payload;

        // Same as the BVN path: an empty NIN stored the placeholder hash and
        // was then counted as "not provided" by updateOverallKYCStatus.
        if (!/^\d{11}$/.test(String(nin ?? "").trim())) {
            return { success: false as const, error: 'A NIN must be 11 digits', data: null };
        }

        // #357 — the other half of the same unrun wire. See the BVN path above.
        if (isObviouslyFakeId(String(nin).trim())) {
            return { success: false as const, error: fakeIdErrorMessage('NIN'), data: null };
        }

        /**
         *   #485 THIS WROTE 'verified' FOR SOMETHING NOTHING VERIFIED.
         *
         *        No check runs above this line and none is configured — the
         *        automated provider is parked. `ninVerified` keeps its value because
         *        onboarding gates and updateOverallKYCStatus depend on it (see
         *        lib/identity-verification.ts for why changing it would stop
         *        onboarding), but the STATUS now says what happened, and the
         *        method is recorded so a screen can render "Self-declared"
         *        instead of a green tick an operator will act on.
         */
        await runQueryWithRetry(() => atomicUpdateUser(userId, { 
            'kyc.nin': nin ? hashData(nin) : hashData('00000000000'),
            'kyc.ninVerified': true,
            'kyc.ninVerifiedAt': FieldValue.serverTimestamp(),
            'kyc.ninStatus': 'self_declared',
            'kyc.ninVerificationMethod': 'self_declared'
        }));

        // Update overall KYC status if NIN now verified
        await updateOverallKYCStatus(userId);

        await invalidateUserCache(userId);

        logger.info('NIN recorded as self-declared — no automated identity check is configured', { userId });
        return { success: true, error: null, data: { isMatch: true } };
    } catch (error) { 
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        logger.error('NIN verification action error', error);
        const isTransient = message.includes("Premature close") || 
                            message.includes("socket hang up") || 
                            message.includes("ECONNRESET") ||
                            message.includes("Client network socket disconnected") ||
                            message.includes("FetchError") ||
                            message.includes("fetch failed") ||
                            message.includes("Connection closed") ||
                            message.includes("Socket closed") ||
                            message.includes("UNAVAILABLE") ||
                            message.includes("stream terminated") ||
                            message.includes("ERR_STREAM_PREMATURE_CLOSE");
        const userFriendlyMessage = isTransient 
            ? "A temporary connection issue occurred. Please try again." 
            : message;
        return { success: false as const, error: userFriendlyMessage, data: null };
    }
}
export const verifyNINAction = withSafeAction("verifyNINAction", _verifyNINAction);

// ─── Verify Voter's Card ─────────────────────────────────────────────────────

/**
 * Record a member's Voter's Card and defer to manual review. There has never
 * been an automated check on this one and the code says so plainly below.
 */
async function _verifyVotersCardAction(payload: { votersCardNumber: string;
    firstName: string;
    lastName: string; }): Promise<KYCVerificationResult> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Not authenticated', data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const { votersCardNumber, firstName, lastName } = payload;

        if (!votersCardNumber) { return { success: false as const, error: "Voter's Card number is required", data: null };
        }
        if (!firstName || !lastName) { return { success: false as const, error: "First name and last name are required for Voter's Card verification", data: null };
        }

        /**
         *   #525 THE ONLY CHECK WAS "IS IT EMPTY".
         *
         *   This wrote `kyc.votersCardVerified: true` for whatever arrived, so a
         *   single character was a verified identity document. looksLikeFakeId
         *   could not help — it answers false for anything that is not eleven
         *   digits, by design — so the voter's card sat outside every rule this
         *   platform has. See lib/kyc-validators for why the new rule has a
         *   floor and no ceiling.
         */
        const cardCheck = votersCardField().safeParse(votersCardNumber);
        if (!cardCheck.success) {
            return {
                success: false as const,
                error: cardCheck.error?.issues[0]?.message ?? VOTERS_CARD_ERROR_MESSAGE,
                data: null,
            };
        }

        logger.info("Voter's Card verification started", { userId, vin: votersCardNumber.slice(0, 4) + '***' });

        // No automated check exists for a Voter's Card. Deferred to manual
        // review and recorded as submitted.
        const originalStatus = 'pending_manual_review';

        /**
         *   #485 THE STATUS SAID 'verified' AND THE FIELD BESIDE IT SAID
         *        'pending_manual_review', IN THE SAME UPDATE.
         *
         *        Both were written together, and the review one of them defers
         *        to had no queue: nothing anywhere read the field. So a member
         *        passed the step, an operator saw "verified", and the review
         *        never happened because there was nowhere for it to appear.
         *
         *        `votersCardVerified` keeps its value — the member must not get
         *        stuck, which is the whole reason for the relaxation — and the
         *        status now says what it is. The queue that reads it is
         *        getIdentitiesAwaitingReview in actions/admin/_users.ts.
         *
         *        The field name loses its provider prefix; nothing ever read it
         *        under the old name, and readers accept both.
         */
        await runQueryWithRetry(() => atomicUpdateUser(userId, { 'kyc.votersCard': votersCardNumber,
            'kyc.votersCardVerified': true,
            'kyc.votersCardVerifiedAt': FieldValue.serverTimestamp(),
            'kyc.votersCardStatus': 'self_declared',
            'kyc.votersCardVerificationMethod': 'self_declared',
            'kyc.votersCardReviewStatus': originalStatus }));

        // Update overall KYC status since we forced voter's card to verified
        await updateOverallKYCStatus(userId);

        await invalidateUserCache(userId);

        logger.info("Voter's Card submitted for manual review", { userId });
        // Return success to the frontend so KYCForm lets them proceed
        return { success: true, error: null, data: { isMatch: true, status: 'pending' } };
    } catch (error) { 
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        logger.error("Voter's Card verification action error", error);
        const isTransient = message.includes("Premature close") || 
                            message.includes("socket hang up") || 
                            message.includes("ECONNRESET") ||
                            message.includes("Client network socket disconnected") ||
                            message.includes("FetchError") ||
                            message.includes("fetch failed") ||
                            message.includes("Connection closed") ||
                            message.includes("Socket closed") ||
                            message.includes("UNAVAILABLE") ||
                            message.includes("stream terminated") ||
                            message.includes("ERR_STREAM_PREMATURE_CLOSE");
        const userFriendlyMessage = isTransient 
            ? "A temporary connection issue occurred. Please try again." 
            : message;
        return { success: false as const, error: userFriendlyMessage, data: null };
    }
}
export const verifyVotersCardAction = withSafeAction("verifyVotersCardAction", _verifyVotersCardAction);

// ─── Save KYC Profile (non-verified fields) ───────────────────────────────────

/**
 * Save personal KYC fields (no ID verification) — fullName, DOB, address etc.
 * Called from the onboarding flow after the form is filled.
 */
async function _saveKYCProfileAction(payload: { firstName: string;
    lastName: string;
    otherNames?: string;
    dateOfBirth: string;
    phoneNumber: string;
    address: string;
    city: string;
    state: string;
    idType?: string;
    idNumber?: string; }): Promise<ActionResponse<null>> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Not authenticated', data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const computedFullName = [payload.firstName, payload.otherNames, payload.lastName]
            .filter(Boolean)
            .join(' ');

        // Build root user update
        const rootUpdate: Record<string, unknown> = { 'kyc.firstName': payload.firstName,
            'kyc.lastName': payload.lastName,
            'kyc.otherNames': payload.otherNames || null,
            'kyc.fullName': computedFullName,
            'kyc.dateOfBirth': payload.dateOfBirth,
            'kyc.phoneNumber': payload.phoneNumber,
            'kyc.address': payload.address,
            'kyc.city': payload.city,
            'kyc.state': payload.state,
            'kyc.idType': payload.idType || null,
            'kyc.idNumber': payload.idNumber || null,
            'kyc.profileSavedAt': FieldValue.serverTimestamp(),
            // Canonical Profile Sync
            'verificationProfile.firstName': payload.firstName,
            'verificationProfile.lastName': payload.lastName,
            'verificationProfile.fullName': computedFullName,
            'verificationProfile.dob': payload.dateOfBirth,
            'verificationProfile.phone': payload.phoneNumber,
            'verificationProfile.lastUpdated': FieldValue.serverTimestamp(),
            // Sync PII to root user doc for Communication Hub queries
            firstName: payload.firstName,
            lastName: payload.lastName,
            otherName: payload.otherNames || null,
            phone: payload.phoneNumber,
            fullName: computedFullName,
            stateOfOrigin: payload.state,
            city: payload.city,
            residentialAddress: payload.address,
            updatedAt: FieldValue.serverTimestamp() };

        await runQueryWithRetry(() => atomicUpdateUser(userId, rootUpdate));

        // ── Cross-module PII sync ──────────────────────────────────────────────
        // Propagate the latest phone / name / address to all module sub-collections
        // so that queries against those collections (SMS broadcast, admin views) are
        // consistent.
        //
        //   #679 THIS SAID "We use a Firestore batch for atomicity and
        //        efficiency". THE BATCH IS NOT ATOMIC.
        //
        //        `SupabaseWriteBatch.commit()` is a `for` loop awaiting each
        //        write in turn, with no rollback — see the note on the class.
        //        So a failure partway through leaves the member's new phone
        //        number in the module collections written so far and the old
        //        one in the rest, which is the exact inconsistency the sentence
        //        above says this block exists to prevent.
        //
        //        The consequence is bounded and recoverable: a later KYC save
        //        re-runs the whole sync, and the root user document — the
        //        record everything else is derived from — is written before
        //        this block by atomicUpdateUser. So the mechanism is left
        //        alone and the claim is corrected, because what is dangerous
        //        here is believing the sync cannot half-apply.
        //
        //        If it must not half-apply, the database has to enforce it; a
        //        batch in this adapter cannot.
        try { const batch = db.batch();

            // 1. academy_applications — find by userId
            const academySnap = await runQueryWithRetry(() => db
                .collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where('userId', '==', userId)
                .get());
            for (const doc of academySnap.docs) {
                batch.update(doc.ref, {
                    'personalInfo.phone': payload.phoneNumber,
                    'personalInfo.fullName': computedFullName,
                    'personalInfo.state': payload.state,
                    updatedAt: FieldValue.serverTimestamp() });
            }

            // 2. cooperative_members — find by userId
            const coopSnap = await runQueryWithRetry(() => db
                .collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where('userId', '==', userId)
                .get());
            for (const doc of coopSnap.docs) { batch.update(doc.ref, {
                    phone: payload.phoneNumber,
                    state: payload.state,
                    address: payload.address,
                    fullName: computedFullName,
                    updatedAt: FieldValue.serverTimestamp() });
            }

            // 3. wave_applications — find by userId
            const waveSnap = await runQueryWithRetry(() => db
                .collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where('userId', '==', userId)
                .get());
            for (const doc of waveSnap.docs) { batch.update(doc.ref, {
                    phone: payload.phoneNumber,
                    stateOfOrigin: payload.state,
                    residentialAddress: payload.address,
                    updatedAt: FieldValue.serverTimestamp() });
            }

            // 4. seller_verifications — find by userId
            const sellerSnap = await runQueryWithRetry(() => db
                .collection(COLLECTIONS.SELLER_VERIFICATIONS)
                .where('userId', '==', userId)
                .get());
            for (const doc of sellerSnap.docs) { batch.update(doc.ref, {
                    phone: payload.phoneNumber,
                    'address.state': payload.state,
                    'address.city': payload.city,
                    updatedAt: FieldValue.serverTimestamp() });
            }

            // 5. export_onboarding_applications — find by userId
            const exportSnap = await runQueryWithRetry(() => db
                .collection(COLLECTIONS.EXPORT_APPLICATIONS)
                .where('userId', '==', userId)
                .get());
            for (const doc of exportSnap.docs) { batch.update(doc.ref, {
                    'profile.phone': payload.phoneNumber,
                    'profile.fullName': computedFullName,
                    'profile.state': payload.state,
                    updatedAt: FieldValue.serverTimestamp() });
            }

            await runQueryWithRetry(() => batch.commit());
            logger.info('Cross-module PII sync completed', { userId });
        } catch (syncError) { // Non-fatal — root KYC data was already saved. Log and continue.
            const syncErrorMessage = syncError instanceof Error ? syncError.message : 'Unknown sync error';
            logger.warn('Cross-module PII sync partial failure', { userId, error: syncErrorMessage });
        }

        await updateOverallKYCStatus(userId);

        await invalidateUserCache(userId);

        return { success: true, error: null, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        logger.error('Save KYC profile error', error);
        const isTransient = message.includes("Premature close") || 
                            message.includes("socket hang up") || 
                            message.includes("ECONNRESET") ||
                            message.includes("Client network socket disconnected") ||
                            message.includes("FetchError") ||
                            message.includes("fetch failed") ||
                            message.includes("Connection closed") ||
                            message.includes("Socket closed") ||
                            message.includes("UNAVAILABLE") ||
                            message.includes("stream terminated") ||
                            message.includes("ERR_STREAM_PREMATURE_CLOSE");
        const userFriendlyMessage = isTransient 
            ? "A temporary connection issue occurred. Please try again." 
            : message;
        return { success: false as const, error: userFriendlyMessage, data: null };
    }
}
export const saveKYCProfileAction = withSafeAction("saveKYCProfileAction", _saveKYCProfileAction);

// ─── Internal: Compute overall KYC status ────────────────────────────────────

async function updateOverallKYCStatus(userId: string): Promise<void> {
    try {
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const snap = await runQueryWithRetry(() => userRef.get());
        if (!snap.exists) return;

        const kyc = snap.data()?.kyc || {};

        const bvnVerified = kyc.bvnVerified === true;
        const ninVerified = kyc.ninVerified === true;
        const votersCardVerified = kyc.votersCardVerified === true;

        // If BVN is provided, it must be verified. Otherwise (if absent or empty or equal to fake/fallback hash), it counts as complete/ignored.
        const bvnVal = kyc.bvn;
        const hasBvn = bvnVal && bvnVal !== hashData('00000000000') && bvnVal !== '';
        const bvnOk = !hasBvn || bvnVerified;

        // If NIN is provided, it must be verified.
        const ninVal = kyc.nin;
        const hasNin = ninVal && ninVal !== hashData('00000000000') && ninVal !== '';
        const ninOk = !hasNin || ninVerified;

        // If Voter's Card is provided, it must be verified.
        const votersCardVal = kyc.votersCard;
        const hasVotersCard = votersCardVal && votersCardVal !== '';
        const votersCardOk = !hasVotersCard || votersCardVerified;

        // Overall KYC is complete if all provided IDs are verified — AND at
        // least one was provided.
        //
        // Each of bvnOk/ninOk/votersCardOk is `!hasX || xVerified`, so with
        // nothing on file all three are vacuously true and kycComplete came out
        // TRUE. An account that had submitted no identity document at all was
        // written `kyc.status: 'verified'` and `kycVerified: true` the moment
        // this ran — and saveKYCProfileAction calls it, so saving a profile was
        // enough.
        //
        // "All provided documents are verified" is only a meaningful statement
        // about somebody who provided one.
        const hasAnyDocument = Boolean(hasBvn || hasNin || hasVotersCard);
        const kycComplete = hasAnyDocument && bvnOk && ninOk && votersCardOk;

        await runQueryWithRetry(() => atomicUpdateUser(userId, { 
            'kyc.status': kycComplete ? 'verified' : 'pending',
            'kyc.completedAt': kycComplete ? FieldValue.serverTimestamp() : null,
            kycVerified: kycComplete 
        }));
    } catch (err) { 
        logger.error('Failed to update overall KYC status', err);
    }
}
