// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const isProduction = process.env.NEXT_PUBLIC_APP_ENV === 'production';

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Tag every event with its environment — separates staging/production in the dashboard
    environment: process.env.NEXT_PUBLIC_APP_ENV || 'development',

    // 10% of transactions in production prevents quota exhaustion.
    // 100% in staging/dev so all flows are fully traceable during validation.
    tracesSampleRate: isProduction ? 0.1 : 1.0,

    debug: false,

    // Capture replays on 100% of errors regardless of environment
    replaysOnErrorSampleRate: 1.0,

    // 5% session sampling in production, 10% in staging/dev
    replaysSessionSampleRate: isProduction ? 0.05 : 0.1,

    // Drop noise before sending to Sentry
    beforeSend(event) {
        // Health check and cron endpoints produce noise without debugging value
        if (event.request?.url?.includes('/api/health')) return null;
        if (event.request?.url?.includes('/api/cron/')) return null;
        return event;
    },

    integrations: [
        Sentry.replayIntegration({
            // Keep text unmasked so UI bugs can be reproduced from session replays
            maskAllText: false,
            // Block media to reduce replay storage size
            blockAllMedia: true,
        }),
    ],
});

/**
 * Call after user signs in to attach identity to all Sentry events.
 * Usage: import { setSentryUser } from '@/sentry.client.config';
 *        setSentryUser({ id: session.user.id, email: session.user.email });
 *
 * Call with null on logout to clear the user context.
 */
export function setSentryUser(user: { id: string; email?: string | null } | null) {
    if (user) {
        Sentry.setUser({ id: user.id, email: user.email ?? undefined });
    } else {
        Sentry.setUser(null);
    }
}

/**
 * Tag active module and action — attach at the top of server action files.
 * Usage: setSentryContext('cooperative', 'submitOnboarding');
 *
 * This makes every error in that action searchable by module in Sentry.
 */
export function setSentryContext(module: string, action?: string) {
    Sentry.setTag('module', module);
    if (action) Sentry.setTag('action', action);
}
