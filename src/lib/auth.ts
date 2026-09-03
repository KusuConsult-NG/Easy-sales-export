import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";

/**
 * Custom error class for NextAuth v5.
 * NextAuth ONLY surfaces errors that extend CredentialsSignin.
 * Throwing a plain Error() always shows the generic 'Configuration' page.
 */
class AuthError extends CredentialsSignin {
    constructor(message: string) {
        super(message);
        this.code = message;
    }
}
// Using Firebase REST API for backend auth to avoid Vercel Node environment crashes
// instead of importing the browser-targeted "firebase/auth" client SDK.
import { FieldValue } from "@/lib/firestore-compat";
import { logger } from "@/lib/logger";
import { loginSchema } from "./schemas";
import { COLLECTIONS, type UserRole } from "./types/firestore";
import type { User as FirestoreUser } from "./types/firestore";
import { authConfig } from "./auth.config";
import { runQueryWithRetry } from "@/lib/firestore-utils";
import { supabase, supabaseAdmin } from "./supabase";
import { supabaseDb as db } from "./supabase-db";
import { isTransientError } from "@/lib/transient-error";

/**
 * NextAuth v5 Configuration
 * 
 * Integrates Firebase Authentication with NextAuth for session management
 * and protected route implementation.
 */

// Export real NextAuth configuration
export const { handlers, signIn, signOut, auth } = NextAuth({
    ...authConfig,
    providers: [
        Credentials({
            name: "credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            authorize: async (credentials) => {
                const authCtx = `[Auth:${Date.now()}]`; // per-request log prefix
                logger.info(`${authCtx} authorize start`);
                try {
                    // ── STEP 1: Env var guard ─────────────────────────────────
                    //
                    // THIS REFUSED EVERY LOGIN WHEN NEXT_PUBLIC_FIREBASE_API_KEY
                    // WAS ABSENT, and nothing on the primary path needs it.
                    //
                    // Authentication runs through Supabase (STEP 4). Firebase is
                    // only a FALLBACK, for legacy users whose password still
                    // lives in Firebase Auth and has not been migrated across —
                    // and that block guards itself on the same variable further
                    // down, as it must, because it is the only code that uses it.
                    //
                    // Requiring it here turned a fallback's optional credential
                    // into a hard prerequisite for the primary path. Unsetting
                    // NEXT_PUBLIC_FIREBASE_API_KEY — the obvious housekeeping
                    // when migrating off Firebase, which this codebase has
                    // otherwise done — locked every user out of the platform
                    // with "Service configuration error. Please contact
                    // support.", a message that names nothing and points
                    // nowhere. Nothing in the unit suite could see it: these
                    // tests never reach authorize(), and a missing env var is
                    // not a code change.
                    //
                    // Found by running the application against a local stack
                    // that, correctly, has no Firebase credentials at all.
                    //
                    // The guard the primary path DOES need is on Supabase, and
                    // it is below where the client is built.

                    // ── STEP 2: Validate credentials ─────────────────────────
                    const { email, password } = loginSchema.parse(credentials);

                    // ── STEP 3: Rate limit check ─────────────────────────────
                    const { consumeLoginAttempt, resetLoginAttempts } = await import("@/lib/rate-limit");
                    try {
                        const rateLimitResult = await consumeLoginAttempt(email);
                        if (!rateLimitResult.allowed) {
                            throw new Error(rateLimitResult.error || "Too many login attempts. Please try again later.");
                        }
                    } catch (err: any) {
                        // CIRCUIT BREAKER: Fail Open
                        // If Upstash Redis times out or crashes, do NOT block the login.
                        if (err.message && err.message.includes("Too many login attempts")) {
                            throw err; // Real rate limit
                        }
                        logger.error(`[Auth:Fallback] Redis consumeLoginAttempt failed, failing open. Error: ${err.message}`);
                    }

                    // ── STEP 4: Supabase Auth Verification with JIT Fallback ──
                    const { data: sbData, error: sbError } = await supabase.auth.signInWithPassword({
                        email,
                        password,
                    });

                    let uid: string;
                    if (!sbError && sbData?.user) {
                        // User exists and password is correct in Supabase Auth.
                        // Priority 1: Direct lookup by Supabase Auth user ID
                        const directDocSnap = await runQueryWithRetry(() => 
                            db.collection(COLLECTIONS.USERS).doc(sbData.user.id).get()
                        );
                        
                        if (directDocSnap.exists) {
                            const directData = directDocSnap.data()!;
                            uid = directData._migratedTo || sbData.user.id;
                            logger.info(`${authCtx} Authenticated via Supabase Auth. Direct Profile ID Match: ${uid}`);
                        } else {
                            // Priority 2: Query users collection by email to find their database profile (holding legacy ID).
                            const userSnap = await runQueryWithRetry(() => db.collection(COLLECTIONS.USERS)
                                .where('email', '==', email.toLowerCase())
                                .get());
                            if (userSnap.empty) {
                                logger.info(`${authCtx} User verified in Supabase Auth but no profile found in database. Auto-provisioning default profile...`);
                                const newUid = sbData.user.id;
                                const defaultProfile = {
                                    id: newUid,
                                    uid: newUid,
                                    email: email.toLowerCase(),
                                    fullName: email.split('@')[0],
                                    roles: ['general_user'],
                                    isVerified: true,
                                    verified: true,
                                    profileComplete: false,
                                    createdAt: FieldValue.serverTimestamp(),
                                    updatedAt: FieldValue.serverTimestamp(),
                                };
                                await db.collection(COLLECTIONS.USERS).doc(newUid).set(defaultProfile, { merge: true });
                                uid = newUid;
                            } else {
                                /**
                                 * WHICH profile belongs to the account that
                                 * just authenticated.
                                 *
                                 * Supabase has proven who the caller is. This
                                 * only decides which USERS document is theirs,
                                 * and the query it works from matches on email
                                 * alone — which is not unique here. Duplicate
                                 * and legacy rows exist; broadcast.ts dedupes
                                 * its recipient list by email for that reason.
                                 *
                                 * TWO THINGS WERE WRONG.
                                 *
                                 * `supabaseAuthId` was not consulted at all. It
                                 * is the field the JIT migration writes to link
                                 * a legacy profile to its new Supabase account
                                 * — preValidateLoginAction writes it,
                                 * password-reset resolves by it, and
                                 * payments/service.ts uses exactly this order,
                                 * `_migratedTo` then `supabaseAuthId`. The one
                                 * place that decides who you are signed in as
                                 * skipped the second half of it.
                                 *
                                 * And the last resort preferred ANY document
                                 * carrying a `_migratedTo`, whatever it pointed
                                 * at, over the first one. Since the code below
                                 * then adopts that pointer as the session id, a
                                 * caller could be signed in as an account they
                                 * had not authenticated as — chosen because
                                 * some unrelated row happened to carry a
                                 * migration marker. That branch is gone: it
                                 * preferred one arbitrary answer over another
                                 * and dressed it as a match.
                                 *
                                 * What remains is three real identity matches,
                                 * then the first row, and a loud log when it
                                 * comes to that — an arbitrary pick should be
                                 * visible rather than silent.
                                 */
                                const authedId = sbData.user.id;
                                const matchedDoc =
                                    userSnap.docs.find(doc => doc.id === authedId)
                                    ?? userSnap.docs.find(doc => doc.data()?._migratedTo === authedId)
                                    ?? userSnap.docs.find(doc => doc.data()?.supabaseAuthId === authedId)
                                    ?? userSnap.docs[0];

                                if (!userSnap.docs.some(doc =>
                                    doc.id === authedId
                                    || doc.data()?._migratedTo === authedId
                                    || doc.data()?.supabaseAuthId === authedId
                                )) {
                                    logger.error(
                                        `${authCtx} No profile identifies itself with the authenticated account. `
                                        + `Falling back to the first of ${userSnap.docs.length} row(s) matching this email.`,
                                    );
                                }
                                const matchedData = matchedDoc.data()!;
                                if (matchedData._migratedTo) {
                                    uid = matchedData._migratedTo;
                                    logger.info(`${authCtx} Authenticated via Supabase Auth. Profile ID: ${matchedDoc.id} (Migrated to: ${uid})`);
                                } else {
                                    uid = matchedDoc.id;
                                    logger.info(`${authCtx} Authenticated via Supabase Auth. Profile ID: ${uid}`);
                                }
                            }
                        }
                    } else {
                        // Fallback: Verify credentials against Firebase Auth for JIT migration
                        logger.info(`${authCtx} Supabase Login failed (${sbError?.message}). Checking Firebase Auth for JIT migration...`);

                        // The Firebase credential is read HERE, in the only block
                        // that uses it, and its absence ends this fallback rather
                        // than the whole login. A deployment with no Firebase
                        // configuration is a legitimate one — Supabase is the
                        // primary authenticator — and it must reject bad
                        // credentials, not refuse everyone.
                        //
                        // Without this check the URL below interpolated
                        // `key=undefined` and Google answered 400, which the
                        // catch turned into a generic failure that read like a
                        // wrong password.
                        const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
                        if (!firebaseApiKey || firebaseApiKey === "mock-api-key-for-build") {
                            logger.info(`${authCtx} No Firebase credential configured; no legacy fallback available.`);
                            throw new Error("Invalid email or password");
                        }

                        const responseData = await runQueryWithRetry(async () => {
                            const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
                            const signInUrl = authEmulatorHost
                                ? `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`
                                : `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`;
                            const res = await fetch(
                                signInUrl,
                                {
                                    method: "POST",
                                    headers: { 
                                        "Content-Type": "application/json",
                                        "Connection": "close"
                                    },
                                    body: JSON.stringify({
                                        email,
                                        password,
                                        returnSecureToken: true
                                    })
                                }
                            );
                            const data = await res.json();
                            if (!res.ok) {
                                const errorCode = data.error?.message || "auth/internal-error";
                                console.error(`${authCtx} STEP 4 JIT FAILED: Firebase REST API error: ${errorCode}`);
                                const error = new Error(errorCode);
                                (error as any).code = errorCode;
                                (error as any).status = res.status;
                                (error as any).data = data;
                                throw error;
                            }
                            return data;
                        });

                        const firebaseUid = responseData.localId;
                        logger.info(`${authCtx} Verified via Firebase Auth. Legacy UID: ${firebaseUid}`);

                        // Provision the user in Supabase Auth
                        logger.info(`${authCtx} Provisioning user in Supabase Auth...`);
                        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
                            email,
                            password,
                            email_confirm: true,
                        });

                        if (createError) {
                            // If they already exist in Supabase Auth but login failed, it means the password typed was incorrect
                            if (createError.message?.includes('already exists') || createError.message?.includes('email_exists')) {
                                throw new Error("auth/invalid-credential");
                            }
                            logger.error(`${authCtx} Failed to provision user in Supabase Auth:`, createError);
                            throw new Error("Service registration failed. Please try again.");
                        }

                        // Map the new Supabase Auth user ID to the legacy profile in users collection (for audit/tracking)
                        await db.collection(COLLECTIONS.USERS).doc(firebaseUid).update({
                            supabaseAuthId: newUser.user.id,
                        }).catch(err => {
                            logger.error(`[Auth] Failed to save supabaseAuthId mapping for ${email}:`, err);
                        });

                        uid = firebaseUid;
                        logger.info(`${authCtx} Successfully migrated user ${email} to Supabase Auth. Profile ID: ${uid}`);
                    }

                    // ── STEP 5: Reset rate limit on success ─────────────────
                    try {
                        await resetLoginAttempts(email);
                    } catch (err: any) {
                        logger.error(`[Auth:Fallback] Redis resetLoginAttempts failed. Error: ${err.message}`);
                    }

                    // ── STEP 6: Fetch user profile (Supabase first, fallback to Firestore) ──
                    const { getUserProfile } = await import("@/lib/user-cache");
                    const profile = await getUserProfile(uid);

                    if (!profile) {
                        console.error(`${authCtx} No user profile found in database for UID: ${uid}`);
                        throw new Error("User profile not found in database");
                    }

                    // ── STEP 7: Ban/suspend check ─────────────────────────────
                    if (profile.isBanned === true || profile.status === 'banned' || profile.suspended === true) {
                        logger.warn(`${authCtx} blocked — banned/suspended user: ${email}`);
                        throw new Error("Your account has been suspended. Please contact support.");
                    }

                    logger.info(`${authCtx} authorize success for ${email}`);
                    // Return user object for NextAuth session
                    return {
                        id: uid,
                        email: profile.email,
                        name: profile.displayName,
                        image: profile.photoURL || null,
                        roles: (profile.roles || []) as UserRole[],
                        verified: profile.verified ?? true,
                        serviceRegistrations: profile.serviceRegistrations || {},
                        gender: profile.gender as "male" | "female" | undefined,
                        createdAt: profile.createdAt,
                    };
                } catch (error: any) {
                    // ── CRITICAL: Log the REAL error BEFORE mapping it ────────
                    console.error(`${authCtx} --- AUTHORIZE CATCH BLOCK ---`);
                    // This is the single most important log for debugging production
                    // auth failures. The mapped message shown to the user is safe,
                    // but the raw code here tells you exactly what Firebase/Firestore
                    // actually threw.
                    const code: string = error?.code || "";
                    const msg: string = error?.message || "(no message)";
                    console.error(
                        `[Auth] authorize() FAILED — ` +
                        `firebase_code: "${code || '(none)'}" | ` +
                        `message: "${msg}" | ` +
                        `env_api_key_set: ${!!process.env.NEXT_PUBLIC_FIREBASE_API_KEY} | ` +
                        `env_project_id_set: ${!!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID} | ` +
                        `env_admin_key_set: ${!!process.env.FIREBASE_PRIVATE_KEY}`
                    );

                    const firebaseErrorMap: Record<string, string> = {
                        "auth/invalid-api-key": "Service configuration error. Please contact support.",
                        "auth/app-not-authorized": "Service configuration error. Please contact support.",
                        "auth/invalid-credential": "Invalid email or password.",
                        "auth/wrong-password": "Invalid email or password.",
                        "auth/user-not-found": "Invalid email or password.",
                        "INVALID_LOGIN_CREDENTIALS": "Invalid email or password.",
                        "INVALID_PASSWORD": "Invalid email or password.",
                        "EMAIL_NOT_FOUND": "Invalid email or password.",
                        "auth/user-disabled": "Your account has been disabled. Please contact support.",
                        "USER_DISABLED": "Your account has been disabled. Please contact support.",
                        "auth/too-many-requests": "Too many attempts. Please try again later.",
                        "TOO_MANY_ATTEMPTS_TRY_LATER": "Too many attempts. Please try again later.",
                        "auth/network-request-failed": "Network error — please check your connection and try again.",
                        "auth/operation-not-allowed": "Email/password login is not enabled. Please contact support.",
                        "OPERATION_NOT_ALLOWED": "Email/password login is not enabled. Please contact support.",
                    };

                    // Only fallback to error.message if it's not the exact raw ALL_CAPS string code 
                    // (prevents ugly raw strings in UI if mapping misses something)
                    const isTransient = isTransientError(msg);
                    let userMessage = firebaseErrorMap[code] || firebaseErrorMap[error?.message] || "Authentication failed.";
                    if (isTransient) {
                        userMessage = "A temporary connection issue occurred. Please try again.";
                    } else if (!firebaseErrorMap[code] && !firebaseErrorMap[error?.message] && error?.message && !/^[A-Z_]+$/.test(error?.message)) {
                        userMessage = error.message;
                    }

                    console.error("Throwing AuthError with message:", userMessage, "Original error:", error);

                    // NOTE: Must throw CredentialsSignin (not plain Error) — NextAuth v5
                    // maps any plain Error from authorize() to the generic 'Configuration' page.
                    throw new AuthError(userMessage);
                }
            },
        }),
    ],
    callbacks: {
        async jwt(params) {
            // 1. Run base Edge mapping
            let token = params.token;
            if (authConfig.callbacks?.jwt) {
                token = (await authConfig.callbacks.jwt(params)) || token;
            }

            // 2. Node-specific logic
            const { user, trigger } = params;

            // Safe helper to parse Firestore Timestamps, JSON formats, Dates, and Strings
            const parseDate = (val: any): string | undefined => {
                if (!val) return undefined;
                try {
                    if (typeof val.toDate === "function") {
                        const d = val.toDate();
                        return isNaN(d.getTime()) ? undefined : d.toISOString();
                    }
                    const secs = typeof val._seconds === "number" ? val._seconds : val.seconds;
                    const nanos = typeof val._nanoseconds === "number" ? val._nanoseconds : val.nanoseconds;
                    if (typeof secs === "number") {
                        const ms = secs * 1000 + (typeof nanos === "number" ? nanos / 1000000 : 0);
                        const d = new Date(ms);
                        return isNaN(d.getTime()) ? undefined : d.toISOString();
                    }
                    const d = new Date(val);
                    return isNaN(d.getTime()) ? undefined : d.toISOString();
                } catch {
                    return undefined;
                }
            };

            // Session Refresh / Sync Protocol - ALWAYS synchronize live roles from database/cache
            if (token.id) {
                const now = Date.now();
                const lastSynced = token.lastSyncedAt as number | undefined;
                const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes

                if (trigger === "update" || !lastSynced || (now - lastSynced) > SYNC_INTERVAL) {
                    try {
                        const { getUserProfile } = await import("@/lib/user-cache");
                        const cachedProfile = await getUserProfile(token.id as string);
                        
                        // Self-healing migration interceptor:
                        // If the loaded profile points to a migrated target, load the migrated target profile and update the session token ID!
                        /**
                         *   #343 THE SAME CAST, THE SAME DEAD BRANCH.
                         *
                         *        This read `(cachedProfile as any)._migratedTo`,
                         *        which getUserProfile never returns — it resolves
                         *        the migration ITSELF and returns the target
                         *        profile, so the field is consumed and dropped
                         *        before this line sees it. The branch could never
                         *        run, and `token.id` therefore kept the LEGACY id
                         *        while every other claim on the token came from
                         *        the migrated account.
                         *
                         *        The fact is still available, and typed: the
                         *        profile that comes back carries the id it was
                         *        actually loaded for.
                         */
                        if (cachedProfile && cachedProfile.id && cachedProfile.id !== token.id) {
                            console.log(`[NextAuth JWT] Intercepted legacy user ${token.id} migrated to ${cachedProfile.id}. Updating token ID.`);
                            token.id = cachedProfile.id;
                        }

                        if (cachedProfile) {
                            /**
                             * Sessions opened before the password was reset are
                             * no longer this account's sessions.
                             *
                             * resetPasswordAction stamps `sessionsValidFrom` on
                             * the profile. Anything minted before that point was
                             * authenticated with a credential that no longer
                             * exists — including, in the case this protects
                             * against, whoever prompted the reset.
                             *
                             * FAILS OPEN, deliberately. A token with no issue
                             * time recorded, or a profile with no revocation
                             * point, is left alone: the cost of a false positive
                             * here is signing out every user on the platform,
                             * and the cost of a false negative is one stale
                             * session that still expires within maxAge.
                             *
                             * Revocation lands within SYNC_INTERVAL rather than
                             * instantly — the same latency the ban check has,
                             * and for the same reason: this is the only place
                             * the profile is re-read.
                             */
                            // #343. `as any` was hiding that CachedUserProfile did not declare
                            // this field and getUserProfile did not carry it, so
                            // this was Number(undefined) || 0 = 0 and the
                            // predicate below could never fire. Typed now, so the
                            // compiler is the one checking.
                            const revokedBefore = Number(cachedProfile.sessionsValidFrom) || 0;
                            const issuedAtMs = typeof token.authAt === "number"
                                ? token.authAt
                                : (typeof token.iat === "number" ? token.iat * 1000 : 0);
                            token.sessionRevoked = revokedBefore > 0 && issuedAtMs > 0 && issuedAtMs < revokedBefore;

                            token.roles = cachedProfile.roles || [];
                            token.verified = cachedProfile.displayName ? (cachedProfile as any).verified ?? true : true; // default to true if legacy profile structure
                            token.onboardingCompleted = (cachedProfile as any).onboardingCompleted;
                            token.sellerVerificationStatus = (cachedProfile as any).sellerVerificationStatus;
                            token.serviceRegistrations = cachedProfile.serviceRegistrations || {};
                            token.isBanned = cachedProfile.isBanned || cachedProfile.status === "banned" || cachedProfile.suspended || false;
                            token.gender = cachedProfile.gender;
                            const cachedCreatedAt = (cachedProfile as any).createdAt;
                            if (cachedCreatedAt) {
                                token.createdAt = parseDate(cachedCreatedAt);
                            }
                            token.lastSyncedAt = now;
                        }
                    } catch (e) {
                        console.error("[NextAuth JWT] Failed to sync session from database", e);
                    }
                }
            }

            if (user) {
                // Clear any stale cached Firebase token on fresh sign-in
                token.firebaseToken = undefined;
                token.firebaseTokenMintedAt = undefined;
            }
            return token;
        },
        async session(params) {
            // 1. Run base Edge mapping
            let session = params.session;
            const { token } = params;

            if (authConfig.callbacks?.session) {
                session = (await authConfig.callbacks.session(params)) || session;
            }

            // 2. Node-specific Firebase logic
            if (session.user) {
                // Instantly block session and clear Firebase custom token if user is banned (M-10),
                // or if this session predates a password reset — see the sync
                // block above. Same mechanism, because the answer is the same:
                // this token no longer represents anyone who may act.
                if (token.isBanned || token.sessionRevoked) {
                    session.firebaseToken = undefined;
                    token.firebaseToken = undefined;
                    session.user = null as any;
                    return session;
                }

                /**
                 *   THE CACHE WAS FOR A CONSTANT, AND NOTHING READ IT.
                 *
                 *        Thirty-five lines stood here: a fifty-minute TTL, a
                 *        mint, a JWT cache, a staleness check, a re-mint and a
                 *        fallback to the stale value on failure — machinery
                 *        that reads as important, on the hot path of every
                 *        session refresh.
                 *
                 *        It computed `adminAuth.createCustomToken(...)`, and
                 *        package.json maps firebase-admin to
                 *        src/lib/shims/firebase-admin. That shim's method is:
                 *
                 *            async createCustomToken(uid, claims) {
                 *                return "mock-custom-token";
                 *            }
                 *
                 *        So every session in the platform carried the same
                 *        literal string, shaped like a credential and shipped
                 *        to the browser in the session payload.
                 *
                 *        And nothing consumed it. `firebaseToken` appears
                 *        nowhere outside this file and the test of this
                 *        machinery — not in src, not in packages, not in any
                 *        client. The other end is a stub too:
                 *        shims/firebase/auth.js exports
                 *        `signInWithCustomToken: async () => ({})`, and nothing
                 *        calls that either. Both halves of a Firebase
                 *        credential exchange, dead, in an app that
                 *        authenticates against Supabase.
                 *
                 *        WHY THE TESTS DID NOT CATCH IT: they mocked
                 *        createCustomToken to return 'minted-firebase-token'
                 *        and asserted the caching behaviour around it. Mocking
                 *        the one function whose real implementation IS the
                 *        defect is what made the machinery look alive — and it
                 *        is the reason this file's coverage counted as tested.
                 *
                 *        The revocation clearing above stays. A JWT minted
                 *        before this change still carries the field, and
                 *        stripping it from a revoked session costs nothing.
                 */
            }
            return session;
        },
    },
    pages: {
        signIn: "/auth/login",
        error: "/auth/error",
    },
    session: {
        strategy: "jwt",
        maxAge: 8 * 60 * 60, // 8 hours — financial platform security standard
        updateAge: 60 * 60, // Refresh session token every 1 hour of activity
    },
    // NextAuth v5 automatically handles secure cookies in production with '__Secure-'
    // prefix and correct SameSite settings. Custom overrides prevent session
    // persistence on Vercel deployments.
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || (process.env.NODE_ENV !== "production" ? "e2e_development_auth_secret_placeholder_must_be_changed_in_production" : undefined),
    debug: process.env.NODE_ENV === "development" || process.env.NEXTAUTH_DEBUG === "true",

    // ── THE FIX: Verbose Internal Logging ────────────────────────────────────
    // NextAuth actively swallows CSRF errors and internal router crashes for security.
    // This explicitly surfaces them in the Vercel logs so a developer can see exactly
    // why a login attempt was silently dropped.
    logger: {
        error(code, ...message) {
            console.error(`🔴 [NEXTAUTH_FRAMEWORK_ERROR] ${(code as any)?.name || code}:`, ...message);
        },
        warn(code, ...message) {
            if (code === "debug-enabled") return; // Silence the expected debug warning
            console.warn(`🟠 [NEXTAUTH_FRAMEWORK_WARN] ${(code as any)?.name || code}:`, ...message);
        },
        debug(code, ...message) {
            // Disabled trace level debug to prevent terminal spam
            // console.log(`🔵 [NEXTAUTH_FRAMEWORK_DEBUG] ${(code as any)?.name || code}:`, ...message);
        }
    }
});

