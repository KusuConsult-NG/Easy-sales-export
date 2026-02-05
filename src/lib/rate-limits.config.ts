/**
 * Rate Limit Configuration
 * 
 * Defines rate limits for different endpoints
 */

export const rateLimitConfig = {
    // Authentication endpoints - strict limits
    login: {
        interval: 15 * 60 * 1000, // 15 minutes
        maxRequests: 5, // 5 attempts per 15 minutes
    },

    // API routes - moderate limits
    api: {
        interval: 60 * 1000, // 1 minute
        maxRequests: 100, // 100 requests per minute
    },

    // Webhooks - high limits (legitimate traffic)
    webhook: {
        interval: 60 * 1000, // 1 minute
        maxRequests: 1000, // 1000 per minute
    },

    // Server actions - moderate limits
    serverAction: {
        interval: 60 * 1000, // 1 minute
        maxRequests: 50, // 50 per minute
    },

    // File uploads - strict limits
    fileUpload: {
        interval: 60 * 60 * 1000, // 1 hour
        maxRequests: 20, // 20 uploads per hour
    },
};
