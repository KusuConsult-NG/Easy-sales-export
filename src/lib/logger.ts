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
        // In production, you could send to Sentry/LogRocket here
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
