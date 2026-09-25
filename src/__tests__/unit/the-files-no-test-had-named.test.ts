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
         */
        expect(ledgerVerdict(unreached().length, 72)).toBe(LEDGER_HELD);
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
