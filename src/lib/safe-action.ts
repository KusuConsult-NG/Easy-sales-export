import { logger } from "@/lib/logger";
import {
    newRoundTripScope,
    runInRoundTripScope,
    scopeTally,
    measuredMs,
} from "@/lib/round-trip-meter";
import { logTelemetryAction } from "@/app/actions/telemetry";
import { logObservabilityTrace } from "@/lib/logger-server";
import { redactPii } from "@/lib/admin-pii";
import { z } from "zod";

/**
 * Standardized response format for all Next.js Server Actions
 * Enforces safe boundary so no unhandled exceptions leak to the client
 */
/**
 * The older, narrower result shape.
 *
 * Predates ActionResponse and is still what several admin actions return. It
 * lived at the top of admin.ts; when that file was split by domain it needed a
 * home outside src/app/actions, where every file must carry "use server" and
 * export only async functions. Here, beside the type it was the forerunner of.
 */
export type ActionState =
    | { error: string; success: false }
    | { error: null; success: true; message: string };

export type ActionResponse<T = unknown, M = any> = {
    success: true;
    error: null;
    data: T;
    lastDocId?: string | null;
    hasMore?: boolean;
    meta?: M;
} | {
    success: false;
    error: string;
    data: null;
    lastDocId?: string | null;
    hasMore?: boolean;
    meta?: M;
};

/**
 * Utility to redact sensitive fields from log payloads
 */
/**
 *   #360 SECURITY: THE REDACTION THAT RUNS ON EVERY SERVER ACTION'S ARGUMENTS
 *        MISSED TWO OF ITS OWN SEVEN FIELDS AND ALL OF THE PII.
 *
 *        captureObservabilityTrace below JSON-stringifies the ARGUMENTS of any
 *        action that throws and writes them to `error_observability_traces`.
 *        Eighty-one action files are wrapped in withSafeAction, so those
 *        arguments include a BVN, a NIN, a bank account number, an MFA token —
 *        whatever the failing call was carrying. This was the only thing
 *        standing between them and a database row:
 *
 *            const sensitiveFields = ['password', 'confirmPassword', 'pin',
 *                                     'cvv', 'token', 'secret', 'authCode'];
 *            if (sensitiveFields.includes(key.toLowerCase())) ...
 *
 *        (a) TWO OF THE SEVEN COULD NEVER MATCH. The list stores
 *            `confirmPassword` and `authCode` in camelCase and the test
 *            lower-cases the key first, so `'confirmpassword'` was compared
 *            against `'confirmPassword'` and never equalled it. Both were
 *            written out in full, every time.
 *
 *        (b) IT NAMED NO PII AT ALL. lib/admin-pii.ts has defined the platform
 *            PII set since #151 — bvn, nin, accountNumber, bankDetails,
 *            nextOfKin, documents — and the credential set since #341 —
 *            totpSecret, mfaRecoveryCodes, passwordHash. None of the fourteen
 *            appeared here. verifyBVNAction, verifyNINAction and
 *            saveKYCProfileAction are all wrapped, so a throw inside any of
 *            them wrote the raw identity number.
 *
 *        (c) AND NOTHING READS THE COLLECTION. `error_observability_traces`
 *            appears exactly once in this repository — in the write, at
 *            lib/logger-server.ts:20. No screen, no script, no migration, and
 *            no erasure path names it. So it was accumulating identity
 *            documents that nobody would ever look at, and that a
 *            right-to-erasure request would not reach.
 *
 *        That is #305's shape — a hand-written PII list beside a shared
 *        definition that already had the answer — with the added twist that
 *        this copy was WRITING rather than reading.
 *
 *        One definition now. redactPii comes from lib/admin-pii.ts, matches
 *        case-blind, and redacts rather than deletes so the trace still shows
 *        which arguments were passed.
 *
 *        OWNER DECISION: `error_observability_traces` has no reader. Build a
 *        screen for it, give it a retention sweep, or stop writing it.
 */
function redactSensitiveData(data: any): any {
    return redactPii(data);
}

/**
 * Capture structured observability trace and write to telemetry database
 */
