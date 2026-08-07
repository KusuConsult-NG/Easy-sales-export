# Technical Findings Record

**Repository:** KusuConsult-NG/Easy-sales-export
**Examined:** 2026-08-07
**Base examined:** commit `e84006b` (2026-07-23), the state of the branch before any changes in this audit
**Codebase size:** 204,451 lines of TypeScript across 836 files, plus SQL schema and configuration

---

## 1. Purpose and status of this document

This is a factual record of defects identified by static examination of the
source code. It is **not** an expert report, and it is not a certification that
the software does or does not work.

It was produced by an AI system. Every finding is stated with a file path and,
where applicable, a line reference, so that **any competent engineer can
independently verify or refute it**. Nothing here should be relied upon without
that verification.

This document does not express any view on fault, responsibility, negligence,
or contractual compliance. Those are questions requiring the project's
contract, specification, agreed scope, timeline and budget — none of which were
available during this examination — and they are not technical questions.

---

## 2. What was and was not examined

### Examined

- The full source tree (`src/`, `packages/`), by targeted pattern analysis
  across all 836 files
- The database compatibility layer, storage layer and authentication bootstrap,
  read in full
- All 118 API routes, for authentication and authorisation checks
- The SQL schema and all three migrations
- The build, type-check and lint configuration, all of which were executed

### Not examined, and therefore not attested to

- **Runtime behaviour.** Nothing was executed against the live database,
  Paystack, or any production service. Every finding is derived from reading
  code, not from observing failure.
- **Business-rule correctness** in approximately 200 server actions — whether
  interest calculations, fee splits or eligibility rules produce the *intended*
  figures. Determining this requires the product specification, which was not
  available.
- **Whether any given defect actually caused a specific incident.** The code
  paths are demonstrably faulty; attributing a particular outage or loss to a
  particular defect requires production logs, which were not available.
- **The `packages/` directory internals** beyond their import relationships.
- **Front-end behaviour** beyond the specific date-handling paths examined.

---

## 3. A material limitation: the repository history is incomplete

This affects what can be established about *when* defects were introduced.

| Observation | Value |
|---|---|
| Earliest commit in repository | 2026-07-13 |
| Total commits before this audit | 50 |
| Files present in the very first commit | 2,020 |
| Subject of the first commit | `fix: implement role-to-status self-healing mapping...` |

The entire application — 2,020 files — appears in a single initial commit, and
that commit is described as a *fix*, not an initial import. Separately, the
project's own earlier audit documents (`docs/audit/phase5_data_reconciliation_audit.md`)
reference specific payment transactions dated **2026-05-16 through 2026-06-06**,
two months before the repository's first commit.

**Conclusion:** the application was in operation and taking payments well before
the earliest commit in this repository. The version-control history covering
that earlier period is not present — it appears to have been squashed,
re-initialised, or overwritten.

**Consequence:** this repository cannot establish when any defect was
introduced, by whom, or how long it persisted. Any timeline must be
reconstructed from other sources (section 6).

I make no claim about *why* the history is absent. Squashing history is a
routine, legitimate practice, and its absence is not by itself evidence of
anything.

---

## 4. Findings

All findings were verified by tracing each call site against the implementation
it calls. Fixes referenced below were made on branch
`claude/easy-sales-export-audit-voajzc` and, as of writing, are **not deployed**.

### 4.1 Defects that would cause a complete failure of the affected feature

| # | Defect | Location | Effect |
|---|---|---|---|
| 1 | `db.doc()` discarded all path arguments after the first | `src/lib/supabase-db.ts` | Cooperative contribution payment verification, all four cooperative balance functions, and the join-cooperative flow threw an exception on first database access |
| 2 | `snapshot.exists` used as a method where it is a property | 7 call sites | `TypeError` on execution |
| 3 | Storage shim lacked `makePublic()` and `getSignedUrl()`; `save()` did nothing | `src/lib/shims/firebase-admin/storage.js` | Every server-side file upload threw. Product images, certificates, export documents were never stored |
| 4 | Push messaging shim returned a fabricated success id | `src/lib/shims/firebase-admin/messaging.js` | No push notification has ever been delivered; the application logged "Push sent" for each |

### 4.2 Defects causing silent incorrect behaviour