/**
 * Type augmentation for NextAuth
 * Extends the default session and user types with custom fields
 */
// TypeScript module augmentation for NextAuth

declare module "next-auth" {
    interface Session {
        user: {
            id: string;
            email: string;
            name?: string | null;
            image?: string | null;
            roles: UserRole[];
            verified: boolean;
            onboardingCompleted?: boolean;
            sellerVerificationStatus?: string;
            serviceRegistrations?: Record<string, any>;
            currentModuleId?: string;
            gender?: "male" | "female";
            createdAt?: string;
            /**
             * When THIS session was authenticated, in epoch ms.
             *
             * Surfaced so changePasswordAction can revoke every OTHER session
             * without revoking the one the user is standing in — it writes this
             * value as the profile's sessionsValidFrom, and the predicate in the
             * jwt callback is strictly-before. Falls back to the JWT's own `iat`
             * for sessions minted before `authAt` existed.
             */
            authAt?: number;
        };
        firebaseToken?: string;
    }

    interface User {
        id: string;
        email: string;
        name?: string | null;
        image?: string | null;
        roles: UserRole[];
        verified: boolean;
        onboardingCompleted?: boolean;
        sellerVerificationStatus?: string;
        serviceRegistrations?: Record<string, any>;
        currentModuleId?: string;
        gender?: "male" | "female";
        createdAt?: string;
    }
}
