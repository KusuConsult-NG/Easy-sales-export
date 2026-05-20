/**
 * Centralized logging service for the application
 * Provides environment-aware logging with structured metadata
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogMetadata {
    [key: string]: any;
}

class Logger {
    private isDevelopment: boolean;

    constructor() {
        this.isDevelopment = process.env.NODE_ENV === 'development';
    }

    /**
     * Format log message with timestamp and metadata
     */
    private formatMessage(level: LogLevel, message: string, metadata?: LogMetadata): string {
        const timestamp = new Date().toISOString();
        const metaString = metadata ? ` ${JSON.stringify(metadata)}` : '';
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
                    content: `🚨 **[${process.env.NODE_ENV?.toUpperCase() || 'PRODUCTION'}] CRITICAL SYSTEM ERROR**\n**Time:** ${new Date().toISOString()}\n**Environment:** ${process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'local')}\n**Message:** ${message}\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
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
    debug(message: string, metadata?: LogMetadata): void {
        if (this.isDevelopment) {
            console.debug(this.formatMessage('debug', message, metadata));
        }
    }

    /**
     * Info level logging
     */
    info(message: string, metadata?: LogMetadata): void {
        if (this.isDevelopment) {
            console.info(this.formatMessage('info', message, metadata));
        }
        // In production, you could send to external service here
    }

    /**
     * Warning level logging
     */
    warn(message: string, metadata?: LogMetadata): void {
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
    log(level: LogLevel, message: string, metadata?: LogMetadata): void {
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
                this.error(message, undefined, metadata);
                break;
        }
    }
}

// Export singleton instance
export const logger = new Logger();

// Export for testing or custom instances
export { Logger };
