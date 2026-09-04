import { z } from 'zod';
import { PAYMENT_STATUS } from './firestore';

/**
 *   #369 NOTHING IMPORTS THIS FILE. It is a THIRD statement of the user
 *        document shape, after lib/schemas.ts (the live one, imported by the
 *        auth and action layers) and lib/canonical/schemas.ts (recorded as dead
 *        by #355).
 *
 *        Two of its statements already disagree with the live ones:
 *
 *          parseUserDoc            its refusal path returned the unvalidated
 *                                  input — see the note on the function.
 *          membershipStatus        enumerates pending|active|approved|rejected|
 *                                  suspended. The live union in
 *                                  lib/types/firestore.ts line 133 also has
 *                                  "under_review", which the cooperative
 *                                  application flow writes. A member sitting in
 *                                  review would fail this schema.
 *
 *        The membershipStatus list is NOT derived here, because there is no
 *        runtime constant to derive it from: firestore.ts states it as a
 *        TypeScript union, which does not exist at run time. Adding the missing
 *        value would leave two hand-written lists agreeing by luck. Recorded
 *        instead.
 *
 *        OWNER DECISION: adopt these schemas at the read boundary — which means
 *        first promoting the cooperative membership statuses to a runtime
 *        constant, the way ESCROW_STATUSES and ORDER_STATUSES already are — or
 *        retire the file.
 */

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
 *
 *   #369 ITS FAILURE PATH RETURNED THE UNVALIDATED INPUT.
 *
 *        The rejected branch built a "sanitized object with defaults" and then
 *        ended with
 *
 *            ...(raw as object),
 *
 *        which spreads the raw input back OVER those defaults. So every field
 *        the schema had just refused — including whichever one caused the
 *        failure — was reinstated, and the caller received it typed as a
 *        validated UserDocument. A parser named "type-safe" whose refusal path
 *        hands back exactly what it refused.
 *
 *        Same family as #245 (a kill switch that failed OPEN on a database
 *        error), #112 (an amount check that failed open when the amount was
 *        unreadable) and #365 (a permission whose refusal a role literal
 *        forgave): a control whose refusal leads somewhere other than a
 *        refusal.
 *
 *        It THROWS now, which is what the function's own first branch already
 *        does for a non-object, and the only behaviour that makes the name
 *        true. Nothing imports this file, so nothing changes today — which is
 *        precisely why it is worth fixing before something does.
 */
export function parseUserDoc(raw: unknown): UserDocument {
    if (!raw || typeof raw !== 'object') {
        throw new TypeError('[db-schemas] Cannot parse non-object as UserDocument');
    }
    const result = UserDocumentSchema.safeParse(raw);
    if (result.success) {
        return result.data;
    }
    throw new TypeError(
        `[db-schemas] Document does not match UserDocumentSchema: ${result.error.issues
            .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
            .join('; ')}`,
    );
}
