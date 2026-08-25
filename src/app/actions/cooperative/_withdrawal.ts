/**
 * Submit Withdrawal Request
 * Creates a withdrawal request that requires admin approval
 */
"use server";

import { auth } from '@/lib/auth';
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from '@/lib/types/firestore';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from '@/lib/audit-log';
import { debitJsonbBalanceWithFloor, compensateJsonbDebit } from "@/lib/wallet-ledger";
import {
    COOPERATIVE_MINIMUM_BALANCE,
    COOPERATIVE_MINIMUM_WITHDRAWAL,
    formatMinimumBalance,
    formatMinimumWithdrawal,
    availableAboveFloor,
} from "@/lib/cooperative-limits";
import { canTransactAsMember, NOT_A_TRANSACTING_MEMBER_MESSAGE } from "@/lib/cooperative-membership-status";
import { revalidatePath } from 'next/cache';

interface WithdrawalRequestData { amount: number;
    bankName: string;
    accountNumber: string;
    accountName: string;
    reason?: string; }

import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";

async function _submitWithdrawalRequestAction(
    data: WithdrawalRequestData
): Promise<ActionResponse> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const userEmail = session.user.email || "";

        const { withdrawalSchema } = await import("@/lib/schemas");
        const submissionSchema = withdrawalSchema.omit({ cooperativeId: true });

        const validation = submissionSchema.safeParse(data);

        if (!validation.success) { return { success: false as const, error: validation.error.issues[0]?.message || "Invalid withdrawal data", data: null };
        }

        const validatedData = validation.data;

        // withdrawalSchema asks only for a POSITIVE amount, while
        // /api/cooperative/withdraw refuses anything under ₦1,000. So a ₦1
        // request was refused by the route and accepted here — creating a
        // pending request an admin has to action and locking the amount out of
        // the member's savings until they do. See lib/cooperative-limits.ts.
        if (validatedData.amount < COOPERATIVE_MINIMUM_WITHDRAWAL) {
            return {
                success: false as const,
                error: `Minimum withdrawal amount is ${formatMinimumWithdrawal()}`,
                data: null,
            };
        }

        const membershipRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
        const membershipDoc = await membershipRef.get();

        if (!membershipDoc.exists) {
            throw new Error('You are not a member of any cooperative');
        }

        const membership = membershipDoc.data()!;

        // #276 This checked only that the row EXISTED, like platform.ts. Same
        // omission, same shared predicate — and "approved" must still pass,
        // because it is the legacy spelling of "active".
        if (!canTransactAsMember(membership)) {
            return { success: false as const, error: NOT_A_TRANSACTING_MEMBER_MESSAGE, data: null };
        }

        // Reserve the funds under a row lock.
        //
        // This read savingsBalance, compared it to the amount and then
        // decremented, inside runTransaction — which takes no lock. Two
        // withdrawals submitted together both passed against the same balance
        // and both deducted, taking a member's savings negative. Migration 010
        // made that worse rather than better: the decrements used to lose one
        // another, which accidentally hid the overdraft.
        //
        // Same conversion as _submitWithdrawalAction in _actions.ts and
        // submitWithdrawalAction in platform.ts. This was the third door onto
        // the same balance; see docs/audit/integrity-sweep-2026-08-10.md.
        //
        // AND THE MINIMUM BALANCE APPLIED TO TWO OF THE THREE.
        //
        // COOPERATIVE_MINIMUM_BALANCE exists because a member must leave ₦5,000
        // in their savings. /api/cooperative/withdraw enforces it through
        // debitJsonbBalanceWithFloor, and so does repayLoanFromSavingsAction,
        // which reduces the same balance for a different reason. This door — a
        // plain withdrawal, the same operation the route performs — used
        // debitJsonbBalance, which enforces "not negative" and nothing more.
        //
        // A member could empty their savings to zero here and be refused at
        // ₦4,999 there, for the same request. cooperative-limits.ts was written
        // for precisely this and its own header names the shape: "the recurring
        // shape in this codebase is a rule applied to one path and not to its
        // sibling".
        const debit = await debitJsonbBalanceWithFloor({
            table: "cooperative_members",
            id: userId,
            field: "savingsBalance",
            amount: validatedData.amount,
            floor: COOPERATIVE_MINIMUM_BALANCE,
        });

        if (!debit.ok) {
            // below_floor is not insufficient_funds — the member HAS the money
            // and is not permitted to take all of it, which is the distinction
            // the route already draws.
            throw new Error(
                debit.reason === "below_floor"
                    ? `You must keep a minimum balance of ${formatMinimumBalance()}. Available to withdraw: ₦${availableAboveFloor(Number(debit.balance)).toLocaleString()}`
                    : debit.reason === "insufficient_funds"
                        ? `Insufficient balance. Available: ₦${Number(debit.balance).toLocaleString()}`
                        : 'You are not a member of any cooperative'
            );
        }

        // From here the member's savings are ALREADY DOWN.
        //
        // The debit above is one round trip; everything after it is several
        // more, and the adapter flushes them one at a time. A timeout between
        // them used to leave the savings reduced with nothing to show for it: no
        // locked balance, no pending request, nothing for an admin to approve or
        // reject, and the member told only "Failed to submit withdrawal
        // request". The money was simply gone.
        //
        // `locked` tracks how far this got, so the compensation reverses exactly
        // what happened and not more.
        let locked = false;
        try {
        // Move the reserved funds into lockedBalance. The admin approve/reject
        // paths both decrement it, so a request that never incremented it drives
        // the field negative.
        await membershipRef.update({
            lockedBalance: FieldValue.increment(validatedData.amount),
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1),
        });
        locked = true;

        const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc();
        await withdrawalRef.set({ userId,
            userEmail,
            userName: session.user.name || userEmail,
            cooperativeId: membership.cooperativeId || "default",
            amount: validatedData.amount,
            bankName: validatedData.bankName,
            accountNumber: validatedData.accountNumber,
            accountName: validatedData.accountName,
            reason: validatedData.reason || 'Personal withdrawal',
            status: 'pending',
            _version: 0,
            requestedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        } catch (workError) {
            await compensateJsonbDebit({
                table: "cooperative_members",
                id: userId,
                field: "savingsBalance",
                amount: validatedData.amount,
                reason: "withdrawal request could not be recorded after the debit",
                ...(locked ? { also: { lockedBalance: -validatedData.amount } } : {}),
            });
            throw workError;
        }

        await createAdminAuditLog({
            action: 'payment_initiated',
            userId,
            userEmail,
            targetId: `W-${Date.now()}`,
            targetType: 'withdrawal',
            metadata: { amount: validatedData.amount,
                bankName: validatedData.bankName,
                accountNumber: validatedData.accountNumber },
            details: `Withdrawal request of ₦${validatedData.amount.toLocaleString()} submitted` });

        try { const { sendWithdrawalConfirmationEmail } = await import('@/lib/email-notifications');
            if (sendWithdrawalConfirmationEmail) { await sendWithdrawalConfirmationEmail(
                    userEmail,
                    session.user.name || userEmail,
                    validatedData.amount,
                    "PENDING"
                );
            }
        } catch (emailError) { logger.error('Failed to send confirmation email:', emailError);
        }

        revalidatePath('/dashboard/wallet');
        revalidatePath('/cooperatives/loans');

        return {
            error: null,
            success: true as const,
            data: { amount: validatedData.amount }
        };
    } catch (error: any) { logger.error('Withdrawal request error:', {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error.message || 'Failed to submit withdrawal request', success: false as const, data: null };
    }
}
export const submitWithdrawalRequestAction = withFlexibleSafeAction("submitWithdrawalRequestAction", _submitWithdrawalRequestAction);
