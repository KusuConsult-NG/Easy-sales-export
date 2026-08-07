# Staging setup

Standing up a second Supabase project so database migrations can be tested
before they touch the ~41,000 live users.

Time: roughly 30–45 minutes. Everything here happens in your Supabase account —
none of it can be done from the repo alone.

---

## First decision: do NOT copy production data

The instinct is "restore a production backup into staging". Don't, for three
reasons:

1. **Privacy.** Production holds ~41,000 real users — bank details, passport
   photos, phone numbers. Copying that into a second database doubles the number
   of places a breach can happen, and doubles what a GDPR erasure request has to
   reach. This repo already runs a GDPR purge cron; a shadow copy silently
   defeats it.
2. **It is not one click.** Supabase has no cross-project restore. It means
   `pg_dump` / `pg_restore`, and neither `psql` nor the `supabase` CLI is
   installed on this machine.
3. **It is not needed for what we are testing.** Migrations `004`, `005` and
   `006` change schema and functions, not data. They need representative
   *structure* and a handful of rows, not 41,000 real ones.

Use `supabase/schema.sql` plus the seed scripts instead.

**The honest trade-off:** production data would catch data-shape surprises that
seeded data will not — RLS behaviour at real row counts, or the timestamp-shape
mismatches the audit already found. If you later need that, anonymise on the way
out (scramble names, emails, phones, bank details) rather than copying raw.

---

## 1. Create the project

Supabase dashboard → **New project**.

- **Name:** `easy-sales-export-staging`
- **Region:** same as production (US West) so behaviour matches
- **Database password:** generate a strong one and store it in your password
  manager — you cannot retrieve it later
- **Plan:** Free is fine for this

Wait for provisioning (~2 minutes).

## 2. Apply the schema

SQL Editor → **New query**. Paste the entire contents of `supabase/schema.sql`
and run it.

Verify — expect 9 rows:

```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
```

Then apply the earlier migrations in order, each as its own query:

- `supabase/migrations/002_jsonb_merge_update.sql`
- `supabase/migrations/003_atomic_profile_sync.sql`

## 3. Collect the credentials

Project Settings → **API**:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

The service_role key bypasses RLS entirely. It belongs in server-side
environment variables only — never in anything prefixed `NEXT_PUBLIC_`.

## 4. Rewrite .env.staging

The current file is stale: it holds Firebase configuration the audit removed and
defines no Supabase variables at all. Replace it.

```bash
NEXT_PUBLIC_APP_ENV=staging
NODE_ENV=production

# Supabase — the STAGING project, never production
NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging anon key>
SUPABASE_SERVICE_ROLE_KEY=<staging service_role key>

# Paystack — TEST keys. See the warning below.
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_...
PAYSTACK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_PAYSTACK_LIVE_MODE=false
PAYSTACK_WEBHOOK_SECRET=<staging webhook secret>

NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<generate a fresh one, do not reuse production's>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> **Use Paystack TEST keys.** Staging exists to exercise payment flows. Pointed
> at live keys, testing a wallet top-up charges a real card and moves real
> money. `pk_test_` / `sk_test_` and `LIVE_MODE=false`.

> **Generate a fresh `NEXTAUTH_SECRET`.** Reusing production's means a session
> minted in staging is valid in production.

Confirm `.env.staging` is git-ignored before you put any key in it:

```bash
git check-ignore -v .env.staging   # must print a matching rule
```

## 5. Seed some data

```bash
cp .env.staging .env.local.bak-check   # keep a note of which env you are on
npm run seed
```

Then create one account through the app's own signup so you have a user with a
real session, rather than a seeded row.

---

## 6. Test the wallet migrations (005 and 006)

Apply in order, each as its own SQL Editor query:

- `supabase/migrations/005_atomic_wallet_operations.sql`
- `supabase/migrations/006_wallet_ledger_corrections.sql`

Confirm all three functions exist:

```sql
SELECT proname FROM pg_proc
 WHERE proname IN ('credit_wallet_once', 'debit_wallet_once', 'debit_wallet_locked');
```

**Prove idempotency** — the property the unit tests cannot cover:

```sql
SELECT * FROM credit_wallet_once('test-ref-1', 'test-user', 100);  -- expect t, 100
SELECT * FROM credit_wallet_once('test-ref-1', 'test-user', 100);  -- expect f, 100
```

Second call returns `claimed = false` and the balance stays 100. If it returns
200, idempotency is broken — stop and investigate.

**Prove debits are not counted as revenue** (the regression fixed in #4):

```sql
SELECT * FROM debit_wallet_once('test-debit-1', 'test-user', 40);
SELECT raw_data->>'status' FROM processed_payments WHERE id = 'test-debit-1';
-- expect 'wallet_debit'. If it says 'completed', revenue is being inflated.
```

**Prove the overdraft guard:**

```sql
SELECT * FROM debit_wallet_locked('test-user', 999999);
-- expect f, 60, insufficient_funds
```

Clean up:

```sql
DELETE FROM processed_payments WHERE id LIKE 'test-%';
DELETE FROM wallets WHERE id = 'test-user';
```

**The concurrency test the unit tests cannot do.** Open two SQL Editor tabs and
run this in the first:

```sql
BEGIN;
SELECT * FROM debit_wallet_locked('test-user', 50);
-- do not commit yet
```

In the second tab, run the same statement. It should **block**, waiting on the
row lock, until you `COMMIT` or `ROLLBACK` the first. That blocking is the whole
point of the fix — it is what `runTransaction` never did.

## 7. Test RLS (004)

Apply `supabase/migrations/004_enable_row_level_security.sql` — **STEP 1 only**,
policies left commented out.

Confirm every table has RLS on:

```sql
SELECT tablename, rowsecurity FROM pg_tables
 WHERE schemaname = 'public' ORDER BY tablename;
```

Confirm the anon key can read nothing:

```bash
curl "$STAGING_URL/rest/v1/users?select=*" -H "apikey: $STAGING_ANON_KEY"
```

Expect `[]`. Rows coming back means RLS is not doing its job.

Then exercise the app against staging and watch for **empty** screens rather
than errors — RLS with no policy returns zero rows, it does not raise:

- sign in
- dashboard
- notification bell and unread badge
- wallet balance
- academy and wave dashboards (membership status)
- the four onboarding pending pages
- admin portal

If a member shows as not-a-member, or a count sits at zero, a browser reader was
missed. `grep -rn "from ['\"]@/lib/supabase['\"]" src/` should show only
`supabaseAdmin`.

---

## 8. Then production

Only after all of the above passes:

1. Settle the Railway subscription (deploys are currently blocked, and the
   dashboard warns about service disruption).
2. Apply `005` and `006` to production **before** deploying — `wallet.ts` on
   `main` calls those functions, and deploying first breaks funding, checkout
   and withdrawals.
3. Apply `004` in a low-traffic window, with the rollback at the bottom of the
   file to hand.
4. Deploy via `deploy-production.yml`, not by re-enabling auto-deploy.

Re-enable Railway auto-deploy afterwards only if you want it — "Wait for CI" is
now on, so it would at least refuse to ship a failing build.

---

## Keeping staging honest

- Seed data drifts from production shape over time. Re-run `schema.sql` and the
  migrations whenever a new one lands.
- Never point `.env.local` at production again. That is how local development
  ended up one command away from live data.
- Every future migration goes here first. That is the entire point.
