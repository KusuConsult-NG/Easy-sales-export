# Applying RLS (migration 004) to production

Four SQL blocks, in order, run in the Supabase SQL editor. Same place migration
025 was applied.

**What this closes.** RLS is currently off on all nine tables. The anon key is
public by design — it ships inside the JavaScript bundle — so anyone holding it
can read and write every row of `users`, `wallets`, `transactions` and
`processed_payments` directly against the Supabase REST endpoint, bypassing the
application and every permission check in it.

**Why it is safe.** RLS on with no policies denies the anon key everything. The
service role key, which is what every server action, API route and cron job uses,
bypasses RLS entirely and is unaffected.

---

## Pre-flight checks already done

Verified on this branch and on `origin/main`, which is what production runs:

- No `"use client"` file imports the anon Supabase client, `@/lib/firebase`, or
  `firebase/firestore`.
- `src/lib/supabase-client-db.ts` does query tables with the anon key, but it is
  **unreachable at runtime**: only `src/lib/firebase.ts` and the firestore shim
  import it, nothing imports `lib/firebase.ts`, and the only reference to
  `firebase/firestore` anywhere is a *type* import in `src/types/global.d.ts`,
  erased at runtime.
- The anon key is otherwise used only for `auth.signInWithPassword`, which goes
  to GoTrue, not PostgREST. RLS does not affect it.
- Realtime is explicitly disabled (`x-client-no-realtime`), so no subscription
  silently stops delivering rows.
- `src/app/actions/my-data.ts` — the Server Action replacements for the three
  polling hooks — exists on `origin/main`.

Verified empirically on a local stack configured exactly this way: RLS on all
nine tables, zero policies, and **360/360 browser tests, 2,436 unit tests and
119 DB integration tests all passing**. With the anon key, `users` and `wallets`
both return `[]`; with the service role, both return rows.

---

## 1. Pre-flight — confirm production has exactly these nine tables

Production's schema has diverged from the local one at least once (025 was
applied by hand), so confirm the target list before altering anything. **If any
row below is missing, stop** — an `ALTER TABLE` on a table that does not exist
aborts the transaction, and a table present in production but absent here would
be left without RLS while you believed it had it.

```sql
SELECT c.relname                AS table_name,
       c.relrowsecurity         AS rls_enabled_now,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies_now
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'users','cooperative_members','cooperative_loans','transactions',
    'processed_payments','marketplace_orders','wallets',
    'academy_applications','document_collections')
ORDER BY 1;
```

Expect **9 rows**, all with `rls_enabled_now = false` and `policies_now = 0`.

Also worth seeing what else is in production that this migration does not cover —
these stay unprotected and are a follow-up, not a blocker:

```sql
SELECT c.relname, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname NOT IN (
    'users','cooperative_members','cooperative_loans','transactions',
    'processed_payments','marketplace_orders','wallets',
    'academy_applications','document_collections')
ORDER BY 1;
```

## 2. Apply — STEP 1 only

`BEGIN`/`COMMIT` are included deliberately: all nine flip together or none do.

```sql
BEGIN;

ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cooperative_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cooperative_loans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets                ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_applications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_collections   ENABLE ROW LEVEL SECURITY;

COMMIT;
```

**Do NOT apply STEP 2 of the migration file.** Those per-user policies are
commented out on purpose. The app authenticates with NextAuth, not Supabase Auth,
so `auth.uid()` is NULL for browser requests and those policies would deny
everything while looking like they grant something.

## 3. Verify — the outcome, not the exit code

```sql
SELECT count(*) AS tables_with_rls
FROM pg_tables WHERE schemaname = 'public' AND rowsecurity;
```

Expect **9 or more**. A migration that enabled RLS on nothing would report
success and leave the database wide open, which is why this checks the result.

Then confirm the anon key is actually locked out. Run from a terminal, with your
production URL and the **anon** key (the public one, safe to use here):

```bash
curl -s "https://<project>.supabase.co/rest/v1/users?select=id&limit=1" \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
```

Expect `[]`. Anything else means a policy is present that should not be.

Finally, exercise the app: sign in, open a dashboard, load the marketplace. The
service role path is unaffected, so this should be uneventful.

## 4. Rollback, if anything misbehaves

Immediate and complete — it restores exactly the prior state:

```sql
BEGIN;
ALTER TABLE users                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE cooperative_members    DISABLE ROW LEVEL SECURITY;
ALTER TABLE cooperative_loans      DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions           DISABLE ROW LEVEL SECURITY;
ALTER TABLE processed_payments     DISABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_orders     DISABLE ROW LEVEL SECURITY;
ALTER TABLE wallets                DISABLE ROW LEVEL SECURITY;
ALTER TABLE academy_applications   DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_collections   DISABLE ROW LEVEL SECURITY;
COMMIT;
```

Rolling back re-opens the exposure, so treat it as a pause, not a resolution.

---

## The one residual risk

A user mid-session on an **older deployed bundle** that still queried Supabase
directly would start getting empty results until they reload. Bundles are
content-hashed and navigation fetches fresh HTML, so this clears itself on the
next page load, and it only applies if such a bundle was ever deployed. Applying
this at a quiet hour costs nothing and removes the question.

Everything after STEP 1 — the per-user policies of Option B, and RLS on the
tables listed by the second pre-flight query — is follow-up work, not part of
this change.
