import { logger } from "@/lib/logger";
import { paystackBaseUrl } from "@/lib/paystack-host";

/**
 * Resolving a Nigerian bank account to its holder's name.
 *
 * WHY THIS IS A MODULE AND NOT A ROUTE HANDLER
 * --------------------------------------------
 * #284 made both onboarding components stop simulating verification and call
 * /api/kyc/verify-bank-account for real. #346 found that this was still only a
 * BROWSER control: the marketplace and export onboarding actions take the bank
 * account off the submitted form —
 *
 *     const bankAccount = JSON.parse(formData.get("bankAccount"))
 *     if (isSeller && (!bankAccount?.bankName || !bankAccount?.accountNumber
 *                      || !bankAccount?.accountName)) { refuse }
 *
 * — and record it. The only requirement was that three strings be non-empty.
 * So the account name on a marketplace SELLER's payout record — the name an
 * admin approves against and the escrow transfers to — was whatever the
 * request said it was, whatever the component did.
 *
 * Extracting the resolution puts it where a server action can reach it, so the
 * check happens at the point the record is written rather than only on the
 * screen before it. The route now delegates here too, so there is one
 * implementation rather than the two that #339 and #345 both turned out to be.
 *
 * FAILING CLOSED IS THE POINT
 * ---------------------------
 * Every non-success is a refusal, including "the key is missing" and "Paystack
 * did not answer". An unresolvable account is not a verified one, and the
 * alternative — recording it anyway — is the defect this closes. Callers get a
 * `reason` they can show, and `status` so an HTTP caller can pass it through.
 */

/**
 * Why a resolution failed, in a form a caller can branch on.
 *
 *   #646 `reason` is prose for the account holder and changes when somebody
 *   improves the wording; Paystack's own message is prose from a third party
 *   and changes when THEY do. A caller that wants to say something friendlier
 *   than either had to match on those strings, which is a branch that breaks
 *   silently and in production.
 */
export type BankResolutionCode =
    | "missing_fields"
    | "bad_account_number"
    | "bad_bank_code"
    | "not_configured"
    | "unreachable"
    | "provider_error"
    | "unresolvable";

export interface BankAccountResolution {
    ok: boolean;
    /** Present only when !ok. Branch on this, never on `reason`. */
    code?: BankResolutionCode;
    /** The holder's name as the bank gives it. Present only when ok. */
    accountName?: string;
    accountNumber?: string;
    bankId?: number | null;
    /** Message safe to show the account holder. Present only when !ok. */
    reason?: string;
    /** HTTP status an API caller should mirror. */
    status?: number;
}

/** Accounts are exactly ten digits; anything else is not worth a request. */
export function isPlausibleAccountNumber(value: unknown): boolean {
    return typeof value === "string" && /^\d{10}$/.test(value);
}

/**
 * Paystack bank codes are three to six digits — #646.
 *
 * The same reasoning as the account number above, and it was applied at one of
 * the two doors: actions/paystack.ts refused a malformed code before spending a
 * request, and the route sent it to Paystack to be refused there. Both doors ask
 * this now.
 */
export function isPlausibleBankCode(value: unknown): boolean {
    return typeof value === "string" && /^\d{3,6}$/.test(value);
}

export async function resolveBankAccount(
    accountNumber: unknown,
    bankCode: unknown,
): Promise<BankAccountResolution> {
    if (!accountNumber || !bankCode) {
        return { ok: false, code: "missing_fields", reason: "accountNumber and bankCode are required", status: 400 };
    }

    if (!isPlausibleAccountNumber(accountNumber)) {
        return { ok: false, code: "bad_account_number", reason: "Account number must be exactly 10 digits", status: 400 };
    }

    if (!isPlausibleBankCode(bankCode)) {
        return {
            ok: false,
            code: "bad_bank_code",
            reason: "Invalid bank code. Please select a valid bank from the dropdown.",
            status: 400,
        };
    }

    const paystackKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackKey) {
        logger.error("CRITICAL: PAYSTACK_SECRET_KEY not found. Failing bank account verification securely.");
        return { ok: false, code: "not_configured", reason: "Verification service currently unavailable.", status: 503 };
    }

    const url = `${paystackBaseUrl()}/bank/resolve`
        + `?account_number=${encodeURIComponent(String(accountNumber))}`
        + `&bank_code=${encodeURIComponent(String(bankCode))}`;

    try {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${paystackKey}` } });
        const data = await response.json().catch(() => ({} as any));

        if (!response.ok) {
            const reason = data?.message || "Bank account verification failed";
            logger.error("Paystack bank resolve error", { status: response.status, message: reason });
            return { ok: false, code: "provider_error", reason, status: response.status };
        }

        if (!data?.status || !data?.data?.account_name) {
            return { ok: false, code: "unresolvable", reason: "Could not resolve account details", status: 422 };
        }

        return {
            ok: true,
            accountName: data.data.account_name,
            accountNumber: data.data.account_number,
            bankId: data.data.bank_id ?? null,
        };
    } catch (error) {
        // A network fault is not a pass. Same rule as the missing key above.
        logger.error("Bank resolve request failed", error);
        return { ok: false, code: "unreachable", reason: "Verification is unavailable right now. Please try again.", status: 503 };
    }
}
