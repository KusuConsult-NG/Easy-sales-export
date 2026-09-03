import { logger } from "@/lib/logger";
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
            return await actionFn(...args);
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
            return await actionFn(...args);
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
