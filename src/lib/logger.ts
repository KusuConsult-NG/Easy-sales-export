/**
 * Centralized logging service for the application
 * Provides environment-aware logging with structured metadata
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogMetadata {
    [key: string]: any;
}

/**
 * Serialise anything a caller passes as log metadata.
 *
 * WHY THIS IS NOT JSON.stringify
 * ------------------------------
 * formatMessage did `JSON.stringify(metadata)`, and an Error's `message` and
 * `stack` are NON-ENUMERABLE own properties. So
 *
 *     logger.warn("Revalidation failed:", revalError)
 *
 * printed the sentence followed by `{}` — the reason the operation failed was
 * dropped at the moment it was recorded. logger.error() has always pulled
 * message and stack out by hand; warn/info/debug never did, and this codebase
 * has 14 such calls, several on paths that only run when something is already
 * going wrong.
 *
 * Also guards against a circular structure. Callers pass request-shaped
 * objects, and JSON.stringify throws on a cycle — a logger that can throw
 * turns a handled failure into an unhandled one, inside the catch block that
 * was supposed to contain it.
 */
function stringifyMetadata(metadata: unknown): string {
    const seen = new WeakSet<object>();

    const replacer = (_key: string, value: unknown): unknown => {
        if (value instanceof Error) {
            return {
                name: value.name,
                message: value.message,
                stack: value.stack,
                // Both are common on Firebase/Supabase/Node errors and both
                // are enumerable, but they are named here so a future change
                // to the replacer cannot quietly drop them.
                ...((value as any).code !== undefined ? { code: (value as any).code } : {}),
                ...((value as any).cause !== undefined ? { cause: String((value as any).cause) } : {}),
            };
        }
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
        }
        if (typeof value === 'bigint') return value.toString();
        if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
        return value;
    };

    try {
        return JSON.stringify(metadata, replacer) ?? String(metadata);
    } catch {
        // Never let recording a failure become a failure.
        return '[unserialisable metadata]';
    }
}

class Logger {
    private isDevelopment: boolean;

    constructor() {
        this.isDevelopment = process.env.NODE_ENV === 'development';
    }

    /**
     * Format log message with timestamp and metadata
     */
    private formatMessage(level: LogLevel, message: string, metadata?: unknown): string {
        const timestamp = new Date().toISOString();
        const metaString = metadata === undefined || metadata === null
            ? ''
            : ` ${stringifyMetadata(metadata)}`;
        return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaString}`;
    }

    /**
     * Broadcasts critical errors to a Discord or Slack Webhook
     */
    private async broadcastAlert(level: LogLevel, message: string, payload: any): Promise<void> {
        // Only run on the server environment
        if (typeof window !== 'undefined') return;

        const webhookUrl = process.env.TELEMETRY_WEBHOOK_URL;
        if (!webhookUrl) return;

        try {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `🚨 **[${process.env.NODE_ENV?.toUpperCase() || 'PRODUCTION'}] CRITICAL SYSTEM ERROR**\n**Time:** ${new Date().toISOString()}\n**Environment:** ${process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'local')}\n**Message:** ${message}\n\`\`\`json\n${stringifyMetadata(payload)}\n\`\`\``
                })
            });
        } catch (e) {
            // Failsafe: Do not let the logger crash the app
            console.error("TELEMETRY DIED:", e);
        }
    }

    /**
     * Debug level logging (development only)
     */
    debug(message: string, metadata?: LogMetadata | Error | unknown): void {
        if (this.isDevelopment) {
            console.debug(this.formatMessage('debug', message, metadata));
        }
    }

    /**
     * Info level logging
     */
    info(message: string, metadata?: LogMetadata | Error | unknown): void {
        if (this.isDevelopment) {
            console.info(this.formatMessage('info', message, metadata));
        }
        // In production, you could send to external service here
    }

    /**
     * Warning level logging
     */
    warn(message: string, metadata?: LogMetadata | Error | unknown): void {
        console.warn(this.formatMessage('warn', message, metadata));
        // In production, you could send to external service here
    }

    /**
     * Error level logging
     */
    error(message: string, error?: Error | unknown, metadata?: LogMetadata): void {
        const errorMeta = error instanceof Error
            ? { ...metadata, error: error.message, stack: error.stack }
            : { ...metadata, error };

        console.error(this.formatMessage('error', message, errorMeta));

        // Zero-Latency Telemetry Alerting
        this.broadcastAlert('error', message, errorMeta);
    }

    /**
     * Log with custom level
     */
    log(level: LogLevel, message: string, metadata?: LogMetadata | Error | unknown): void {
        switch (level) {
            case 'debug':
                this.debug(message, metadata);
                break;
            case 'info':
                this.info(message, metadata);
                break;
            case 'warn':
                this.warn(message, metadata);
                break;
            case 'error':
                this.error(message, undefined, metadata as LogMetadata);
                break;
        }
    }


}

// Export singleton instance
export const logger = new Logger();

// Export for testing or custom instances
export { Logger };
