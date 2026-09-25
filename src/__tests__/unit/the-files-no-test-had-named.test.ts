/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "in terms of %, how many perfect is left in the entire app to
 *   be audited" — and then "fix all the 137 files".
 *
 * ── THE DENOMINATOR WAS THE HARD PART, AND IT WAS SITTING THERE ─────────────
 *
 *   Twice in this audit the answer to "how much is left" has been "there is no
 *   denominator". #436 already showed that to be a dodge: it asked the same
 *   question about coverage, found `collectCoverageFrom` naming three roots out
 *   of eight, and the missing ones held every API route on the platform.
 *
 *   The filesystem is the denominator. Every shipping .ts/.tsx under src/ is a
 *   thing that can be wrong, and the honest numerator for "has anybody looked
 *   at this" is whether ANY test names the file — by import specifier or by
 *   repo path. This codebase's audit is source-assertion heavy, so a test that
 *   names a file is the cheapest true signal that somebody read it.
 *
 *   Measured: 1,272 shipping files, 137 named by no test at all.
 *
 * ── WHY THIS IS A LEDGER AND NOT A THRESHOLD ────────────────────────────────
 *
 *   Being named by a test is not being correct, and pretending otherwise is how
 *   #74's 70%-against-32% happened. What this number honestly measures is
 *   REACH: which parts of the application the audit has not visited even once.
 *   A file on this list has had nothing said about it by anybody.
 *
 *   It is a ledger, in the shape #743 settled: a ceiling absorbs progress
 *   silently — four of eighty-eight get converted, the ceiling stays at
 *   eighty-eight, and four NEW ones can appear with every test green.
 *   ledgerVerdict reports the improvement and asks for it to be recorded.
 *
 * ── WHAT IS EXEMPT, AND WHY ONLY THIS ───────────────────────────────────────
 *
 *   `.d.ts` files, and nothing else. A type declaration has no runtime: there
 *   is no behaviour for a test to name, and "cover the shim that declares
 *   firebase-admin's types" is ceremony that would make this number look better
 *   without anybody having looked at anything. Twelve of the files are these.
 *
 *   Everything else stays in — including the tiny layouts, the static legal
 *   pages and the developer scripts — because each of them is code that ships
 *   or runs, and several findings in this audit have been exactly that: a
 *   two-line layout with the wrong guard, a page whose only job was a redirect
 *   that went to the wrong place.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== 'node_modules') walk(full, out);
        } else if (/\.tsx?$/.test(full)) {
            out.push(full);
        }
    }
    return out;
}

const isTest = (f: string) => /__tests__|\.test\./.test(f);

/** A type declaration has no runtime — see the header. */
const isTypeOnly = (f: string) => f.endsWith('.d.ts');

/**
 * Computed once.
 *
 * The sweep reads every test file in the repository and joins them, which is
 * ~5 seconds. Calling it per assertion took this one file to a minute of the
 * suite's runtime — a test that is slow for no reason is a test somebody
 * eventually excludes.
 */
let cached: string[] | null = null;

