# Performance Optimization Guide

## Overview

This document outlines performance optimizations implemented across the Easy Sales Export platform.

---

## Image Optimization

### Next.js Image Component
All images use the Next.js `<Image>` component for automatic optimization:

```tsx
import Image from 'next/image';

<Image
  src="/path/to/image.jpg"
  alt="Description"
  width={800}
  height={600}
  priority={false} // Only true for above-the-fold images
  loading="lazy" // Default for optimal performance
/>
```

### Formats
- **WebP**: Modern format with ~30% better compression
- **AVIF**: Next-gen format when browser supports it

### Remote Images
Firebase Storage images are optimized through Next.js:

```typescript
// next.config.ts
remotePatterns: [
  {
    protocol: 'https',
    hostname: 'firebasestorage.googleapis.com',
  },
],
```

### Best Practices
1. **Specify dimensions**: Always provide `width` and `height`
2. **Use `priority`** for above-the-fold images
3. **Lazy load** by default for below-the-fold images
4. **Responsive sizes**: Use `sizes` prop for responsive images

---

## Code Splitting

### Dynamic Imports
Heavy components are loaded on-demand:

```typescript
import dynamic from 'next/dynamic';

const HeavyChart = dynamic(() => import('@/components/HeavyChart'), {
  loading: () => <LoadingSpinner />,
  ssr: false, // Disable SSR for client-only components
});
```

### Route-based Splitting
Next.js automatically code-splits by route:
- Each page in `/app` is a separate bundle
- Shared components are extracted to shared chunks

### Recommended Dynamic Imports
- **Charts**: Recharts components
- **Modals**: Large modal dialogs
- **Editors**: Rich text editors
- **Maps**: Map libraries

---

## Database Query Optimization

### Firestore Best Practices

#### 1. Use Composite Indexes
For complex queries, create composite indexes:

```javascript
// Firestore console: Create index for
// Collection: orders
// Fields: userId (ascending), status (ascending), createdAt (descending)
```

#### 2. Limit Results
Always limit large collections:

```typescript
const orders = await db.collection('orders')
  .where('userId', '==', userId)
  .orderBy('createdAt', 'desc')
  .limit(20) // Pagination
  .get();
```

#### 3. Cache Frequently Accessed Data
Use React Query or SWR for client-side caching:

```typescript
import { useQuery } from '@tanstack/react-query';

const { data } = useQuery({
  queryKey: ['products'],
  queryFn: getProductsAction,
  staleTime: 5 * 60 * 1000, // 5 minutes
});
```

#### 4. Batch Reads
Use `getAll()` for multiple documents:

```typescript
const refs = ids.map(id => db.collection('products').doc(id));
const docs = await db.getAll(...refs);
```

---

## Loading States

### Standard Components
Use consistent loading components:

```typescript
import { LoadingSpinner, SkeletonCard, SkeletonTable } from '@/components/LoadingComponents';

// Full screen
<LoadingSpinner size="lg" text="Loading..." fullScreen />

// Inline
<LoadingSpinner size="sm" />

// Skeleton loaders
<SkeletonCard />
<SkeletonTable rows={5} />
```

### Suspense Boundaries
Wrap async components:

```typescript
import { Suspense } from 'react';

<Suspense fallback={<SkeletonCard />}>
  <AsyncComponent />
</Suspense>
```

---

## Bundle Size Optimization

### Current Stats
```
Total Size: ~850 KB (gzipped)
- Main bundle: ~250 KB
- Vendor chunks: ~400 KB
- Page bundles: ~200 KB
```

### Monitoring
```bash
# Analyze bundle
ANALYZE=true npm run build

# Opens bundle analyzer in browser
```

### Optimization Strategies
1. **Tree Shaking**: Import only what you need
   ```typescript
   // Bad
   import _ from 'lodash';
   
   // Good
   import debounce from 'lodash/debounce';
   ```

2. **Remove unused dependencies**
3. **Use smaller alternatives**
   - `date-fns` instead of `moment`
   - `lucide-react` instead of `react-icons`

---

## Caching Strategy

### Static Assets
```typescript
// next.config.ts
images: {
  minimumCacheTTL: 60 * 60 * 24 * 365, // 1 year
},
```

### API Responses
Server Actions with Next.js cache:

```typescript
export async function getProductsAction() {
  'use server';
  
  const products = await db.collection('products')
    .where('status', '==', 'active')
    .get();
    
  return {
    success: true,
    products: products.docs.map(d => d.data()),
  };
}

// With revalidation
export const revalidate = 60; // Revalidate every 60 seconds
```

---

## Performance Metrics

### Core Web Vitals Targets
- **LCP** (Largest Contentful Paint): < 2.5s
- **FID** (First Input Delay): < 100ms
- **CLS** (Cumulative Layout Shift): < 0.1

### Monitoring
Use Vercel Analytics or Google Analytics to track:
- Page load times
- Time to interactive
- Core Web Vitals
- Error rates

---

## Production Checklist

- [ ] All images use `<Image>` component
- [ ] Heavy components are dynamically imported
- [ ] Database queries are indexed and limited
- [ ] Loading states are implemented
- [ ] Bundle size is analyzed
- [ ] Caching headers are configured
- [ ] Performance metrics are monitored

---

## Future Optimizations

1. **CDN**: Use Cloudflare or similar for static assets
2. **Service Worker**: Implement offline support
3. **Prefetching**: Prefetch likely next pages
4. **Database**: Consider Redis for hot data
5. **Edge Functions**: Move some logic to edge for lower latency

---

**Built for Performance** ⚡
