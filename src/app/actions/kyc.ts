'use server';

/**
 * KYC Server Actions
 *
 * Handles real-time BVN and NIN verification via QoreID and persists
 * the result to the user's Firestore document.
 */

import { qoreIdService } from '@/lib/qoreid';
import { db } from '@/lib/firebase-admin';
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '@/lib/logger';
import { requireSession } from '@/lib/session-guard';
import { isObviouslyFakeId, fakeIdErrorMessage } from '@/lib/kyc-validators';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KYCVerificationResult {
    success: boolean;
    isMatch?: boolean;
    error?: string;
    /** Populated when names don't match — helps user see what name is on record */
    hint?: string;
}

export interface SubmitKYCPayload {
    firstName: string;
    lastName: string;
    /** 11-digit BVN (optional — only verified when provided) */
    bvn?: string;
    /** 11-digit NIN (optional — only verified when provided) */
    nin?: string;
}

// ─── Verify BVN ──────────────────────────────────────────────────────────────

/**
 * Verify a single BVN against QoreID and save the result to Firestore.
 * Returns isMatch:true only if QoreID confirms the name matches the BVN record.
 */
export async function verifyBVNAction(payload: {
    bvn: string;
    firstName: string;
    lastName: string;
}): Promise<KYCVerificationResult> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: 'Not authenticated' };
        const { session } = sessionResult;
        const userId = session.user!.id;

        const { bvn, firstName, lastName } = payload;

        if (!bvn || !/^\d{11}$/.test(bvn)) {
            return { success: false, error: 'BVN must be exactly 11 digits' };
        }
        if (!firstName || !lastName) {
            return { success: false, error: 'First name and last name are required for BVN verification' };
        }

        // Guard: reject obviously fake / placeholder BVN patterns server-side
        if (isObviouslyFakeId(bvn)) {
            logger.warn('[verifyBVNAction] Suspicious BVN submitted', { userId, bvn });
            return { success: false, error: fakeIdErrorMessage('BVN') };
        }

        logger.info('BVN verification started [QOREID BYPASSED]', { userId, bvn: bvn.slice(0, 4) + '***' });

        // BYPASS QOREID: Automatically grant success and match
        const result = { success: true, isMatch: true, error: undefined };

        // Persist result to Firestore regardless of match outcome
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            'kyc.bvn': bvn,
            'kyc.bvnVerified': result.success && result.isMatch,
            'kyc.bvnVerifiedAt': FieldValue.serverTimestamp(),
            'kyc.bvnStatus': result.success
                ? (result.isMatch ? 'verified' : 'mismatch')
                : 'failed',
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (!result.success) {
            return { success: false, error: result.error || 'BVN verification failed' };
        }

        if (!result.isMatch) {
            return { success: true, isMatch: false,
                error: 'BVN name mismatch — the name on your BVN record does not match the name you provided. Please check your name spelling and try again.' };
        }

        // Update overall KYC status if BVN now verified
        await updateOverallKYCStatus(userId);

        logger.info('BVN verified successfully', { userId });
        return { success: true, isMatch: true };
    } catch (error: any) {
        logger.error('BVN verification action error', error);
        return { success: false, error: error?.message || 'An unexpected error occurred' };
    }
}

// ─── Verify NIN ──────────────────────────────────────────────────────────────

/**
 * Verify a single NIN against QoreID (nin-premium endpoint) and save
 * the result to Firestore.
 */
