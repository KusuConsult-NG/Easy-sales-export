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
import { findCooperativeMemberRow } from "@/lib/cooperative-member-lookup";
import { isAmountAtLeast } from "@/lib/amount";

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

/*
 *   #827 RETIRED — A SECOND WAVE APPLICATION WRITER, EIGHT FIELDS WIDE.
 *
 *        Exactly the shape the note below this one records for
 *        enrollInCourseAction, in the same module, for the same reason: an
 *        action nothing imports, exported from "@/app/actions/platform" — which
 *        the UI ALREADY imports for submitWithdrawalAction — under a name an
 *        autocomplete offers beside the correct one.
 *
 *        WHAT THE LIVE APPLICATION COLLECTS, AND THIS DID NOT. The wired path
 *        is submitMultiStepWaveApplicationAction: roughly fifty fields, NIN and
 *        BVN, state, LGA, ward and polling unit, next of kin, consent. This
 *        wrote eight — fullName, email, phone, gender, businessName,
 *        businessType, yearsInBusiness, reasonForApplying — straight into
 *        WAVE_APPLICATIONS with status "pending".
 *
 *        So a row written here would have arrived in the admin approval queue
 *        missing every field that screen reads. It writes no `surname` and no
 *        `firstName`, which are the two the table builds its label from — the
 *        row would have shown a BLANK NAME, and #814's and #825's name search
 *        looks at exactly those fields, so nobody could have found her by
 *        typing it either. An applicant would have appeared as an unnamed
 *        pending row that no administrator could action.
 *
 *        It also took no duplicate check, so it could add a second application
 *        for a woman who already had one, and it minted its own document id
 *        (`WAVE-${Date.now()}-${random}`) rather than an auto id.
 *
 *        HOW IT SURVIVED THIS LONG is the part worth recording. The orphan
 *        scanner counted it as CALLED — by a `@deprecated` comment in
 *        lib/schemas.ts naming it as uncalled. A quote inside a regex literal
 *        had desynced the comment stripper (#827), so that prose was being read
 *        as code. The action nothing calls looked like an action something
 *        calls, because of the sentence saying nothing calls it.
 *
 *        Retired rather than wired: the multi-step form is the application, and
 *        a second writer that produces unactionable rows is not a fallback.
 */

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
        if (!isAmountAtLeast(parsedAmount, COOPERATIVE_MINIMUM_WITHDRAWAL)) {
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

        /**
         *   #488 "CORRECT PATTERN" WAS HALF THE PATTERN.
         *
         *        The comment this replaces recorded a real decision — read the
         *        ROOT collection, not the nested one — and stopped there. Most
         *        writers key the row by the user id and some do not, so a
         *        doc-id read refuses a member whose row was created by
         *        joinCooperativeAction or bound by a claim path. See
         *        lib/cooperative-member-lookup.ts.
         *
         *        This door withdraws money, and its refusal is the sentence the
         *        owner keeps being shown: "You are not a member of any
         *        cooperative", to somebody who is.
         */
        const memberRow = await findCooperativeMemberRow(
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS), session.user.id,
        );

        if (!memberRow) { throw new Error("You are not a member of any cooperative");
        }

        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(memberRow.id);
        const memberData = memberRow.data;

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
