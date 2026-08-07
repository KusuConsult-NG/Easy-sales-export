# Data Layer & Compatibility Shim Audit

**Scope:** the Firestore-compatibility layer over Supabase, the storage layer, the
auth bootstrap, and the CI pipeline.
**Method:** static tracing of every call site against the adapter implementations,
plus a clean `tsc --noEmit`, `eslint` and `next build` baseline.

## Why the app keeps breaking

The application was migrated from Firebase to Supabase by keeping the Firestore
API surface and re-implementing it on top of Postgres:

| Layer | File | Used by |
|---|---|---|
| Server adapter | `src/lib/supabase-db.ts` | all server actions and route handlers |
| Client adapter | `src/lib/supabase-client-db.ts` | 7 client components |
| Sentinels | `src/lib/firestore-compat.ts` | writes across the app |
| Package shims | `src/lib/shims/firebase*`, wired in `package.json` | anything still importing `firebase` / `firebase-admin` |

The strategy is sound, but the two adapters were written independently and
**neither matches the Firestore API it claims to emulate, nor each other**. Because
`tsconfig.json` sets `noImplicitAny: false` and `strictNullChecks: false`, and
every adapter surface is typed `any`, *none of these defects are visible to
`tsc`, `eslint`, or the build.* A full production build passes with every bug
below live. That is the mechanism behind "we fix it and it breaks again": the
compiler cannot see the contract, so each fix is validated only by whichever
screen was being tested at the time.

The fixes in this change close the defects that had a confirmed call site. The
remaining items are listed under *Open risks* because fixing them safely
requires a data migration or a product decision.

---

## Fixed — confirmed broken in production

### 1. `db.doc()` discarded all path segments after the first

`supabaseDb.doc()` accepted a single slash-joined path, but a dozen call sites use
the client-SDK form `doc(db, collection, id)`. The extra arguments were dropped,
leaving a one-segment path, which hit the guard and threw
`Invalid document path: <collection>`.

Everything below threw on its first database access, before any business logic ran:

- `src/app/actions/cooperative/_payment.ts` — **cooperative contribution payment
  verification.** Members were debited by Paystack and verification threw every
  time.
- `src/lib/cooperative-utils.ts` — `getCooperativeBalance`,
  `checkCooperativeCreditEligibility`, `getCooperativeMembershipStatus`,
  `getCooperativeQuickStats` (all four).
- `src/components/modals/JoinCooperativeModal.tsx` — the join-cooperative action.

`doc()` now accepts `doc("a/b")`, `doc("a", "b")` and nested segments, and rejects
odd-segment paths with a message that names the correct alternative.

### 2. `snapshot.exists` — property on the server, method on the client

`SupabaseDocumentSnapshot.exists` is a boolean getter (Admin-SDK semantics), but
`supabase-client-db` returns `exists: () => boolean` (client-SDK semantics). Seven
server call sites wrote `.exists()`, which throws `TypeError: ... is not a
function`. 527 other call sites use the property form.

`_payment.ts` used **both forms in the same function**. Server call sites corrected;
the client sites were already right.

### 3. Every server-side file upload threw

`firebase-admin/storage` resolves to `src/lib/shims/firebase-admin/storage.js`,
whose bucket handle implements only `save`/`delete`/`exists` — all no-ops — and
does not define `makePublic()` or `getSignedUrl()` at all. Callers saved a buffer
(discarded silently) and then immediately called one of the missing methods:

- `src/lib/storage-admin.ts` → marketplace product images and videos, export
  documents, certificates
- `src/app/actions/resource-actions.ts` → Wave resource uploads
- `src/app/api/certificates/upload/route.ts` → certificate uploads

`bucket.name` was also `undefined`, so the URLs being written to the database were
`https://storage.googleapis.com/undefined/...`.

The rest of the app already uploads to Cloudinary (`src/app/api/upload/route.ts`,
`src/lib/storage-upload.ts`, which states plainly that no Firebase Storage bucket
is provisioned). `storage-admin.ts` now uploads to Cloudinary using the same
signing scheme, and the two other call sites were routed through it.

While rewriting it, the file-type allow-list check was also fixed: it was wrapped
in a `try/catch` that swallowed everything except its own error, so a failure to
load `file-type` silently disabled content validation. It now fails closed.

### 4. `set(data, { merge: true })` silently discarded the write on new documents

A merging `set()` routed to `supabasePartialUpdate()`, which issues a bare SQL
`UPDATE` (directly or via the `merge_raw_data` RPC). On a document that does not
exist yet that matches **zero rows and reports no error** — the write vanished and
the caller saw success.

