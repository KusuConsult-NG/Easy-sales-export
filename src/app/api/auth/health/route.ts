export const dynamic = 'force-dynamic';

/**
 * Auth Health Diagnostic Endpoint — /api/auth/health
 *
 * Returns the presence/format of every env var that auth depends on.
 * SECURITY: Values are NEVER exposed — only boolean present/absent/format flags.
 * Admin-only: requires X-Auth-Health-Key header matching NEXTAUTH_SECRET.
 *
 * Usage:
 *   curl https://your-domain.com/api/auth/health \
 *     -H "X-Auth-Health-Key: <NEXTAUTH_SECRET value>"
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function checkPrivateKey(key: string | undefined): string {
    if (!key) return "MISSING";
    const normalized = key.replace(/\\n/g, "\n").replace(/^"|"$/g, "");
    if (!normalized.includes("BEGIN PRIVATE KEY")) return "PRESENT_BUT_NO_PEM_HEADER";
    if (!normalized.includes("END PRIVATE KEY")) return "PRESENT_BUT_NO_PEM_FOOTER";
    const lines = normalized.split("\n").filter(Boolean);
    if (lines.length < 5) return "PRESENT_BUT_TOO_SHORT";
    return "OK";
}

export async function GET(req: NextRequest) {
    // Simple guard: require the secret as a header to access this endpoint
    const authHeader = req.headers.get("X-Auth-Health-Key");
    const secret = process.env.NEXTAUTH_SECRET;

    if (!secret || authHeader !== secret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const check = {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        nextauth: {
            NEXTAUTH_SECRET: secret ? "OK" : "MISSING",
            NEXTAUTH_URL: process.env.NEXTAUTH_URL
                ? `OK (${process.env.NEXTAUTH_URL})`
                : "MISSING — OK if using VERCEL_URL auto-detection",
            AUTH_SECRET: process.env.AUTH_SECRET ? "OK" : "MISSING (alias of NEXTAUTH_SECRET)",
            NEXTAUTH_DEBUG: process.env.NEXTAUTH_DEBUG || "not set (disabled)",
        },
        firebase_client: {
            NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY
                ? (process.env.NEXT_PUBLIC_FIREBASE_API_KEY === "mock-api-key-for-build" ? "MOCK_VALUE_SET" : "OK")
                : "MISSING",
            NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
                ? (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN.includes("mock") ? "MOCK_VALUE_SET" : "OK")
                : "MISSING",
            NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
                ? (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "mock-project-id" ? "MOCK_VALUE_SET" : "OK")
                : "MISSING",
            NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ? "OK" : "MISSING",
            NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ? "OK" : "MISSING",
            NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ? "OK" : "MISSING",
        },
        firebase_admin: {
            FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ? "OK" : "MISSING",
            FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL
                ? (process.env.FIREBASE_CLIENT_EMAIL.includes("@") ? "OK" : "BAD_FORMAT")
                : "MISSING",
            FIREBASE_PRIVATE_KEY: checkPrivateKey(process.env.FIREBASE_PRIVATE_KEY),
            FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET ? "OK" : "MISSING",
        },
        redis: {
            UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL
                ? (process.env.UPSTASH_REDIS_REST_URL.startsWith("https://") ? "OK" : "BAD_FORMAT")
                : "MISSING — rate limiting disabled (fail-open)",
            UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ? "OK" : "MISSING — rate limiting disabled (fail-open)",
        },
        resend: {
            RESEND_API_KEY: process.env.RESEND_API_KEY ? "OK" : "MISSING — emails disabled",
        },
        payments: {
            // CRITICAL: 8 Paystack payment flows use this for callback_url.
            // If missing, callback URL becomes 'undefined/...' and payment redirect fails.
            NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL
                ? `OK (${process.env.NEXT_PUBLIC_APP_URL})`
                : "MISSING — ALL Paystack callback_urls will be broken",
            PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY ? "OK" : "MISSING — payment init will fail",
        },
        summary: {
            auth_will_work: !!(
                process.env.NEXTAUTH_SECRET &&
                process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
                process.env.NEXT_PUBLIC_FIREBASE_API_KEY !== "mock-api-key-for-build" &&
                process.env.FIREBASE_PROJECT_ID &&
                process.env.FIREBASE_CLIENT_EMAIL &&
                checkPrivateKey(process.env.FIREBASE_PRIVATE_KEY) === "OK"
            ),
            payments_will_work: !!(
                process.env.PAYSTACK_SECRET_KEY &&
                process.env.NEXT_PUBLIC_APP_URL
            ),
        },
    };

    return NextResponse.json(check, {
        status: 200,
        headers: {
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex",
        },
    });
}
