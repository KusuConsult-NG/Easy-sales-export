/**
 * @jest-environment node
 */

/**
 *   #629 "THE RULE THE SCREENS AND THE GUARDS SHARE" WAS SHARED BY NOTHING.
 *
 *   Found by sweeping for it rather than by stumbling on it a fourth time.
 *
 *   Three findings in this audit have had one shape — a rule stated in one
 *   place and consulted nowhere, while the same logic is written out by hand
 *   wherever it is actually needed:
 *
 *     #618  canAccessAdminRoute enforced strict module isolation and only ever
 *           decided which sidebar LINKS to draw.
 *     #623  finance:refund was declared, held by super_admin alone, and gated
 *           no door anywhere.
 *     #624  PRODUCT_VISIBLE_STATUSES described what a buyer may see while
 *           fifteen hand-written queries decided it.
 *
 *   So the fourth was looked for. Every value export under src/lib was counted
 *   against every reference in the application: 1,047 exports, 108 of which no
 *   application file mentions at all.
 *
 *   Most of those 108 are harmless — a helper written ahead of its use costs
 *   nothing. An unused RULE is different, because somebody reads it to learn
 *   what the system does and it answers with authority while governing nothing.
 *
 * ── THE ONE THAT MATTERED ───────────────────────────────────────────────────
 *
 *   `isDisputeSettled`, whose own docstring reads "the rule the screens and the
 *   guards share". Nothing shared it.
 *
 *   A dispute has four stored statuses, and two of them mean settled:
 *   `"resolved"` is what the resolvers write, and `"closed"` is declared but
 *   unwritten — kept, in dispute-status's own words, "so that asking for
 *   settled disputes never silently omits one".
 *
 *   THE FILTER LEARNED THAT AND NOTHING ELSE DID. `disputeStatusesForFilter`
 *   is used twice and correctly matches both spellings. Beside it:
 *
 *     actions/disputes.ts ×2   `status === "resolved" || status === "closed"`
 *                              written out by hand, once in the guard and once
 *                              again inside the transaction that re-reads it.
 *     two admin tallies        counted `"resolved"` alone.
 *
 *   The tallies are the live cost. admin/marketplace/disputes shows open,
 *   under_review and resolved — a THREE-WAY SPLIT OF FOUR STATUSES — so a
 *   dispute stored as `closed` appears in none of them and the totals quietly
 *   fail to add up. The escalated screen's "Resolved" card does the same.
 *
 *   Nothing writes `closed` today, so it is latent; that is exactly what the
 *   constant was created to survive.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import {
    isDisputeSettled,
    disputeStatusesForFilter,
    DISPUTE_STATUSES,
    DISPUTE_TERMINAL_STATUSES,
    DISPUTE_OPEN_STATUSES,
} from '@/lib/dispute-status';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full) && !/\.d\.ts$/.test(full)) out.push(full);
    }
    return out;
}

/** Comments removed, so prose about a rule is never counted as using it. */
const strip = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

const APP_FILES = walk(join(ROOT, 'src'))
    .map(f => relative(ROOT, f))
    .filter(f => !f.includes('__tests__') && !f.includes('/testing/'));

const BODIES = new Map(APP_FILES.map(f => [f, strip(readFileSync(join(ROOT, f), 'utf8'))]));

/** Application files, other than its own, whose CODE mentions this symbol. */
function appUsers(symbol: string, ownFile: string): string[] {
    const word = new RegExp(`\\b${symbol}\\b`);
    return APP_FILES.filter(f => f !== ownFile && word.test(BODIES.get(f)!));
}

describe('#629 — the sweep that found it, and the answers it was checked against', () => {
    /*
     *   THE INSTRUMENT IS VALIDATED FIRST. #612's lesson: a sweep whose output
     *   is believed without being checked against known answers is how a list of
     *   108 becomes 108 wrong conclusions. These five are known independently.
     */
    it('IT COUNTS A HEAVILY USED SYMBOL AS HEAVILY USED', () => {
        expect(appUsers('isAdmin', 'src/lib/admin-permissions.ts').length).toBeGreaterThan(30);
        expect(appUsers('nationalIdField', 'src/lib/kyc-validators.ts').length).toBeGreaterThan(5);
    });

    it('AND A SYMBOL WITH EXACTLY TWO USERS AS TWO', () => {
        //   #625 wired restoredStepIndex into precisely two flows.
        expect(appUsers('restoredStepIndex', 'src/lib/draft-step.ts')).toHaveLength(2);
    });

    it('AND IT DOES NOT COUNT A MENTION IN A COMMENT', () => {
        /*
         *   The fault that would make this sweep useless in the other direction.
         *   Four files discuss `canAccessAdminRoute` in comments — three API
         *   routes that #618 found delegating their authorisation to it in prose
         *   — and exactly one calls it.
         */
        const users = appUsers('canAccessAdminRoute', 'src/lib/admin-permissions.ts');
        expect(users).toEqual(['src/components/admin/AdminSidebar.tsx']);

        //   And the raw text really does mention it far more widely, or this
        //   assertion would be proving nothing about comment-stripping.
        const raw = APP_FILES.filter(f =>
            readFileSync(join(ROOT, f), 'utf8').includes('canAccessAdminRoute'));
        expect(raw.length).toBeGreaterThan(users.length + 3);
    });
});

