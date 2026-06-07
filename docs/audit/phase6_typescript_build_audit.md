# Phase 6: TypeScript & Build Audit

This document compiles the build-time checks, type-checking, linter output, and compilation characteristics for the **Easy Sales Export** Next.js platform.

---

## 1. Next.js Production Build Metrics

The production build was executed via `npm run build` (`next build --webpack`).

- **TypeScript Type-Checking**: Completed successfully in **15.4 seconds** with **0 errors**.
- **Static Page Generation**: Completed successfully in **1.37 seconds** generating **154 static/dynamic routes** with **0 errors**.
- **Execution Mode**: Standalone output (`output: "standalone"`).
- **Environment Context**: Build-time timestamps injected dynamically into container endpoints.

---

## 2. ESLint Static Analysis Results

Executing `npm run lint` completed successfully with **0 errors** and **4 warnings**. 

The minor warnings logged:

1. **Unused eslint-disable Directive**:
   - **File**: `packages/services/src/contracts.ts:9`
   - **Warning**: Unused `eslint-disable` directive (no problems were reported from `@typescript-eslint/no-explicit-any`).
   
2. **Missing Hook Dependencies**:
   - **File**: [page.tsx](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/academy/%5BcourseId%5D/page.tsx#L115)
   - **Warning**: React Hook `useEffect` has missing dependencies: `router` and `showToast`. Either include them or remove the dependency array.
   
3. **HTML `<img>` Element Warnings (LCP / Performance)**:
   - **Files**:
     - [create/page.tsx](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/export/(app)/products/create/page.tsx#L255)
     - [page.tsx](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/export/(app)/products/page.tsx#L111)
   - **Warning**: Using `<img>` could result in slower LCP and higher bandwidth. Consider using `<Image />` from `next/image` to optimize assets.

---

## 3. Hydration & Compilation Analysis

- **Strict Type Checking**: Enabled in `tsconfig.json`. No compiler errors were thrown, confirming strict static type safety.
- **Hydration Scans**: Page data collection with 9 workers did not encounter any React hydration errors during compile-time static generation.
- **Peer Dependencies**: The project uses Node 22.12.0 and npm 10.8.2. Sentry deprecation warnings were logged for auto-instrumentation settings (moving config from client configs to `instrumentation-client.ts`), but they do not block the build or break compilation.

---

## 4. Critical Build Discrepancy: Middleware Exclusion

Next.js build logs listed `Proxy (Middleware)` as a dynamic symbol, but the generated `middleware-manifest.json` in the `.next/server/` output was empty:

```json
{
  "version": 3,
  "middleware": {},
  "functions": {},
  "sortedMiddleware": []
}
```

### Root Cause
Next.js expects the middleware file to be named `middleware.ts` (or `.js`) in the `src/` directory or root. Because it is named `proxy.ts`, Next.js compiles it as a standard module rather than routing traffic through it. As a result:
- **No middleware gating is active**. Protected routes can be browsed without login.
- **Domain-based sub-tenant path rewrites are completely disabled**.
- **Zombie cookie session clears do not execute**.
