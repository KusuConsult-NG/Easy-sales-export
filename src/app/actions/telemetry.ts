"use server";

import { logger } from "@/lib/logger";

export async function logTelemetryAction(level: 'debug' | 'info' | 'warn' | 'error', message: string, payload?: any) {
    try {
        if (level === 'error') {
            logger.error(message, undefined, payload);
        } else if (level === 'warn') {
            logger.warn(message, payload);
        } else if (level === 'info') {
            logger.info(message, payload);
        } else {
            logger.debug(message, payload);
        }
        return { success: true };
    } catch (e) {
        console.error("Telemetry Action failed:", e);
        return { success: false };
    }
}
