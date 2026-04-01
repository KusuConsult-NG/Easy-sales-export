/**
 * Termii SMS Client
 *
 * Lightweight wrapper for the Termii Token/Message API.
 * Set the following environment variables:
 *   TERMII_API_KEY      — your Termii API key
 *   TERMII_SENDER_ID    — approved sender ID (max 11 chars, default: "EasySales")
 *
 * Failures are non-fatal: errors are logged but never thrown.
 */

import { logger } from "@/lib/logger";

const TERMII_BASE_URL = "https://v3.api.termii.com/api";

interface TermiiSendResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

/**
 * Send an SMS to a Nigerian (or international) phone number.
 *
 * @param to      E.164 or local format, e.g. "+2348012345678" or "08012345678"
 * @param message Plain-text message body
 */
export async function sendSMS(to: string, message: string): Promise<TermiiSendResult> {
    const apiKey = process.env.TERMII_API_KEY || "TLnDMGWzthbNQtleNuchVceOPBfsbcCDzqdgBenFwOmWBvWjYCAToHMfIOpWmX";

    if (!apiKey) {
        logger.warn("[termii] TERMII_API_KEY not set — SMS skipped");
        return { success: false, error: "TERMII_API_KEY not configured" };
    }

    // Normalise number: strip leading 0 and prepend 234 for local numbers
    const normalisedTo = to.startsWith("+")
        ? to.slice(1)          // strip leading +
        : to.startsWith("0")
            ? `234${to.slice(1)}`  // 08012345678 → 2348012345678
            : to;

    const senderId = process.env.TERMII_SENDER_ID ?? "EASYSALESNG";

    try {
        const response = await fetch(`${TERMII_BASE_URL}/sms/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                to: normalisedTo,
                from: senderId,
                sms: message,
                type: "plain",
                api_key: apiKey,
                channel: "generic",
            }),
        });

        const data = await response.json();

        if (!response.ok || data.code === "404" || data.code === "error") {
            logger.error("[termii] SMS send failed:", data);
            return { success: false, error: data.message ?? "SMS delivery failed" };
        }

        logger.info(`[termii] SMS sent OK → ${normalisedTo} | messageId: ${data.message_id}`);
        return { success: true, messageId: data.message_id };
    } catch (err: unknown) {
        logger.error("[termii] SMS fetch error:", { error: String(err) });
        return { success: false, error: String(err) };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Named helpers for platform events
// ─────────────────────────────────────────────────────────────────────────────

/** Notify a user that their escrow funds have been released. */
export async function smsEscrowReleased(phone: string, orderNumber: string, amount: number) {
    const formatted = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
    return sendSMS(phone, `EasySales: Escrow funds of ${formatted} for order #${orderNumber} have been released to your account. Log in to view your wallet.`);
}

/** Notify a user that their withdrawal request has been approved. */
export async function smsWithdrawalApproved(phone: string, amount: number) {
    const formatted = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
    return sendSMS(phone, `EasySales: Your withdrawal request of ${formatted} has been approved and is being processed. You will receive your funds within 1-2 business days.`);
}

/** Notify a user that their withdrawal request has been rejected. */
export async function smsWithdrawalRejected(phone: string, amount: number, reason?: string) {
    const formatted = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
    const reasonNote = reason ? ` Reason: ${reason}.` : "";
    return sendSMS(phone, `EasySales: Your withdrawal request of ${formatted} was declined.${reasonNote} Contact support for assistance.`);
}

/** Notify dispute parties of resolution. */
export async function smsDisputeResolved(phone: string, orderNumber: string, resolution: string) {
    const label = resolution === "refund_buyer" ? "refunded" : resolution === "release_seller" ? "released to seller" : "partially refunded";
    return sendSMS(phone, `EasySales: The dispute for order #${orderNumber} has been resolved. Funds have been ${label}. Log in for details.`);
}

/** Notify a seller that they received a Verified Badge. */
export async function smsBadgeGranted(phone: string) {
    return sendSMS(phone, "EasySales: Congratulations! Your seller account has been awarded a Verified Badge. It now appears on all your product listings.");
}
