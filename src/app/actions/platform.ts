"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { waveApplicationSchema,
    withdrawalSchema } from "@/lib/schemas";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimIdempotencyKey, debitJsonbBalanceWithFloor, compensateJsonbDebit } from "@/lib/wallet-ledger";
import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { parseCurrencyStringToFloat } from "@/lib/utils";
import { COOPERATIVE_MINIMUM_BALANCE, formatMinimumBalance, COOPERATIVE_MINIMUM_WITHDRAWAL, formatMinimumWithdrawal } from "@/lib/cooperative-limits";
import { canTransactAsMember, NOT_A_TRANSACTING_MEMBER_MESSAGE } from "@/lib/cooperative-membership-status";

/**
 * Server Actions for Platform Forms
 * 
 * Handles WAVE applications, Academy enrollments, and Cooperative withdrawals
 * with Firestore integration and validation.
 */

// Type definitions for action return states
type ActionErrorState = { error: string;
    success: false;
    data?: null;
    meta?: null; };

type WaveSuccessState = { error: null;
    success: true;
    message: string;
    applicationId: string; };

type WithdrawalSuccessState = { error: null;
    success: true;
    message: string;
    withdrawalId: string; };

export type WaveApplicationState = ActionErrorState | WaveSuccessState;
export type WithdrawalActionState = ActionErrorState | WithdrawalSuccessState;


// ============================================
// WAVE Application Actions
// ============================================