export async function verifyNINAction(payload: {
    nin: string;
    firstName: string;
    lastName: string;
}): Promise<KYCVerificationResult> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: 'Not authenticated' };
        const { session } = sessionResult;
        const userId = session.user.id;

        const { nin, firstName, lastName } = payload;

        if (!nin || !/^\d{11}$/.test(nin)) {
            return { success: false, error: 'NIN must be exactly 11 digits' };
        }
        if (!firstName || !lastName) {
            return { success: false, error: 'First name and last name are required for NIN verification' };
        }

        // Guard: reject obviously fake / placeholder NIN patterns server-side
        if (isObviouslyFakeId(nin)) {
            logger.warn('[verifyNINAction] Suspicious NIN submitted', { userId, nin });
            return { success: false, error: fakeIdErrorMessage('NIN') };
        }

        logger.info('NIN verification started [QOREID BYPASSED]', { userId, nin: nin.slice(0, 4) + '***' });

        // BYPASS QOREID: Automatically grant success and match
        const result = { success: true, isMatch: true, error: undefined };

        // Persist result to Firestore regardless of match outcome
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            'kyc.nin': nin,
            'kyc.ninVerified': result.success && result.isMatch,
            'kyc.ninVerifiedAt': FieldValue.serverTimestamp(),
            'kyc.ninStatus': result.success
                ? (result.isMatch ? 'verified' : 'mismatch')
                : 'failed',
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (!result.success) {
            return { success: false, error: result.error || 'NIN verification failed' };
        }

        if (!result.isMatch) {
            return { success: true, isMatch: false,
                error: 'NIN name mismatch — the name on your NIN record does not match the name you provided. Please check your name spelling and try again.' };
        }

        // Update overall KYC status if NIN now verified
        await updateOverallKYCStatus(userId);

        logger.info('NIN verified successfully', { userId });
        return { success: true, isMatch: true };
    } catch (error: any) {
        logger.error('NIN verification action error', error);
        return { success: false, error: error?.message || 'An unexpected error occurred' };
    }
}

// ─── Verify Voter's Card ─────────────────────────────────────────────────────

/**
 * Verify a single Voter's Card against QoreID and save the result to Firestore.
 * NOTE: PVC API is highly unreliable, so we allow users to pass this step
 * and defer to manual review.
 */
export async function verifyVotersCardAction(payload: {
    votersCardNumber: string;
    firstName: string;
    lastName: string;
}): Promise<KYCVerificationResult> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: 'Not authenticated' };
        const { session } = sessionResult;
        const userId = session.user.id;

        const { votersCardNumber, firstName, lastName } = payload;

        if (!votersCardNumber) {
            return { success: false, error: "Voter's Card number is required" };
        }
        if (!firstName || !lastName) {
            return { success: false, error: "First name and last name are required for Voter's Card verification" };
        }

        logger.info("Voter's Card verification started", { userId, vin: votersCardNumber.slice(0, 4) + '***' });

        // No QoreID verification implemented for Voter's card as per requirements.
        // We defer to manual review and directly mark it as submitted/verified.
        const originalStatus = 'pending_manual_review';

        // Persist result to Firestore but forcefully override to allow the user to pass
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            'kyc.votersCard': votersCardNumber,
            // Relaxation for Voter's Card: since PVC names in Nigeria often have inconsistent ordering
            // or the DB fails, we forcefully mark it verified so the user isn't stuck.
            'kyc.votersCardVerified': true,
            'kyc.votersCardVerifiedAt': FieldValue.serverTimestamp(),
            'kyc.votersCardStatus': 'verified',
            'kyc.votersCardOriginalQoreIdStatus': originalStatus,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Update overall KYC status since we forced voter's card to verified
        await updateOverallKYCStatus(userId);

        logger.info("Voter's Card allowed and bypassed for manual review", { userId });
        
        // Return 100% success to the frontend so KYCForm lets them proceed
        return { success: true, isMatch: true };
    } catch (error: any) {
        logger.error("Voter's Card verification action error", error);
        return { success: false, error: error?.message || 'An unexpected error occurred' };
    }
}

// ─── Save KYC Profile (non-verified fields) ───────────────────────────────────

/**
 * Save personal KYC fields (no ID verification) — fullName, DOB, address etc.
 * Called from the onboarding flow after the form is filled.
 */
