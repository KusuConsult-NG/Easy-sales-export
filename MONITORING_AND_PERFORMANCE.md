# Error Monitoring & Performance Testing Setup

## Error Monitoring

### Recommended: Sentry Integration

Sentry provides real-time error tracking, performance monitoring, and session replay for production applications.

#### Setup Instructions

1. **Install Sentry SDK:**
```bash
npm install --save @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```

2. **Configuration Files Created:**
- `sentry.client.config.ts` - Client-side error tracking
- `sentry.server.config.ts` - Server-side error tracking
- `sentry.edge.config.ts` - Edge runtime tracking

3. **Environment Variables:**
```bash
# Add to .env.local
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn_here
SENTRY_ORG=your_org
SENTRY_PROJECT=easy-sales-export
SENTRY_AUTH_TOKEN=your_auth_token
```

4. **Error Boundary Enhancement:**

Our existing `src/app/error.tsx` already captures errors. Integrate with Sentry:

```typescript
'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log to Sentry
        Sentry.captureException(error);
        console.error('Global error caught:', error);
    }, [error]);
    
    // ... rest of component
}
```

### Alternative: LogRocket

LogRocket provides session replay and performance monitoring.

```bash
npm install --save logrocket
npm install --save logrocket-react
```

---

## Performance Testing

### 1. Lighthouse CI

Automated performance testing on every deploy.

#### Setup `.github/workflows/lighthouse-ci.yml`:

```yaml
name: Lighthouse CI
on: [push]
jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Lighthouse CI
        uses: treosh/lighthouse-ci-action@v9
        with:
          urls: |
            https://your-staging-url.com
            https://your-staging-url.com/export/dashboard
            https://your-staging-url.com/wave/dashboard
          uploadArtifacts: true
```

#### Configuration `lighthouserc.json`:

```json
{
  "ci": {
    "collect": {
      "numberOfRuns": 3
    },
    "assert": {
      "assertions": {
        "categories:performance": ["warn", {"minScore": 0.9}],
        "categories:accessibility": ["error", {"minScore": 0.9}],
        "categories:best-practices": ["warn", {"minScore": 0.9}],
        "categories:seo": ["warn", {"minScore": 0.9}]
      }
    }
  }
}
```

### 2. Load Testing with k6

Test API endpoints under load.

#### Install k6:
```bash
brew install k6  # macOS
# or
curl https://github.com/grafana/k6/releases/download/v0.48.0/k6-v0.48.0-linux-amd64.tar.gz -L | tar xvz
```

#### Sample Test `tests/load/api-test.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.01'],   // Error rate must be below 1%
  },
};

export default function () {
  const res = http.get('https://your-api.com/api/cooperative/balance');
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  
  sleep(1);
}
```

#### Run:
```bash
k6 run tests/load/api-test.js
```

### 3. Next.js Bundle Analysis

Already configured! Use:

```bash
npm run build
# Check .next/analyze for bundle size reports
```

### 4. Web Vitals Monitoring

Add to `src/app/layout.tsx`:

```typescript
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
```

Install:
```bash
npm install @vercel/speed-insights @vercel/analytics
```

---

## Performance Checklist

### Before Deployment

- [ ] Run `npm run build` and check for warnings
- [ ] Analyze bundle size (`.next/analyze`)
- [ ] Test with Lighthouse locally
- [ ] Check for console.logs in production bundle
- [ ] Verify images are optimized (use Next.js Image component)
- [ ] Test on slow 3G network (Chrome DevTools)

### After Deployment

- [ ] Monitor Core Web Vitals in production
- [ ] Set up Sentry error tracking
- [ ] Run load tests on staging
- [ ] Check server response times
- [ ] Monitor database query performance
- [ ] Set up uptime monitoring (UptimeRobot, Pingdom)

### Database Optimization

- [ ] Add Firestore indexes for common queries
- [ ] Review query complexity in admin dashboards
- [ ] Consider pagination for large collections
- [ ] Cache frequently accessed data (Redis/Vercel KV)

---

## Monitoring Dashboards

### Recommended Tools

1. **Vercel Analytics** - Built-in for Vercel deployments
2. **Sentry Performance** - Error tracking + performance
3. **LogRocket** - Session replay + performance
4. **DataDog** - Full APM solution (enterprise)
5. **New Relic** - Full APM solution (enterprise)

### Free Tier Options

- **Sentry:** 5,000 errors/month
- **LogRocket:** 1,000 sessions/month  
- **Vercel Analytics:** Unlimited on paid plans
- **UptimeRobot:** 50 monitors

---

## Next Steps

1. Choose error monitoring provider (recommend Sentry)
2. Set up Lighthouse CI in GitHub Actions
3. Configure Web Vitals monitoring
4. Run baseline load tests
5. Document performance budgets
