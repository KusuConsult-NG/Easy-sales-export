"use server";

import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { withSafeAction, ActionResponse } from "@/lib/safe-action";
import { resolveBankAccount } from "@/lib/bank-account-resolve";
import {
    bankAccountResolutionStamp,
    isResolvedBankAccount,
} from "@/lib/bank-account-provenance";

/**
 * Confirming your own payout account — #208.
 *
 * THIS EXISTS BECAUSE THE REFUSAL NEEDED SOMEWHERE TO POINT. paystackPayout now
 * holds a payout to an account this codebase never resolved, and tells the
 * admin to ask the member to re-verify. Before this action there was no way for
 * a member to do that: the only bank-verification controls in the app were
 * inside the two onboarding wizards, which somebody already onboarded cannot
 * re-enter. A refusal naming a step the product does not have is #362's shape —
 * a screen announcing what the code cannot deliver — and it would have turned
 * every held payout into a support ticket.
 *
 * THE ACCOUNT IS RESOLVED SERVER SIDE AND THE BANK'S NAME IS WHAT IS STORED.
 * The caller sends a number and a bank code; they do not send a holder name,
 * because a caller-supplied holder name is exactly the defect #284 closed.
 *
 * IT WRITES BOTH SHAPES THE PAYOUT PATHS READ. The user row carries the account
 * in two forms — top-level `bankAccountNumber`/`bankCode`/`bankAccountName`, and
 * a nested `bankDetails` block — and different payout paths read different ones
 * (_withdrawals and _loans the first, _wv_admin_withdrawals the second through
 * extractCanonicalUser). Stamping one and not the other would leave a member
 * confirmed for some of their money and not the rest.
 *
 * NOTHING IS DELETED. The previous account details are overwritten only by the
 * member's own re-verification of their own row, which is the operation they
 * asked for; no other record is touched.
 */

export interface BankAccountStatus {
    /** Has this codebase confirmed the account against the bank? */
    resolved: boolean;
    /** The holder name on file, as far as it is known. Empty when there is none. */
    accountName: string;
    /** Last four digits only — the full number is not needed to recognise it. */
    accountNumberTail: string;
    bankName: string;
}

/**
 * What the caller's payout account looks like right now.
 *
 * The account NUMBER is not returned in full. The screen's job is to let
 * somebody recognise which account is on file and re-confirm it, and the last
 * four digits do that — sending the whole number back to the browser would put
 * it in a place it does not need to be (#152's reasoning, applied to the
 * member's own record rather than an admin list).
 */
async function _getBankAccountStatusAction(): Promise<ActionResponse<BankAccountStatus>> {
    try {
        const { session } = await requireSession();
        if (!session) return { success: false as const, error: "Unauthorized", data: null };

        const snap = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const data = (snap.data() ?? {}) as Record<string, any>;
        const nested = (data.bankDetails ?? {}) as Record<string, unknown>;

        const number = String(data.bankAccountNumber ?? nested.accountNumber ?? "");

        return {
            error: null,
            success: true as const,
            data: {
                // Either shape counts as confirmed: a member re-verifying stamps
                // both, but a record written by one of the onboarding flows
                // carries the stamp only where that flow put it.
                resolved: isResolvedBankAccount(data) || isResolvedBankAccount(nested),
                accountName: String(data.bankAccountName ?? nested.accountName ?? ""),
                accountNumberTail: number.length > 4 ? number.slice(-4) : number,
                bankName: String(data.bankName ?? nested.bankName ?? ""),
            },
        };
    } catch (error: any) {
        logger.error("[bank-account] status read failed", error);
        // A failed read is a failure, not "not confirmed". #313's lesson: a
        // control that answers with a state it could not check is
        // indistinguishable from one that checked.
        return { success: false as const, error: "Could not read your bank account", data: null };
    }
}

export const getBankAccountStatusAction = withSafeAction(
    "getBankAccountStatusAction",
    _getBankAccountStatusAction,
);

/**
 * Re-confirm the caller's own payout account against the bank.
 *
 * Scoped to the session user and takes no userId — there is no argument through
 * which somebody else's row could arrive, rather than a check that a second
 * door could forget.
 */
async function _reverifyBankAccountAction(
    accountNumber: string,
    bankCode: string,
    bankName: string,
): Promise<ActionResponse<{ accountName: string }>> {
    try {
        const { session } = await requireSession();
        if (!session) return { success: false as const, error: "Unauthorized", data: null };

        const resolution = await resolveBankAccount(accountNumber, bankCode);
        if (!resolution.ok) {
            // Refused, not recorded. An account that cannot be resolved is not
            // a verified one — the same rule the onboarding actions apply.
            return {
                success: false as const,
                error: resolution.reason
                    || "We could not confirm that account. Check the number and bank and try again.",
                data: null,
            };
        }

        const accountName = resolution.accountName ?? "";
        const stamp = bankAccountResolutionStamp();
        const number = String(accountNumber).trim();
        const code = String(bankCode).trim();
        const bank = String(bankName ?? "").trim();

        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            bankAccountNumber: number,
            bankCode: code,
            bankAccountName: accountName,
            bankName: bank,
            ...stamp,
            bankDetails: {
                accountNumber: number,
                bankCode: code,
                accountName,
                bankName: bank,
                verified: true,
                ...stamp,
            },
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { error: null, success: true as const, data: { accountName } };
    } catch (error: any) {
        logger.error("[bank-account] re-verification failed", error);
        return { success: false as const, error: "Could not save your bank account", data: null };
    }
}

export const reverifyBankAccountAction = withSafeAction(
    "reverifyBankAccountAction",
    _reverifyBankAccountAction,
);
