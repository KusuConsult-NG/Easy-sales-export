"use server";

import { logger } from "@/lib/logger";

export async function logTelemetryAction(level: 'debug' | 'info' | 'warn' | 'error', message: string, payload?: unknown) { try {
        if (level === 'error') {
            logger.error(message, undefined, payload as any);
            
            // Explicitly report to Sentry for Railway production
            try {
                const Sentry = await import("@sentry/nextjs");
                Sentry.captureException(new Error(message), {
                    extra: payload as any
                });
            } catch (sentryErr) { // Sentry might not be initialized
            }
        } else if (level === 'warn') { logger.warn(message, payload as any);
        } else if (level === 'info') { logger.info(message, payload as any);
        } else { logger.debug(message, payload as any);
        }
        return { error: null, success: true as const , data: null };
    } catch (e) { console.error("Telemetry Action failed:", e);
        return { error: "Action failed", success: false as const, data: null };
    }
}
