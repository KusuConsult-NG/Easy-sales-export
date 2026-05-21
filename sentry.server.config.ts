// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const isProduction = process.env.NEXT_PUBLIC_APP_ENV === 'production';

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Tag every server-side event with its environment
    environment: process.env.NEXT_PUBLIC_APP_ENV || 'development',

    // Match client sample rate: 10% in production, 100% in staging/dev
    tracesSampleRate: isProduction ? 0.1 : 1.0,

    debug: false,

    // Drop noise before sending to Sentry
    beforeSend(event) {
        // Health check polling and cron triggers are not actionable errors
        if (event.request?.url?.includes('/api/health')) return null;
        if (event.request?.url?.includes('/api/cron/')) return null;
        return event;
    },
});
