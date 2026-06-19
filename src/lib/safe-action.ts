import { logger } from "@/lib/logger";
import { logTelemetryAction } from "@/app/actions/telemetry";
import { logObservabilityTrace } from "@/lib/logger-server";
import { z } from "zod";

/**
 * Standardized response format for all Next.js Server Actions
 * Enforces safe boundary so no unhandled exceptions leak to the client
 */
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
function redactSensitiveData(data: any): any {
    if (!data || typeof data !== 'object') return data;
    
    const sensitiveFields = ['password', 'confirmPassword', 'pin', 'cvv', 'token', 'secret', 'authCode'];
    const redacted = Array.isArray(data) ? [...data] : { ...data };
    
    for (const key in redacted) {
        if (sensitiveFields.includes(key.toLowerCase())) {
            redacted[key] = '[REDACTED]';
        } else if (typeof redacted[key] === 'object') {
            redacted[key] = redactSensitiveData(redacted[key]);
        }
    }
    return redacted;
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
                                errorMessage.includes("fetch failed");
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
                                errorMessage.includes("fetch failed");
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
