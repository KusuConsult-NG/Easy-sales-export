import { z } from 'zod';
import { PAYMENT_STATUS } from './firestore';

/**
 * Zod schema for canonical User document stored in `users` table or `raw_data`
 */
export const UserDocumentSchema = z.object({
    id: z.string(),
    email: z.string().email().or(z.string()),
    roles: z.array(z.string()).default(['general_user']),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    otherName: z.string().optional(),
    fullName: z.string().optional(),
    phone: z.string().optional(),
    isVerified: z.boolean().default(false),
    verified: z.boolean().optional(), // legacy field
    isBanned: z.boolean().optional(),
    status: z.string().optional(),
    cooperativeId: z.string().optional(),
    requiresPasswordChange: z.boolean().optional(),
    onboardingCompleted: z.boolean().default(false),
    serviceRegistrations: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    verificationProfile: z.record(z.string(), z.unknown()).optional(),
    kyc: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.unknown().optional(),
    updatedAt: z.unknown().optional(),
});

export type UserDocument = z.infer<typeof UserDocumentSchema>;

/**
 * Zod schema for KYC document shape
 */
export const KycDocumentSchema = z.object({
    bvn: z.string().optional(),
    bvnVerified: z.boolean().optional(),
    nin: z.string().optional(),
    ninVerified: z.boolean().optional(),
    tin: z.string().optional(),
    tinVerified: z.boolean().optional(),
    cac: z.string().optional(),
    cacVerified: z.boolean().optional(),
    status: z.enum(['pending', 'verified', 'rejected']).optional(),
    verifiedAt: z.unknown().optional(),
});

export type KycDocument = z.infer<typeof KycDocumentSchema>;

/**
 * Zod schema for Cooperative Member document
 */
export const CooperativeMemberDocumentSchema = z.object({
    id: z.string(),
    userId: z.string(),
    membershipStatus: z.enum(['pending', 'active', 'approved', 'rejected', 'suspended']).default('pending'),
    savingsBalance: z.number().default(0),
    sharesBalance: z.number().default(0),
    joinedAt: z.unknown().optional(),
    approvedAt: z.unknown().optional(),
});

export type CooperativeMemberDocument = z.infer<typeof CooperativeMemberDocumentSchema>;

/**
 * Zod schema for Wallet document
 */
export const WalletDocumentSchema = z.object({
    id: z.string(),
    userId: z.string().optional(),
    balance: z.number().default(0),
    ledgerBalance: z.number().optional(),
    currency: z.string().default('NGN'),
    updatedAt: z.unknown().optional(),
});

export type WalletDocument = z.infer<typeof WalletDocumentSchema>;

/**
 * Type-safe user document parser
 * Safely parses raw database JSONB output into a typed UserDocument.
 */
export function parseUserDoc(raw: unknown): UserDocument {
    if (!raw || typeof raw !== 'object') {
        throw new TypeError('[db-schemas] Cannot parse non-object as UserDocument');
    }
    const result = UserDocumentSchema.safeParse(raw);
    if (result.success) {
        return result.data;
    }
    // Return sanitized object with defaults if parse contains unexpected types
    const fallbackId = (raw as any).id || (raw as any).uid || 'unknown';
    return {
        id: String(fallbackId),
        email: String((raw as any).email || ''),
        roles: Array.isArray((raw as any).roles) ? (raw as any).roles : ['general_user'],
        isVerified: Boolean((raw as any).isVerified || (raw as any).verified),
        onboardingCompleted: Boolean((raw as any).onboardingCompleted),
        ...(raw as object),
    };
}