async function captureObservabilityTrace(actionName: string, error: any, args: any[]): Promise<void> {
    try {
        const errorMessage = error instanceof Error ? error.message : String(error);
        let userState = "anonymous";
        let sessionContext: any = null;

        try {
            const { requireSession } = await import("@/lib/session-guard");
            const sessionRes = await requireSession();
            if (sessionRes && sessionRes.session?.user) {
                userState = JSON.stringify({
                    id: sessionRes.session.user.id,
                    roles: sessionRes.session.user.roles || [],
                });
                sessionContext = {
                    userEmail: sessionRes.session.user.email,
                    userName: sessionRes.session.user.name,
                };
            }
        } catch (sessionErr) {
            console.error("[captureObservabilityTrace] Failed to get session:", sessionErr);
        }

        await logObservabilityTrace({
            rootCause: errorMessage,
            affectedModule: actionName,
            userState,
            queryOrAction: JSON.stringify(redactSensitiveData(args)),
            stackTrace: error instanceof Error ? error.stack || "" : "No stack trace",
            sessionContext
        });
    } catch (e) {
        console.error("[captureObservabilityTrace] Failed to log telemetry trace:", e);
    }
}

/**
 * How long a server action may take before it is named in the log.
 *
 *   THE OWNER, THREE TIMES: "the entire app is still very slow".
 *
 *   Answered three times with inference, because nothing on this platform
 *   measures a server action. The admin side was repaired from a measurement —
 *   EXPLAIN ANALYZE on the registration rollup, 1,037,000 buffers down to
 *   1,262 — and the user side has only ever been repaired from READING CODE,
 *   which is how "I fixed the slowness" and "it is still slow" have both been
 *   true at once.
 *
 *   Every server action on this platform already funnels through the two
 *   wrappers below. One `Date.now()` on each side of the call they already
 *   make turns "the app is slow" into a list of names and milliseconds, in
 *   production, in logs the owner already reads — and costs a subtraction per
 *   action to do it.
 *
 *   A THRESHOLD, NOT A LINE PER CALL. This platform runs thousands of actions
 *   a minute; logging every one would bury the answer in the evidence. Only
 *   the ones that are actually slow are named, so the log stays a shortlist of
 *   what to fix rather than a trace to be sifted.
 *
 *   TUNABLE WITHOUT A DEPLOY, because the right threshold is not knowable from
 *   here: SLOW_ACTION_MS on the service lowers it to catch more, or raises it
 *   once the worst offenders are gone. `0` turns the reporting off entirely
 *   for an operator who wants silence. Read per call, not frozen at import, so
 *   changing it on the service takes effect on restart without a rebuild.
 *
 *   300ms BY DEFAULT, at the owner's instruction. 1000 was the first guess and
 *   it was too coarse to be useful: a page that makes four actions of 400ms
 *   each feels slow and reports nothing at all. The point of this is to find
 *   what to fix, so it is set where it will actually name things.
 *
 *   ── A BLANK VALUE IS NOT A ZERO, AND THAT DISTINCTION IS THE BUG ──────────
 *
 *   `Number("")` is 0, and 0 means OFF. So a variable that exists on the
 *   service WITH AN EMPTY VALUE would have switched this off silently while
 *   looking configured — and it is set by typing into a hosting dashboard,
 *   where an unresolved reference like ${{Svc.VAR}} leaves exactly that.
 *
 *   This platform has been bitten by that precise shape before: #716 is the
 *   owner answering "[Redis] UPSTASH_REDIS_REST_URL IS NOT SET" with "this IS
 *   set", both of them right, because the row existed and its value was blank.
 *   lib/redis.ts now distinguishes missing from empty for that reason, and a
 *   diagnostic that quietly reports nothing is worse than a cache that quietly
 *   does nothing: the whole purpose of this one is to be believed when it
 *   stays silent.
 *
 *   So a blank or unparseable value falls back to the default, and only a real
 *   number set on purpose can turn the reporting off.
 */
const SLOW_ACTION_DEFAULT_MS = 300;

const slowActionThresholdMs = (): number => {
    const configured = process.env.SLOW_ACTION_MS?.trim();
    if (!configured) return SLOW_ACTION_DEFAULT_MS;

    const raw = Number(configured);
    //   Negative is not a threshold anybody means; it reads as "off" the same
    //   way 0 does rather than as "report everything".
    return Number.isFinite(raw) ? raw : SLOW_ACTION_DEFAULT_MS;
};

