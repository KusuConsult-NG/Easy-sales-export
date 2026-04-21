/**
 * WhatsApp Group Invite — Token Redemption API
 *
 * GET /api/whatsapp-invite?token=XXX
 *
 * Validates the one-time token, marks it as used, then redirects
 * the user to the correct WhatsApp group URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";



export async function GET(req: NextRequest) {
    const token = req.nextUrl.searchParams.get("token");

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://easysalesexport.com";
    const GROUP_URLS: Record<string, string | undefined> = {
        wave_briefing: process.env.WAVE_WHATSAPP_GROUP_URL,
        cooperative: process.env.COOPERATIVE_WHATSAPP_GROUP_URL,
    };

    // --- 1. Basic input validation ---
    if (!token || token.length < 10) {
        logger.warn("[WhatsApp Invite] Missing or invalid token in request");
        return NextResponse.redirect(`${APP_URL}/invite-error?reason=invalid`);
    }

    try {
        const inviteRef = db.collection(COLLECTIONS.WHATSAPP_INVITES).doc(token);
        const inviteSnap = await inviteRef.get();

        // --- 2. Token must exist ---
        if (!inviteSnap.exists) {
            logger.warn(`[WhatsApp Invite] Token not found: ${token}`);
            return NextResponse.redirect(`${APP_URL}/invite-error?reason=invalid`);
        }

        const invite = inviteSnap.data()!;

        // --- 3. Token must not have been used ---
        if (invite.used === true) {
            logger.warn(`[WhatsApp Invite] Token already used: ${token} by ${invite.email}`);
            return NextResponse.redirect(`${APP_URL}/invite-error?reason=used`);
        }

        // --- 4. Token must not be expired ---
        const expiresAt: Date = invite.expiresAt?.toDate?.() || new Date(invite.expiresAt);
        if (new Date() > expiresAt) {
            logger.warn(`[WhatsApp Invite] Token expired: ${token}`);
            return NextResponse.redirect(`${APP_URL}/invite-error?reason=expired`);
        }

        // --- 5. Resolve the WhatsApp group URL ---
        const groupUrl = GROUP_URLS[invite.groupType as string];
        if (!groupUrl) {
            logger.error(`[WhatsApp Invite] No group URL configured for type: ${invite.groupType}`);
            return NextResponse.redirect(`${APP_URL}/invite-error?reason=unavailable`);
        }

        // --- 6. Atomically mark as used BEFORE redirecting ---
        await inviteRef.update({
            used: true,
            usedAt: FieldValue.serverTimestamp(),
        });

        logger.info(`[WhatsApp Invite] Token redeemed for ${invite.groupType} by ${invite.email}`);

        // --- 7. Redirect to WhatsApp ---
        return NextResponse.redirect(groupUrl);

    } catch (error: any) {
        logger.error("[WhatsApp Invite] Error processing token:", error);
        return NextResponse.redirect(`${APP_URL}/invite-error?reason=error`);
    }
}
