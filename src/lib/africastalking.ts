/**
 * Africa's Talking SMS Client
 *
 * Edge-compatible lightweight wrapper for Africa's Talking Messaging API
 * utilizing standard fetch. No heavy Node-only SDK required.
 *
 * Environment variables:
 *   AT_USERNAME   — Africa's Talking username (default: "sandbox" for testing)
 *   AT_API_KEY    — Africa's Talking API key
 *   AT_SENDER_ID  — optional approved sender ID or shortcode (default: "EASYSALESNG")
 *
 * Failures are non-fatal: errors are logged but never thrown.
 */

import { logger } from "@/lib/logger";

interface ATSendResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

/**
 * Send an SMS via Africa's Talking REST API.
 *
 * @param to      Phone number in international E.164 format, e.g. "+2348012345678"
 * @param message Plain-text message body
 */
export async function sendSMS(to: string, message: string): Promise<ATSendResult> {
    const apiKey = process.env.AT_API_KEY;
    const username = process.env.AT_USERNAME || "sandbox";

    if (!apiKey) {
        logger.warn("[africastalking] AT_API_KEY not set — SMS skipped");
        return { success: false, error: "AT_API_KEY not configured" };
    }

    // Normalise number: must start with "+" and be in E.164 format
    let normalisedTo = to.trim();
    if (!normalisedTo.startsWith("+")) {
        if (normalisedTo.startsWith("0")) {
            normalisedTo = `+234${normalisedTo.slice(1)}`; // 08012345678 -> +2348012345678
        } else if (normalisedTo.startsWith("234")) {
            normalisedTo = `+${normalisedTo}`;             // 2348012345678 -> +2348012345678
        } else {
            normalisedTo = `+${normalisedTo}`;             // Fallback
        }
    }

    const isSandbox = username.toLowerCase() === "sandbox";
    const AT_BASE_URL = isSandbox
        ? "https://api.sandbox.africastalking.com/version1/messaging"
        : "https://api.africastalking.com/version1/messaging";

    const senderId = process.env.AT_SENDER_ID ?? "EASYSALESNG";

    // Build x-www-form-urlencoded request body
    const bodyParams = new URLSearchParams({
        username: username,
        to: normalisedTo,
        message: message,
    });

    // Sandbox doesn't support custom Alphanumeric Sender IDs; omit if sandbox
    if (senderId && !isSandbox) {
        bodyParams.append("from", senderId);
    }

    try {
        const response = await fetch(AT_BASE_URL, {
            method: "POST",
            headers: {
                "apiKey": apiKey,
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: bodyParams.toString(),
        });

        const data = await response.json();

        if (!response.ok) {
            logger.error("[africastalking] SMS send failed with HTTP error:", {
                status: response.status,
                data,
            });
            return { success: false, error: data.errorMessage || "SMS delivery failed" };
        }

        const recipients = data.SMSMessageData?.Recipients || [];
        if (recipients.length === 0) {
            logger.error("[africastalking] SMS send returned empty recipients data:", data);
            return { success: false, error: "Empty recipients response from gateway" };
        }

        const recipient = recipients[0];

        // Official AT statusCode reference:
        // 100 = Processed, 101 = Sent, 102 = Queued       → success
        // 409 = DoNotDisturbRejection                      → skipped (user opted out, not our error)
        // 401 = RiskHold, 403 = InvalidSenderId/Phone
        // 405 = InsufficientBalance, 500 = InternalServerError → failure
        const statusCode = Number(recipient.statusCode);
        const isSuccess = statusCode === 101 || statusCode === 102 || statusCode === 100
            || recipient.status === "Success" || recipient.status === "Sent";

        // DND (Do Not Disturb) — recipient opted out of promotional SMS in Nigeria
        // Treat as skipped, not failed — it is not an account or code error
        if (statusCode === 409 || recipient.status === "DoNotDisturbRejection") {
            logger.warn(`[africastalking] DND rejection (skipped) → ${normalisedTo}`);
            return { success: false, error: "DoNotDisturbRejection" };
        }

        if (!isSuccess) {
            const friendlyError =
                statusCode === 403 ? `InvalidSenderId or InvalidPhoneNumber: check AT_SENDER_ID is registered` :
                statusCode === 405 ? "InsufficientBalance — please top up your Africa's Talking account" :
                statusCode === 401 ? "RiskHold — contact Africa's Talking support" :
                statusCode === 500 ? "AT InternalServerError — try again later" :
                recipient.status || "SMS delivery failed";

            logger.error("[africastalking] SMS failed for recipient:", { recipient, statusCode, friendlyError });
            return { success: false, error: friendlyError };
        }

        logger.info(`[africastalking] SMS sent OK → ${normalisedTo} | messageId: ${recipient.messageId}`);
        return { success: true, messageId: recipient.messageId };
    } catch (err: unknown) {
        logger.error("[africastalking] SMS fetch error:", { error: String(err) });
        return { success: false, error: String(err) };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transactional helper methods matching standard API signatures
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
