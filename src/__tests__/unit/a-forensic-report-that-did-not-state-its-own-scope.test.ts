/**
 * @jest-environment node
 */

/**
 *   #918 A FORENSIC REPORT THAT DID NOT STATE ITS OWN SCOPE.
 *
 *   Found auditing src/app/admin/forensics/duplicates/page.tsx and
 *   src/services/index.ts — two of the files no test had named. The services
 *   registry turned out clean and is recorded at the bottom rather than left
 *   silent. The duplicates screen is the finding, and it is in the action behind
 *   it.
 *
 *   `listDuplicateProfileGroupsAction` reports three counts — need a decision,
 *   look at these, already settled — and nothing about what it could not see.
 *   Two blind spots, on a tool whose output an operator acts on IRREVERSIBLY, by
 *   superseding somebody's records:
 *
 *   1. `if (!email) continue;` in loadGroups. A profile with no address is
 *      skipped entirely. forensics.ts's own blank-email check found 49 of them.
 *      If two are the same person, this tool cannot group them — and never said
 *      it had not looked.
 *
 *   2. The walk stops at MAX_PAGES × PAGE = 50,000 rows. supabase-db's header
 *      calls the users table 41,000, so it fits TODAY. The day it does not, the
 *      scan returns the groups it happened to reach and the screen presents them
 *      as the answer. #915's shape exactly, three days older and on a screen
 *      rather than a console.
 *
 *   NEITHER IS FIXABLE BY LOOKING HARDER. You cannot group by an address that is
 *   absent, and the ceiling is what stops this reading the whole table on every
 *   page load. What was missing is the SENTENCE.
 *
 * ── AND THE PLATFORM ALREADY HAD THE VOCABULARY ─────────────────────────────
 *
 *   lib/forensic-scan-scope exists for this, and says why in its own header: "a
 *   check that claims completeness it does not have is worse than no check,
 *   because the owner stops looking." It carries SampleScope, sampleOf,
 *   describeSample and verdictFor, and forensics.ts uses them for its other
 *   checks — including the blank-email one that counted the 49.
 *
 *   So the fix reuses that rule rather than restating it: loadGroups returns a
 *   SampleScope and the count it skipped, the report carries both, the screen
 *   says them before the list, and an incomplete scan also logs describeSample's
 *   sentence so it can be found later. Nothing about which record is the person
 *   changes — that decision is the owner's and this screen still only presents
 *   it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { sampleOf, describeSample, type SampleScope } from '@/lib/forensic-scan-scope';

const ROOT = process.cwd();
const ACTION = 'src/app/actions/admin/_duplicate_profiles.ts';
const SCREEN = 'src/app/admin/forensics/duplicates/page.tsx';
const REGISTRY = 'src/services/index.ts';

const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.15 });

describe('#918 — the scope vocabulary this reuses', () => {
    it('THE CONTROL: sampleOf calls a ceiling-length read incomplete', () => {
        //   The property the whole finding rests on, asserted before anything
        //   depends on it. A scan that returned exactly its ceiling cannot tell
        //   "this many exist" from "there are more and I stopped".
        expect(sampleOf(41_000, 50_000).complete).toBe(true);
        expect(sampleOf(50_000, 50_000).complete).toBe(false);
        expect(sampleOf(50_001, 50_000).complete).toBe(false);
    });

    it('and describeSample produces a sentence naming both numbers', () => {
        const sentence = describeSample(sampleOf(50_000, 50_000), 'profile');

        expect(sentence).toMatch(/50,000|50000/);
        expect(sentence.length).toBeGreaterThan(10);
    });
});

describe('#918 — the action reports what it could not see', () => {
    it('THE CONTROL: the action is still the action', () => {
        const src = code(ACTION);

        expect(src).toContain('listDuplicateProfileGroupsAction');
        expect(src).toContain('loadGroups');
        expect(src.length).toBeGreaterThan(5_000);
    });

    it('IT COUNTS THE PROFILES IT SKIPS, rather than dropping them silently', () => {
        const src = code(ACTION);

        //   The skip is still there — it has to be, you cannot group by an
        //   absent address — but it is counted now.
        expect(src).toContain('withoutEmail += 1');
        expect(src).toMatch(/if \(!email\) \{ withoutEmail \+= 1; continue; \}/);
    });

    it('AND IT MEASURES ITS OWN WALK AGAINST THE CEILING', () => {
        const src = code(ACTION);

        expect(src).toContain('scanned += 1');
        //   Derived from the two constants rather than a third copy of 50,000.
        expect(src).toContain('sampleOf(scanned, MAX_PAGES * PAGE)');
    });

    it('and both reach the report', () => {
        const src = code(ACTION);

        expect(src).toContain('scope,');
        expect(src).toContain('profilesWithoutEmail: withoutEmail');
    });

    it('and an incomplete scan leaves a line in the log as well', () => {
        //   The screen is where an operator reads it; the log is where somebody
        //   finds it afterwards. `describeSample` so the sentence matches every
        //   other scan's.
        const src = code(ACTION);

        expect(src).toContain('describeSample(scope, "profile")');
        expect(src).toMatch(/if \(!scope\.complete \|\| withoutEmail > 0\)/);
    });

    it('THE RESOLVE PATH TAKES ONLY THE MAP, and still works', () => {
        //   loadGroups' return shape changed, and it has two callers. The second
        //   one — the action that actually supersedes records — must keep
        //   destructuring correctly rather than iterating a wrapper object.
        const src = code(ACTION);

        expect(src).toContain('const { byEmail } = await loadGroups()');
        expect(src).toContain('const { byEmail, scope, withoutEmail } = await loadGroups()');
        //   And no caller left reading the old shape.
        expect(src).not.toMatch(/const byEmail = await loadGroups\(\)/);
    });

    it('POSITIVE CONTROL: the stripper left real code behind', () => {
        //   One `not.toMatch` above, which passes on an empty string.
        const src = code(ACTION);

        expect(src).toContain('COLLECTIONS.USERS');
        expect(src).toContain('MAX_PAGES');
    });
});

describe('#918 — the screen says it, or the operator never learns it', () => {
    it('THE CONTROL: the screen still renders the three counts', () => {
        const src = code(SCREEN);

        expect(src).toContain('report.needsADecision');
        expect(src).toContain('report.inconsistent');
        expect(src).toContain('report.resolved');
    });

    it('IT RENDERS THE TWO ABSENCES', () => {
        const src = code(SCREEN);

        expect(src).toContain('report.profilesWithoutEmail');
        expect(src).toContain('report.scope');
        expect(src).toContain('scope?.scanned');
        expect(src).toContain('scope?.ceiling');
    });

    it('AND READS EVERY NUMBER THROUGH numberOrZero', () => {
        /*
         *   NOT MY FIRST DRAFT, and the ratchets were right.
         *
         *   It formatted the count straight off the report and tested
         *   completeness with a plain member access. #598's and #600's scans both
         *   refused it, for a hazard I had not thought through: a report served by
         *   a deployment older than this screen carries no `scope` at all, so the
         *   member access THROWS and takes down the screen an operator uses to
         *   settle duplicate accounts. The ratchet caught a crash, not a style.
         */
        const src = code(SCREEN);

        expect(src).toContain('numberOrZero(report.profilesWithoutEmail)');
        expect(src).toContain('numberOrZero(scope?.scanned)');
        expect(src).toContain('numberOrZero(scope?.ceiling)');
        expect(src).toContain("from \"@/lib/numbers\"");
    });

    it('AND A MISSING SCOPE CLAIMS NOTHING, in either direction', () => {
        //   `!report.scope?.complete` would have been the easy fix and is wrong:
        //   an absent scope makes it true, so an old report would render "the scan
        //   stopped at its limit" about a scan that never reported one. The notice
        //   appears only when incompleteness is actually stated.
        const src = code(SCREEN);

        expect(src).toContain('scope ? scope.complete === false : false');
        expect(src).not.toContain('!report.scope.complete');
        expect(src).not.toContain('!report.scope?.complete');
    });

    it('and only when there is something to say', () => {
        //   An ordinary complete run stays quiet. A permanent "this might be
        //   incomplete" banner is read once and then never again, which is the
        //   same failure as saying nothing.
        const src = code(SCREEN);

        expect(src).toContain('if (!scanIncomplete && withoutEmail <= 0) return null;');
    });

    it('and it describes a limit on the tool, not a finding about anybody', () => {
        //   Wording matters on this screen — its own header argues that at length
        //   about the apply button. The same care applies to a disclosure an
        //   operator will read as an accusation if it is phrased as one.
        //   Whitespace-normalised: this is JSX prose, so a sentence wraps across
        //   lines and `toContain` on a phrase that spans one is asserting the line
        //   break rather than the wording. The first draft failed on exactly that.
        const src = code(SCREEN).replace(/\s+/g, ' ');

        expect(src).toContain('What this list does not cover');
        expect(src).toContain('not grouped here at all');
        expect(src).toContain('could be the same person and this list would not show it');
        expect(src).toContain('floor rather than a total');
    });

    it('POSITIVE CONTROL: the stripper left the screen behind', () => {
        //   Three `not`-shaped assertions above, all of which pass on an empty
        //   string.
        const src = code(SCREEN);

        expect(src).toContain('DuplicateProfilesPage');
        expect(src.length).toBeGreaterThan(5_000);
    });
});

