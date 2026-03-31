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

        logger.info('BVN verification started', { userId, bvn: bvn.slice(0, 4) + '***' });

        const result = await qoreIdService.verifyBVN(bvn, firstName, lastName);

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
            return {
                success: true,
                isMatch: false,
                error: 'BVN name mismatch — the name on your BVN record does not match the name you provided. Please check your name spelling and try again.',
            };
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

        logger.info('NIN verification started', { userId, nin: nin.slice(0, 4) + '***' });

        const result = await qoreIdService.verifyNIN(nin, firstName, lastName);

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
            return {
                success: true,
                isMatch: false,
                error: 'NIN name mismatch — the name on your NIN record does not match the name you provided. Please check your name spelling and try again.',
            };
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

// ─── Save KYC Profile (non-verified fields) ───────────────────────────────────

/**
 * Save personal KYC fields (no ID verification) — fullName, DOB, address etc.
 * Called from the onboarding flow after the form is filled.
 */
export async function saveKYCProfileAction(payload: {
    fullName: string;
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

        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            'kyc.fullName': payload.fullName,
            'kyc.dateOfBirth': payload.dateOfBirth,
            'kyc.phoneNumber': payload.phoneNumber,
            'kyc.address': payload.address,
            'kyc.city': payload.city,
            'kyc.state': payload.state,
            'kyc.idType': payload.idType || null,
            'kyc.idNumber': payload.idNumber || null,
            'kyc.profileSavedAt': FieldValue.serverTimestamp(),
            // Sync PII for Communication Hub
            phone: payload.phoneNumber,
            stateOfOrigin: payload.state,
            residentialAddress: payload.address,
            updatedAt: FieldValue.serverTimestamp(),
        });

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

        // KYC is considered complete when BOTH primary IDs are verified
        const kycComplete = bvnVerified && ninVerified;

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
