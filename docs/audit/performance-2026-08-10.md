# Performance audit, 2026-08-10

Measured, not estimated. Every number below comes from a production build on this
commit or from counting the source; where something is inferred rather than
observed, it says so.

`outstanding-work.md` lists performance as "never audited" and carries two
figures from an earlier estimate. Both are now measured, and **one of them is
materially misleading** — see §1.

The headline is not the bundle. It is §2: **every filtered query against a JSONB
field runs as a sequential scan**, because the only indexes covering `raw_data`
are GIN, and GIN cannot serve the `raw_data->>'field' = value` form the adapter
generates. That is the mechanism behind "the slowness", and it is one migration
to fix.

§3 is a correctness bug found while measuring: the fulfilment reconciler silently
checks only the first 5,000 rows of each collection it scans, and one of those
collections has 41,105 records.

---

## 1. The client bundle is in better shape than recorded

**Measured** (`next build`, this commit):

| | Recorded in `outstanding-work.md` | Measured |
|---|---|---|
| Client JS | "12 MB of JavaScript" | **8.8 MB** across `.next/static/chunks` |
| Largest chunk | "up to 469 KB" | **439 KB** |
| Server output | "188 MB" | **197 MB** |

**The 12 MB (and the 8.8 MB) figure does not mean what it looks like.** It is the
sum of *every* chunk for *every* one of ~200 routes — the whole build output, not
what any user downloads. The number that matters is the shared baseline plus one
route's chunk:

```
rootMainFiles (loaded on EVERY page): 7 files, 452 KB uncompressed
     227 KB  react-dom
     108 KB  (framework)
      44 KB  (framework)
      ... 4 smaller
```

That 227 KB is `react-dom`. The baseline is essentially framework code, which is
normal for Next and not something to optimise away. A separate 110 KB polyfill
chunk exists but is `nomodule` — modern browsers never fetch it.

**The heavy libraries are already lazy-loaded**, which the recorded item assumed
they were not. Verified by reading the call sites:

| Library | Status |
|---|---|
| `recharts` | `next/dynamic`, `ssr:false` — 3 of 4 sites |
| `leaflet` / `react-leaflet` | `next/dynamic`, `ssr:false` — all sites |
| `jspdf`, `html2canvas` | `await import(...)` at point of use — all sites |
| `@react-pdf/renderer` | server routes + one component |

So the "split the heavy libraries" work is substantially done. Two things remain.

### 1a. One chart import was never converted

`src/app/admin/DashboardClient.tsx:22`

```js
import AnalyticsCharts from "@/components/admin/AnalyticsCharts";
```

`src/app/admin/analytics/page.tsx` loads the same component through
`dynamic(..., { ssr: false })`. The dashboard does not, so it pulls `recharts`
into the admin dashboard's initial load — and the admin dashboard is a far more
frequently visited page than the analytics page.

Two chunks of 337 KB each contain `recharts`, with different hashes: it is
resident in more than one place.

**This is the same shape as four of the six defects in
`integrity-sweep-2026-08-10.md`** — a fix applied to one copy of a path and not
the other. It is worth noticing that the pattern is not specific to
concurrency work.

**FIXED, and measured** by building twice and reading
`.next/server/app/admin/page_client-reference-manifest.js` each time:

| `/admin` initial JS | Chunks | Total | recharts |
|---|---|---|---|
| before | 16 | **900 KB** | 338 + 38 + 21 KB |
| after | 13 | **506 KB** | none |

**394 KB removed, 44% of the route's initial JavaScript.** Larger than the
~337 KB this section originally estimated: recharts was spread across three
chunks, not one.

### 1b. `framer-motion` is static in 11 route files

`loans/page`, `land/verify/page`, `loans/success`, `loans/approve`,
`admin/DashboardClient`, `profile/page`, `escrow/page`, plus `LandMap`,
`LoanWizard`, `VideoPlayer`, `AISidebar`.

Animation is not deferrable the way a chart is — the component needs it on first
paint — so this is not a `dynamic()` fix. It is a "do we need this library"
question, and it is a real one at ~100 KB gzipped on those routes. Recorded, not
acted on: replacing it is a design decision, not a performance patch.

---

## 2. Every JSONB filter is a sequential scan — the headline

**`schema.sql` defines 23 indexes, including GIN on `raw_data` for all 9 tables.**
That looks like coverage. It is not, and the reason is exact.

The adapter generates this for any field that is not a native column
(`src/lib/supabase-db.ts:1074`):

