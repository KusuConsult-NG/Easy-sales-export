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
import { ALL_USER_ROLES } from './types/roles';
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

    logger.error(message, { context, issues: result.error.issues });
    throw new Error(message);
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

/**
 * The one list, imported rather than repeated.
 *
 * THIS LIST WAS BREAKING THE ADMIN ROLE EDITOR
 * --------------------------------------------
 * It was a hand-written 19 entries, and lib/types/roles.ts's own header names
 * it as one of the six disagreeing role lists — "including 'user',
 * 'academy_student', 'wave_member', 'farm_nation_member' and 'exporter', none
 * of which are roles". Those five are not the problem. What it OMITTED was.
 *
 * `updateUserRolesAction` validates its input against schemas.ts's
 * UserRoleSchema and then writes through this one. UserRoleSchema accepts
 * `general_user`, `marketplace_buyer` and `field_officer`; this list did not.
 * So any of those three passed validation and was then refused at the write
 * boundary with "[writeGuard] Schema violation in admin/updateUserRoles".
 *
 * `general_user` is the BASE role — it is on essentially every ordinary
 * account, and the editor writes the roles array wholesale, so the existing
 * role has to be sent back with any addition. Editing the roles of an ordinary
 * user therefore failed outright, every time, with a message that reads like an
 * internal error because it is one.
 *
 * ALL_USER_ROLES is the value form of the UserRole type, and roles.ts fails
 * compilation if the two drift. Deriving from it is what stops a seventh list
 * appearing.
 *
 * Widening this does NOT widen who may grant what: authorisation is
 * hasAdminPermission(..., "users:assign_roles") plus the super-admin-only rule
 * in admin-permissions.ts, whose PRIVILEGED_ROLES is COMPUTED from the
 * permission matrix and so already covers every module-admin role this now
 * accepts.
 */
const VALID_ROLES = ALL_USER_ROLES;

/** Schema for user role arrays */
export const UserRolesWriteSchema = z.object({
    roles: z.array(z.enum(VALID_ROLES)).optional(),
});

/** Generic partial update guard — strips undefined keys and validates known shapes */
export const PartialUpdateSchema = z.record(z.string(), z.unknown()).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'Update object must not be empty' }
);