Behaviour also varied by table and by whether migration `002` had been applied,
which is why this presented as intermittent. `set()` now creates the document when
it does not exist. `update()` on a missing document remains a no-op (unchanged, to
avoid new failures under load) but now logs a warning instead of staying invisible.

### 5. `increment()` wrote a JSON object instead of incrementing

`supabase-db.ts` exported `increment(n)` returning `{ __op: 'increment', value: n }`,
but the write pipeline detects sentinels via `_methodName`. The object was
persisted verbatim, so counters were **replaced** by
`{"__op":"increment","value":1}` rather than incremented — `memberCount` and
`totalSavings` in the join-cooperative flow. Now returns a real
`FieldValue.increment`. `arrayUnion`, `arrayRemove` and `deleteField` were also
missing from that module and have been added.

### 6. `AggregateField.count()` returned a sum of money

`aggregate()` ignored the `_op` and always summed, defaulting the field to
`"amountDisbursed"`. `AggregateField.count()` therefore returned the total
disbursed amount where a document count was expected —
`src/services/analytics.service.ts:179` (`totalTransactions`).

It also read a single un-paginated page, so **every aggregate silently
under-reported once a collection passed 1,000 rows** — including revenue totals.
Both fixed: `count`/`sum`/`average` are honoured and all pages are read.

### 7. Client queries silently dropped unsupported operators

`supabase-client-db` implemented only `==`, `>=` and `<=` for native columns and
only `==` for JSONB. Any other operator was skipped without error, turning a scoped
query into "select the entire collection".

`where("participants", "array-contains", userId)` is used in
`src/app/dashboard/page.tsx`, `src/components/dashboard/DashboardNav.tsx` and
`src/components/layout/ModuleSidebar.tsx`. The filter was dropped, so the
unread-message badge counted **every conversation on the platform**, and those
documents — including `lastMessage` content and participant details — were pulled
into every signed-in browser every 8 seconds.

All operators the app uses are now implemented, unknown operators throw instead of
returning an unfiltered collection, and `getDocs`/`onSnapshot` share one
implementation so they cannot drift apart again.

### 8. Read errors were reported as "document does not exist"

`SupabaseDocumentReference.get()` caught every error and returned a
non-existent snapshot. A transient database error was indistinguishable from a
missing document, so callers proceeded to re-create records over live data. Errors
now propagate.

**Deployment note:** this converts silent wrong answers into visible errors. If a
chronic query error exists in production it will now surface rather than read as
an empty result — which is the point, but worth watching on the first deploy.

### 9. The same document returned different values depending on how it was read

`.doc().get()` gave the native SQL column precedence for `createdAt`/`updatedAt`/
`email`; `.where().get()` gave `raw_data` precedence. The same record therefore
reported different timestamps in a detail view than in a list view. Both paths now
prefer `raw_data`, with the SQL column as fallback.

### 10. Auth was gated behind Firebase credentials that do nothing

`initializeFirebaseAdmin()` threw `Missing FIREBASE_PRIVATE_KEY environment
variable` when that variable was absent or not PEM-formatted. Firebase is fully
shimmed: `initializeApp`/`cert` return empty objects and `getAuth()` ignores the
app, talking to Supabase Auth directly. The credential was doing nothing except
providing a way for authentication to fail.

Every registration, login provisioning, password reset and profile email change
goes through `adminAuth`. Removing the obsolete Firebase variables from the
environment would have taken all of them down with an unrelated error message.
Credential problems are now logged, not thrown.

### 11. Startup env validation demanded six dead variables

`env-validator.ts` required `NEXT_PUBLIC_FIREBASE_API_KEY`,
`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`,
`FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PROJECT_ID` — none of
which are read by anything. Every correctly configured deploy printed
`❌ Environment validation failed!`, which buried the entries that matter.
Removed, and the three `CLOUDINARY_*` variables that uploads genuinely require were
added to the production set.

### 12. CI validated a runtime production never uses, and never built

`package.json` requires Node `>=22.12.0`, `.node-version` says 22 and the Dockerfile
that Railway deploys uses `node:22-alpine` — but both workflows pinned Node 20.
CI also ran only `tsc` and `jest`; it never ran `next build`, so a
build-breaking change could merge cleanly. CI now reads `.node-version` and runs
lint plus a production build.

---

## Open risks — not changed here

These are real, but each needs a migration or a product decision rather than a
code edit.

### A. No row-level security anywhere

`supabase/schema.sql` creates nine tables and never issues
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, and there is not a single
`CREATE POLICY` in the repository. The browser-side client in `src/lib/supabase.ts`
authenticates with the anon key.