function unreached(): string[] {
    if (cached) return cached;
    const all = walk(join(ROOT, 'src'));
    const corpus = [...all.filter(isTest), ...walk(join(ROOT, 'e2e'))]
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');

    const result = all
        .filter((f) => !isTest(f) && !isTypeOnly(f))
        .filter((f) => {
            const rel = relative(ROOT, f);
            const noExt = rel.replace(/\.tsx?$/, '');
            //   Either spelling a test would use: the repo path, or the `@/`
            //   import alias. A bare mention of the MODULE name is deliberately
            //   not enough — `lib/claim-outcome` appearing in a comment is what
            //   made that module look covered while nothing imported it.
            return !(corpus.includes(rel)
                || corpus.includes(noExt)
                || corpus.includes('@/' + noExt.replace(/^src\//, '')));
        })
        .map((f) => relative(ROOT, f))
        .sort();

    cached = result;
    return result;
}

describe('how much of the application no test has named', () => {
    it('THE SWEEP IS READING THE APPLICATION', () => {
        //   THE control, first. Every assertion below is about a list, and an
        //   empty or tiny list agrees with almost any expectation about it.
        const all = walk(join(ROOT, 'src'));

        expect(all.filter((f) => !isTest(f)).length).toBeGreaterThan(1_000);
        expect(all.filter(isTest).length).toBeGreaterThan(500);
    });

    it('AND IT FINDS A FILE THAT IS GENUINELY NAMED (control)', () => {
        //   The other half of the guard: a matcher that never matched would
        //   report every file as unreached and the ledger would read as a
        //   catastrophe rather than as a measurement.
        expect(unreached()).not.toContain('src/lib/export-returns.ts');
        expect(unreached()).not.toContain('src/lib/price-reduction.ts');
    });

    it('THE LEDGER — files with runtime that no test names', () => {
        /*
         *   This may only go DOWN. Reaching one costs a one-line edit here that
         *   RECORDS it, which is the whole of #743's argument against a ceiling.
         *
         *   Lowered from 128 as the first pass off the 137: lib/claim-outcome,
         *   write-guard, wave-resource-access, academy-purchased-courses,
         *   bounced-address, notice-email-address, cooperative-member-identity,
         *   postgrest-filters and server-seed. Two of the nine were not merely
         *   unnamed — claim-outcome's own header claimed a test asserted its
         *   constant against both writers and none did, and
         *   wave-resource-access gated admins on the session token beside a
         *   database row it was already reading.
         *
         *   Then 116 → 106, which finishes the HTTP entry points: EVERY route
         *   file under src/app/api is now named by a test. They went first
         *   because they are the part of this application the internet reaches
         *   directly, and four of the ten held defects —
         *
         *     wallet/verify              reflected an uncaught exception's own
         *                                message into a redirect URL, from an
         *                                endpoint that needs no session
         *     notifications/subscribe    saved the push token with update(),
         *                                a no-op on a missing row, and
         *                                answered `{ success: true }` anyway
         *     admin/finance/paystack-balance   gated the company's live bank
         *                                balance on the session token
         *     admin/finance/recovery-emails    gated batch emails to members
         *                                about money owed them on the same
         *
         *   plus `details: error.message` on onboarding/complete and a
         *   six-of-anything token check on auth/mfa/enable.
         *
         *   Then 106 → 103, on the libraries and services: land-inspection,
         *   form-validation and communications.service. Two more findings —
         *   `inspectionRefusal` decides whether a land approval may proceed and
         *   its existing suite checks only that the six doors MENTION it, never
         *   calling it; and the broadcast service asked for one of the two
         *   spellings of the seller and buyer roles, so an admin mailing
         *   "sellers" reached the older spelling and nobody else, with a
         *   plausible count in the log.
         *
         *   Then 103 → 102, on ONE file — land/submit — and it is worth the
         *   whole line. Reading it found #901, which is three defects wearing
         *   the same shape and two of them fatal:
         *
         *     /land/verify         the admin land queue read `soilQuality` and
         *                          `location.lat` unguarded. Nothing on the
         *                          platform writes either, so it THREW on every
         *                          row waiting for a decision — #689's own
         *                          warning about this queue, landing on the
         *                          screen rather than on the action it repaired.
         *     LandMap.tsx          the public land map plotted every pin from
         *                          `location.lat` and labelled it with
         *                          `soilQuality.toUpperCase()`. #598 found this
         *                          shape in the file NEXT DOOR and guarded the
         *                          grid without entering the map.
         *     CROP_SOIL_MATRIX     asked for "clayey", a word no writer on this
         *                          platform uses, so a buyer searching for land
         *                          to grow sugarcane matched nothing at all.
         *     /land/submit         itself: a four-step wizard that uploaded her
         *                          title deeds and THEN called an action that
         *                          refuses anyone without Farm Nation access —
         *                          and for those it did admit, wrote a listing
         *                          with no category, no lease term and no rent
         *                          price. Now a redirect to the one door that
         *                          gates before she types, with the two fields
         *                          only it collected moved across first.
         *
         *   Then 102 → 94, on eight files that were one finding. #902: the
         *   platform published its canonical host in ten hand-written strings
         *   and named the one its OWN middleware 301s away from —
         *   `easysalesexport.com`, while lib/canonical-host has sent that to
         *   `www.` since #494 because the session cookie is host-only. The
         *   sitemap built up to eight hundred urls on it, and robots advertised
         *   it from the www host too, so a crawler that had already been moved
         *   was sent back.
         *
         *   Reading those two files then found the second half: the five module
         *   domains were hand-written and TWO of them are not hosts this
         *   platform serves — `wave.ng` (the config says waveprogramme.com) and
         *   `marketplace.easysalesexport.com` (easysalesmarket.com) — while the
         *   cooperative domain was missing altogether. #454 deleted a constant
         *   for this exact reason and wrote down why: "a list ... is exactly the
         *   thing somebody reaches for ... and it would have been silently out
         *   of date." Both are derived from HUB_MODULES now.
         *
         *   And 94 → 93 on one more, reached incidentally and recorded anyway:
         *   types/strict.ts, which #901's suite imports for `SoilQuality` to
         *   assert that the colour tables are keyed on the enum's lower-case
         *   values while the form writes "Clay". A file reached by a test that
         *   needed it is exactly what this ledger measures; a file reached by a
         *   test written to lower the number is not, which is why every entry
         *   above says what was found.
         *
         *   Then 93 → 88, on the error boundaries. #904: FOURTEEN of them, and
         *   the only one that reported was app/global-error.tsx — which Next
         *   reaches LAST, so it handles almost nothing, because there is an
         *   error.tsx at the app root and one in every module segment. Thirteen
         *   boundaries wrote `console.error` and told nobody.
         *
         *   Which is WHY the two crashes above were live. #901's screens threw
         *   on every row they were given and both sit under /land, which has no
         *   boundary of its own, so both landed on app/error.tsx and were
         *   logged to a browser console. An audit had to find them by reading.
         *
         *   app/error.tsx and admin/error.tsx also rendered `error.message`
         *   straight onto the page — useless to the reader and, for a
         *   client-side throw, whatever the code happened to say.
         *
         *   Then 88 → 85, on the WAVE application steps. #905: both doors that
         *   accept an application returned `issues[0].message` and threw away
         *   `issues[0].path`, and FOURTEEN of the schema's required fields carry
         *   no message of their own — so an applicant reached the end of seven
         *   sections, on the largest programme this platform runs, and was told
         *   "Too small: expected number to be >=18" with no field, no section
         *   and nowhere to go. Measured against the schema, not supposed.
         *
         *   And the form's own pre-submission guard checked ELEVEN of the thirty
         *   fields the server refuses on, because the schema sat in a
         *   "use server" module the form could not import. The schema moved to
         *   lib/wave-application-fields unchanged and the form parses the very
         *   object the action parses; the field→step table lives beside it, so a
         *   field added to one without the other fails a test rather than
         *   reappearing as a bare Zod message on exactly one field.
         *
         *   Then 85 → 84, on the export product create form. #906: the action
         *   behind it, submitExportProductAction, asked for a session and
         *   NOTHING ELSE — so any signed-in account could put a listing into the
         *   catalogue queue an admin works. #486 found this exact shape on the
         *   three land-listing writers and wrote the rule down ("THE GATE IS THE
         *   MODULE'S OWN ACCESS RULE"); it never visited Export. The form being
         *   behind a gated layout is not the same thing, for the reason #803
         *   recorded on the land door: a server action is callable directly.
         *
         *   And two upload paths in the module filed under a literal —
         *   `${session?.user?.id || 'anonymous'}` — one of them for an ID
         *   document and a proof of address. Unreachable today (both routes are
         *   in PROTECTED_PATHS) and a trap rather than a leak, which the suite
         *   says in those words; the folder is shared by every caller that
         *   reaches it.
         *
         *   Then 84 → 81, on the three component error boundaries — and #907 is
         *   a CORRECTION to #904 above, which is why it reads as one.
         *
         *   #904 wired the fourteen route boundaries and never asked what sits
         *   INSIDE them. React stops at the NEAREST boundary, and a CLASS
         *   boundary — `<ErrorBoundary>` — wraps the member layout of every
         *   module on this platform: admin, farm-nation, both marketplace
         *   portals, export, wave, academy. So for a signed-in member anywhere,
         *   a class boundary catches the crash and the route boundary #904 fixed
         *   never sees it. All four ended in console.error, and ErrorBoundary's
         *   own screen said "Our team has been notified and is working on a fix."
         *
         *   Reading them also found CooperativeErrorBoundary with no
         *   NEXT_REDIRECT handling of any kind, where the other three both skip
         *   the log and re-throw from render. Latent — its one subtree navigates
         *   with router.replace, which does not throw — and recorded as latent.
         *
         *   Then 81 → 80, on /marketplace/success. #908: it read `?reference`
         *   and rendered "Payment Successful! — Your order has been placed and
         *   payment confirmed", with the caller's own string printed back as the
         *   platform's Transaction Reference. It called nothing.
         *
         *   THE SEVERITY, MEASURED. Nothing links there — every Paystack
         *   callback the platform hands out is `{module}/payment/callback` — so
         *   it is not "a buyer whose payment failed is told it succeeded". It is
         *   a page on this domain, in this branding, that tells anybody their
         *   payment is confirmed and shows any reference they choose: a
         *   proof-of-payment screenshot to send a seller, which is the class #262
         *   worked. Now a redirect to the callback, carrying the reference so a
         *   real one gets verified.
         *
         *   A sweep of every screen in src/app says it was the only one: the
         *   others either ask the server or render a stored payment status off a
         *   row. That sweep is the ratchet in its suite, written around the SOURCE
         *   of the claim rather than the sentence — two earlier versions produced
         *   false positives and each exemption is somewhere a real instance can
         *   hide.
         *
         *   Then 80 → 79, on components/admin/AdminDataTable. #909: it renders a
         *   failed read as a banner — so unlike #384 and #408 it was never
         *   silent — and then the table body underneath said "No results found"
         *   anyway. useAdminData sets `error` and leaves `data` at its initial
         *   `[]`, so the two co-occur on every first-load failure.
         *
         *   It backs /admin/users, /admin/farm-nation/listings and
         *   /admin/farm-nation/applications. On the last, "No results found"
         *   means "no applications to review" — the sentence #384 called "the
         *   worst available wrong answer" on the loans queue and #408 called the
         *   same on the land queue. Both were fixed one screen at a time; this is
         *   the shared component neither reached, so three queues get #408's
         *   three distinguishable states at once.
         *
         *   Then 79 → 77, on lib/export-order-fulfilment and lib/record-export,
         *   which were audited together as the export money path. #911 came out
         *   of the first: the module is carefully reasoned and the defect is in
         *   the vocabulary it has to write into. PAYMENT_STATUS called itself
         *   canonical and held six of the thirteen values the application
         *   writes, so PaymentStatusWriteSchema — z.enum over that list, and
         *   writeGuard THROWS — could not describe the `paid_awaiting_refund`
         *   write sitting twenty lines above the guarded `completed` one.
         *
         *   record-export is sound and is tested rather than changed. What the
         *   same pass found beside it is recorded, not fixed: #309's one
         *   already-logged screen still writes its audit row by a private path.
         *
         *   Then 77 → 75, on lib/validations/shared and lib/validations/academy.
         *   #912: an academy application's address is written by two actions and
         *   only one normalised it. The submit door lowercases and trims and says
         *   why; the resubmit door writes the schema's output — the address as
         *   typed — through an update whose nested map REPLACES rather than
         *   merges, so one resubmission undid it.
         *
         *   The three readers that comment names are all fallbacks behind an
         *   owner-scoped query, so none of them noticed. The duplicate guard in
         *   the submit transaction did: it queries the one lowercased form, and a
         *   de-normalised row is invisible to it. Normalised at the parse
         *   boundary now, with both doors sharing one function.
         *
         *   Then 75 → 72, on the three action barrels — wave, farm-nation and
         *   farm-nation-admin. #913: eight domain barrels, and admin and
         *   cooperative had a parity test each, written as a LIST of the names a
         *   file exported at one commit. The other six had nothing. The sweep
         *   derives the domains from the filesystem and the actions from source,
         *   checks barrel completeness in both re-export forms, the "private
         *   files" rule, and that every action file's first statement is the
         *   server directive.
         *
         *   It found no defect — all eight are complete and declared, and the one
         *   cross-domain private import is a deliberate delegation, pinned as
         *   itself. What it did find is that four of the eight barrels never
         *   STATED the private-files rule they were being held to, which is now a
         *   sentence in each of their headers.
         *
         *   Then 72 → 71, on lib/chatbot-knowledge. #914: the chat widget offers
         *   "What is the membership fee?" and "Are courses free?" as quick
         *   actions, and the system prompt behind them contained no amount at all
         *   — no ₦, no digit group outside the hex colours. api/ai sends that
         *   prompt straight to OpenAI, so the platform handed a member a button
         *   asking a money question and gave the model nothing to answer from.
         *
         *   I went looking for a STALE price, because #1, #2, #18 and #21 were
         *   all a fee copy disagreeing with checkout. There was no copy at all,
         *   which is the same class from the other side.
         *
         *   Then 71 → 66, which finishes src/scripts — every script there is now
         *   named by a test. #915: three diagnostics swept a collection with a
         *   bare `.get()`, which supabase-db caps at 5,000, against a users table
         *   its own header calls 41,000 rows. audit-academy printed "Total users
         *   who bypassed payment" and wrote the report an operator works through,
         *   from an eighth of the table.
         *
         *   Five of the eleven scripts were unreached. Three had the defect; the
         *   other two — auth-db-audit, which pages listUsers properly, and
         *   diag-coop-members, which bypasses the adapter for PostgREST on named
         *   users — were clean, and the test says so rather than leaving it
         *   silent.
         *
         *   Then 66 → 65, on components/profile/DeleteAccountSection. #916: the
         *   delete-my-account screen told the person "This permanently removes …
         *   your identity documents. It cannot be undone, and support cannot
         *   restore them afterwards." Two deliberate owner decisions make all
         *   three claims false — #530 keeps a full profile copy for fraud audit,
         *   and #292 deletes nothing on Cloudinary, so the ID scan and passport
         *   photo survive and the retention record keeps their links.
         *
         *   The retention is defensible and is left exactly as the owner set it.
         *   Telling the data subject the opposite of it is not, and that is the
         *   half this fixes — the wording, not the behaviour.
         *
         *   Then 65 → 63, on the two login doors — app/auth/login/page and
         *   login/admin/page. Both are four-line wrappers and the thing worth
         *   checking was not in them but in what the second one passes down.
         *   #917: safeInternalPath returned its FALLBACK unexamined, and
         *   LoginForm's fallback is a prop — so `<LoginForm
         *   defaultCallbackUrl="https://elsewhere.example" />` would have made the
         *   guard hand back the value it exists to refuse, on the login screen.
         *   No live open redirect (all four fallbacks are safe literals or the
         *   documented empty sentinel); the guard enforces it now instead of
         *   trusting four callers to remember.
         *
         *   Then 63 → 61, on admin/forensics/duplicates/page and services/index.
         *   #918: the duplicate-profile report gives three counts and said nothing
         *   about what it could not see — profiles with no address are skipped
         *   entirely (forensics found 49 of them) and the page walk stops at
         *   50,000 rows against a 41,000-row table. An operator supersedes records
         *   on the strength of it. lib/forensic-scan-scope already held the
         *   platform's vocabulary for saying so, and it is used rather than
         *   restated.
         *
         *   services/index is clean — four files, four registered singletons,
         *   nothing constructing one directly, no constructors at all — and the
         *   sweep that establishes that is kept, because a fifth service added
         *   without registration is what would go unnoticed.
         *
         *   Then 61 → 59, on components/ui/PhoneInput and auth/forgot-password.
         *   #919: two functions called isValidNigerianPhone existed, one in
         *   PhoneInput and one in lib/security, and they disagreed on the middle
         *   digit — `[789][01]` against `[789]\d`, so 082, 075, 095 and 085 were
         *   valid to one and not the other. Measured: lib/security's copy had NO
         *   callers, so it was a dead and wrong copy of a live rule in the module
         *   whose name invites reaching for it. One rule in lib/phone now, both
         *   spellings delegating, nothing deleted.
         *
         *   forgot-password is correct and is pinned for it: its success message
         *   never confirms an address is registered, which is the screen's half of
         *   a non-enumeration guarantee the action already keeps.
         *
         *   Then 59 → 54, on the five academy application wizard files — the three
         *   steps, ReviewStep and the retired success page. Taken as a batch
         *   because the question worth asking spans them: do the steps collect
         *   exactly what AcademyApplicationInputSchema declares? They do, field
         *   for field, and that is now pinned — Zod strips what it does not
         *   declare, so a step that gains a field the schema lacks loses it in
         *   silence.
         *
         *   #920 is what the comparison found one layer in. #912's fix ends "so:
         *   normalise at the parse boundary, where every caller of the schema gets
         *   it" — and _submitAcademyApplicationAction, the door that fix was
         *   written about, was not a caller of the schema. It took a TypeScript
         *   interface, and withFlexibleSafeAction validates nothing. Measured
         *   against both doors with the same payload: submit WROTE
         *   `email: "not-an-email"` into the field its own dedup guard queries,
         *   wrote a blank address as null and thereby SKIPPED that guard
         *   (`if (normalisedEmail)` is falsy on ""), and spread an invented key
         *   into the row — `_version: 99` reached it, and the admin raw-details
         *   modal prints `v{_version}.0`. Resubmit refused all three. It parses
         *   now, before the session read, the order its sibling already pinned.
         *
         *   NOT fixed and said so: the schema gives no string a `.min(1)`, so both
         *   doors accept a blank in a field the wizard marks required, and submit
         *   copies seven blanks onto the learner's own user row. Tightening it
         *   would refuse resubmission of the historical rows the edit form loads
         *   back into itself, and how many carry a blank is not measurable from
         *   here. Pinned with the exact list of nine instead.
         *
         *   And a ninth spelling of #452's name rule: the wizard built
         *   `personalInfo.fullName` as firstName + lastName, dropping the middle
         *   name, while the action writes the user row as
         *   [firstName, otherName, lastName]. One submission, two names for one
         *   person — the admin users screen said "Ada Chidinma Obi", the admin
         *   academy applications screen, which prints personalInfo.fullName as its
         *   heading and exports it to CSV, said "Ada Obi", and its search could
         *   not find the middle name the applicant typed. Both now go through
         *   joinFullName. firestore-serialize's serializeUser carried the same
         *   two-part rule and overwrote a stored three-part name with it; it has
         *   no callers, so nothing loses a name to it today, and it is corrected
         *   rather than left for the reason #919 recorded about lib/security.
         *
         *   ReviewStep — the last screen before Submit, ending in "I confirm that
         *   all the information provided is accurate and complete" — declared six
         *   personalInfo fields and omitted GENDER and LGA, both required, both
         *   written onto the user row. LGA is the one the form clears whenever the
         *   State changes, so it is precisely the value an applicant needed to see
         *   confirmed. The parent already passed them; only the prop type left
         *   them out, which is why nothing complained.
         *
         *   The success page is clean and stays retired: #384 pointed it at
         *   /academy/dashboard because the wizard never sends anyone to it, and
         *   that redirect is pinned rather than left looking unfinished.
         *
         *   Then 54 → 51, on three navigation primitives: components/ui/BackButton
         *   and BOTH components called StepIndicator — one under components/shared,
         *   one under components/onboarding.
         *
         *   #921 DEFECT ONE. BackButton is rendered by fourteen screens and read
         *
         *       if (history.length > 1) router.back();
         *       else if (fallbackPath) router.push(fallbackPath);
         *
         *   with nothing after the `else if`, and `fallbackPath` OPTIONAL. Four of
         *   the fourteen left it out — admin/marketplace/products, farm-nation
         *   offers, and the seller and buyer quote lists. On a tab with one
         *   history entry (a bookmark, a link from an email, target=_blank) those
         *   four rendered an enabled Back button that did nothing at all. The prop
         *   is required now and each of the four was given its own screen's path;
         *   required rather than defaulted, because one default cannot be right
         *   for an admin moderation tool and a member dashboard both.
         *
         *   DEFECT TWO. shared/StepIndicator chose the step circle's colour from a
         *   nested ternary whose first two branches were byte-identical, so the
         *   step you were ON rendered exactly like the ones you had finished —
         *   three states written, two drawn. It draws the marketplace onboarding
         *   wizard, up to six steps for a seller. The current circle now carries
         *   the ring its SIBLING component already uses for the same purpose, and
         *   aria-current, which it had no way to express at all.
         *
         *   The two same-named components are NOT merged and the test says why:
         *   numeric id and numeric cursor here, string id plus a per-step
         *   `completed` flag there, so folding either into the other changes a
         *   live wizard's data shape. onboarding/StepIndicator's own gap is
         *   recorded rather than fixed — an id it does not have greys every circle
         *   and hides the description, which #625 already guards at the one caller
         *   that could produce it.
         *
         *   AND A LESSON ABOUT THE HARNESS, which nearly became a false finding:
         *   the first draft of that test took `jest` from '@jest/globals', which
         *   #392 established defeats jest.mock hoisting. Every router assertion
         *   came back zero — and so does the no-op being investigated, so the
         *   broken harness and the defect were indistinguishable until the FIXED
         *   component also reported zero. Re-measured with a working mock before
         *   anything was claimed. #392's own detector cannot see this class: it
         *   resolves only first-party specifiers, so a late mock of a bare package
         *   is outside its reach. Searched for a live instance and found none; the
         *   gap is named, not closed.
         *
         *   Then 51 → 49, on the two components mounted on EVERY page —
         *   components/session-refresh-listener and
         *   components/common/GlobalScrollWatcher. Both are always-on, both were
         *   unreached, and both were doing the opposite of their job.
         *
         *   #922 DEFECT ONE. The refresh listener called next-auth's `update()` on
         *   every path change and every window focus with no interval at all.
         *   `trigger === "update"` is the first term of the jwt callback's sync
         *   test, so each call FORCED a profile resync past the two-minute
         *   SYNC_INTERVAL — and that interval is not a tuning knob: the callback's
         *   own comment calls it the latency budget for ban and password-reset
         *   revocation. Then useSession() handed every consumer a new session
         *   OBJECT, and 24 effects across 21 client components still list the whole
         *   `session` in their dependency array.
         *
         *   That was measured in production once, at one of those consumers.
         *   WaveApplicationClient: "checkWaveStatusAction ran about fourteen times
         *   in forty seconds for one member, at 784ms to 2784ms a call." It fixed
         *   its own dependency list and named the cause without changing it. The
         *   cause is throttled now, to the platform's own constant, shared from
         *   lib/session-staleness so there is one statement of "fresh enough". The
         *   four deliberate `update()` callers are untouched — there the bypass is
         *   the point. The 24 effects are counted and pinned, not re-keyed: two
         *   dozen dependency arrays across six modules, each watching for something
         *   different, is not a change to make on one reading.
         *
         *   DEFECT TWO, and a Next fact worth keeping. GlobalScrollWatcher exists,
         *   in its own words, so that "users on mobile don't miss feedback after
         *   submitting forms". It excluded EXCLUDED_PATHS as SUBTREES, with two
         *   escape hatches — and `!pathname.includes('/member')` could never fire,
         *   because every member area here lives in a route GROUP (`(member)`,
         *   `(learner)`, `(app)`) and route groups are stripped from the URL.
         *   `app/farm-nation/(member)/offers` is served at `/farm-nation/offers`.
         *   The clause was written against the filesystem path.
         *
         *   Counted over all 254 pages: 122 were excluded, including
         *   /academy/dashboard, /cooperatives/my-savings,
         *   /marketplace/seller/dashboard, /farm-nation/inquiries and every orders
         *   list. The watcher was off wherever the forms are. Exact match now — 9
         *   pages, which is what the list's own heading describes — and both
         *   hatches go with it. The list already thought that way: `/wave/landing`
         *   had its own entry although `/wave` covered its subtree.
         *
         *   Widening is safe because the strict guard already replaced the old
         *   colour-class matcher, and that is asserted rather than assumed:
         *   role="alert" or data-message only, after a 1.5s readiness delay, and
         *   only when the element is off screen.
         *
         *   A SECOND HARNESS TRAP, after #921's. jsdom does not implement
         *   innerText, which the watcher reads, so every positive assertion failed
         *   on correct code until it was shimmed — the same shape as the router
         *   mock, where a harness gap and the defect are indistinguishable from the
         *   assertion's side. The shim has its own control so it cannot outlive the
         *   need for it silently.
         *
         *   Then 49 → 45, on the shared form primitive and its neighbours:
         *   components/ui/FormField, components/ui/LoadingButton,
         *   components/common/BackToHub and
         *   cooperatives/onboarding/steps/NextOfKinStep.
         *
         *   #923 DEFECT ONE. FormInput, FormSelect and FormTextarea back FIVE
         *   onboarding and KYC forms, and when `error` was set they drew a red
         *   border and wired aria-describedby but never aria-invalid — the
         *   description announced, the state not. Measured before calling it a
         *   defect: `grep -rn aria-invalid src` found ONE occurrence in the whole
         *   tree, components/ui/ComboBox, and the expression is copied from it
         *   rather than invented. The platform had decided; the primitive five
         *   forms go through was the one place not doing it.
         *
         *   DEFECT TWO, and the trap inside its own fix. INPUT_BASE and
         *   INPUT_EMERALD were five identical lines each, differing only in the
         *   focus accent. Folded — and the first fold built them with
         *   `focus:ring-` + an interpolated colour, which compiles, typechecks,
         *   renders the right string, and would have made Tailwind generate
         *   NEITHER utility, because its scanner reads source text for whole class
         *   names. The focus ring on every field in five forms would have vanished
         *   with no error anywhere. The accent classes are whole literals; a test
         *   asserts both exported strings are byte-for-byte what they were.
         *
         *   DEFECT THREE — THE FOURTH AND FIFTH PHONE RULES. #919 folded the two
         *   functions called isValidNigerianPhone onto isNigerianMobile. Swept by
         *   SHAPE rather than by name, three regexes had survived it:
         *   cooperatives NextOfKinStep and marketplace BusinessProfileStep both
         *   used `/^0\d{10}$/` — 0 followed by ANY ten digits, so 01234567890
         *   passed — and one of those is the SELLER'S BUSINESS PHONE, the number a
         *   buyer rings. WAVE's PersonalDetailsStep restated the rule correctly.
         *   All three delegate now.
         *
         *   RECORDED, NOT CHANGED: lib/schemas' strictNigerianPhoneSchema is the
         *   `[789]\d` shape #919 measured as wrong, and it gates PUBLIC WAVE
         *   briefing registration and the WAVE application. Tightening it decides
         *   who may register, and refusing a real person costs more than storing a
         *   number no network issues. The disagreeing set — 0821…, 0751…, 0951…,
         *   0851… — is pinned so the decision is costed rather than forgotten.
         *
         *   LoadingButton is clean, and one thing about it was worth checking: it
         *   never sets `type`, so one inside a form defaults to submit. Swept the
         *   whole tree — ZERO onClick buttons without a type inside a form. The
         *   sweep is kept, because that is a one-character regression.
         *
         *   BackToHub is correct, with one caveat recorded rather than fixed:
         *   useSession reports "loading" before "authenticated" and this reads only
         *   `data`, so for the first moment of a page a signed-in member is offered
         *   "Back to Hub" pointing at "/". Every available fix is somebody else's
         *   decision — hiding a floating control makes it flicker, defaulting to
         *   /dashboard sends an anonymous visitor to a guarded route — so the
         *   behaviour is pinned and the choice left visible.
         *
         *   A THIRD HARNESS TRAP, and the most pointed one: the assertion written
         *   to forbid the interpolated Tailwind class failed on correct code,
         *   because the COMMENT explaining the trap quotes the interpolated form.
         *   Caught by this repo's own recorded lesson, inside the test written to
         *   describe it. Stripped before the negative sweep; raw for the positive
         *   one, since raw is what Tailwind reads.
         *
         *   Then 45 → 41, on components/admin/RejectionModal,
         *   components/modals/QuoteRequestModal, components/marketplace/
         *   ShipmentFields and components/ui/LocalVideoPreview.
         *
         *   #924 RejectionModal is rendered by FIVE admin screens, will not enable
         *   Confirm until the reason is at least ten characters, and its default
         *   banner says that reason "will be communicated to the applicant". Four
         *   of the five doors keep that promise — the export and wave actions and
         *   the cooperative reject-member and marketplace reject-seller routes all
         *   store it and email it.
         *
         *   THE FIFTH DOES NOT. /api/admin/marketplace/suspend-seller writes
         *   `suspensionReason` on the verification row AND on
         *   serviceRegistrations.marketplace.suspensionReason, sends no email, and
         *   raises no notification. Measured: four occurrences of the field in the
         *   tree and every one a WRITE — this route twice, bulk-user-operations
         *   twice. Not one reader.
         *
         *   AND THE SELLER HAD A SLOT FOR IT ALL ALONG. onboarding/pending routes
         *   `rejected` AND `suspended` to /marketplace/onboarding in one line, and
         *   that screen's amber banner has a paragraph for the explanation —
         *   reading `rejectionReason`. So a seller whose shop had stopped working
         *   was sent to a banner headed "Your verification requires updates" with
         *   nothing under it, while the ten characters an admin was compelled to
         *   write sat one field away. The reader takes suspensionReason first now,
         *   because the suspension is the newer verdict when a row carries both.
         *
         *   RECORDED AND NOT FIXED: there is no suspension email. The library has
         *   four rejection emails and no suspension counterpart, and writing one is
         *   composing a new message to sellers in the platform's voice, which is
         *   the owner's to word. And the server floor is ONE character, not ten —
         *   both review schemas want only `!!reason`, both API doors only
         *   `!reason`. Left alone: every door is admin-only behind a permission
         *   check, so the caller who would bypass the floor is the person it
         *   advises, and refusing a short-but-adequate reason would strand an admin
         *   mid-decision.
         *
         *   ALSO PINNED: WaveApplicationReviewSchema and
         *   ExportOnboardingReviewSchema are byte-identical but for the name. They
         *   agree, so a ledger beats a rewrite — folding them makes one module's
         *   schema import another's, and #912 recorded what that costs.
         *
         *   The other three are clean and are recorded as such. LocalVideoPreview
         *   owns exactly one object URL per file and revokes it on cleanup, which
         *   is the whole reason it exists as a component. ShipmentFields' courier
         *   phone is `type="tel"` with no format rule, and that is right rather
         *   than a sixth phone rule: "a phone number the buyer can call" may be a
         *   landline, which isNigerianMobile would refuse.
         *
         *   QuoteRequestModal is clean for a reason worth writing down, because it
         *   is not in the component: `if (!isOpen) return null` sits AFTER its
         *   hooks, so a parent that kept it mounted would show the previous
         *   product's quantity, notes and OFFERED PRICE against the next one. Both
         *   callers avoid that — ProductDetailClient is one product per page, and
         *   the export opportunities LIST renders it as
         *   `{selectedWindow && …}` with onClose nulling the selection, so it
         *   remounts per window. The guarantee lives at the call site, and that is
         *   where it is pinned.
         *
         *   A FOURTH HARNESS TRAP, and it would have reported the defect as
         *   already fixed: the reader/writer sweep tested `/\.suspensionReason/`
         *   against raw source, and the suspend route writes the field by its
         *   DOTTED PATH inside a quoted key — so the writer matched as a reader.
         *   String literals are blanked before the read test now.
         *
         *   Then 41 → 38, on the three admin chart components —
         *   components/admin/AnalyticsCharts, ContributionTrendChart and
         *   DashboardLineChart.
         *
         *   #925 DEFECT ONE, and the page's own comment gave it away.
         *   admin/analytics/page renders AnalyticsCharts with
         *   `moduleUsage={moduleUsage}` and, two elements later, an empty
         *   `<div></div>` labelled "Spacer since Module Usage is now handled by
         *   AnalyticsCharts inside its own grid". AnalyticsCharts declared the prop
         *   in its interface and never destructured it. The page deleted its chart,
         *   made the space, handed over the data, and nothing drew it.
         *
         *   The series is real, and analytics.service goes out of its way to keep
         *   it drawable — nine `{ module, count }` rows, zeroes filtered, and
         *   `[{ module: "No data yet", count: 1 }]` rather than an empty array,
         *   which is a deliberate "so the chart has something to show". It is drawn
         *   now, conditionally, because admin/DashboardClient passes the other two
         *   props and must not gain a blank third card.
         *
         *   DEFECT TWO. ContributionTrendChart and DashboardLineChart read the SAME
         *   series — reports.monthlyTrend from getCooperativeReportsAction,
         *   `{ month, amount }` in naira. The bar chart on the contributions screen
         *   formatted it; the line chart on the cooperatives dashboard showed
         *   "1240000", with nothing to say it was money rather than a count of
         *   contributions. AnalyticsCharts states the platform's rule and is why
         *   this is a defect rather than taste: its REVENUE chart formats, its USER
         *   GROWTH chart deliberately does not.
         *
         *   RECORDED: the two cooperative charts hold mirror-image halves of one
         *   guard. The bar chart checks for empty data ITSELF while its caller
         *   passes `reports?.monthlyTrend` unguarded, so that check is
         *   load-bearing; the line chart has no check and its caller does. Neither
         *   is broken and both are pinned, because the halves are one edit from
         *   being swapped.
         *
         *   A FIFTH HARNESS GAP: recharts measures its container and jsdom reports
         *   every element as 0x0, so ResponsiveContainer renders NOTHING and every
         *   assertion about a bar or a line is vacuous. Given an explicit size it
         *   renders. Same shape as the other four — without it a correct chart and
         *   a missing one are indistinguishable from the assertion's side.
         */
        expect(ledgerVerdict(unreached().length, 38)).toBe(LEDGER_HELD);
    });

    it('AND EVERY HTTP ENTRY POINT IS OFF IT', () => {
        /*
         *   The whole of src/app/api, which is the part of this application
         *   the internet can reach without going through a page. #436's
         *   finding was that all 121 route files had been outside the coverage
         *   denominator entirely; this says no route is outside the audit's
         *   reach either, and a new unnamed one fails here rather than waiting
         *   for the ledger above to notice a count.
         */
        expect(unreached().filter((f) => f.startsWith('src/app/api/'))).toEqual([]);
    });

    it('AND THE MONEY AND IDENTITY RULES ARE OFF IT', () => {
        //   Named individually because these are the ones where being unread
        //   costs somebody money or access, so they must not drift back on.
        for (const rel of [
            'src/lib/claim-outcome.ts',
            'src/lib/write-guard.ts',
            'src/lib/wave-resource-access.ts',
            'src/lib/academy-purchased-courses.ts',
            'src/lib/bounced-address.ts',
            'src/lib/cooperative-member-identity.ts',
            'src/lib/postgrest-filters.ts',
            'src/lib/server-seed.ts',
            'src/lib/notice-email-address.ts',
        ]) {
            expect({ rel, unreached: unreached().includes(rel) })
                .toEqual({ rel, unreached: false });
        }
    });
});