describe('#629 — the settled rule is now the one everybody asks', () => {
    it('NOBODY WRITES THE TWO SPELLINGS OUT BY HAND ANY MORE', () => {
        const HAND_WRITTEN = /status === "resolved" \|\| \w*\.?\w*status === "closed"/;
        const offenders = APP_FILES.filter(f => HAND_WRITTEN.test(BODIES.get(f)!));
        expect(offenders).toEqual([]);
    });

    it('AND THE GUARDS AND THE TALLIES ASK isDisputeSettled', () => {
        //   The other half: "nobody hand-writes it" is also satisfied by
        //   deleting the checks. They have to be asking the rule.
        expect(appUsers('isDisputeSettled', 'src/lib/dispute-status.ts').sort()).toEqual([
            'src/app/actions/disputes.ts',
            'src/app/admin/marketplace/disputes/escalated/page.tsx',
            'src/app/admin/marketplace/disputes/page.tsx',
        ]);
    });

    it('AND NO DISPUTE SCREEN COUNTS ONE SPELLING OF SETTLED', () => {
        /*
         *   A SHARPER ASSERTION THAN THE ONE ABOVE, and it had to be: reverting
         *   a tally to `d.status === "resolved"` left the import in place, so
         *   "this file mentions isDisputeSettled" stayed true and both tally
         *   mutants survived. Mentioning a rule is not using it — which is, word
         *   for word, the finding this file is about, committed inside the test
         *   for it.
         */
        const DISPUTE_SCREENS = [
            'src/app/admin/marketplace/disputes/page.tsx',
            'src/app/admin/marketplace/disputes/escalated/page.tsx',
            'src/app/dashboard/disputes/DisputesClient.tsx',
        ];

        for (const screen of DISPUTE_SCREENS) {
            const code = BODIES.get(screen);
            expect(code).toBeDefined();
            //   Counting or badging one terminal spelling is what under-counts.
            expect({ screen, countsOneSpelling: /\.filter\([^)]*status === "resolved"\)/.test(code!) })
                .toEqual({ screen, countsOneSpelling: false });
        }

        //   And the two tallies ask the rule, by the expression and not the import.
        expect(BODIES.get('src/app/admin/marketplace/disputes/page.tsx'))
            .toContain('filter((d) => isDisputeSettled(d.status))');
        expect(BODIES.get('src/app/admin/marketplace/disputes/escalated/page.tsx'))
            .toContain('filter(d => isDisputeSettled(d.status))');
    });

    it('AND THE FILTER STILL ASKS ITS OWN, which was right all along', () => {
        //   disputeStatusesForFilter was the one door that had learned the rule.
        //   A fix that consolidated onto isDisputeSettled and broke this would
        //   be a net loss.
        expect(appUsers('disputeStatusesForFilter', 'src/lib/dispute-status.ts').length).toBe(2);
        expect([...disputeStatusesForFilter('resolved')]).toEqual(['resolved', 'closed']);
        expect([...disputeStatusesForFilter('open')]).toEqual(['open']);
    });
});

describe('#629 — and the rule itself answers correctly', () => {
    it('BOTH SETTLED SPELLINGS ARE SETTLED', () => {
        expect(isDisputeSettled('resolved')).toBe(true);
        expect(isDisputeSettled('closed')).toBe(true);
    });

    it('AND NEITHER OPEN ONE IS', () => {
        expect(isDisputeSettled('open')).toBe(false);
        expect(isDisputeSettled('under_review')).toBe(false);
    });

    it('AND AN ABSENT OR UNKNOWN STATUS IS NOT SETTLED', () => {
        //   "We could not tell" must not read as "done" on a dispute — that is
        //   a row nobody ever looks at again.
        for (const unknown of [null, undefined, '', 'RESOLVED', 'settled', 'closed ']) {
            expect(isDisputeSettled(unknown as any)).toBe(false);
        }
    });

    it('AND THE FOUR STATUSES ARE PARTITIONED, with nothing falling between', () => {
        /*
         *   The defect stated as a property. The admin screen splits disputes
         *   into open, under_review and settled; if those three do not cover
         *   every status a dispute can be stored with, some row is in none of
         *   them and the totals under-count without saying so.
         */
        const covered = new Set([...DISPUTE_OPEN_STATUSES, ...DISPUTE_TERMINAL_STATUSES]);
        expect([...DISPUTE_STATUSES].filter(s => !covered.has(s))).toEqual([]);
        //   And the two halves do not overlap, or a dispute would be counted twice.
        expect(DISPUTE_OPEN_STATUSES.filter(s => DISPUTE_TERMINAL_STATUSES.includes(s))).toEqual([]);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the guard hand-writes the rule again               KILLED
 *     THE DEFECT: the admin tally counts one spelling again          KILLED
 *     THE DEFECT: the escalated tally counts one spelling again      KILLED
 *     the settled rule forgets "closed"                              KILLED
 *     an unknown status counts as settled                            KILLED
 *     the filter stops matching both spellings                       KILLED
 *     the sweep counts comment mentions again                        KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   The fifth is the one that would be a worse bug than the original: making
 *   "settled" mean "not open" marks a dispute with an unreadable status as done,
 *   and a dispute marked done is a row nobody looks at again.
 *
 * ── THE TWO TALLY MUTANTS SURVIVED FIRST, AND THE REASON IS THIS FILE'S OWN ─
 *   SUBJECT ─────────────────────────────────────────────────────────────────
 *
 *   The first assertion checked that each screen APPEARS in the list of files
 *   using `isDisputeSettled`. Reverting a tally to `d.status === "resolved"`
 *   leaves the import untouched, so the file still mentions the symbol and the
 *   assertion stayed green while the count was wrong again.
 *
 *   MENTIONING A RULE IS NOT USING IT — which is, word for word, the defect
 *   this file was written about, reproduced inside the test for it. The
 *   assertion is on the EXPRESSION now, and no dispute screen may filter on a
 *   single terminal spelling.
 */
