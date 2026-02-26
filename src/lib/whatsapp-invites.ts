/**
 * WhatsApp Group Invite — One-Time Token Utility
 *
 * Generates a single-use invite token, stores it in Firestore,
 * and sends a branded email with a clickable "Join" button.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "@/lib/logger";
import {
    sendWaveWhatsAppInviteEmail,
    sendCooperativeWhatsAppInviteEmail,
} from "@/lib/email-notifications";

export type WhatsAppGroupType = "wave_briefing" | "cooperative";

interface InviteOptions {
    email: string;
    name: string;
    userId?: string; // present for cooperative (auth user), absent for public briefing registrant
}

/**
 * Generates a one-time invite token, persists it, and sends the email.
 * Non-throwing — logs errors silently so callers are never broken.
 */
export async function generateAndSendWhatsAppInvite(
    type: WhatsAppGroupType,
    options: InviteOptions
): Promise<{ success: boolean; error?: string }> {
    try {
        const { email, name, userId } = options;
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://easysalesexport.com";

        // Generate a cryptographically random token
        const token = randomUUID();

        // Expires in 7 days
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        // Persist token to Firestore
        await db.collection("whatsapp_invites").doc(token).set({
            token,
            groupType: type,
            email,
            name,
            userId: userId || null,
            used: false,
            usedAt: null,
            createdAt: FieldValue.serverTimestamp(),
            expiresAt,
        });

        // Build the redemption URL (our API route validates and redirects)
        const inviteUrl = `${appUrl}/api/whatsapp-invite?token=${token}`;

        // Send the email
        let emailResult: { success: boolean; error?: string };
        if (type === "wave_briefing") {
            emailResult = await sendWaveWhatsAppInviteEmail(email, name, inviteUrl);
        } else {
            emailResult = await sendCooperativeWhatsAppInviteEmail(email, name, inviteUrl);
        }

        if (!emailResult.success) {
            logger.warn(`[WhatsApp Invite] Email failed for ${email}: ${emailResult.error}`);
            return { success: false, error: emailResult.error };
        }

        logger.info(`[WhatsApp Invite] Token sent for ${type} to ${email}`);
        return { success: true };
    } catch (error: any) {
        logger.error("[WhatsApp Invite] Failed to generate invite:", error);
        return { success: false, error: error.message };
    }
}