```js
jsonPath = `raw_data->>${JSON.stringify(field)}`;   //  raw_data->>'status'
...
return query.eq(jsonPath, String(value));           //  raw_data->>'status' = 'pending'
```

A GIN index with the default `jsonb_ops` serves **containment** (`@>`, `?`). It
cannot serve `->>` text extraction compared with `=`. Postgres will not use
`idx_doc_collections_raw_data` for that predicate, and falls back to a
sequential scan of the table.

`document_collections` is the fallback table for every collection not in the
10-entry `DEDICATED_TABLE_MAP` — which is most of them, including
`loan_applications`, `cooperative_withdrawals`, `export_windows`,
`notifications`, `conversations`, `land_listings`, `products`. Every filtered
read of any of those scans the whole shared table.

**A trap worth stating separately.** Being in a dedicated table is not enough
either. `cooperative_members` has a native `status` column — but the code filters
on `membershipStatus`, a different field, which lives in `raw_data`. So it takes
the JSONB path and scans. `processed_payments` has native
`id, user_id, amount, reference` — but is filtered on `status` and `type`, both
JSONB. Native columns only help when the *queried field name* matches.

### What to index, ranked by actual use

Counted across `src/`, from `.where("field", …)` calls attributed to their
collection:

| Uses | Field | | Uses | Collection.field |
|---|---|---|---|---|
| 171 | `status` | | 22 | `LAND_LISTINGS.status` |
| 137 | `userId` | | 20 | `PRODUCTS.status` |
| 24 | `email` | | 17 | `PROCESSED_PAYMENTS.status` |
| 16 | `type` | | 16 | `COOPERATIVE_MEMBERS.userId` |
| 16 | `roles` | | 15 | `SELLER_VERIFICATIONS.userId` |
| 14 | `buyerId` | | 13 | `ACADEMY_APPLICATIONS.userId` |

`status` and `userId` are 308 of the ~450 filtered reads between them. Two
composite expression indexes on `document_collections` cover most of the
codebase:

```sql
CREATE INDEX CONCURRENTLY idx_dc_collection_status
  ON document_collections (collection_name, (raw_data->>'status'));
CREATE INDEX CONCURRENTLY idx_dc_collection_user
  ON document_collections (collection_name, (raw_data->>'userId'));
```

`collection_name` leads because every query on that table is already filtered by
it, so it makes the index selective per collection rather than global.

Then the dedicated tables, for the fields whose *names* miss their native column:

```sql
CREATE INDEX CONCURRENTLY idx_pp_status   ON processed_payments ((raw_data->>'status'));
CREATE INDEX CONCURRENTLY idx_pp_type     ON processed_payments ((raw_data->>'type'));
CREATE INDEX CONCURRENTLY idx_cm_mstatus  ON cooperative_members ((raw_data->>'membershipStatus'));
CREATE INDEX CONCURRENTLY idx_mo_buyer    ON marketplace_orders ((raw_data->>'buyerId'));
CREATE INDEX CONCURRENTLY idx_mo_pstatus  ON marketplace_orders ((raw_data->>'paymentStatus'));
```

**`CONCURRENTLY` matters and cannot run inside a transaction block** — so this
must be its own migration with no `BEGIN`/`COMMIT`, unlike every other migration
in this repo. Building these indexes non-concurrently would take an ACCESS
EXCLUSIVE lock on live tables.

**Verify before believing any of this.** The claim is that these predicates
currently seq-scan; confirm on the real data rather than taking it on trust:

```sql
EXPLAIN ANALYZE
SELECT * FROM document_collections
 WHERE collection_name = 'loan_applications'
   AND raw_data->>'status' = 'pending';
-- expect Seq Scan before, Index Scan after
```

I have not run this — it needs production or a loaded staging database, and
neither is reachable from here. **The mechanism is certain; the magnitude is
not.** On a small table Postgres would choose a seq scan anyway and the index
would change nothing.

---

## 3. The fulfilment reconciler silently checks 5,000 rows — a correctness bug

Found while measuring read patterns, and more serious than a performance issue.

`src/lib/supabase-db.ts:105` sets `DEFAULT_QUERY_LIMIT = 5000`. A query with no
`.limit()` returns at most that, logs a warning once per collection, and returns
what looks like a complete result.

`api/cron/reconcile-fulfilment/route.ts` scans whole collections with no
`.limit()` and no `.all()` — **seven of them**:

