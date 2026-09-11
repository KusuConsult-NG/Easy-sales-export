# Outstanding work

**Rewritten 2026-09-11 at `0ba8cd92`, updated the same day at `d846ec45`.**
Every line below was checked against the tree, not carried forward.

**The cron change since then is verified, not assumed:** run 780 of Scheduled
Jobs, 2026-09-11 12:30 UTC, `HTTP 200 {"success":true,"processed":0}` — the
first successful scheduled run since 22 August. See §1.

The version this replaces was last updated 2026-08-14 and said "2,058 tests
passing". There are now **12,474 across 680 suites**, build clean. A status
document that contradicts the repository is worse than none — it is read and
believed — so it was replaced rather than appended to.

Gate for every item marked done: `npm run build` then `npm run test`, green, with
the change mutation-tested against a control.

---

## How to read this

| Mark | Meaning |
|---|---|
| ✅ | Done, on `main`, with tests |
| ☐ | Open, and doable in this repository |
| 🔑 | Open, and **needs a credential or dashboard nobody in this repository has** |

The 🔑 items are the only ones that are not mine to finish. Everything marked ☐
is mine.

---

## 1. Server and operations — the highest-stakes column

### 🔑 Rotate the Paystack `sk_live_` key — still exposed

A live secret key was committed in `scripts/force-sync.js` and is **still
recoverable from git history** (added in `c767ff8e`, removed in `a57f5e95`).
Deleting the file did not remove it. Anyone who has ever cloned the repository
has it.

Rotating is the only fix. Rewriting history does not help once a clone exists.
Rotate and update the deployment environment **in the same sitting** — the old
key dies the moment the new one is issued, so a gap is an outage.

✅ Prevention is in place: `gitleaks` runs in CI on a pinned action SHA
(`.github/workflows/ci.yml`), with `.gitleaks.toml` configured. No secret is
tracked in the working tree today — verified by scan.

### 🔑 Rotate the Supabase keys and the Railway token

Both appeared in an assistant transcript during this audit. Not committed
anywhere, but treat them as disclosed.

**Do not rotate `MFA_SECRET_KEY`.** It encrypts users' recovery codes at rest;
rotating it destroys them.

### ✅ The scheduled jobs are running again — verified

**This item was wrong when it was written, and the correction is the finding.**

It said the two secrets were unset. They were not: the workflow's "Check
required secrets" job exits 1 if either is empty and had SUCCEEDED on every
run. The owner said so; the Actions history agreed with the owner.

What had actually been failing was the call after it — 779 times, ending
2026-08-22 — and every one of those runs printed

    /api/cron/process-email-queue returned HTTP 404

which reads as a missing route. The body said otherwise and nobody was
reading it: `{"status":"error","code":404,"message":"Application not
found",...}` is the HOSTING PLATFORM's error page. There was no app at the
address the secret then held. The response at the time was to comment the
schedule out, which silenced the alarm rather than answering it.

Two fixes came out of that, and then the proof:

  #631  the workflow now says WHICH of three things failed — nothing deployed
        at that host, the secret refused, or the app 404ing its own route.
        Three different people, three different actions.
  #632  a 3xx is now a failure. The check was `-ge 400`, and a redirect is
        not, so a redirect made the step PASS while the endpoint was never
        invoked. One character — the apex instead of `www` — was enough to
        make eight jobs report green for ever while doing nothing.

  VERIFIED  run 780, 2026-09-11 12:30 UTC, `HTTP 200
            {"success":true,"processed":0}`. First success since 22 August,
            and a genuine 200 rather than a redirect counted as one.

Nothing further is needed here. The other seven jobs fire on their own crons.

### 🔑 (superseded) Set `CRON_SECRET` and `PRODUCTION_URL` as repository secrets

