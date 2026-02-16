# Monitoring & Observability Setup

## Overview
This guide covers the setup for **Sentry** (Error Tracking) and **LogRocket** (Session Replay) to ensure 100% observability of user issues in production.

---

## 1. Sentry (Error Tracking)

**Package**: `@sentry/nextjs`

### Installation
```bash
npx sentry-wizard@latest -i nextjs
```
*Follow the wizard to automatically create config files.*

### Manual Configuration (Reference)

If the wizard fails, create these files:

**`sentry.client.config.ts`**
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1, // Sample 10% of transactions in prod
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0, // Record 100% of sessions with errors
  integrations: [Sentry.replayIntegration()],
});
```

**`sentry.server.config.ts`**
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
```

**`sentry.edge.config.ts`**
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
```

---

## 2. LogRocket (Session Replay)

**Package**: `logrocket`

### Installation
```bash
npm install logrocket
```

### Setup (`src/app/layout.tsx`)

Add this inside a `useEffect` in your `ClientLayout` or a dedicated `MonitoringProvider`.

```typescript
import LogRocket from 'logrocket';

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  LogRocket.init('app-id/easy-sales-export');
  
  // Identify user (after login)
  // LogRocket.identify(user.id, {
  //   name: user.name,
  //   email: user.email,
  // });
}
```

---

## 3. Alerting Rules

Recommended alerts to configure in Sentry dashboard:
1. **New Issue**: Alert immediately via email/Slack.
2. **Regression**: Alert if a resolved issue reappears.
3. **High Impact**: Alert if an issue affects >1% of users.
