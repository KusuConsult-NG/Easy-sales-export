import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { phoneLookupVariants } from "@/lib/phone";
import { MANUFACTURED_PROFILE_MARKER } from "@/lib/profile-provenance";
// The flag, the refusal and the seedable-role list live in lib, NOT here: a
// route.ts may export only its handlers and Next's config keys. See #431's note
// in lib/retired-endpoints.
import {
    legacyDevUserSeedingEnabled,
    DEV_USER_SEEDING_RETIRED_MESSAGE,
    SEEDABLE_ROLES,
} from "@/lib/retired-endpoints";

/**
 * POST /api/auth/register — RETIRED. A dev seeder that minted any role you named.
 *
 *   #513. NOTHING CALLS IT. Not a page, not a script, not a test, not the e2e
 *   suite. The only references anywhere are three audit notes observing that it
 *   "returns 404 in production". registerAction in actions/auth.ts is the
 *   sign-up path and always has been.
 *
 * ── IT IS NOT AN OPEN DOOR, AND SAYING SO FIRST MATTERS ─────────────────────
 *
 *   The production block holds. I checked it rather than assuming it, because
 *   the container does NOT run `next start` — the Dockerfile ends
 *
 *       CMD ["node", "server.js"]
 *
 *   so the `next` CLI, which is what sets NODE_ENV when it is unset, never runs.
 *   The Dockerfile sets no NODE_ENV either. What saves it is line 5 of Next's
 *   generated standalone server:
 *
 *       process.env.NODE_ENV = 'production'
 *
 *   unconditionally, before any handler. So on Railway this route answers 404,
 *   and no live account was ever created through it.
 *
 * ── BUT NODE_ENV IS THE WRONG QUESTION ──────────────────────────────────────
 *
 *   NODE_ENV describes THE PROCESS. It says nothing about WHICH DATABASE the
 *   process is pointed at, and those are different facts. `npm run dev` with
 *   production Supabase credentials in .env.local is NODE_ENV=development
 *   against the live users table — and that is not a hypothetical configuration
 *   for this project, it is how its operational work has been done.
 *
 *   In that configuration this endpoint accepted, unauthenticated:
 *
 *       { "email": "...", "password": "x", "firstName": "A", "lastName": "B",
 *         "phone": "0800...", "role": "super_admin" }
 *
 *   and wrote `roles: ["super_admin"]` into the production users collection,
 *   with a real Supabase auth account behind it. `role` came straight off the
 *   request body into the document. There are three super_admins.
 *
 * ── WHAT ELSE IT SKIPPED THAT THE REAL PATH DOES ────────────────────────────
 *
 *   Line by line against registerAction, which is the point of comparison
 *   because it proves each of these is this platform's own standard, not mine:
 *
 *     rate limit          registerAction throttles per IP.        THIS: none.
 *     password policy     passwordPolicySchema, shared with
 *                         changePasswordAction since #330.        THIS: none —
 *                         "x" was a password.
 *     phone dedup         phoneLookupVariants, because members
 *                         arrived by six writers using different
 *                         spellings.                              THIS: exact
 *                         string only, so it missed the case the helper exists
 *                         for.
 *     email dedup         resolved by password proof.             THIS: a scan
 *                         capped at 200,000 accounts that returns null past the
 *                         cap — correct today at 41k, and silent when it is not.
 *     roles               hardcoded ["general_user"].             THIS: yours.
 *     isVerified          not set.                                THIS: true,
 *                         plus verified: true and profileComplete: true — #495's
 *                         class exactly, a profile calling itself verified with
 *                         nobody having verified it.
 *
 * ── RETIRED, NOT DELETED, AND HARDENED ANYWAY ───────────────────────────────
 *
 *   The owner's standing rule, and the treatment #379, #386, #431 and #485
 *   established: the implementation is kept and refuses by default. Set
 *   LEGACY_DEV_USER_SEEDING=enabled to revive it.
 *
 *   A retired endpoint one flag from being live must not be revived in the state
 *   it was found in, so the flag is not the only change:
 *
 *     - `role` is checked against SEEDABLE_ROLES. A caller can no longer name
 *       its own privileges even with the flag on.
 *     - `isVerified`/`verified` are gone and `_system_skeleton_backfill` marks
 *       the row, so #495's provenance rule reports these as unevidenced rather
 *       than letting a seeded account claim a verification nobody performed.
 *     - the phone check uses phoneLookupVariants, like the real path.
 *     - the swallowed catch logs. #308's class.
 *
 *   THE PRODUCTION BLOCK STAYS TOO, and keeps all three of its conditions. It
 *   was never the problem; it was carrying a weight it was not shaped for.
 */