✅ **The schedule itself is now on** (#623). It had been commented out, which
left eight jobs idle — escrow auto-release, Paystack reconciliation, fulfilment
reconciliation, the email queue, GDPR purge, export-window closing,
stale-reservation release, notification ageing.

With the block live, setting these two secrets is the **only** remaining step;
nobody has to remember to come back and edit YAML. Until they are set:

- a scheduled run annotates a warning and skips — calls nothing, fails nothing
- a **daily** config check fails loudly naming what is missing
- a manual run fails hard, because a person is waiting on it

### 🔑 Set `UPSTASH_REDIS_REST_URL` / `_TOKEN`

Without them every rate limiter and cache uses a **per-instance in-memory
fallback that does not share state between server instances**.

✅ The code already handles this properly and says so loudly: a one-time warning
at module load, an honest `isRedisConfigured` flag that callers check, and a red
**Disconnected** tile on `/admin/system-health`. No code work is outstanding —
only the credentials.

### 🔑 Confirm migration `034_user_segment_counts_widened.sql` is applied

33 migrations are in `supabase/migrations/`. Whether the production database has
them cannot be determined from here.

### 🔑 Confirm what production is actually serving

If the deployed build predates this branch, everything below is academic. This
cannot be checked from inside the repository.

### 🔑 Two decisions with no code consequence until made

- **MFA enforcement for admin accounts** — the machinery exists; whether it is
  mandatory is a policy call.
- **Paystack reference `s9ib3feavh`** — flagged during an earlier reconciliation
  and never searched in the Paystack dashboard.

---

## 2. UI

### ✅ Done

| | What is now guaranteed |
|---|---|
| ✅ | **Chrome on all 247 routes** (#619). No screen wears two navigations. Found `/loans/approve` wearing both — the admin sidebar *and* the global member one — which was my own #617 fix reaching one of two doors. |
| ✅ | **All 127 client screens render under a failing read** (#620). Either they show something or they navigate away; never a white page. Found the admin course manager rendering literally nothing when its read threw. |
| ✅ | **All 120 server screens** (#622). Render, redirect, `notFound()`, or throw into a boundary — never null. No defects found. |
| ✅ | **Every route has an error boundary above it** (#622), proven by deleting a real one and watching the assertion fire. |
| ✅ | **Dead internal links** — covered by three pre-existing suites. |

### ✅ Interaction paths — nine of nine flows

Everything above tested a screen's **first** state. These test what happens when
somebody uses it. All nine multi-step flows are covered, three ways:

| | |
|---|---|
| #625 | **arriving** — a saved draft outside the step range left the WAVE application with ZERO buttons, and reloading restored the same dead step. Four flows; guarded once in `lib/draft-step`. |
| #626 | **advancing** — `CivicStatusStep.validateForm` was `setErrors({}); return true`, a check that could not fail, in the step that collects the NIN. Plus three steps that crashed outright on a missing list. |
| #627 | **going back** — two steps declared `onChange` and never called it, so everything typed on them was discarded by Back, silently, and was not in the draft either. |
| #630 | seller verification let you through all four steps empty, then refused the whole thing with "Missing required fields", naming none of eleven. |

Checked and sound, recorded so the absence of a finding is a measurement:
cooperatives onboarding, academy application, the loan wizard, the onboarding
tour. Double-submit was checked across six flows and is correctly guarded
everywhere.

### ✅ (#628) Three placeholder cards on `/help` that led nowhere

They rendered as `<Link href="#">` inside a hover-lifting card and did nothing.
Nothing is deleted — the intent to write those pages is real — but a resource
with no destination is now plain text marked "Coming soon", with no anchor for a
keyboard to land on and then ignore.

### ☐ `out_of_stock` presentation

A product with this status currently vanishes from the marketplace instead of
showing as unavailable. **Nothing writes the status today**, so it is latent and
harmless.

✅ #624 made the visibility rule real, so finishing this is now one line in
`PRODUCT_VISIBLE_STATUSES` **plus** the card and checkout saying "out of stock"
and refusing the purchase. Both halves must land together: adding the status
alone would make an unfulfillable listing *purchasable*, which is worse than
hiding it, and it moves money.

---

## 3. Backend

### ✅ Done

| | What was wrong |
|---|---|
| ✅ | **#618** — the admin module silo hid sidebar links and guarded nothing. Typing the URL was enough. Enforced in middleware now. The first draft of that fix would have locked `moderator` and `support` out of the whole portal in an infinite redirect; caught before shipping. |
| ✅ | **#621** — a seller's public storefront said "not found" whenever the read failed, collapsing 400/404/500 into one `notFound()`. Because that serves HTTP 404, a database blip could tell crawlers a trading seller's shop was permanently gone. |
| ✅ | **#623** — `finance:refund` was declared, held by super_admin alone, and gated no door; both real refund paths asked a different permission. The declaration now matches the code, with no change to who can refund. |
| ✅ | **#624** — `PRODUCT_VISIBLE_STATUSES` was consulted by nothing; fifteen hand-written copies decided what buyers see. All fifteen ask the rule now, with the value unchanged. |

### ✅ (#628) Nigerian VIN length — no longer a question that needs answering

Both fields capped input at 19 beside a placeholder of `90F5B123456789012345`,
which is TWENTY characters: **the field could not accept its own example**, and
with `showCount` on, a member watched the counter stop at 19/19.

`kyc-validators` had already decided against a ceiling — "a rule that refuses a
real member is worse than the defect it fixes" — and the two inputs kept one
anyway. The cap is gone; the floor, the alphanumeric rule and the
repeated-character rule all remain. The true length is still unknown and no
longer matters: the field accepts either, and the one place to add a ceiling is
named in `kyc-validators`.

### ☐ Module apex domains have no apex → www redirect

`middleware.ts` records it: five module apexes have `www` variants in
`DOMAIN_MAP` but no redirect from the bare apex. Whether they should have one
depends on their DNS.

---

## 4. Recurring defect classes this audit keeps finding

Listed because the next defect is more likely to be one of these than something
new, and because two of them were found in **my own work** during this session.

1. **A declared rule that nothing consults.** #618 (silo drew links only), #623
   (`finance:refund` gated nothing), #624 (`isVisibleProductStatus` had zero
   callers), #629 (`isDisputeSettled`, whose docstring called itself "the rule
   the screens and the guards share"). Four in one session.

   **The sweep for the rest came back mostly clean, and that is the useful
   result.** Every value export under `src/lib` was counted against every
   reference in the application — 1,047 exports, 108 that nothing mentions — and
   the security- and status-shaped ones were triaged by hand:

   | | |
   |---|---|
   | `isDisputeSettled` | REAL. Fixed in #629. |
   | `isSettledEscrowStatus` | The sibling checks mean something else — routing two statuses to dedicated actions, deliberately excluding a third. |
   | `ORDER_TERMINAL_STATUSES` | The hand-written `delivered \|\| completed` means **fulfilled**, not terminal. Folding in `cancelled` would offer a review on a cancelled order. |
   | `DECISION_LOCKED_STATUSES` | Documents in its own header why it is declarative and not the guard. |
   | `lib/permissions.ts` | Settled in **#353** — a known second, incomplete matrix, deliberately kept, with `one-permission-authority` as its ratchet. |
   | `requireAdminPermission` | An unused convenience wrapper. No correctness consequence. |

   Six checked, one real. Most of the 108 are deliberate decisions with their
   reasons already written down, so the remaining list is **not** a backlog of
   107 defects — and grinding through it one at a time has a falling return.
2. **The fix reached one of N doors.** #619 found #617 doing exactly this, one
   commit later.
3. **"Could not tell" rendered as "no".** #620 (blank page), #621 (500 shown as
   404).
4. **Two hand-maintained copies of one contract.** Found in the sweep stubs
   themselves (#622).
5. **A check that cannot fail.** A mutant that deletes an assertion always
   survives — relearned six times here. The repair is always the same: turn the
   assertion into a named function and ask it questions with known answers.
6. **Audit the instrument before believing the measurement.** One sweep reported
   47, then 121, then 57 "defects", every one of them a fault in the probe. Had
   any been believed, they would have been reported as application bugs.
