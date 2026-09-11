# Outstanding work

**Rewritten 2026-09-11 at `0ba8cd92`; updated at `d846ec45`, `e10f19b5` and now
at `a3d179d5`.** Every line below was checked against the tree, not carried
forward.

**The cron change is verified, not assumed:** run 780 of Scheduled Jobs,
2026-09-11 12:30 UTC, `HTTP 200 {"success":true,"processed":0}` — the first
successful scheduled run since 22 August. See §1.

**Gate at this revision: build clean, 696 suites / 12,704 tests green.** The
version before this one said 12,474 across 680. A status document that
contradicts the repository is worse than none — it is read and believed — so
these numbers are re-read from a full run each time this file is touched.

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

## 1b. Since the last revision of this file (`e10f19b5` → `a3d179d5`)

Ten findings. Four are defects a member or an administrator could meet; four are
defects in this audit's own instruments, which matter because a broken
instrument reports "clean"; two are both.

| | |
|---|---|
| ✅ #633 | The support inbox listed every conversation and opened none. #356 fixed the gate and left the hand-written admin test on the two functions that decide what may be READ. |
| ✅ #634 | **A notification addressed to you was hidden from you.** A subscription filter stood between members and their own mail: escrow, dispute, export and land notifications were dropped for anyone without an active registration for that module — which is most of the people they are written to. Both badges agreed, on zero. |
| ✅ #635 | **The admin inbox listed doors it had locked.** The list and the opener kept two copies of the conversation rule and had drifted; the list's extra branch matched a module keyword inside a PARTICIPANT'S EMAIL, so private member-to-member threads were shown to a module admin, last message included, and then refused on click. |
| ✅ #636 | **Every certificate this platform prints named a page that does not exist.** The verifier is `/academy/verify/:id`; the screen footer, the PDF footer and CertificateGenerator all printed `/verify/:id`, which 404s. Measured against a built server. Certificates already in circulation are rescued by a permanent redirect. |
| ✅ #637 | **An open redirect on the registration form.** `router.replace(searchParams.get("callbackUrl"))` — Next 16 hard-navigates `//evil.example` off-site. #262 fixed the login form beside it; its ratchet swept for a guard written the WRONG way and could not see a door with no guard at all. Also: three cooperative links built `//onboarding` on the dedicated host. |
| ✅ #638 | The ownership scanner read PARAMETERS, so it could not see an id arriving in a request BODY. Over `src/app/api` it reported zero across 123 route files — a silence indistinguishable from a clean result. Repaired; still zero, now pinned at zero. |
| ✅ #639 | The same blind spot in `fake-guard-scan`, which had never been pointed at `src/app/api` at all. The vocabulary is shared now rather than corrected twice. Zero fake guards on both surfaces. |
| ✅ #640 | `module-sweep` composes three scanners: two were pointed at half the surface and the third was keyed on a field that does not exist, so its column had **never** fired. |
| ✅ #641 | **The withdrawal rate limit guarded the one door nobody uses.** "Very strict (financial security)" had a single consumer — a route with no callers — while the three screens a member presses had none. Each request debits savings, locks funds and queues admin work. |
| ✅ #642 | **The bank-account name oracle had a meter on one door and a turnstile on the other.** 10/hour on the action, 200/**minute** on the route asking Paystack the same question. |


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

### ✅ (#643) `lib/rate-limit.ts` no longer pools its routes into one budget

**Closed the same day it was recorded.** There are TWO rate-limiting modules:

| | |
|---|---|
| `lib/rate-limiter.ts` + `rate-limits.config.ts` | named buckets, each with its own key space. Repaired for exactly this. |
| `lib/rate-limit.ts` + `security.ts` | ONE generic bucket — `RATE_LIMIT_MAX_REQUESTS`, default 200/minute — under a single un-named prefix, applied by `withRateLimit` to **14 routes**. |

So MFA setup, file upload, QR verify, loan application and three KYC endpoints
all draw from one counter per user. `rate-limits.config.ts` documents this exact
failure in its own header — "every limiter built here shared one key per
identifier… a member was refused a withdrawal because they had used the app" —
and the repair reached one of the two modules.