| Line | Collection | |
|---|---|---|
| 79 | `USERS` | `outstanding-work.md` records **41,105 records** |
| 97 | `COOPERATIVE_MEMBERS` | |
| 112 | `MARKETPLACE_ORDERS` | |
| 131 | `EXPORT_SLOTS` | |
| 145 | `FARM_NATION_TRANSACTIONS` | |
| 182 | `PROCESSED_PAYMENTS` | reads all, then filters by date in JS |
| 271 | orders, for `refundsOwed` | added earlier today — same defect |

The academy check builds its "who is fulfilled" set from the users read. Truncated
at 5,000 of 41,105, **every academy payment belonging to a user outside that
first slice is reported as unfulfilled.** The reconciler built to catch the
original eight-registration incident is itself reporting against a fraction of
the data.

This is precisely the failure the cap's own warning describes: *"a short result
that looks complete is how 'the report is missing rows' bugs reach production."*
The warning fires — once per collection, into logs nobody is reading, on a job
that has never been scheduled in production.

**FIXED.** All seven use `.all()`, which raises the ceiling to 500,000 and logs
an *error* when hit rather than truncating quietly. Four also use `.select()` to
fetch only the fields the check reads.

**One thing I planned and did not do.** The first draft pushed the date window
into the `PROCESSED_PAYMENTS` query as `.where("processedAt", ">=", cutoff)`.
That would have been a regression: the JavaScript filter deliberately KEEPS rows
with no `processedAt` — *"undated: check it rather than skip it"* — and a SQL
`>=` drops exactly those, which are the rows most likely to be malformed and
worth looking at. `processedAt` is also written as a server timestamp on some
paths and an ISO string on others, so the comparison would not have been sound
across both. The filter stays in JavaScript, and the reason is now a comment.

**And the ceiling is no longer only a log line.** `.all()` reports an error into
logs — and this entire defect was hidden by a warning in logs nobody read, on a
job that has never been scheduled. Each check now returns whether its scan was
truncated, the response carries `incompleteScans`, and the status becomes
`incomplete_scan` rather than `ok`. A reconciler running against a partial view
must not be able to report clean: every "unfulfilled" for a truncated type is a
possible false positive, and every fulfilled one a possible false negative.

I introduced the seventh instance today, in the `refundsOwed` scan. Same fix,
plus the filter pushed into the query where it is safe to do so.

---

## 4. Two genuine N+1 loops

A sweep for `await` on a read inside a loop found 114 candidates; most are the
*correct* batched shape (`userPromises.push(...)` with a `documentId in [...]`
query, then one `Promise.all`). Two are real.

### `messages.ts:480` — O(N × M), and the worst thing here

```js
for (const memberUid of memberUids) {
    const existingSnap = await db.collection(COLLECTIONS.CONVERSATIONS)
        .where("participants", "array-contains", adminId)
        .get();                       // ← the ADMIN'S ENTIRE conversation list
    for (const doc of existingSnap.docs) { /* scan in JS */ }
}
```

For each member being messaged it re-fetches **every conversation the admin has**
and filters in JavaScript. Broadcasting to 500 members runs 500 full queries over
a collection that grows with every conversation ever created — and serially,
because the `await` is inside the loop. The result is identical every iteration:
it should be fetched once before the loop.

**FIXED.** The query is hoisted above the loop and indexed into a
`Map<memberId, conversationId>`, so the per-member lookup is a map read. Cost
goes from O(members × conversations) to O(conversations) once.

A second read went with it. Inside the `if (!conversationId)` branch sat a
`USERS` read feeding a `convData` object that was **assigned and never
referenced** — `startConversation` resolves participant details itself. One round
trip per new member, for an object that was discarded.

### `forensics.ts:41` and `:69` — serial reads

```js
for (const user of authUsers) {
    const doc = await db.collection(COLLECTIONS.USERS).doc(user.uid).get();
```

**CORRECTION.** An earlier draft of this section said this "does not complete in
any reasonable time" against 41,105 users. That was wrong: the scan is bounded by
`listUsers(100)` and, for the products check below it, `.limit(200)`. It is
~300 serial round trips, not 41,000 — slow, not broken. The corrected claim is
the one to act on, and the original overstated it by two orders of magnitude.

The products check has a second problem the user loop does not: it re-reads the
same seller once per product, so a seller with 40 listings costs 40 identical
round trips.

Both are the chunked `FieldPath.documentId() in [...]` shape `admin.ts` already
uses for hydration. **FIXED** — 300 serial round trips become ~10 concurrent
queries, and the products check now de-duplicates sellers before reading.

---

## 5. 399 unlimited collection scans

Counted: **556 collection queries ending in `.get()`, of which 157 carry a
`.limit()` and 399 do not.** (`outstanding-work.md` recorded 415 of 516 — same
picture, slightly different counting.)

