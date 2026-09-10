/**
 * @jest-environment node
 */

/**
 *   #600 THE ADMIN SCREENS WERE EXCLUDED FROM EVERY RATCHET IN THIS AUDIT, AND
 *        THEY ARE WHERE THE MONEY IS RELEASED.
 *
 *   Six ledgers — #545, #588, #589, #596, #597, #598 — each walk `src/app` and
 *   each skip one directory, with the same sentence attached:
 *
 *       //   Admin is a separate pass — a handful of staff, not every member.
 *
 *   That reasoning is about HOW MANY PEOPLE SEE THE SCREEN. It is the wrong
 *   question. /admin/marketplace/withdrawals is where a member's withdrawal is
 *   approved; /admin/escrow is where funds are released to a seller;
 *   /admin/cooperatives/loans is where a loan is disbursed. A blank page there
 *   is not five people inconvenienced — it is a seller who does not get paid,
 *   and nobody to tell because the person who would have noticed is the one
 *   looking at the blank page.
 *
 *   Measured, the exclusion was hiding:
 *
 *       26 hand-written humanisers   — a `.replace("_", " ")` or `.charAt(0)`
 *                                      read straight off a document, on the
 *                                      escalated-disputes list, the loans
 *                                      approval screen, the export orders
 *                                      table and eleven more
 *       32 unguarded .toLocaleString — every audit-log counter, the SMS
 *                                      broadcast preview a staff member reads
 *                                      before sending to thousands of people,
 *                                      and every export figure
 *        5 hand-written date formatters — including the two on
 *                                      /admin/marketplace/withdrawals and
 *                                      /admin/marketplace/disputes/escalated
 *
 *   All sixty-three are fixed, and the three ratchets walk `src/app/admin` now.
 *   This file exists to make the SCOPE ITSELF a tested claim: an exclusion that
 *   nobody checks is how a ratchet becomes decoration, and re-adding
 *   `if (entry !== 'admin')` to any of the three would otherwise be silent.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   NO ADMIN SCREEN HAS BEEN RENDERED WITH A BARE ROW. The bare-row floor —
 *   #589's, now 83 screens — still covers member-facing screens only, and it
 *   cannot be extended to admin cheaply: not one admin screen takes a
 *   server-seeded `initial` prop, so there is nothing to hand a hostile document
 *   to. They all fetch in the browser, which means each would need its own
 *   mocked action shape, and a wrong shape gives a vacuous pass rather than a
 *   finding. That is real remaining work and it is stated here rather than
 *   implied by the three ratchets going green.
 *
 *   THE CLASSES FIXED ARE THE THREE THAT WERE ALREADY MEASURED. There may be
 *   others in admin that no instrument in this audit looks for yet.
 *
 *   TWO SITES REMAIN AND ARE NAMED. Both are on
 *   /admin/farm-nation/land-verification, both sit behind a
 *   `typeof x === "string"` the pattern cannot see, and neither can throw.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

/** The ledgers that walk src/app and must not be walking around admin. */
const RATCHETS = [
    'src/__tests__/unit/a-row-with-nothing-on-it.test.tsx',
    'src/__tests__/unit/a-date-that-is-not-one.test.tsx',
    'src/__tests__/unit/a-number-nobody-wrote.test.tsx',
];

function adminFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (entry.endsWith('.tsx')) found.push(full);
        }
    };
    walk(join(ROOT, 'src/app/admin'));
    return found;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#600 — the scope of the ratchets is itself a claim', () => {
    it('NOT ONE OF THEM SKIPS THE ADMIN DIRECTORY ANY MORE', () => {
        /**
         *   The exclusion was one clause — `if (entry !== 'admin') walk(full)` —
         *   repeated in three files. Re-adding it would take every admin screen
         *   back out of every count while all three suites stayed green, which
         *   is precisely the failure mode a ratchet is supposed to prevent.
         */
        //   THE LIST IS CHECKED BEFORE IT IS USED. A SURVIVING MUTANT IS WHY:
        //   deleting an entry from RATCHETS left the loop passing over fewer
        //   files and asserting nothing about the one that was removed. Each
        //   must also exist, so a rename cannot empty the check silently.
        expect(RATCHETS).toHaveLength(3);
        for (const ratchet of RATCHETS) {
            const src = readFileSync(join(ROOT, ratchet), 'utf-8');
            expect({ ratchet, skipsAdmin: /entry\s*!==\s*'admin'/.test(src) })
                .toEqual({ ratchet, skipsAdmin: false });
            expect({ ratchet, walksSrcApp: src.includes("walk(join(ROOT, 'src/app'))") })
                .toEqual({ ratchet, walksSrcApp: true });
        }
    });

    it('AND THE ADMIN DIRECTORY IS BIG ENOUGH THAT SKIPPING IT MATTERED', () => {
        //   The alibi: if this were three files, the exclusion would have been
        //   a rounding error rather than a hole.
        expect(adminFiles().length).toBeGreaterThan(50);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#600 — and the three classes are gone from admin', () => {
    /** A `.replace("_"…)` or `.charAt(0)` on a value read off an object. */
    function handWrittenHumanisers(src: string): string[] {
        const re = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\.\s*(?:replace\s*\(\s*["'/]_|charAt\s*\(\s*0\s*\))/g;
        return (src.match(re) ?? []).filter(hit => !hit.includes('?.'));
    }

    /** `a.b.toLocaleString()` where the root is not a module constant. */
    function unguardedLocaleStrings(src: string): string[] {
        const re = /(?<![A-Za-z0-9_$.])([A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*)+)\.toLocaleString\(\)/g;
        const hits: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
            if (/^[A-Z0-9_]+$/.test(m[1])) continue;
            if (m[0].includes('?.')) continue;
            hits.push(m[0]);
        }
        return hits;
    }

    /** A formatter built by hand rather than taken from lib/date-utils. */
    function handWrittenDateFormatters(src: string): string[] {
        return src.match(/new\s+Intl\.DateTimeFormat\s*\(/g) ?? [];
    }

    it('THE HUMANISERS ARE DOWN TO THE TWO A REGEX CANNOT READ', () => {
        const offenders = adminFiles()
            .map(f => ({ file: f.slice(ROOT.length + 1), hits: handWrittenHumanisers(readFileSync(f, 'utf-8')) }))
            .filter(o => o.hits.length);

        //   Named, not counted: the claim is about WHICH file, so a new one
        //   somewhere else fails even if the total happens to match.
        expect(offenders.map(o => o.file)).toEqual([
            'src/app/admin/farm-nation/land-verification/page.tsx',
        ]);
        //   And that file's two are behind a `typeof x === "string"`.
        const src = readFileSync(join(ROOT, 'src/app/admin/farm-nation/land-verification/page.tsx'), 'utf-8');
        expect(src).toContain('typeof verification.category === "string"');
    });

    it('AND THE UNGUARDED toLocaleString CALLS ARE ZERO', () => {
        const offenders = adminFiles()
            .map(f => ({ file: f.slice(ROOT.length + 1), hits: unguardedLocaleStrings(readFileSync(f, 'utf-8')) }))
            .filter(o => o.hits.length);

        expect(offenders).toEqual([]);
    });

    it('AND NO ADMIN SCREEN BUILDS ITS OWN DATE FORMATTER', () => {
        const offenders = adminFiles()
            .map(f => ({ file: f.slice(ROOT.length + 1), hits: handWrittenDateFormatters(readFileSync(f, 'utf-8')) }))
            .filter(o => o.hits.length);

        expect(offenders).toEqual([]);
    });

    it('AND ALL THREE SCANS CAN STILL FIND ONE — the guard that zero needs', () => {
        //   #484's shape, three times: at zero, a scan that reads nothing looks
        //   exactly like a codebase that is clean.
        expect(adminFiles().length).toBeGreaterThan(50);
        expect(handWrittenHumanisers('{order.status.replace("_", " ")}')).toHaveLength(1);
        expect(handWrittenHumanisers('{order.status?.replace("_", " ")}')).toHaveLength(0);
        expect(unguardedLocaleStrings('{stats.total.toLocaleString()}')).toHaveLength(1);
        expect(unguardedLocaleStrings('{numberOrZero(stats.total).toLocaleString()}')).toHaveLength(0);
        expect(unguardedLocaleStrings('{CURRENCY_CONFIG.fee.toLocaleString()}')).toHaveLength(0);
        expect(handWrittenDateFormatters('new Intl.DateTimeFormat("en-NG", {}).format(d)')).toHaveLength(1);
        expect(handWrittenDateFormatters('formatDateOrDash(d)')).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#600 — and the work that is left is written down, not implied', () => {
    it('NO ADMIN SCREEN IS SERVER-SEEDED, WHICH IS WHY THE BARE-ROW FLOOR STOPS HERE', () => {
        /**
         *   The honest limit. #589's floor renders a screen with a hostile
         *   document by handing it one through its `initial` prop. Not one admin
         *   screen has that prop — they all fetch in the browser — so extending
         *   the floor to admin means mocking each screen's actions in its own
         *   shape, and a shape guessed wrong is a vacuous pass rather than a
         *   finding.
         *
         *   Asserted rather than asserted-about: if an admin screen ever gains a
         *   seed, this fails and the floor should take it.
         */
        const isSeeded = (src: string) => src.includes('initial = null');

        const seeded = adminFiles()
            .filter(f => isSeeded(readFileSync(f, 'utf-8')))
            .map(f => f.slice(ROOT.length + 1));
        expect(seeded).toEqual([]);

        /**
         *   AND THE DETECTOR CAN DETECT, WHICH A DELETED ASSERTION HIDES. A
         *   mutant that softened the line above to `.toBeGreaterThanOrEqual(0)`
         *   survived, because nothing proved the filter was capable of matching.
         *   #599 hit the same thing and learned the same lesson: an assertion
         *   deleted always survives, so the thing being asserted has to be
         *   exercised against a known answer.
         */
        expect(isSeeded('export default function X({ initial = null }) {}')).toBe(true);
        expect(isSeeded('export default function X() {}')).toBe(false);
        //   And the member-facing side really does have some, so "none in
        //   admin" is a fact about admin rather than about the string.
        const memberSeeded = readFileSync(
            join(ROOT, 'src/app/marketplace/seller/dashboard/SellerDashboardClient.tsx'), 'utf-8');
        expect(isSeeded(memberSeeded)).toBe(true);
    });
});

/**
 * ── THE MUTATION TABLE ──────────────────────────────────────────────────────
 *
 *   Against a green baseline, one anchored swap at a time, each restored and
 *   verified with `diff -q` before the next:
 *
 *     the humaniser ratchet skips admin again          KILLED (2 tests)
 *     the date ratchet skips admin again               KILLED (2)
 *     the toLocaleString ratchet skips admin again     KILLED (2)
 *     admin withdrawals: the hand-written formatter back KILLED (2)
 *     admin escalated disputes: the humaniser back     KILLED (3)
 *     admin loans: the humaniser back                  KILLED (3)
 *     admin export: a figure unguarded again           KILLED (2)
 *     the admin walk pointed at one subtree            KILLED (3)
 *     a ratchet dropped from the RATCHETS list         KILLED  ← see below
 *     the seeded-admin assertion softened              SURVIVED — see below
 *     reword this header                               SURVIVED, as intended
 *
 *   ONE SURVIVED THE FIRST RUN AND WAS FIXED. Deleting an entry from RATCHETS
 *   left the loop passing over fewer files and asserting nothing about the one
 *   removed — the same "a loop over an emptied list asserts nothing" that #595's
 *   FIXED ledger had. Its length is asserted now, and each entry must also
 *   still walk `src/app`.
 *
 *   AND ONE SURVIVES ON PURPOSE, RECORDED RATHER THAN PAPERED OVER. Softening
 *   `expect(seeded).toEqual([])` to `toBeGreaterThanOrEqual(0)` survives, and it
 *   always will: a mutant that deletes an assertion survives by definition,
 *   because the assertion IS the test. #599 hit this and converted its
 *   comparison into a named function so mutants had code to attack. The same
 *   move is made here for the DETECTOR — `isSeeded` is exercised against a
 *   known-true and a known-false input, and against a member-facing screen that
 *   really is seeded — so the check is falsifiable even though the assertion
 *   itself cannot be mutation-killed. Claiming otherwise would be the kind of
 *   coverage claim this audit exists to catch.
 */