/**
 * Run `fn`, and name it in the log if it was slow.
 *
 *   `finally`, so an action that FAILS slowly is reported too. A failure that
 *   takes nine seconds is the more interesting one — it is usually a timeout,
 *   and a timeout is the thing a user actually sits through.
 *
 *   THE TIMING MUST NEVER CHANGE THE OUTCOME. It returns the value untouched,
 *   rethrows untouched, and its own logging is wrapped so a broken logger
 *   cannot turn a working action into a failed one. Instrumentation that can
 *   break the thing it measures is worse than none.
 */
async function reportingHowLongItTook<T>(actionName: string, fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    /*
     *   WHAT THE ELAPSED NUMBER NEVER SAID.
     *
     *   This line has reported "took 1840ms" since #261 and could not say why.
     *   The owner, after seven merged read-count fixes: "i noticed the app is
     *   still slow. did you fix get to production or you dont know how to fix
     *   it?" — and the honest answer was that this audit counted READS and
     *   never measured TIME, so the one question that decides what to do next
     *   could only be inferred:
     *
     *       IS IT SLOW BECAUSE IT ASKS TOO MANY TIMES,
     *       OR BECAUSE EACH ASK COSTS TOO MUCH?
     *
     *   EACH ACTION GETS ITS OWN SCOPE. The first version kept one
     *   REQUEST-scoped tally and subtracted around the call, so two actions
     *   running at once each measured the other's reads — and the log said
     *   3,806ms of database inside 3,235ms of wall clock. AsyncLocalStorage
     *   follows the async call tree, so nothing is subtracted and nothing
     *   interleaves. See lib/round-trip-meter for both defects and what one
     *   entry of each kind means.
     */
    const scope = newRoundTripScope();
    try {
        return await runInRoundTripScope(scope, fn);
    } finally {
        try {
            const elapsedMs = Date.now() - startedAt;
            const threshold = slowActionThresholdMs();
            if (threshold > 0 && elapsedMs >= threshold) {
                const t = scopeTally(scope);
                const { db, cache, http } = t.byKind;
                /*
                 *   `unmeasuredMs`, NOT `appMs`, and the rename is the point.
                 *
                 *   The first version called this "elsewhere", which reads as
                 *   this container doing work. It was usually a network nobody
                 *   had instrumented — and the line that gave the game away
                 *   was an action reporting 1,848ms with ZERO reads, all of it
                 *   an Upstash round trip inside requireSession.
                 *
                 *   Redis and the outbound calls a page waits on are counted
                 *   now. What is left is genuinely not measured, and saying so
                 *   is the difference between a number and a guess.
                 */
                const unmeasuredMs = Math.max(0, elapsedMs - measuredMs(t));
                const parts = [`${db.calls} reads ${db.ms}ms (slowest ${db.slowestMs}ms)`];
                if (cache.calls > 0) parts.push(`${cache.calls} cache ${cache.ms}ms`);
                if (http.calls > 0) parts.push(`${http.calls} http ${http.ms}ms`);
                parts.push(`${unmeasuredMs}ms unmeasured`);
                logger.warn(
                    `[slow-action] ${actionName} took ${elapsedMs}ms — ${parts.join(", ")}`,
                    {
                        actionName,
                        elapsedMs,
                        reads: db.calls,
                        dbMs: db.ms,
                        slowestReadMs: db.slowestMs,
                        cacheCalls: cache.calls,
                        cacheMs: cache.ms,
                        httpCalls: http.calls,
                        httpMs: http.ms,
                        unmeasuredMs,
                    },
                );
            }
        } catch {
            // An unreportable measurement is not a reason to fail the action.
        }
    }
}

/**
 * A higher-order function that wraps Server Actions to catch any unhandled exceptions
 * and return them safely as structured { success: false, error: string } objects.
 * Prevents Node.js runtime crashes and 500 Server Errors in Next.js 16.
 */
