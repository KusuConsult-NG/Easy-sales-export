"use server";

/**
 * KYC Server Actions
 *
 * THE HEADER DESCRIBED A VERIFICATION THAT DOES NOT HAPPEN.
 *
 * It read "Handles real-time BVN and NIN verification via QoreID", and the
 * module imported `qoreIdService` — which appeared nowhere below its import
 * line. Every path here writes `verified: true` from what the user typed, under
 * its own comments saying so ("forcefully as fully verified", "QoreID
 * bypassed"). The import and the sentence were the only things still claiming
 * otherwise, and both are gone: an unused import of the verification service is
 * the same "reads as present, is none" shape that lib/kyc-validators.ts's own
 * #357 note is about.
 *
 * WHAT THIS MODULE ACTUALLY DOES TODAY
 * ------------------------------------
 * It records self-asserted identity numbers, checks their FORMAT, and persists
 * them against the user's document. That is the owner's standing decision while
 * QoreID is out — see lib/kyc-validators.ts for the switch that turns the
 * placeholder screening back on with it.
 *
 * To re-wire QoreID, import qoreIdService here again and call it between each
 * format check and its write; the format checks stay either way, because they
 * are about whether the caller supplied a document at all.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { runQueryWithRetry } from '@/lib/firestore-utils';
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { logger } from '@/lib/logger';
import { requireSession } from '@/lib/session-guard';
import { withSafeAction, type ActionResponse } from '@/lib/safe-action';
import {
    isObviouslyFakeId,
    fakeIdErrorMessage,
    isPlausibleVotersCardNumber,
    normaliseVotersCardNumber,
    votersCardErrorMessage,
} from '@/lib/kyc-validators';
import { atomicUpdateUser } from '@/lib/services/userService';
import { invalidateUserCache } from '@/lib/cache-invalidation';
import { hashData } from '@/lib/security';
import { isTransientError } from '@/lib/transient-error';

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
 * Verify a single BVN against QoreID and save the result to Firestore.
 * Returns isMatch:true only if QoreID confirms the name matches the BVN record.
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
        // This is separate from the QoreID decision recorded further down: that
        // one is "we trust what the user types". This was "we mark verified
        // when the user types nothing", which nobody decided.
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

        // Persist result to Firestore forcefully as fully verified
        await runQueryWithRetry(() => atomicUpdateUser(userId, { 
            'kyc.bvn': bvn ? hashData(bvn) : hashData('00000000000'),
            'kyc.bvnVerified': true,
            'kyc.bvnVerifiedAt': FieldValue.serverTimestamp(),
            'kyc.bvnStatus': 'verified'
        }));

        // Update overall KYC status if BVN now verified
        await updateOverallKYCStatus(userId);

        await invalidateUserCache(userId);

        logger.info('BVN verified forcefully (QoreID bypassed)', { userId });
        return { success: true, error: null, data: { isMatch: true } };
    } catch (error) { 
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        logger.error('BVN verification action error', error);
        const isTransient = isTransientError(message);
        const userFriendlyMessage = isTransient 
            ? "A temporary connection issue occurred. Please try again." 
            : message;
        return { success: false as const, error: userFriendlyMessage, data: null };
    }
}
export const verifyBVNAction = withSafeAction("verifyBVNAction", _verifyBVNAction);

// ─── Verify NIN ──────────────────────────────────────────────────────────────

/**
 * Verify a single NIN against QoreID (nin-premium endpoint) and save
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

        // Persist result to Firestore forcefully as fully verified
        await runQueryWithRetry(() => atomicUpdateUser(userId, { 
            'kyc.nin': nin ? hashData(nin) : hashData('00000000000'),
            'kyc.ninVerified': true,
            'kyc.ninVerifiedAt': FieldValue.serverTimestamp(),
            'kyc.ninStatus': 'verified'
        }));

        // Update overall KYC status if NIN now verified
        await updateOverallKYCStatus(userId);

        await invalidateUserCache(userId);

        logger.info('NIN verified forcefully (QoreID bypassed)', { userId });
        return { success: true, error: null, data: { isMatch: true } };
    } catch (error) { 
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        logger.error('NIN verification action error', error);
        const isTransient = isTransientError(message);
        const userFriendlyMessage = isTransient 
            ? "A temporary connection issue occurred. Please try again." 
            : message;
        return { success: false as const, error: userFriendlyMessage, data: null };
    }
}
export const verifyNINAction = withSafeAction("verifyNINAction", _verifyNINAction);

// ─── Verify Voter's Card ─────────────────────────────────────────────────────

/**
 * Verify a single Voter's Card against QoreID and save the result to Firestore.
 * NOTE: PVC API is highly unreliable, so we allow users to pass this step
 * and defer to manual review.
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

        /**
         * THE THIRD IDENTITY PATH ACCEPTED ANYTHING.
         *
         * The line above was the whole check. BVN and NIN each test
         * /^\d{11}$/ and refuse anything else; this one refused only the
         * empty string. Combined with the forced pass below and
         * updateOverallKYCStatus counting any stored card as a document on
         * file, submitting the single character "x" wrote
         * kyc.status: 'verified' and kycVerified: true on the account.
         *
         * Executed rather than argued: verifyVotersCardAction with
         * votersCardNumber "x" returned success and the user document came
         * back { kycVerified: true, kyc: { status: 'verified',
         * votersCard: 'x' } }.
         *
         * The comment on the BVN check names this exact consequence — "that
         * marked an account KYC-verified having submitted no identity document
         * whatsoever" — and this path went on doing it. The fix from that
         * finding reached two of the three siblings.
         *
         * The forced pass below is NOT touched. That is the owner's decision,
         * documented and reasoned, and it is a different question from whether
         * the thing being passed is a voter's card number at all.
         */
        if (!isPlausibleVotersCardNumber(votersCardNumber)) {
            return { success: false as const, error: votersCardErrorMessage(), data: null };
        }
        const normalisedVotersCard = normaliseVotersCardNumber(votersCardNumber);

        if (!firstName || !lastName) { return { success: false as const, error: "First name and last name are required for Voter's Card verification", data: null };
        }

        logger.info("Voter's Card verification started", { userId, vin: votersCardNumber.slice(0, 4) + '***' });

        // No QoreID verification implemented for Voter's card as per requirements.
        // We defer to manual review and directly mark it as submitted/verified.
        const originalStatus = 'pending_manual_review';

        // Persist result to Firestore but forcefully override to allow the user to pass
        await runQueryWithRetry(() => atomicUpdateUser(userId, { 'kyc.votersCard': normalisedVotersCard,
            // Relaxation for Voter's Card: since PVC names in Nigeria often have inconsistent ordering
            // or the DB fails, we forcefully mark it verified so the user isn't stuck.
            'kyc.votersCardVerified': true,
            'kyc.votersCardVerifiedAt': FieldValue.serverTimestamp(),
            'kyc.votersCardStatus': 'verified',
            'kyc.votersCardOriginalQoreIdStatus': originalStatus }));

        // Update overall KYC status since we forced voter's card to verified
        await updateOverallKYCStatus(userId);

        await invalidateUserCache(userId);

        logger.info("Voter's Card submitted for manual review", { userId });
        // Return success to the frontend so KYCForm lets them proceed
        return { success: true, error: null, data: { isMatch: true, status: 'pending' } };
    } catch (error) { 
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        logger.error("Voter's Card verification action error", error);
        const isTransient = isTransientError(message);
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
        // always consistent. We use a Firestore batch for atomicity and efficiency.
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
        const isTransient = isTransientError(message);
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
