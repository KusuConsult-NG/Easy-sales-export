export const dynamic = 'force-dynamic';

/**
 * Auth Health Diagnostic Endpoint — /api/auth/health
 *
 * GET, with `X-Auth-Health-Key: <NEXTAUTH_SECRET>`.
 * Reports the presence and severity of every environment variable this
 * platform defines. VALUES ARE NEVER RETURNED — names and booleans only.
 *
 *   curl https://your-domain.com/api/auth/health -H "X-Auth-Health-Key: ..."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   #511 THE PAGE YOU OPEN WHEN AUTH IS BROKEN SAID AUTH WAS BROKEN, ALWAYS.
 *
 *   This endpoint kept its own list of what authentication needs, and that list
 *   was six FIREBASE_* variables. Firebase is not in this application: both
 *   packages resolve to local shims —
 *
 *       "firebase":       "file:./src/lib/shims/firebase"
 *       "firebase-admin": "file:./src/lib/shims/firebase-admin"
 *
 *   — and the data layer is Supabase. So on the live deployment, correctly
 *   configured, this endpoint answered:
 *
 *       FIREBASE_PROJECT_ID:   "MISSING"
 *       FIREBASE_CLIENT_EMAIL: "MISSING"
 *       FIREBASE_PRIVATE_KEY:  "MISSING"
 *       auth_will_work:        false
 *
 *   `auth_will_work` was computed from four of those absent names, so it could
 *   not return true on any real deploy of this platform. It was false while
 *   sign-in worked, and it would have stayed false while sign-in was broken —
 *   an indicator with one value is not an indicator.
 *
 *   AND IT NEVER MENTIONED SUPABASE. NEXT_PUBLIC_SUPABASE_URL,
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY — the three
 *   #450 proved fatal from a Railway log, the ones whose absence means there is
 *   no data layer to authenticate against — were not checked at all. The one
 *   screen for "why can nobody sign in" asked about a system that is gone and
 *   stayed silent about the system that is there.
 *
 *   #450 ALREADY FIXED THIS LIST TWICE. It removed the Firebase names from
 *   env-validator.ts, whose header says why: requiring them printed
 *   "❌ Environment validation failed!" on every correct deploy and buried
 *   SUPABASE_SERVICE_ROLE_KEY. It then found a SECOND copy in security-checks.ts
 *   and pointed that at env-validator rather than repairing it in place, with
 *   the note "Two lists, one dead and wrong, is the shape this audit has found
 *   some thirty times. There is one list now."
 *
 *   There were three. This was the third, and it is the one an operator reads.
 *   It is not repaired in place either: it renders env-validator's lists, so a
 *   variable added there appears here, and a fourth copy cannot be written.
 *
 * ── AND THE KEY COMPARISON IS CONSTANT TIME NOW ──────────────────────────────
 *
 *   `authHeader !== secret` compares NEXTAUTH_SECRET with `===`, which returns
 *   on the first differing byte. Said at its size: recovering a secret from
 *   that across a network, through Railway's proxy and Next's routing, is not a
 *   practical attack, and I am not claiming one. It costs four lines not to
 *   have the question.
 */

import { NextRequest, NextResponse } from "next/server";
import { envVarStatuses, dataLayerTarget } from "@/lib/env-validator";
//   #659 — this file held one of the two hand-written `secretsMatch`
//   implementations. It was the careful one, and it is the one lib/secret-compare
//   is built from; the webhook's copy short-circuited on a length mismatch.
import { secretsMatch } from "@/lib/secret-compare";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const secret = process.env.NEXTAUTH_SECRET;

    if (!secret || !secretsMatch(req.headers.get("X-Auth-Health-Key"), secret)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const statuses = envVarStatuses();
    const missing = statuses.filter((s) => !s.present);
    const fatalMissing = missing.filter((s) => s.severity === "fatal").map((s) => s.name);

    const check = {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,

        // Every variable this platform defines, at its real severity, from the
        // one list in lib/env-validator.ts. Presence only — no values.
        variables: statuses.map((s) => ({
            name: s.name,
            status: s.present ? "OK" : "MISSING",
            severity: s.severity,
            ...(s.present ? {} : { breaks: s.breaks }),
        })),

        // What the container is pointed at. A NEXT_PUBLIC_ hostname label, and
        // the display names Railway stamps on the container — never a key.
        deployment: {
            supabaseProject: dataLayerTarget(),
            railwayProject: process.env.RAILWAY_PROJECT_NAME ?? "(not reported)",
            railwayEnvironment:
                process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.RAILWAY_ENVIRONMENT ?? "(not reported)",
            railwayService: process.env.RAILWAY_SERVICE_NAME ?? "(not reported)",
        },

        summary: {
            // The four in FATAL_ENV_VARS, and nothing else. A missing
            // RESEND_API_KEY is a broken feature on a working platform; it does
            // not belong in an answer to "can anyone sign in".
            auth_will_work: fatalMissing.length === 0,
            fatal_missing: fatalMissing,

            // getBaseUrl() falls back through NEXTAUTH_URL, NEXT_PUBLIC_APP_URL
            // and finally the apex domain, so a callback URL always resolves.
            // The secret key is the only thing without which nothing can be
            // initialised or verified. The old form also demanded
            // NEXT_PUBLIC_APP_URL, which env-validator lists as RECOMMENDED —
            // a second false alarm from the same endpoint.
            payments_will_work: !!process.env.PAYSTACK_SECRET_KEY,

            missing_count: missing.length,
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
