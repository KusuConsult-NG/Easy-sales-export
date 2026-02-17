# Authentication Architecture Guide

## Overview

The Easy Sales Export platform uses a **dual-track access control system** for maximum flexibility and security.

---

## The Two Tracks

### 1. Roles Array (Route Access)
- **When assigned**: During registration
- **Stored in**: NextAuth JWT, Firestore, Redis cache
- **Used by**: Middleware, route protection
- **Staleness**: Until re-login (30 days)

### 2. Service Registrations (Feature Access)
- **When created**: During module onboarding
- **Stored in**: Firestore, Redis cache
- **Used by**: Module layouts, service access checks
- **Staleness**: Real-time with cache invalidation

---

## Authentication Patterns

### ✅ Client Components (Recommended)

```typescript
import { useSession } from "next-auth/react";

export default function MyComponent() {
    const { data: session, status } = useSession();
    
    // Check authentication
    if (status === "loading") return <Spinner />;
    if (!session?.user) return <LoginPrompt />;
    
    // Use session data
    return <div>Welcome {session.user.name}</div>;
}
```

**Why**: `status` provides loading state, `session?.user` is safe during hydration.

---

### ✅ Server Components (Recommended)

```typescript
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function MyPage() {
    const session = await auth();
    
    if (!session?.user) {
        redirect("/auth/login");
    }
    
    return <div>Welcome {session.user.name}</div>;
}
```

**Why**: Standard NextAuth pattern, works in Server Components.

---

### ✅ Server Actions

```typescript
import { auth } from "@/lib/auth";

export async function myAction() {
    "use server";
    
    const session = await auth();
    if (!session?.user) {
        return { error: "Unauthorized" };
    }
    
    // ... action logic
}
```

---

### ✅ Module Layouts (Protection)

```typescript
import { auth } from "@/lib/auth";
import { checkServiceAccess } from "@/lib/auth/service-access";
import { redirect } from "next/navigation";

export default async function WaveMemberLayout({ children }) {
    const session = await auth();
    
    // Check authentication
    if (!session?.user) {
        redirect("/auth/login?module=wave");
    }
    
    // Check service-specific access
    const access = await checkServiceAccess(session.user.id, "wave");
    
    if (!access.hasAccess) {
        redirect(access.redirectTo || "/wave/application");
    }
    
    return <>{children}</>;
}
```

**Why**: Two-layer protection ensures both authentication AND approval status.

---

## Common Mistakes

### ❌ Checking Status Instead of Session

```typescript
// BAD
if (status === "unauthenticated") redirect("/login");

// GOOD
if (!session?.user) redirect("/login");
```

**Why**: `status` has three states (loading, authenticated, unauthenticated), but during SSR/hydration it might be `"loading"`. Checking `session?.user` is more reliable.

---

### ❌ Using Roles Only for Protected Features

```typescript
// BAD - Only checks roles
if (session.user.roles.includes("wave_participant")) {
    return <WaveDashboard />;
}

// GOOD - Checks both roles AND registration status
const access = await checkServiceAccess(session.user.id, "wave");
if (access.hasAccess) {
    return <WaveDashboard />;
}
```

**Why**: Roles are assigned before onboarding completion. User might have the role but not be approved yet.

---

### ❌ Forgetting Cache Invalidation

```typescript
// BAD - Update Firestore without cache invalidation
await db.collection("users").doc(userId).update({ 
    roles: ["wave_participant"] 
});

// GOOD - Invalidate cache after update
await db.collection("users").doc(userId).update({ 
    roles: ["wave_participant"] 
});
await invalidateUserCache(userId);
```

**Why**: Redis cache will serve stale data until TTL expires or manual invalidation.

---

## Role Update Propagation

When an admin approves a user:

1. **Firestore updated** → Immediate (source of truth)
2. **Redis cache invalidated** → Next request fetches fresh data
3. **JWT token** → **Remains stale** until re-login

**Implication**: Critical pages should check Firestore/cache, not rely solely on JWT.

---

## Session Refresh

For critical operations that require up-to-date roles:

```typescript
// Force session refresh
await invalidateSession();
redirect("/auth/login?session_refresh=true&returnTo=/dashboard");
```

**Use sparingly** - Only for security-critical flows.

---

## Testing Authentication

### Test Cases

1. **New user registration** → Roles assigned, empty serviceRegistrations
2. **Onboarding completion** → serviceRegistrations created, status: pending
3. **Admin approval** → Roles updated, serviceRegistrations.status: approved
4. **Session after approval** → Cache reflects changes, JWT may be stale
5. **Re-login** → JWT refreshed with new roles

---

## Best Practices

1. **Always check `session?.user`** in components
2. **Use service access checks** for protected features
3. **Invalidate cache** after Firestore updates
4. **Document auth requirements** in component comments
5. **Test both authenticated and unauthenticated** states

---

## See Also

- [`service-access.ts`](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/lib/auth/service-access.ts) - Feature access checks
- [`middleware.ts`](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/middleware.ts) - Route protection
- [`type definitions`](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/types/service-registration.ts) - UserWithServices interface
