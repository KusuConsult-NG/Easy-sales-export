import { logger } from "@/lib/logger";
import { logTelemetryAction } from "@/app/actions/telemetry";
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

            // Return safe string to client boundaries
            return {
                success: false,
                error: errorMessage,
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

            // Return safe string to client boundaries
            return {
                success: false,
                error: errorMessage,
                data: null as any,
                meta: null
            };
        }
    };
}
