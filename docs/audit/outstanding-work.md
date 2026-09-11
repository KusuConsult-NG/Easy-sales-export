# Outstanding work

**Rewritten 2026-09-11 at `0ba8cd92`.** Every line below was checked against the
tree on that commit, not carried forward from the previous version.

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

### 🔑 Set `CRON_SECRET` and `PRODUCTION_URL` as repository secrets

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

### ☐ Interaction paths through multi-step flows

Everything above tests a screen's **first** state. What happens when someone
clicks *through* the loan wizard, checkout, or KYC is covered only where a
specific test already exists. This is the largest remaining UI gap and the next
thing I would build.

### ☐ Three placeholder cards on `/help` that lead nowhere

Community Forum and two siblings have `link: "#"`. The file's own comment notes
that an inert card which looks clickable is a defect this audit removed
elsewhere, and left these as a content gap. They should become a visibly
non-clickable "coming soon" state rather than looking like working links.

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

### ☐ Nigerian VIN length: 19 or 20 characters

`CivicStatusStep` and `KYCForm` both use `maxLength={19}`; `IdInput`'s
documentation mentions 20 for a Voter's Card. A factual question about the
document format, not a code defect — but if 19 is wrong, valid numbers are being
truncated at entry.

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
   callers). Three in one session.
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
