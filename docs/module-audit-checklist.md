# Module audit — checklist and execution plan

Derived from the defects actually found and fixed in WAVE (#814, #822, #824–#837).
Every item below is here because it was a **real defect on a live screen**, not
because it is good practice in general.

**Rule for this work: one module at a time.** Each module is its own commit, its
own gate run, and its own push. Nothing is batched, because the value of the
module-by-module order is that a regression is attributable to one change.

---

## A. The checklist

Run every module through all six sections. An item is ticked only when it has
been **executed and proved**, not when the code looks right — see §C.

### A1 · Counting: is the number the thing it is labelled?

- [ ] **A1.1 — The population is counted, not the detail table.**
  `<MODULE>_APPLICATIONS` holds the long form, and only for the route that
  writes one. The register of who applied is
  `serviceRegistrations.<module>.status` on the user, which every enrolment path
  maintains — including `_legacy.ts`. Use `countModuleApplicants()`.
  *WAVE read 716 for a programme of ~15,130.*

- [ ] **A1.2 — Role-holders with no registration object are counted.**
  An account can hold `<module>_participant` with no `serviceRegistrations`
  entry. `countModuleApplicants` unions both signals.
  *This is the population #835 began with.*

- [ ] **A1.3 — The register is only trusted when it is complete.**
  `registerIsUsable()` — prefer the register only when it is at least as large
  as the detail collection, else keep the module's own counts and flag it.
  *`applicants.total ?? detailCount` reported 0 against 5 real applications,
  because `??` does not fall back on zero.*

- [ ] **A1.4 — Counts are exact, not array lengths.**
  `.count()` is a real `count: 'exact'`. `rows.length` after a `.get()` silently
  caps at `DEFAULT_QUERY_LIMIT` (5,000).

- [ ] **A1.5 — Any sweep that feeds an aggregate uses `.all()` and reports
  `truncated`.** A `.get()` behind a total is a time bomb that is invisible
  until the collection crosses 5,000 rows.

- [ ] **A1.6 — No double counting.** Check the two overlap traps:
  dual-spelling keys (`cooperative`/`cooperatives`, `farmNation`/`farm_nation`
  are written to the **same** user) and multi-role modules (a marketplace trader
  holds `buyer` **and** `seller`). Use inclusion–exclusion or
  `array-contains-any`, never a sum.

- [ ] **A1.7 — Status buckets are exhaustive.** `approved + pending + rejected +
  revisionRequired + other === total`. A status nobody anticipated lands in
  `other` and stays visible instead of deleting the person from the funnel.

- [ ] **A1.8 — The status vocabulary comes from
  `lib/module-registration-status.ts`.** Do not write a second list. One was
  written for #835 and drifted from the canonical one within the same commit.

### A2 · Honesty: does the screen say only what was measured?

- [ ] **A2.1 — A failed read is `null`, never `0`.** Render via `statText()` /
  `statMoney()`: a figure, `—` for not-yet, `Unavailable` for failed.
  *Zero is a plausible answer, so nobody questions it.*

- [ ] **A2.2 — No figure is invented.** No hardcoded stats, no defaults standing
  in for measurements. *#829 removed a fabricated ₦80.5m ledger naming five real
  institutions; a repayment rate defaulted to 85.*

- [ ] **A2.3 — No claim is made about what a record's absence means.** A count
  that cannot see a record is evidence about **the query**, never about the
  person. *"14,655 without an approved application" was false.*

- [ ] **A2.4 — Derived breakdowns declare their basis.** If a chart is drawn
  from a subset, say the numerator and denominator.

- [ ] **A2.5 — Every tile's label matches what it counts.** "Total" invites the
  reading "the whole programme". If it counts one table's rows, name it for
  that.

- [ ] **A2.6 — Things of different kinds are not summed.** *A briefing sign-up
  (an event register) was a slice of "Registrations by Module" and part of its
  denominator.*

- [ ] **A2.7 — An empty list distinguishes "none" from "failed to load"**
  (`ListLoadFailed`), including when `Promise.allSettled` is used — an
  `if (fulfilled)` with no `else` throws the distinction away.

### A3 · Agreement: do two screens describe the same people the same way?

- [ ] **A3.1 — The module's admin screens and the dashboard pie agree on who
  exists.** They may answer different questions (current participants vs. all
  applications ever) but must not disagree about the population.
  *Compliance used `status IS NOT NULL`; the pie used `status IN (active) OR
  role`.*

- [ ] **A3.2 — Where two figures legitimately differ, the difference is
  documented in a test**, so a later reader does not "fix" one to match.

- [ ] **A3.3 — All three data doors agree**: `supabase-db.ts` (server),
  `supabase-client-db.ts` (browser), `testing/fake-db.ts` (double). An operator
  in one that throws in another works until it runs elsewhere.

### A4 · Identity and access: is what the user signed up as what they can do?

- [ ] **A4.1 — Every account type the form accepts gets its roles granted.**
  *Marketplace `accountType: "both"` never receives `marketplace_buyer`.*

- [ ] **A4.2 — Role spellings are complete everywhere they are listed.**
  *`module-access-check.ts` omits `marketplace_seller`, which live data
  contains.*

- [ ] **A4.3 — The eligibility/access rule has exactly one definition.**
  *#817 found a fifth copy of the WAVE rule on the main dashboard, missing the
  admin exemption.*

- [ ] **A4.4 — Post-signup routing serves every account type**, including
  combined ones.

### A5 · The member's own screens (onboarding + dashboard)

- [ ] **A5.1 — Names/acronyms come from the shared constant.**
  *Eight invented expansions of "WAVE" across five sweeps.*

- [ ] **A5.2 — Multi-step forms repopulate on going back**, and dependent
  dropdowns (state → LGA → ward) work **on mobile**.

- [ ] **A5.3 — Optional fields are genuinely optional** end to end: client
  schema, server schema, and DB constraint.

- [ ] **A5.4 — Single-select means single-select** in schema and UI.

- [ ] **A5.5 — The dashboard shows no fabricated content** — no invented
  announcements, ledgers, or activity.

- [ ] **A5.6 — Images resolve to files that ship** (`isRenderableSrc` /
  `PUBLIC_ASSETS`), and a missing one degrades rather than throwing.

- [ ] **A5.7 — Nothing decorative runs on mount for every visitor.**
  *An unconditional `initSession()` in a chat widget took the homepage down.*

### A6 · Admin actions and their responses

- [ ] **A6.1 — Search finds people by what is on the row**, not only by the
  account record, and reports truncation when it caps.

- [ ] **A6.2 — Approve/reject writes every field its readers read**, under both
  key spellings where they exist, and grants the roles.

- [ ] **A6.3 — A caller's bad input is logged at `warn`, not `error`.** Reserve
  `error` for the platform's own faults. *A member mistyping her account number
  was logged as a system error.*

- [ ] **A6.4 — Exports carry the same corrected figures as the screen**, and are
  unbounded with truncation reported.

- [ ] **A6.5 — Permissions are the named permission**, not "any admin role".

---

## B. Execution plan

### Order, and why

| # | Module | Why here | Est. |
|---|--------|----------|------|
| 1 | **Cooperative** | **Owner's call — money first.** Savings, loans, withdrawals, member contributions. Dual-spelling keys (`cooperative`/`cooperatives`, written to the *same* user) make A1.6 a live risk, and the scoped admin views need care: a platform-wide count must never be substituted into a per-cooperative view. | 1–2 sessions |
| 2 | **Marketplace** | Confirmed A4 defects (`both` gets no buyer role; `marketplace_seller` missing from the access list) — the only module where signup type and capability already disagree. | 1 session |
| 3 | **Export** | Its own status vocabulary (`pending_approval`, `revision_required`) that no other module writes — the exact shape A1.8 exists for. Also money (bookings, idempotency). | 1 session |
| 4 | **Farm Nation** | Land verification + listings. A1.4/A1.5 risk on listing sweeps. | 1 session |
| 5 | **Academy** | `totalStudents` counts paid applications only; needs an A2.5 label decision. Lowest risk. | 1 session |

WAVE is the reference implementation and is already done.

### What each session looks like

1. **Measure first.** Reproduce the module's numbers locally at production
   *shape* before changing anything. Never reason from a code comment — that is
   how "14k without application" happened.
2. **Walk A1–A6** for that module, recording each item as pass / fail / N-A with
   the evidence.
3. **Fix only what failed**, smallest change that removes the defect.
4. **Write the test first where possible**, and make it behavioural — execute
   the code, do not grep the source.
5. **Run the full gate** (§C).
6. **Commit that module alone**, push, verify the remote SHA.
7. **Report**: what was found, what changed, what is still open.

### Guardrails — how this does not break anything

- Additive first: new fields alongside old ones; existing readers keep working.
- Fall back safely (`registerIsUsable`) so a module whose register is sparse
  keeps its current numbers rather than dropping to zero.
- `undefined` (field absent, old payload) and `null` (measured and failed) are
  different and must stay different.
- Bump cache keys when a cached payload's shape changes.
- Never delete or destroy data. Fix the reader, not the record.
- If an existing test fails, it is right until proved otherwise — four of them
  caught real defects in these fixes.

---

## C. The gate — every item, every module

```
npx tsc --noEmit
npm run lint
TZ=UTC npm run test
LOCAL_PG_URL=postgres://postgres@127.0.0.1:54322/postgres npm run test:pg
npm run build
npx playwright test --project=chromium     # no dev server running, port 3000 free
```

**Known harness traps, learned the hard way:**
- Do not leave `next dev` running, and never `rm -rf .next` while a server is
  up — Playwright reuses port 3000 and the run measures a broken server.
- `jest.doMock` leaks to every later require in a file; keep such cases last.
- The fake DB is not automatically the real DB. `.count()` was capped at 5,000
  in the double while the adapter counts exactly.

---

## D. Open items not owned by this plan

- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` — the owner generates it (32 bytes,
  base64) and sets it in the **build** environment. Code only reports its
  absence.
- WebKit is not installed, so cross-browser coverage is unchecked — and #833 was
  a browser-compatibility crash every other test missed.
- The yams product row points at a missing image file (data, not code).

---

## E. Results

### E1 · Cooperative — pass 1 (#838)

Surveyed before changing anything, as §B step 1 requires. **Cooperative was in
considerably better shape than WAVE**: most items already passed, several because
earlier findings (#520, #789, #825) had already fixed them here. Recorded with
the evidence so the next reader does not re-derive it.

| Item | Verdict | Evidence |
|---|---|---|
| A1.4 counts are exact | **pass** | `fetchAllDocs` paginates on a total order (`__name__`), so the metrics sweep is genuinely complete, not a capped `.get()` |
| A1.5 aggregates unbounded + report truncation | **pass** | `getStandardCooperativeMembersAction` computes `cohortTruncated` and logs at error level |
| A1.6 no double counting | **pass** | no cooperative count sums the `cooperative` / `cooperatives` spellings |
| A1.8 shared status vocabulary | **pass** | reads `memberStatusOf` / `lib/cooperative-membership-status` |
| A2.1 failed read is not zero | **pass** | admin dashboard renders through `statText` / `statMoney` |
| A2.1 / A6.1 **on the members page** | **FAIL → fixed** | the action returned `truncated` + `rowCap`; **the page read neither**. Four tiles and the list drawn identically whether complete or the newest 5,000 rows |
| A2.2 nothing invented | **pass** | no hardcoded figures in the member dashboard |
| A4.2 role spellings complete | **pass** | `module-access-check` resolves *both* coop spellings by progression score |
| A5.2 dependent dropdowns repopulate | **pass** | `PersonalInfoStep` drives state/LGA/ward from `data.address`; #789 fixed the ward blocker |
| A6.3 caller input logged at warn | **pass** | the `logger.error` sites are cache-invalidation and internal-refusal paths, which are platform faults |

**Fixed this pass:** the members screen now surfaces the partial-cohort banner
its own action was already reporting — matching the sibling dashboard, which had
had the same treatment since its own finding. One of two screens having the rule
is this audit's most repeated shape.

**Still open for cooperative** (carried to pass 2, not defects yet — questions):

- A3.1 — three surfaces can answer "how many cooperative members": the dashboard
  pie (register-based), the admin dashboard (register when unscoped, else
  `COOPERATIVE_MEMBERS`), and the members page (a `COOPERATIVE_MEMBERS` window).
  They answer legitimately different questions; what is not yet proved is that
  they never *disagree about the same one*.
- A1.1 / A1.2 — whether a member holding `cooperative_member` with no
  `COOPERATIVE_MEMBERS` row exists in production, and which screens would miss
  her.