/**
 *   AND A NOTE ON THE TWO SCANS THAT CAUGHT ME, because it cost two rounds and
 *   will cost the next person the same.
 *
 *   #598's and #600's toLocaleString scans read RAW SOURCE. So a comment written
 *   in the shape they look for counts as an instance. This file's screen was
 *   refused twice: once for a note quoting the original line, and again for the
 *   placeholder substituted to describe the shape — which was, of course, an
 *   example of it.
 *
 *   #598 imports stripComments and uses it for its own render assertions, then
 *   reads raw for this scan. #600 does not import it at all. Neither is wrong
 *   about the defect they exist for, and a comment cannot call a method, so both
 *   would be sharper stripping comments first — the same correction #916 made to
 *   erasure-retires-never-destroys.
 *
 *   NOT CHANGED HERE. Altering two shared ratchets' semantics in the same breath
 *   as the change they refused is how a guard quietly stops guarding, and #916
 *   already moved one this session. Recorded so it is a decision somebody takes
 *   on purpose.
 */
describe('#918 — the scans read raw source, and that is why the note is worded oddly', () => {
    it('BOTH SCANS STILL READ RAW SOURCE — measured, not assumed', () => {
        const nobodyWrote = readFileSync(join(ROOT, 'src/__tests__/unit/a-number-nobody-wrote.test.tsx'), 'utf8');
        const adminScope = readFileSync(join(ROOT, 'src/__tests__/unit/the-admin-screens-were-never-in-scope.test.ts'), 'utf8');

        //   #598 knows the helper and uses it — for something else.
        expect(nobodyWrote).toContain('stripComments');
        expect(nobodyWrote).toMatch(/unguardedLocaleStrings\(readFileSync\(/);

        //   #600 does not import it.
        expect(adminScope).not.toContain('stripComments');
        expect(adminScope).toMatch(/unguardedLocaleStrings\(readFileSync\(/);
    });

    it('so this screen carries no comment in the shape they match', () => {
        //   The reason the note above reads the way it does. Asserted so that a
        //   future edit adding a worked example to that comment fails here, next
        //   to the explanation, rather than in a ratchet three directories away.
        const raw = readFileSync(join(ROOT, SCREEN), 'utf8');
        const shape = /(?<![A-Za-z0-9_$.])([A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*)+)\.toLocaleString\(\)/g;

        expect(raw.match(shape)).toBeNull();
    });
});

describe('#918 — the service registry, swept and clean', () => {
    const SERVICES = ['analytics', 'communications', 'finance', 'userMetrics'] as const;

    it('THE CONTROL: the registry names every service file that exists', () => {
        const { readdirSync } = require('node:fs') as typeof import('node:fs');
        const files = readdirSync(join(ROOT, 'src/services'))
            .filter((f: string) => f.endsWith('.service.ts'))
            .map((f: string) => f.replace('.service.ts', ''))
            .sort();

        expect(files).toEqual([...SERVICES].sort());
    });

    it('and exports a singleton for each', () => {
        const src = code(REGISTRY);

        for (const name of SERVICES) {
            const singleton = `${name}Service`;
            expect({ name, exported: src.includes(`export const ${singleton}`) })
                .toEqual({ name, exported: true });
        }
    });

    it('NOTHING CONSTRUCTS A SERVICE OUTSIDE THE REGISTRY', () => {
        const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');

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

        const offenders: string[] = [];
        for (const file of walk(join(ROOT, 'src'))) {
            const rel = file.slice(ROOT.length + 1);
            if (/__tests__|\.test\./.test(rel) || rel === REGISTRY) continue;

            const src = stripComments(readFileSync(file, 'utf8'), { label: rel });
            if (/new\s+(Analytics|Communications|Finance|UserMetrics)Service\s*\(/.test(src)) {
                offenders.push(rel);
            }
        }

        expect(offenders).toEqual([]);
    });

    it('POSITIVE CONTROL: that pattern matches a real direct construction', () => {
        const pattern = /new\s+(Analytics|Communications|Finance|UserMetrics)Service\s*\(/;

        expect(pattern.test('const s = new FinanceService();')).toBe(true);
        expect(pattern.test('import { financeService } from "@/services";')).toBe(false);
    });

    it('and the singletons are the contract types, one instance each', async () => {
        //   Imported, so this is behaviour rather than a source assertion: two
        //   imports of the registry must hand back the same object, or "singleton"
        //   means nothing.
        const first = await import('@/services');
        const second = await import('@/services');

        expect(first.financeService).toBe(second.financeService);
        expect(first.analyticsService).toBe(second.analyticsService);
        expect(first.userMetricsService).toBe(second.userMetricsService);
        expect(first.communicationsService).toBe(second.communicationsService);
    });
});