export function withSafeAction<TArgs extends any[], TReturn>(
    actionName: string,
    actionFn: (...args: TArgs) => Promise<ActionResponse<TReturn>>
): (...args: TArgs) => Promise<ActionResponse<TReturn>> {
    return async (...args: TArgs): Promise<ActionResponse<TReturn>> => {
        try {
            return await reportingHowLongItTook(actionName, () => actionFn(...args));
        } catch (error: any) {
            // CRITICAL: Re-throw Next.js internal errors (redirects/not-found)
            if (error && typeof error === 'object' && 'digest' in error) {
                const digest = (error as any).digest;
                if (typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND')) {
                    throw error; // Let Next.js handle navigation natively
                }
            }

            // Beautifully handle Zod validation errors without leaking stack traces or JSON
            if (error instanceof z.ZodError) {
                const firstIssue = error.issues[0];
                const errorMessage = firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : "Invalid input data";
                return { success: false, error: errorMessage, data: null as any };
            }

            // Log full stack trace and redacted input securely via our new Telemetry
            const errorMessage = error instanceof Error ? error.message : "An unexpected server error occurred";
            logTelemetryAction('error', `[Unhandled Exception in Action: ${actionName}] ${errorMessage}`, { 
                stack: error?.stack,
                input: redactSensitiveData(args)
            });

            // Asynchronously capture the detailed observability trace to Firestore
            captureObservabilityTrace(actionName, error, args).catch(err => {
                console.error("[withSafeAction] Failed to capture trace:", err);
            });

            // Return safe string to client boundaries
            const isTransient = errorMessage.includes("Premature close") || 
                                errorMessage.includes("socket hang up") || 
                                errorMessage.includes("ECONNRESET") ||
                                errorMessage.includes("Client network socket disconnected") ||
                                errorMessage.includes("FetchError") ||
                                errorMessage.includes("fetch failed") ||
                                errorMessage.includes("Connection closed") ||
                                errorMessage.includes("Socket closed") ||
                                errorMessage.includes("UNAVAILABLE") ||
                                errorMessage.includes("stream terminated") ||
                                errorMessage.includes("ERR_STREAM_PREMATURE_CLOSE");
            const sanitizedMessage = isTransient 
                ? "A temporary connection issue occurred. Please try again." 
                : errorMessage;

            return {
                success: false,
                error: sanitizedMessage,
                data: null as any,
                meta: null
            };
        }
    };
}

/**
 * A flexible higher-order function that wraps Server Actions to catch any unhandled exceptions
 * while preserving the original return type of the function.
 */
export function withFlexibleSafeAction<TArgs extends any[], TReturn>(
    actionName: string,
    actionFn: (...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn | { success: false; error: string; data: null; meta?: any }> {
    return async (...args: TArgs): Promise<TReturn | { success: false; error: string; data: null; meta?: any }> => {
        try {
            return await reportingHowLongItTook(actionName, () => actionFn(...args));
        } catch (error: any) {
            // CRITICAL: Re-throw Next.js internal errors (redirects/not-found)
            if (error && typeof error === 'object' && 'digest' in error) {
                const digest = (error as any).digest;
                if (typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND')) {
                    throw error; // Let Next.js handle navigation natively
                }
            }

            // Beautifully handle Zod validation errors without leaking stack traces or JSON
            if (error instanceof z.ZodError) {
                const firstIssue = error.issues[0];
                const errorMessage = firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : "Invalid input data";
                return { success: false, error: errorMessage, data: null as any };
            }

            // Log full stack trace and redacted input securely via our new Telemetry
            const errorMessage = error instanceof Error ? error.message : "An unexpected server error occurred";
            logTelemetryAction('error', `[Unhandled Exception in Action: ${actionName}] ${errorMessage}`, { 
                stack: error?.stack,
                input: redactSensitiveData(args)
            });

            // Asynchronously capture the detailed observability trace to Firestore
            captureObservabilityTrace(actionName, error, args).catch(err => {
                console.error("[withFlexibleSafeAction] Failed to capture trace:", err);
            });

            // Return safe string to client boundaries
            const isTransient = errorMessage.includes("Premature close") || 
                                errorMessage.includes("socket hang up") || 
                                errorMessage.includes("ECONNRESET") ||
                                errorMessage.includes("Client network socket disconnected") ||
                                errorMessage.includes("FetchError") ||
                                errorMessage.includes("fetch failed") ||
                                errorMessage.includes("Connection closed") ||
                                errorMessage.includes("Socket closed") ||
                                errorMessage.includes("UNAVAILABLE") ||
                                errorMessage.includes("stream terminated") ||
                                errorMessage.includes("ERR_STREAM_PREMATURE_CLOSE");
            const sanitizedMessage = isTransient 
                ? "A temporary connection issue occurred. Please try again." 
                : errorMessage;

            return {
                success: false,
                error: sanitizedMessage,
                data: null as any,
                meta: null
            };
        }
    };
}