With RLS disabled, that key can read and write every table — users, wallets,
transactions, processed payments — directly against the Supabase REST endpoint,
regardless of what the application code allows. **This is the most serious finding
in this audit.** It was not changed here because enabling RLS without first
writing policies would take the client reads offline instantly. It needs a
migration that adds policies and enables RLS in one transaction, staged and
verified.

### B. Transactions are not atomic

`SupabaseTransaction` reads immediately and replays writes sequentially after the
callback returns (`supabase-db.ts`). There is no rollback and no retry. If the
ledger write fails after the membership update in `_payment.ts`, the contribution
is recorded against the member with no corresponding ledger entry. `update()` is
also read-modify-write, so concurrent increments lose each other. Correct fix is a
Postgres function per money-moving flow.

### C. Numeric comparisons on JSONB fields are lexicographic

`raw_data->>'field'` yields `text`, so `applyJsonbFilter` compares numbers as
strings: `where("amount", ">", 900)` matches `"1000"` as *less than* `"900"`.
Affects any range filter on a field not promoted to a native column. ISO date
strings compare correctly, so this is confined to numeric fields. Fix requires
either promoting those fields to typed columns or generated columns with a cast.

### D. `orderBy("createdAt")` sorts by row insert time, not the domain timestamp

Both adapters map `createdAt` to the native `created_at` column. Writes store the
domain value in `raw_data.createdAt`. For rows created by the migration,
`created_at` is the migration timestamp for every row, so ordering is effectively
insertion order. This is the likely cause of the transaction-listing ordering
problems previously worked around by removing the `orderBy` clause. Changing it
now would alter pagination for existing data, so it needs to be done together with
a backfill.

### E. Cursor pagination is silently ignored for JSONB-ordered queries

In `SupabaseQuery.get()`, `startAfter` only applies when the first `orderBy` field
resolves to a native column. Otherwise the cursor is dropped and the query returns
page 1 again — "load more" repeats the same rows indefinitely.

### F. Two incompatible `Timestamp` classes

`supabase-client-db.Timestamp` exposes `seconds`/`nanoseconds`;
`firestore-compat.Timestamp` exposes `_seconds`/`_nanoseconds`. Code reading one
shape off the other gets `undefined` and produces `Invalid Date`. Separately,
`convertStringsToTimestamps()` converts *any* ISO-looking string anywhere in a
document into a class instance, which Next.js cannot serialize across the
server/client boundary.

### G. `firebase/firestore` client shim silently no-ops writes

`src/lib/shims/firebase/firestore.js` defines `addDoc` as
`async () => ({ id: "mock-id" })` and `updateDoc` as `async () => ({})` — neither
writes anything. It also re-exports `supabase-client-db`, which has no `setDoc`,
`writeBatch`, `serverTimestamp` or `runTransaction`, so those import as
`undefined`. Only the integration tests import from this path today, so nothing
in the application is currently affected — but the shim is a loaded gun for the
next person who imports from `firebase/firestore`.

### H. Storage deletes are no-ops

Certificate deletion (`src/app/actions/certificates.ts`,
`src/app/api/certificates/[id]/route.ts`) calls `bucket.file(path).delete()` on
the shim, which resolves without doing anything. Both are wrapped in `try/catch`,
so nothing fails — the assets simply accumulate. Now that uploads go to
Cloudinary, deletion should go through the Cloudinary destroy API.

### I. A schema trigger raises on a normal state transition

`enforce_member_active_on_paid` in `schema.sql` raises an exception whenever a
`cooperative_members` row is written with `status = 'pending'` and any
`processed_payments` row exists for that user — including refunds, reversals and
administrative corrections. A database exception here surfaces as a 500.

### J. Type checking is disabled where it would help most

`strictNullChecks: false` and `noImplicitAny: false`, combined with adapter
surfaces typed `any`, is why none of the twelve defects above were caught by
`tsc`. Typing the adapter return values — even without turning on strict mode
globally — would have caught items 1, 2, 5 and 6 at compile time.

### K. Cloudinary signatures use SHA-256

Both `/api/upload` and `storage-admin.ts` sign with SHA-256. Cloudinary's default
signature algorithm is SHA-1; SHA-256 works only if the account is configured for
it. Unverifiable from the repository — worth confirming against the account
settings, since a mismatch fails every signed upload.

---

## Verification

- `npx tsc --noEmit` — clean
- `npx eslint` on all changed files — clean
- `npm run build` (production, webpack) — succeeds

The Jest suite could not be executed in the audit environment: the Next SWC
native binding is unavailable there, so all 24 suites fail to load before any test
runs. This is an environment limitation and says nothing about the suite itself.