export async function POST(req: Request) {
    // Both gates, and the environment one first: the refusal must not become a
    // way to learn which flags a deployment has set.
    if (
        process.env.NODE_ENV === "production" ||
        process.env.VERCEL_ENV === "production" ||
        process.env.RAILWAY_ENVIRONMENT === "production"
    ) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!legacyDevUserSeedingEnabled()) {
        return NextResponse.json({ error: DEV_USER_SEEDING_RETIRED_MESSAGE }, { status: 410 });
    }

    try {
        const body = await req.json();
        const { email, password, firstName, lastName, phone, role } = body;

        if (!email || !password || !firstName || !lastName || !phone) {
            return NextResponse.json(
                { error: "Missing required fields (email, password, firstName, lastName, phone)" },
                { status: 400 }
            );
        }

        // A caller does not name its own privileges.
        const requestedRole = role ?? "general_user";
        if (!(SEEDABLE_ROLES as readonly string[]).includes(requestedRole)) {
            logger.warn("[auth-seed] refused a role outside SEEDABLE_ROLES", { requestedRole });
            return NextResponse.json(
                { error: `Role not seedable. Allowed: ${SEEDABLE_ROLES.join(", ")}` },
                { status: 403 }
            );
        }

        // Does this email already have an auth account?
        try {
            const existingUser = await adminAuth.getUserByEmail(email);
            if (existingUser) {
                return NextResponse.json(
                    { error: "An account with this email already exists." },
                    { status: 409 }
                );
            }
        } catch (err: any) {
            if (err.code !== "auth/user-not-found") {
                logger.error("[auth-seed] duplicate-email check failed", {
                    error: err instanceof Error ? err.message : String(err),
                });
                return NextResponse.json(
                    { error: "Database error during duplicate check: " + err.message },
                    { status: 500 }
                );
            }
        }

        // EVERY spelling that might be stored, not just the one that was typed.
        // registerAction's reason applies here unchanged: six writers store the
        // phone differently, and the bulk import is where most members came
        // from.
        const phoneVariants = phoneLookupVariants(phone);
        if (phoneVariants.length > 0) {
            const phoneCheck = await db.collection(COLLECTIONS.USERS)
                .where("phone", "in", phoneVariants)
                .limit(1)
                .get();
            if (!phoneCheck.empty) {
                return NextResponse.json(
                    { error: "An account with this phone number already exists." },
                    { status: 409 }
                );
            }
        }

        const userRecord = await adminAuth.createUser({
            email,
            password,
            displayName: `${firstName} ${lastName}`.trim(),
            emailVerified: true,
        });

        const userProfile = {
            uid: userRecord.uid,
            fullName: `${firstName} ${lastName}`.trim(),
            firstName,
            lastName,
            email,
            phone,
            roles: [requestedRole],
            // NOT isVerified/verified. A seeded account has had no identity
            // check performed on it, and #495 measured what happens when rows
            // that nobody verified are written as verified: 3,605 of them.
            // The marker makes verificationState() report "unevidenced" — and
            // it is the CONSTANT, not the string, because a second copy of a
            // name is how the two drift apart.
            [MANUFACTURED_PROFILE_MARKER]: true,
            profileComplete: false,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        try {
            await db.collection(COLLECTIONS.USERS).doc(userRecord.uid).set(userProfile, { merge: true });
        } catch (firestoreError: any) {
            // Delete the auth account so a failed seed does not leave an
            // orphan — the shape orphaned-user-repair exists to clean up.
            try {
                await adminAuth.deleteUser(userRecord.uid);
            } catch (rollbackError) {
                logger.error("[auth-seed] CRITICAL: failed to roll back auth account", {
                    uid: userRecord.uid,
                    error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
                });
            }
            return NextResponse.json(
                { error: "Failed to create user profile: " + firestoreError.message },
                { status: 500 }
            );
        }

        return NextResponse.json(
            { success: true, uid: userRecord.uid },
            { status: 201 }
        );
    } catch (error: any) {
        logger.error("[auth-seed] failed", {
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
            { error: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}