| # | Defect | Location | Effect |
|---|---|---|---|
| 5 | `set(data, {merge:true})` issued a SQL `UPDATE`, matching zero rows for a new record | `src/lib/supabase-db.ts` | Writes discarded without error; caller received success |
| 6 | `increment()` returned an unrecognised sentinel | `src/lib/supabase-db.ts` | Counters overwritten with a JSON object instead of incremented |
| 7 | `AggregateField.count()` ignored, always summed | `src/lib/supabase-db.ts` | Record counts reported as monetary sums |
| 8 | Aggregates read one un-paginated page | `src/lib/supabase-db.ts` | All totals under-reported beyond 1,000 records, including revenue |
| 9 | Unsupported query operators silently dropped | `src/lib/supabase-client-db.ts` | Scoped queries returned entire collections |
| 10 | Read errors returned "record does not exist" | `src/lib/supabase-db.ts` | Database failures indistinguishable from missing data |

Finding 10 is the most consequential of this group: code that cannot
distinguish "the record is absent" from "the query failed" may re-create
records over existing data.

### 4.3 Security and data-protection findings

| # | Finding | Location |
|---|---|---|
| 11 | No row-level security is enabled on any of the nine tables, and no access policy exists anywhere in the repository, while the browser holds a publicly-visible key | `supabase/schema.sql` |
| 12 | The GDPR deletion routine deleted personal data but never deleted the corresponding authentication identity, because it called a non-functional interface | `src/app/api/cron/gdpr-purge/route.ts` |
| 13 | An orphan-detection script classified a user as deletable when a database read *failed*, and a companion script permanently deleted every identity on that list in batches of 1,000, without confirmation | `src/scripts/auth-db-audit.ts`, `src/scripts/auth-purge-orphans.ts` |

Regarding finding 11: with row-level security disabled, the key embedded in the
public website can read and write every table directly. This is a
misconfiguration of the database, not of the application code.

Regarding finding 13: these scripts appear to predate the migration to the
current database. Whether either was ever executed cannot be determined from
the repository. **No conclusion should be drawn about whether they caused any
data loss without execution logs.**

### 4.4 Structural findings

- 409 of 510 database read operations retrieve entire tables with no limit,
  causing performance to degrade as data volume grows
- Three separate loan implementations write incompatible records to one shared
  collection; the one reachable from the user interface records neither an
  interest rate nor a repayment period
- Type checking is disabled in the configuration (`strictNullChecks: false`,
  `noImplicitAny: false`) with 2,173 untyped values, which is why findings 1–10
  are invisible to the compiler

### 4.5 An important qualification

**The application builds, type-checks and lints cleanly with every defect above
present.** This was verified. That is a direct consequence of finding 4.4's
third item.

This matters in both directions. It explains how these defects could persist
undetected — standard verification would not surface them. It equally means
their presence is not, by itself, evidence that any particular standard of care
was or was not met. That assessment requires the project's agreed scope and
practices.

---

## 5. Verification

Any engineer can confirm or refute the above:

```bash
git checkout e84006b          # the state before any audit changes
npm ci
npx tsc --noEmit              # passes
npm run build                 # passes
```

Each finding cites a file. Reading the cited implementation alongside its call
sites is sufficient to confirm or reject it. No specialist tooling is required.

The fixes are on branch `claude/easy-sales-export-audit-voajzc`, each in a
separate commit with its reasoning. The accompanying test suite
(`src/lib/__tests__/adapter-contract.test.ts`) fails against the original code
and passes against the corrected code, which demonstrates the defects
concretely.

---

## 6. Evidence preservation

If the state of this system is likely to be examined, the following should be
preserved **before** any further change, as several have limited retention:

| Source | Holds | Typical retention |
|---|---|---|
| Supabase → Database → Backups / PITR | Database state over time | ~7 days |
| Supabase → Authentication → Users (export) | Current identity records | Until modified |
| Sentry | Application errors with timestamps and stack traces | 30–90 days |
| Railway | Deployment history and runtime logs | Varies |
| Paystack | Independent record of every transaction | Long-term |
| Resend | Email delivery logs | Varies |
| GitHub | Branch, tag and force-push history via the events API | ~90 days |

The last row is relevant to section 3: GitHub retains repository events for a
limited period, which may indicate what happened to the earlier history.

A full copy of the repository at the examined state, including all audit
commits, is preserved in the file `easy-sales-export-audit.bundle`.

---

## 7. Recommended next step

For any formal proceeding, this record should be **independently verified by a
qualified human engineer** engaged for that purpose. This document is intended
to make that verification fast and cheap — the findings are specific and
reproducible — but it cannot substitute for it.

An independent examiner should also be given the project's contract,
specification and agreed scope, none of which were available here, and without
which no view can be formed on whether the work met what was agreed.
