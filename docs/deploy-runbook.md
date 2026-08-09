# Deploy runbook

How to get the work currently sitting on `main` in front of users, in an order
that cannot half-apply.

As of 2026-08-08 production runs `e84006b`, sixteen days old. Everything below
is merged and unshipped.

---

## Before anything: the two blockers

**Railway is unpaid.** Deploys are blocked and the dashboard warns about service
disruption. Nothing here can ship until that is settled.

**PR #13 is unmerged**, and `main`'s migration set has a hole because of it:

```
002 003 004 005 006 007 008 009  ⟶  012 013 014
                            ↑
                    010 and 011 live in PR #13
```

`011` corrects the wallet functions in `005`/`006`, which as merged update a
column the application never reads — so wallet credits are currently invisible.
`010` makes `FieldValue.increment` atomic.

`scripts/build-deploy-sql.mjs` refuses to build while either is absent. That is
deliberate: a partial application is worse than none, because the code on `main`
calls functions those files create.

---

## 1. Build the SQL

```bash
npm run build:deploy-sql          # writes deploy.sql
```

It concatenates every migration in application order and appends a verification
block. It is generated, never hand-edited — regenerate after any migration
changes.

Three orderings are not optional, and the generator encodes them:

| Rule | Why |
|---|---|
| `013` before `014` | `014` replaces the function `013` creates, to add nested-path support. Reversed, that support silently disappears. |
| `005`/`006` before `011` | `011` corrects both to write the value the application actually reads. |
| `004` last | Row-level security. Its failures are silent — empty rows, not errors. |

There is a fourth dependency the generator cannot enforce, because it spans code
and schema:

> **`010` must not be applied ahead of the code that guards it.** Making
> increments atomic makes several unguarded checks *worse*: concurrent credits
> previously lost one another, which accidentally masked duplicates. PRs #22,
> #23 and #27 add those guards, and they are all on `main`. So applying `010`
> now is correct — but only because that code ships in the same deploy. Do not
> apply the SQL and postpone the deploy.

---

## 2. Rehearse on staging

Apply `deploy.sql` to the staging project first, then:

```bash
npm run test:db
```

29 integration tests run against the real database. They are the only checks
that exercise the adapter rather than a mock, and they exist because two defects
this month passed unit tests, review and a manual staging check — every one of
which queried the same column the bug was writing to.

Run the verification block at the end of `deploy.sql` too. Two items in it
matter most:

- **`debit_jsonb_balance` on a nested path.** If it errors, `013` was applied
  after `014`.
- **A wallet credit moving BOTH copies of the balance.** If the native column
  moves and `raw_data` does not, `011` was skipped and credits are invisible.

---

## 3. Apply to production

Only after staging is green.

1. Confirm the project in the Supabase SQL Editor. These statements create
   functions and enable RLS on whatever database they are pasted into.
2. Paste `deploy.sql`, run once, top to bottom.
3. Run the verification block.
4. Run the anon-key curl from a terminal — the SQL Editor runs as `service_role`
   and bypasses RLS, so it **cannot** tell you whether RLS works:

   ```bash
   curl "$SUPABASE_URL/rest/v1/users?select=*" -H "apikey: $ANON_KEY"
   # expect []
   ```

Do step 4 in a low-traffic window and keep the rollback at the bottom of
`004_enable_row_level_security.sql` to hand.

---

## 4. Deploy the code

Via the gated workflow, not by re-enabling Railway auto-deploy:

```
Actions → "Deploy — Production (Manual Gate)" → Run workflow
```

It asks for a release version and three typed confirmations. It has never been
run; Railway auto-deploy was disabled on 2026-08-07 and "Wait for CI" enabled,
so `main` reaching production is now a deliberate act.

**Migrations before code.** `wallet.ts` and the payment paths call functions
that do not exist in production yet. Deploying first breaks wallet funding,
checkout, withdrawals and every Paystack fulfilment path.

---

## 5. Watch for silence, not errors

The failure modes introduced by this work are quiet. In the hour after deploy:

- **Members reported as non-members.** RLS returning zero rows rather than
  raising. Check the academy and WAVE dashboards, the notification bell.
- **Balances that do not move.** A wallet credit landing somewhere the app does
  not read.
- **Payouts that do not happen.** A claim lost where nothing logged it.

Every one of those looks like a quiet day rather than an outage, which is why
they need looking for rather than waiting for.

---

## Not covered by any of this

Four things are recorded in `docs/audit/atomic-money-migration.md` as needing a
person rather than a deploy:

1. **Loan approval dual control can be bypassed** — two admins approving at once
   can both become `firstApprover`. A security control on lending.
2. **`arrayUnion`/`arrayRemove` are still not atomic** — 38 sites, same class as
   the increment bug, blocked behind PR #13.
3. **Training events can be overbooked** — capacity checked then incremented.
4. **Farm-nation listings stuck at `"verified"`** — each is a property nobody
   can buy. Fixable with one UPDATE today, independent of any deploy.
