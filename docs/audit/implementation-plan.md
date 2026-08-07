# Implementation Plan

Ordered by risk, lowest first. Each phase is independently deployable and
independently revertible. Do not start a phase before the previous one has been
live and stable for a few days.

**Assumption:** nobody is available to debug a broken deploy quickly. Every
decision below favours "safe and slower" over "complete and faster."

---

## How anything gets deployed

This is the bottleneck, so it comes first.

1. **Grant write access** to the Claude GitHub App at
   https://claude.ai/admin-settings/claude-in-slack — find `Easy-sales-export`,
   change read → write. This is a settings toggle, not a technical task.
2. I push the branch and open a pull request.
3. You press **Merge** on GitHub.
4. Railway deploys automatically from the default branch.

Until step 1 happens, nothing in this plan can reach your site. The work exists
only in this session and in the `easy-sales-export-audit.bundle` file.

**Before the first merge:** confirm Railway is set to deploy from the default
branch, and note the current deployment so it can be rolled back to. In Railway,
a previous deployment can be redeployed from the Deployments tab — that is your
undo button for every phase below.

---

## Phase 0 — Preserve evidence *(do today, no code involved)*

Nothing here changes the app. Do it before any deploy, because some of it
expires.

- [ ] Supabase → Authentication → Users → **Export**. Save the file.
- [ ] Supabase → Database → **Backups**. Record what exists and the retention.
      If point-in-time recovery is available, note the earliest recoverable time.
- [ ] Supabase → SQL Editor → run and record:
      ```sql
      select count(*) as profiles from public.users;
      select count(*) as logins from auth.users;
      select count(*) as soft_deleted from public.users
        where raw_data->>'deleted' = 'true';
      ```
- [ ] Download `easy-sales-export-audit.bundle` and the audit documents.

---

## Phase 1 — The completed fixes *(ready now, low risk)*

Twenty defects, already fixed, verified by a clean type-check, a clean
production build and 323 passing tests. Payments, uploads, saving records, the
notification bell, financial totals, authentication.

**Risk: low.** These repair paths that currently throw or silently discard data.

**One deliberate exception.** Database read errors used to be reported as
"record not found." They now surface as real errors. If your production
database has a persistent fault, pages that currently render empty will start
showing errors instead. That is the intended behaviour — silently wrong is
worse than visibly broken — but it is the one change that could look like a new
problem on the first deploy.

**Verify after deploy:** sign in; open the dashboard; open the notification
bell; upload a product image; make a small cooperative contribution and confirm
it is recorded.

**If it goes wrong:** redeploy the previous Railway deployment.

---

## Phase 2 — Close the database security hole *(highest value, needs care)*

Anyone can currently read and write your entire database without signing in.
This is the most serious outstanding finding.

It cannot be fixed in one step, because switching the protection on while the
browser still queries the database directly would take your dashboard offline.
Two deploys, in this order:

### 2a — Move browser database access to the server *(behaviour-preserving)*

Seven components query the database straight from the browser. Each moves to a
server-side function instead. Nothing visible changes; the same data appears in
the same places, fetched a different way.

Affected: dashboard, notifications page, sidebar (×2), dashboard navigation,
admin finance page, cooperative withdrawals page.

**Risk: medium.** Contained — if one screen breaks it is obvious immediately,
and only that screen is affected.

**Verify:** every affected screen still shows the same numbers as before.

### 2b — Turn on row-level security

Once nothing queries the database from the browser, the public key can be
locked out entirely. The migration is already written and reviewed:
`supabase/migrations/004_enable_row_level_security.sql`.

**Risk: low once 2a is confirmed working** — because by then nothing depends on
that key.

**Verify:** this command must return an empty list, not user records:
```bash
curl "https://YOUR-PROJECT.supabase.co/rest/v1/users?select=*" -H "apikey: YOUR-ANON-KEY"
```

**If it goes wrong:** the migration file ends with a rollback section. Running
it restores the previous state immediately.

---

## Phase 3 — Make money operations safe *(needs your input)*

Wallet top-ups and cooperative payments use a "transaction" that is not
actually atomic: it reads, then writes, with no locking. Two requests arriving
together can both pass the "already processed?" check and both credit the same
wallet. Reloading a payment confirmation page twice is enough to attempt it.

The fix is a database function that claims the payment reference and credits
the balance in one indivisible step. I can write it.

**Before I do, I need to know:** has anyone reported being credited twice, or
have you seen duplicate wallet top-ups? That changes whether this is urgent
repair or preventive work.

**Risk: medium.** It touches money handling, so it wants careful checking on a
copy of the database first.

---

## Phase 4 — The loan system *(blocked on your decision)*

Three separate loan implementations write to one shared place with different
rules. The one your customers actually use records **no interest rate and no
repayment period**, so those borrowers have an empty repayment schedule —
nothing to pay back. Another would charge roughly twelve times the advertised
rate.

**I will not guess at this.** Tell me:

1. What interest rate do you actually charge?
2. Over what maximum period?
3. How much can a member borrow relative to their savings?
4. Is the collateral-based "business loan" at `/loans/apply` a real product, or
   left over from an earlier design?

With those four answers I can make one implementation correct and switch off
the others. Without them, any change I make could alter real customers' loan
terms.

---

## Phase 5 — Stop the slow degradation *(low urgency, steady value)*

409 of 510 database reads fetch entire tables with no limit. Nothing fails
today; everything gets slower as data grows, until pages time out. This is the
clearest explanation for "it works, then breaks eventually."

Fixing it means deciding, per screen, how many records it should show. Best
done a few screens at a time, worst offenders first: the admin users list,
academy applications, marketplace listings.

**Risk: low per screen, but each change alters what that screen displays**, so
each wants a look before merging.

---

## Phase 6 — Prevent recurrence *(do once the above is stable)*

The root cause of nearly every defect found: the database layer has no type
definitions, so the compiler cannot check it. Your app builds cleanly with all
of these bugs present.

Adding proper types to the two database files means this class of defect fails
the build instead of reaching customers. It is unglamorous and it is the single
highest-value long-term change on this list.

Also worth doing: delete the six unused code packages, and remove the two
scripts that can delete users (now guarded, but better gone).

---

## What I cannot do

Stated plainly so you are not waiting on me for these:

- **Deploy anything.** I have no access to Railway or your GitHub settings.
- **Read your production database.** Every diagnosis depends on numbers you run.
- **Restore push notifications.** They have never worked, and restoring them
  needs a paid notification service chosen by you.
- **Verify against real customer data.** I can prove code paths are correct in
  principle; only a real deploy proves they work with your actual data.