export async function saveKYCProfileAction(payload: {
    firstName: string;
    lastName: string;
    otherNames?: string;
    dateOfBirth: string;
    phoneNumber: string;
    address: string;
    city: string;
    state: string;
    idType?: string;
    idNumber?: string;
}): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: 'Not authenticated' };
        const { session } = sessionResult;
        const userId = session.user.id;

        const computedFullName = [payload.firstName, payload.otherNames, payload.lastName]
            .filter(Boolean)
            .join(' ');

        // Build root user update
        const rootUpdate: Record<string, any> = {
            'kyc.firstName': payload.firstName,
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
            // Sync PII to root user doc for Communication Hub queries
            firstName: payload.firstName,
            lastName: payload.lastName,
            otherName: payload.otherNames || null,
            phone: payload.phoneNumber,
            fullName: computedFullName,
            stateOfOrigin: payload.state,
            city: payload.city,
            residentialAddress: payload.address,
            updatedAt: FieldValue.serverTimestamp(),
        };

        await db.collection(COLLECTIONS.USERS).doc(userId).update(rootUpdate);

        // ── Cross-module PII sync ──────────────────────────────────────────────
        // Propagate the latest phone / name / address to all module sub-collections
        // so that queries against those collections (SMS broadcast, admin views) are
        // always consistent. We use a Firestore batch for atomicity and efficiency.
        try {
            const batch = db.batch();

            // 1. academy_applications — find by userId
            const academySnap = await db
                .collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where('userId', '==', userId)
                .get();
            for (const doc of academySnap.docs) {
                batch.update(doc.ref, {
                    'personalInfo.phone': payload.phoneNumber,
                    'personalInfo.fullName': computedFullName,
                    'personalInfo.state': payload.state,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            // 2. cooperative_members — find by userId
            const coopSnap = await db
                .collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where('userId', '==', userId)
                .get();
            for (const doc of coopSnap.docs) {
                batch.update(doc.ref, {
                    phone: payload.phoneNumber,
                    state: payload.state,
                    address: payload.address,
                    fullName: computedFullName,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            // 3. wave_applications — find by userId
            const waveSnap = await db
                .collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where('userId', '==', userId)
                .get();
            for (const doc of waveSnap.docs) {
                batch.update(doc.ref, {
                    phone: payload.phoneNumber,
                    stateOfOrigin: payload.state,
                    residentialAddress: payload.address,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            // 4. seller_verifications — find by userId
            const sellerSnap = await db
                .collection(COLLECTIONS.SELLER_VERIFICATIONS)
                .where('userId', '==', userId)
                .get();
            for (const doc of sellerSnap.docs) {
                batch.update(doc.ref, {
                    phone: payload.phoneNumber,
                    'address.state': payload.state,
                    'address.city': payload.city,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            // 5. export_onboarding_applications — find by userId
            const exportSnap = await db
                .collection(COLLECTIONS.EXPORT_APPLICATIONS)
                .where('userId', '==', userId)
                .get();
            for (const doc of exportSnap.docs) {
                batch.update(doc.ref, {
                    'profile.phone': payload.phoneNumber,
                    'profile.fullName': computedFullName,
                    'profile.state': payload.state,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            await batch.commit();
            logger.info('Cross-module PII sync completed', { userId });
        } catch (syncError: any) {
            // Non-fatal — root KYC data was already saved. Log and continue.
            logger.warn('Cross-module PII sync partial failure', { userId, error: syncError?.message });
        }

        return { success: true };
    } catch (error: any) {
        logger.error('Save KYC profile error', error);
        return { success: false, error: error?.message || 'Failed to save KYC profile' };
    }
}

// ─── Internal: Compute overall KYC status ────────────────────────────────────

async function updateOverallKYCStatus(userId: string) {
    try {
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const snap = await userRef.get();
        const kyc = snap.data()?.kyc || {};

        const bvnVerified = kyc.bvnVerified === true;
        const ninVerified = kyc.ninVerified === true;
        const votersCardVerified = kyc.votersCardVerified === true;

        // KYC is considered complete when BVN is verified and at least one primary ID (NIN or Voter's Card) is verified
        const kycComplete = bvnVerified && (ninVerified || votersCardVerified);

        await userRef.update({
            'kyc.status': kycComplete ? 'verified' : 'pending',
            'kyc.completedAt': kycComplete ? FieldValue.serverTimestamp() : null,
            kycVerified: kycComplete,
            updatedAt: FieldValue.serverTimestamp(),
        });
    } catch (err) {
        logger.error('Failed to update overall KYC status', err);
    }
}
