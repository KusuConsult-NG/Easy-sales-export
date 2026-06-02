/**
 * GET /api/admin/test-sms
 *
 * Temporary debug endpoint — tests Africa's Talking SMS connection live.
 * Returns the exact AT API response so we can diagnose failures.
 *
 * ADMIN ONLY — protected by CRON_SECRET header.
 * Remove this file once SMS is confirmed working.
 *
 * Usage:
 *   curl -H "x-cron-secret: YOUR_CRON_SECRET" https://easysalesexport.com/api/admin/test-sms?phone=+2348012345678
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    // Admin guard
    const secret = req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret");
    if (secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const phone = req.nextUrl.searchParams.get("phone") || "+2348012345678";
    const apiKey = process.env.AT_API_KEY;
    const username = process.env.AT_USERNAME || "sandbox";
    const senderId = process.env.AT_SENDER_ID || "EASYSALESNG";

    // Normalise phone
    let to = phone.trim();
    if (!to.startsWith("+")) {
        if (to.startsWith("0")) to = `+234${to.slice(1)}`;
        else if (to.startsWith("234")) to = `+${to}`;
        else to = `+${to}`;
    }

    const isSandbox = username.toLowerCase() === "sandbox";
    const url = isSandbox
        ? "https://api.sandbox.africastalking.com/version1/messaging"
        : "https://api.africastalking.com/version1/messaging";

    const configSnapshot = {
        AT_USERNAME: username,
        AT_USERNAME_set: !!username,
        AT_API_KEY_set: !!apiKey,
        AT_API_KEY_prefix: apiKey ? apiKey.slice(0, 12) + "..." : "NOT SET",
        AT_SENDER_ID: senderId,
        isSandbox,
        endpoint: url,
        normalisedPhone: to,
    };

    if (!apiKey) {
        return NextResponse.json({
            success: false,
            error: "AT_API_KEY is not set in Railway environment variables",
            config: configSnapshot,
        });
    }

    const bodyParams = new URLSearchParams({ username, to, message: "EasySales SMS test - please ignore" });
    if (senderId && !isSandbox) bodyParams.append("from", senderId);

    let atResponse: unknown = null;
    let httpStatus = 0;
    let fetchError: string | null = null;

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                apiKey,
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: bodyParams.toString(),
        });
        httpStatus = res.status;
        atResponse = await res.json();
    } catch (err: unknown) {
        fetchError = String(err);
    }

    return NextResponse.json({
        config: configSnapshot,
        httpStatus,
        atResponse,
        fetchError,
    });
}
