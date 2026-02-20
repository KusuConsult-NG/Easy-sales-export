import { logger } from "@/lib/logger";

/**
 * Standardized response format for all Next.js Server Actions
 * Enforces safe boundary so no unhandled exceptions leak to the client
 */
export type ActionResponse<T = any> = {
    success: true;
    data?: T;
} | {
    success: false;
    error: string;
};

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
        } catch (error) {
            // Log full stack trace securely on the server
            logger.error(`[Unhandled Exception in Action: ${actionName}]`, error);

            // Return safe string to client boundaries
            const errorMessage = error instanceof Error ? error.message : "An unexpected server error occurred";
            return {
                success: false,
                error: errorMessage,
            };
        }
    };
}
