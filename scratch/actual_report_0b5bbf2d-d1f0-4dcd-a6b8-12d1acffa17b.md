All three fixes are clean and correct. Here's a summary of everything that was done:

---

## ✅ Audit Complete — All Fixes Applied

### 🐛 Bug 1 Fixed: `isTimestamp` in [`firestore-serialize.ts`](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/lib/firestore-serialize.ts#L27)

**Problem:** `Object.keys(v).length <= 2` caused Timestamps embedded in larger plain objects (from certain REST/serialization layers) to be silently skipped.

**Fix:** Removed the key-count guard — detection is now purely structural:
```diff
-    return hasSeconds && hasNanoseconds && Object.keys(v).length <= 2;
+    return hasSeconds && hasNanoseconds;
```

---

### 🐛 Bug 2 Fixed: [`dashboard.ts`](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/actions/dashboard.ts) — Raw `Date` objects crossing the server→client boundary

**Problem:** `getRecentActivityAction` and `getEscrowStatusAction` were returning raw `Date` objects (from `.toDate()` calls) inside their response payloads. `Date` class instances crash Next.js's server-component serializer just like `Timestamp`.

**Fix:** Added `serializeValue` import. Both actions now wrap their return data with `serializeValue()`, converting all `Date`/`Timestamp` values to ISO strings before they cross the boundary.

---

### 🐛 Bug 3 Fixed: [`vendor.ts`](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/actions/vendor.ts) — Partial manual conversion leaving other Timestamps raw

**Problem:** `_getVendorOrdersAction` and `_getVendorProductsAction` manually converted only `createdAt` and `updatedAt` via `.toDate()`, but spread `...data` directly — any other Timestamp fields in those documents would still be raw.

**Fix:** Replaced both manual mappings with `serializeDoc<T>(doc.id, doc.data())`, which recursively converts every Timestamp in the entire document tree.

---

### ✅ Confirmed Clean (No Fixes Needed)

| File | Status |
|------|--------|
| `export.ts` | ✅ Uses `serializeDoc`/`serializeDocs` correctly |
| `messages.ts` | ✅ Uses `serializeDocs` correctly |
| `notifications.ts` | ✅ Uses `serializeDocs` correctly |
| `orders.ts` | ✅ Uses `serializeDoc` via dynamic import |
| `wallet.ts` | ✅ Uses `serializeDoc`/`serializeDocs` correctly |
| `profile.ts` | ✅ Uses `serializeDoc` correctly |
| `vendor-dashboard.ts` | ✅ Uses `serializeDocs`/`serializeValue` correctly |
| `dashboard/page.tsx` | ✅ Client component — uses `onSnapshot` directly, no server→client crossing |