Worst files:

| Unlimited scans | File |
|---|---|
| 30 | `actions/sms-broadcast.ts` |
| 27 | `services/analytics.service.ts` |
| 21 | `actions/global-aggregation.ts` |
| 19 | `actions/in-app-broadcast.ts` |
| 16 | `actions/admin.ts` |

The 5,000-row default cap stops any single one reading a whole table, so these
are bounded — but §3 is what "bounded" costs when the code needed the whole
collection. Every one of these is either a hidden truncation or 5,000 rows of
data pulled to discard most of it.

**`global-aggregation.ts` is the exception worth noting, and it is a good
pattern**: revenue comes from the `platform_revenue_totals()` SQL function and
the dashboard counters use `.count().get()`, so the money figures are computed in
Postgres rather than by scanning. Its 21 unlimited reads are elsewhere in the
file. That is the shape the rest should move toward.

---

## 6. Server output: 197 MB

`.next/server` is 197 MB, `.next` total 349 MB. `next.config.ts` already excludes
SWC binaries, Prisma and Jest from output file tracing.

Largest installed dependencies, for context on what a serverless bundle is
tracing over:

```
 168 MB  next            44 MB  lucide-react     29 MB  jspdf
 116 MB  @next           38 MB  date-fns         26 MB  @zxing
  72 MB  @sentry         29 MB  @turbo           19 MB  react-qr-reader
```

Two observations rather than findings:

- `@sentry` at 72 MB installed is the largest non-framework dependency, and
  `next.config.ts` already lists `@sentry/node` and `@sentry/nextjs` in
  `serverExternalPackages`.
- `lucide-react` (44 MB) and `recharts` are both in `optimizePackageImports`,
  which is the correct handling.

I have not attributed the 197 MB to specific causes. Doing that properly needs
`@next/bundle-analyzer` (already wired up — `ANALYZE=true npm run build`) and is
a piece of work in itself. **It is also worth asking whether it matters**: on
Railway this is image size and cold-start, not per-request latency. §2 and §3
affect every request; this affects deploys.

---

## Status

| | Finding | State |
|---|---|---|
| §1a | recharts static on the admin dashboard | **fixed** — 900 KB → 506 KB measured |
| §1b | `framer-motion` static in 11 files | open — needs a design decision |
| §2 | JSONB filters seq-scan | **migration 022 written** — apply after `EXPLAIN ANALYZE` |
| §3 | reconciler truncates at 5,000 rows | **fixed** — `.all()`, plus `incompleteScans` in the response |
| §4 | `messages.ts` O(N×M), `forensics.ts` serial | **fixed** |
| §5 | 399 unlimited scans | open — a project, not a patch |
| §6 | 197 MB server output | open — needs `ANALYZE=true` and is deploy cost, not request cost |

**Migration 022 is written but its value is unverified.** The mechanism is
certain; the magnitude is not, and it cannot be established from the repository.
Run the `EXPLAIN ANALYZE` in the migration header against production or a
comparably loaded database *before* applying. If a table is small enough that the
planner prefers a sequential scan anyway, drop that index rather than leaving it:
an unused index is write cost with no read benefit.

It is also the only migration in this repo with **no `BEGIN`/`COMMIT`**, because
`CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Adding them will
make it fail.

## Priority

1. **§3 — the reconciler truncation.** A correctness bug in the safety net, in
   code paths that already exist. Cheapest fix here and the only one that is
   currently reporting wrong answers.
2. **§2 — the expression indexes.** One migration, and the mechanism behind the
   general slowness. Needs `EXPLAIN ANALYZE` against real data first to size the
   win.
3. **§4 — the `messages.ts` N+1.** One hoisted query; the fix is smaller than
   this paragraph.
4. **§1a — the dashboard chart import.** One line.
5. §5, §1b, §6 — real, but each is a project rather than a patch.

## What this audit did not cover

Named explicitly, because an audit that quietly skips things reads as an
all-clear — the same reasoning the fulfilment reconciler applies to payment types
it does not check.

- **No runtime measurement.** No `EXPLAIN ANALYZE`, no request timings, no
  profiling against real data. Everything here is static analysis plus a build.
  §2's magnitude in particular is unverified.
- **No React render profiling** — re-renders, memoisation, hydration cost.
- **Images** beyond confirming `next.config.ts` sets formats, sizes and a
  one-year `minimumCacheTTL`.
- **Redis caching** — present in the codebase, hit rates unexamined.
- **No lighthouse / Core Web Vitals run.**
