# Rate Limiting Guide

## Using Existing Rate Limiter

The application already has `rate-limiter-flexible` installed (v9.1.0) and a basic rate limiter in `src/lib/rate-limiter.ts`.

### Current Implementation

```typescript
// src/lib/rate-limiter.ts
export async function rateLimit(identifier: string): Promise<boolean>
```

The existing rate limiter provides basic in-memory rate limiting.

### Usage in API Routes

```typescript
import { rateLimit } from '@/lib/rate-limiter';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    // Get client identifier (IP address)
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0] || 'unknown';
    
    // Check rate limit
    const allowed = await rateLimit(ip);
    
    if (!allowed) {
        return NextResponse.json(
            { error: 'Too many requests' },
            { status: 429 }
        );
    }
    
    // Process request
    // ...
}
```

### Applying to Sensitive Routes

Add rate limiting to:

#### 1. Authentication Routes
- `/api/auth/*` - 5 requests/minute
- `/api/register` - 3 requests/hour

#### 2. Payment Routes  
- `/api/cooperative/withdraw` - 10 requests/hour
- `/api/payment/*` - 20 requests/minute

#### 3. Admin Routes
- `/api/admin/*` - 100 requests/minute

### Upgrade to rate-limiter-flexible

For production, consider upgrading to use the installed `rate-limiter-flexible` library:

```typescript
import { RateLimiterMemory } from 'rate-limiter-flexible';

const limiter = new RateLimiterMemory({
    points: 10, // Number of points
    duration: 60, // Per 60 seconds
});

export async function checkRateLimit(key: string) {
    try {
        await limiter.consume(key, 1);
        return { allowed: true };
    } catch (error) {
        return {
            allowed: false,
            retryAfter: Math.round(error.msBeforeNext / 1000),
        };
    }
}
```

### Distributed Rate Limiting (Redis)

For multi-instance deployments, use Redis:

```typescript
import { RateLimiterRedis } from 'rate-limiter-flexible';
import Redis from 'ioredis';

const redisClient = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
});

const limiter = new RateLimiterRedis({
    storeClient: redisClient,
    points: 10,
    duration: 60,
});
```

## Next Steps

1. **Review existing rate limiter** - Check `src/lib/rate-limiter.ts`
2. **Apply to sensitive routes** - Add to auth, payment, admin endpoints
3. **Test rate limiting** - Verify it triggers correctly
4. **Monitor in production** - Track 429 responses
5. **Consider Redis** - For horizontal scaling