export async function submitWaveApplicationAction(
    prevState: WaveApplicationState,
    formData: FormData
): Promise<WaveApplicationState> { try {
        // Get authenticated user
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;

        // Extract and validate form data
        const applicationData = { fullName: (formData.get("fullName") as string | null)?.trim() ?? "",
            email: (formData.get("email") as string | null)?.trim() ?? "",
            phone: (formData.get("phone") as string | null)?.trim() ?? "",
            gender: (formData.get("gender") as string | null)?.trim() ?? "",
            businessName: (formData.get("businessName") as string | null)?.trim() ?? "",
            businessType: (formData.get("businessType") as string | null)?.trim() ?? "",
            yearsInBusiness: (() => { const y = parseInt((formData.get("yearsInBusiness") as string | null) ?? "0", 10); return isNaN(y) ? 0 : y; })(),
            reasonForApplying: (formData.get("reasonForApplying") as string | null)?.trim() ?? "" };

        // Validate with Zod (enforces female-only validation)
        const validatedData = waveApplicationSchema.parse(applicationData);

        // Double-check gender enforcement at server level
        if (validatedData.gender.toLowerCase() !== "female") { return { error: "WAVE Program is exclusively for female entrepreneurs", success: false as const };
        }

        // Generate application ID
        const applicationId = `WAVE-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        // Save to Firestore
        await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId).set({ ...validatedData,
            userId: session.user.id,
            status: "pending", // pending | approved | rejected
            applicationDate: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        return { error: null, success: true as const, message: "Application submitted successfully! We'll review it within 1 week.", applicationId  };
    } catch (error: any) { logger.error("WAVE application error:", error);

        if (error.name === "ZodError") {
            const zodError = error as ZodError;
            const firstError = zodError.issues[0];
            return { error: firstError?.message || "Please fill in all required fields correctly", success: false as const };
        }

        return { error: "Failed to submit application. Please try again.", success: false as const };
    }
}

// ============================================
// Academy Enrollment — REMOVED, see academy/_ac_enrollment.ts
// ============================================
//
//   #279 A SECOND enrollInCourseAction LIVED HERE AND GRANTED PAID COURSES FOR
//        FREE.
//
//        Two exports of that name existed. The academy barrel exports the one
//        in academy/_ac_enrollment.ts, and that is what both learner pages
//        import. This one had no importer at all — but it was exported from
//        "@/app/actions/platform", a module the UI already imports for
//        submitWithdrawalAction, under a name that SHADOWS the correct action.
//        An autocomplete pick from the wrong module was all it took.
//
//        WHAT THE WIRED ONE CHECKS, AND THIS ONE DID NOT:
//
//          1. the caller is enrolling THEMSELVES
//          2. the registration was not DECIDED AGAINST    (#207/#210)
//          3. checkCourseAccess(userPlan, courseTier)       the plan gate
//
//        It asked for none of them: any signed-in account, any courseId.
//
//        AND IT WROTE THE DOCUMENT THE PAID FLOW OWNS. academy/_payment.ts
//        writes enrollments/{userId}_{courseId} as `status: "pending_payment"`
//        with a Paystack reference and a 1,000 naira minimum, and only the
//        verified callback promotes it to "active". This wrote THE SAME DOC ID
//        straight to `status: "active"` with no amount and no reference — two
//        writers of one document disagreeing about what "active" means, and one
//        of them able to mint it for nothing.
//
//        Removed rather than hardened: hardening it would mean reimplementing
//        the action that already exists and is wired. Nothing imported it, so
//        nothing breaks — a tombstone rather than a silent deletion, so the
//        next person looking for it is sent to the right one. Same treatment as
//        api/kyc/verify-id.


// ============================================
// Cooperative Withdrawal Actions
// ============================================

export async function submitWithdrawalAction(
    prevState: WithdrawalActionState,
    formData: FormData
): Promise<WithdrawalActionState> { try {
        // Get authenticated user
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        const idempotencyKey = (formData.get("idempotencyKey") as string | null)?.trim() ?? "";
        if (!idempotencyKey) { return { error: "Missing security token. Please refresh the page.", success: false as const };
        }

        // Extract and validate form data
        const rawAmount = formData.get("amount") as string | null;
        const parsedAmount = rawAmount ? parseCurrencyStringToFloat(rawAmount) : NaN;
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return { error: "Invalid amount", success: false as const };
        }

        //   #276 THE FOURTH DOOR, AND THE ONLY ONE A MEMBER CAN REACH.
        //
        //        Three other paths take a cooperative withdrawal and every one
        //        of them enforces COOPERATIVE_MINIMUM_WITHDRAWAL. This one asked
        //        only that the amount be positive — and it is what
        //        WithdrawalModal.tsx calls, so through the product a NGN 1
        //        withdrawal went through.
        if (parsedAmount < COOPERATIVE_MINIMUM_WITHDRAWAL) {
            return {
                error: `Minimum withdrawal amount is ${formatMinimumWithdrawal()}`,
                success: false as const,
            };
        }
        const withdrawalData = { cooperativeId: (formData.get("cooperativeId") as string | null)?.trim() ?? "",
            amount: parsedAmount,
            accountNumber: (formData.get("accountNumber") as string | null)?.trim() ?? "",
            accountName: (formData.get("accountName") as string | null)?.trim() ?? "",
            bankName: (formData.get("bankName") as string | null)?.trim() ?? "",
            reason: (formData.get("reason") as string | null)?.trim() ?? "" };

        // Validate with Zod
        const validatedData = withdrawalSchema.parse(withdrawalData);

        // Generate withdrawal request ID
        const withdrawalId = `WD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        // WHAT WAS WRONG HERE
        // -------------------
        // Two defects, both on a path that locks a member's savings.
        //
        // 1. The idempotency key was read at the top and written at the BOTTOM,
        //    with the fund lock in between. Two submissions carrying the same
        //    key both read "absent" and both proceeded, so the member's savings
        //    were locked TWICE for one request. The key made the duplicate look
        //    impossible without preventing it.
        //
        // 2. The balance was read, compared to the amount, and then decremented
        //    — inside runTransaction, which takes no lock. The same overdraft
        //    shape already fixed on _submitWithdrawalAction and WAVE earnings.
        //
        // The key is claimed first, then the debit is taken under a row lock.
        const keyClaim = await claimIdempotencyKey({
            key: idempotencyKey,
            userId: session.user.id,
            action: "submit_withdrawal",
        });

        if (!keyClaim.claimed) {
            return { error: "Duplicate transaction detected. Please wait.", success: false as const };
        }

        // CORRECT PATTERN: Use Root Collection for members (Standardized)
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(session.user.id);
        const memberDoc = await memberRef.get();

        if (!memberDoc.exists) { throw new Error("You are not a member of any cooperative");
        }

        const memberData = memberDoc.data();

        //   #276 EXISTING IS NOT THE SAME AS MAY TRANSACT.
        //
        //        This checked that a membership row EXISTS and that its
        //        cooperativeId matches, and nothing else. A member at "pending"
        //        — registered, onboarding incomplete, nothing approved —
        //        satisfies both and could withdraw savings.
        //
        //        cooperative-membership-status.ts was written for exactly this
        //        question and opens with "FIVE DOORS, THREE ANSWERS", listing
        //        the doors it corrected. This one is not on that list, and it is
        //        the only door the product reaches. Its own note about the two
        //        it did fix applies here with money leaving instead of being
        //        locked: "A member still at 'pending' ... could file a loan
        //        application and lock savings into a fixed plan through them,
        //        while the routes doing the same work refused."
        //
        //        The shared predicate, not a literal: "approved" is the LEGACY
        //        spelling of "active", and a hand-written `=== "active"` here
        //        would refuse every legacy member their own savings.
        if (!canTransactAsMember(memberData)) {
            return { error: NOT_A_TRANSACTING_MEMBER_MESSAGE, success: false as const };
        }

        // Validate that the user belongs to the target cooperative
        if (memberData?.cooperativeId !== validatedData.cooperativeId) { throw new Error("Membership mismatch: You do not belong to this cooperative");
        }

        // Use 'savingsBalance' as per schema, fallback to 'balance' if legacy
        const currentBalance = memberData?.savingsBalance || memberData?.balance || 0;

        // The minimum-balance rule is a policy floor, and it is now applied
        // under the same lock as the debit.
        //
        // It used to be a plain read above the debit, and the comment here said
        // so: two withdrawals that each leave 5,000 behind can together dip
        // under it, because a read takes no lock. debitJsonbBalance could not
        // close that gap — it checks `balance >= amount` and nothing else, so it
        // guaranteed only that the balance could not go NEGATIVE.
        //
        // debit_jsonb_balance_with_floor (migration 020) is the primitive that
        // note asked for. The advisory read is gone rather than kept alongside.
        //
        // The floor itself comes from lib/cooperative-limits.ts. It was a local
        // `const MIN_BALANCE = 5000` here — a THIRD copy of the same number,
        // after the withdraw route and the loan-repayment-from-savings path.
        // cooperative-limits.ts exists precisely to stop that, and its own
        // header says why: "two copies of a money rule in two files is how the
        // copies come to disagree". This file was written before it and never
        // moved over, so a change to the floor would have reached two of the
        // three paths that reduce a member's savings.
        const MIN_BALANCE = COOPERATIVE_MINIMUM_BALANCE;

        // 1. Lock Funds — debited under a row lock, floor included.
        const debit = await debitJsonbBalanceWithFloor({
            table: "cooperative_members",
            id: session.user.id,
            field: "savingsBalance",
            amount: validatedData.amount,
            floor: MIN_BALANCE,
        });

        if (!debit.ok) {
            // below_floor is not insufficient_funds: the member has the money
            // and is simply not allowed to take all of it.
            return {
                error: debit.reason === "below_floor"
                    // Formatted from the same module as the value that was
                    // enforced, so the figure a member is shown is the figure
                    // they were refused by.
                    ? `You must maintain a minimum balance of ${formatMinimumBalance()}`
                    : debit.reason === "insufficient_funds"
                        ? `Insufficient balance. Available: ₦${Number(debit.balance).toLocaleString()}`
                        : "You are not a member of any cooperative",
                success: false as const,
            };
        }

        // From here the member's savings are ALREADY DOWN.
        //
        // The debit is one round trip and the two writes below are two more,
        // flushed one at a time. A timeout between them left the savings reduced
        // with no locked balance and no withdrawal request — nothing for an
        // admin to approve or reject — and the catch at the end of this function
        // only logged it. `locked` records how far this got so the compensation
        // reverses exactly that much.
        let locked = false;
        try {
        await memberRef.update({
            lockedBalance: FieldValue.increment(validatedData.amount),
            updatedAt: FieldValue.serverTimestamp() });
        locked = true;

        // 2. Create Withdrawal Request
        const withdrawalRef = db.collection(COLLECTIONS.WITHDRAWALS).doc(withdrawalId);
        await withdrawalRef.set({ userId: session.user.id,
            cooperativeId: validatedData.cooperativeId,
            amount: validatedData.amount,
            accountNumber: validatedData.accountNumber,
            accountName: validatedData.accountName,
            bankName: validatedData.bankName,
            reason: validatedData.reason,
            status: "pending", // pending | approved | rejected | completed
            requestDate: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        } catch (workError) {
            await compensateJsonbDebit({
                table: "cooperative_members",
                id: session.user.id,
                field: "savingsBalance",
                amount: validatedData.amount,
                reason: "withdrawal request could not be recorded after the debit",
                ...(locked ? { also: { lockedBalance: -validatedData.amount } } : {}),
            });
            throw workError;
        }

        // (The idempotency key row is written by claimIdempotencyKey above.)

        revalidatePath("/cooperatives");
        // /dashboard/cooperatives has no route; the cooperative dashboard is
        // /cooperatives/dashboard. revalidatePath on a path with no route is a
        // silent no-op, so a member who withdrew kept seeing a cached balance.
        revalidatePath("/cooperatives/dashboard");
        revalidatePath("/admin/withdrawals");

        return {
            error: null,
            success: true as const,
            message: `Withdrawal request submitted! Reference: ${withdrawalId}`,
            withdrawalId
        };
    } catch (error: any) { logger.error("Withdrawal error:", error);

        if (error.name === "ZodError") {
            return { error: "Please fill in all required fields correctly", success: false as const };
        }

        if (error.message.includes("balance")) { return { error: error.message, success: false as const };
        }

        return { error: "Failed to submit withdrawal request. Please try again.", success: false as const };
    }
}