`withRateLimit` takes a required route scope now, and so does the `rateLimit`
function beneath it — an optional parameter on the low-level call is a door the
pooling can come back through. Thirteen call sites across twelve routes, each
with its own key space; the typechecker named every one of them, which is what
made the change complete rather than partial.

It changes key spaces, not limits: no route became more restricted, they stopped
spending each other's budget. The scope enters the key on the **in-memory
fallback path as well as the Redis one** — which is the half that matters today,
because `UPSTASH_REDIS_REST_URL` is unset and the fallback is therefore the live
path.

### ☐ Two implementations of the Paystack bank-resolve call

#346 built `lib/bank-account-resolve` so callers would stop writing their own.
`actions/paystack.ts::verifyBankAccount` still writes its own `fetch`. Recorded
during #642 and deliberately not folded into it: the meter was what had a live
consequence, and the action's error strings are pinned by two suites, so
consolidating is its own read.

### ✅ (#644) The `api` bucket had no consumer because a SECOND table did

Triaged, and it was the more interesting of the two. **Twenty-two files import
`rateLimitConfig`. Twenty-one get the table of named buckets from
`lib/rate-limits.config.ts`; one — `lib/rate-limit.ts`, which guards twelve
routes — imported a completely different object of the same name from
`lib/security.ts`.**

So `api: 100 a minute` was the declaration a reader would find, and 200 was the
limit in force. Nothing connected them, and the identical identifier is what hid
it.

Resolved in the direction the evidence supports: the DECLARATION moved to match
what has been running. Halving a live limit on twelve routes because a number
nobody applied said so would be a behaviour change with nothing behind it. The
env overrides are kept and are now visible in the table where every other limit
is written down; `lib/security.ts` no longer exports the colliding name.

### ☐ The `webhook` bucket still has no consumer

1000/minute, declared, consumed by nothing. Not yet read. The webhook routes
verify a signature or a shared secret, so this may be the `kyc` story again — a
bucket waiting for something — or a limit somebody meant to apply.

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

   **This class produced four findings of its own in #638–#640**, all in the
   audit's own tooling, all with the same signature: a scanner reporting ZERO
   over a surface it could not read. The repair each time was to point it at a
   known-bad sample first and only then believe its answer about the tree.

7. **A surviving mutant is a question about the TESTS before it is a question
   about the code.** Three findings running (#638, #639, #641/#642) had a mutant
   survive that turned out to be a missing case or an under-stated property, not
   a redundant rule. Each one made the assertion stronger rather than being
   explained away.

---

## 5. Read, and deliberately not acted on

Recorded so nobody re-reads them, and so that "no finding" is a measurement.

| | |
|---|---|
| `module-sweep` MONEY leads | 66 leads over 654 entries. The route ones were read in #640 — a webhook signature, two cron secrets, two public routes, two cooperative money routes. ~50 remaining are the `MONEY`-with-no-role-check class: a member moving their OWN money, which is the largest documented false-positive class this sweep has. Not individually read. |
| `_confirmWalletFundingAction` | No session, correctly: the authority is the payment. Verified against Paystack, amount taken from what was actually charged, `creditWalletOnce` claims the reference atomically so a replay answers "already processed". |
| `joinVillageMarketEventAction` | `eventId` is caller-supplied and addresses the event; the value written is the session's own id, and the caller's seller status is checked first. No ownership question to answer. |
| `rateLimitConfig.kyc` | Unwired on purpose while `IDENTITY_PROVIDER === 'none'`, with a conditional ratchet (#642). |
| `/api/cooperative/withdraw` | No in-app caller, kept anyway — it may serve a client this repository cannot see. Pinned so a caller appearing is noticed (#641). |
| 107 orphan symbols | Six triaged, one real (#629). Most of the rest are deliberate decisions with their reasons already written down. Falling return. |
| A pending-queue sweep that did not work | Asked "which collections are written with a pending status and mentioned by no ADMIN file". Ten leads; the five checked were all false positives, because most pending work in this platform is resolved by MEMBER and SELLER screens (land inquiries at `/farm-nation/inquiries`, quotes at `/marketplace/seller/quotes`) and the actions behind admin screens live in files whose paths do not say "admin". The premise was wrong, not the code. Recorded so nobody rebuilds the same sweep: the useful version asks whether a reader is reachable from a rendered screen, which is a call-graph question. |
