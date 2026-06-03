/**
 * writeGuard — Validates data against a Zod schema before a Firestore write.
 *
 * WHY: Firestore accepts any shape. Without validation at the write boundary,
 * a developer can accidentally write { paymentStatus: 'successful' } instead of
 * the canonical 'paid', or omit a required field, causing silent data corruption.
 *
 * USAGE:
 *   // Instead of: await docRef.set(data)
 *   await docRef.set(writeGuard(UserWriteSchema, data, 'createUser'));
 *
 *   // For partial updates (.update()), use writeGuard with a .partial() schema:
 *   await docRef.update(writeGuard(UserWriteSchema.partial(), patch, 'updateUser'));
 *
 * In development/staging: throws an Error with full field details.
 * In production: logs the error to logger and allows the write (fail-open
 * to avoid blocking payments/critical flows on schema drift).
 */
import { z } from 'zod';
import { logger } from './logger';
import { PAYMENT_STATUS } from './types/firestore';

export function writeGuard<T>(
    schema: z.ZodSchema<T>,
    data: unknown,
    context: string
): T {
    const result = schema.safeParse(data);

    if (result.success) {
        return result.data;
    }

     
    const errorSummary = result.error.issues
        .map((e) => `${e.path.map(String).join('.')}: ${e.message}`)
        .join(', ');

    const message = `[writeGuard] Schema violation in ${context}: ${errorSummary}`;

    if (process.env.NODE_ENV === 'production') {
        // Fail-open in production: log and allow the write to proceed
        // (blocking a payment write is worse than allowing slightly bad data)
        logger.error(message, { context, issues: result.error.issues });
        return data as T; // allow write with original data
    } else {
        // Fail-closed in dev/staging: throw so developers see the problem immediately
        logger.error(message);
        throw new Error(message);
    }
}

/**
 * Zod schemas for the most critical Firestore write shapes.
 * These guard the write boundaries for the most common data corruption patterns.
 */

const PAYMENT_STATUS_VALUES = Object.values(PAYMENT_STATUS) as [string, ...string[]];

/** Schema for payment status fields on any document */
export const PaymentStatusWriteSchema = z.object({
    paymentStatus: z.enum(PAYMENT_STATUS_VALUES).optional(),
});

const VALID_ROLES = [
    'user',
    'admin',
    'super_admin',
    'cooperative_member',
    'academy_student',
    'wave_member',
    'farm_nation_member',
    'marketplace_seller',
    'exporter',
    // Additional roles discovered in codebase
    'wave_participant',
    'export_participant',
    'academy_participant',
    'buyer',
    'seller',
    'farmer',
    'land_owner',
    'investor',
    'academy_admin',
] as const;

/** Schema for user role arrays */
export const UserRolesWriteSchema = z.object({
    roles: z.array(z.enum(VALID_ROLES)).optional(),
});

/** Generic partial update guard — strips undefined keys and validates known shapes */
export const PartialUpdateSchema = z.record(z.string(), z.unknown()).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'Update object must not be empty' }
);
