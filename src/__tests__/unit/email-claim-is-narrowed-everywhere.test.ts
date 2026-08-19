/**
 * @jest-environment node
 */

/**
 * Every place that claims a module application BY EMAIL applies the same two
 * narrowings.
 *
 * WHY THIS GATE EXISTS
 * --------------------
 * WAVE, Export and Farm Nation each grew the same "let a returning applicant
 * claim their legacy application by email" block, copied between them. It had
 * two defects:
 *
 *   1. When the `userEmail` query came back empty it fell back to a second
 *      field — `email` on WAVE, `profile.email` on the other two. `userEmail`
 *      is written from `session.user.email` at submission and is the address the
 *      account actually authenticated as. The fallback fields are not: on WAVE
 *      it was the optional address on the application form, spread straight from
 *      the applicant's own input; on the other two it arrives from an import or
 *      an admin edit. Either way, nobody proved they control it.
 *
 *   2. The `!appData.userId` test guarded only the backfill WRITE. The document
 *      was adopted either way, so an application belonging to a different user
 *      id was still read — and the block underneath promotes an `approved`
 *      application's status onto the caller AND writes it to their user record,
 *      which module-access-check Layer 2 admits on.
 *
 * It was fixed as #36 — on WAVE. The other two were found still carrying both
 * defects while writing behavioural tests for Farm Nation, and fixed as #83.
 * Three copies, one fix, two years of the other two being reachable is the
 * pattern this audit keeps meeting; a per-file regression test would not have
 * caught the second and third.
 *
 * WHAT THIS ASSERTS
 * -----------------
 * Structural, deliberately. The behavioural proof for each module lives in its
 * own suite — those run the code and would fail if a claim were widened. This
 * one asserts the SHAPE across all of them, which is what catches a FOURTH copy
 * being added to a module that has no behavioural suite yet.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

/**
 * The claiming sites. Adding a module here is the point: a new one must either
 * appear in this list or not claim by email at all.
 */
const CLAIM_SITES = [
    { module: 'WAVE', file: 'src/app/actions/wave/_wv_membership.ts' },
    { module: 'Export', file: 'src/app/actions/export/_ex_onboarding.ts' },
    { module: 'Farm Nation', file: 'src/app/actions/farm-nation/_fn_onboarding.ts' },
] as const;

const read = (file: string) =>
    stripComments(readFileSync(path.join(process.cwd(), file), 'utf8'));

/** Every actions file, so a fourth copy cannot appear somewhere unlisted. */
function allActionSources(): Array<{ file: string; code: string }> {
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const listed = execFileSync('git', ['ls-files', 'src/app/actions', 'src/app/api'], {
        cwd: process.cwd(), encoding: 'utf8',
    })
        .split('\n')
        .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

    return listed.map((file) => ({ file, code: read(file) }));
}

describe('the by-email application claim', () => {
    it.each(CLAIM_SITES)('$module queries userEmail and nothing else', ({ file }) => {
        const code = read(file);

        expect(code).toContain('"userEmail", "=="');
        // The fallback fields. `email` alone would over-match, so the assertion
        // is on the WHERE clause specifically.
        expect(code).not.toContain('"profile.email", "=="');
        expect(code).not.toMatch(/\.where\(\s*["']email["']\s*,\s*["']==["']/);
    });

    it.each(CLAIM_SITES)('$module claims only an UNCLAIMED application', ({ file }) => {
        const code = read(file);

        // The narrowing: pick the row with no userId, rather than picking the
        // first row and then testing its userId before writing.
        expect(code).toMatch(/\.docs\.find\(\s*\w+\s*=>\s*!\w+\.data\(\)\?\.userId\s*\)/);
        // And the old shape is gone: docs[0] taken unconditionally.
        expect(code).not.toMatch(/appDoc\s*=\s*emailQuery\.docs\[0\]/);
    });

    it.each(CLAIM_SITES)('$module says so when it declines to claim', ({ file }) => {
        // A silent decline is how a support ticket becomes unanswerable: the
        // applicant sees "no application" and the log says nothing happened.
        const code = read(file);
        expect(code).toMatch(/already belongs to another account/);
    });

    it('no OTHER action or route claims an application by email', () => {
        const listed = CLAIM_SITES.map((s) => s.file);
        const offenders = allActionSources()
            .filter(({ file }) => !listed.includes(file as (typeof CLAIM_SITES)[number]['file']))
            .filter(({ code }) =>
                /\.where\(\s*["']userEmail["']\s*,\s*["']==["']/.test(code)
                && /\.update\(\s*\{\s*userId\s*:/.test(code))
            .map(({ file }) => file);

        expect(offenders).toEqual([]);
    });

    it('and the scan can see a violation — the sweep above is not vacuous', () => {
        // A synthetic positive control. The count-floor version of this test
        // ("at least N files were scanned") passes when the predicate is broken;
        // this one fails.
        const synthetic = `
            const emailQuery = await db.collection(X).where("userEmail", "==", e).limit(1).get();
            const appDoc = emailQuery.docs[0];
            await appDoc.ref.update({ userId: session.user.id });
        `;
        const violates = /\.where\(\s*["']userEmail["']\s*,\s*["']==["']/.test(synthetic)
            && /\.update\(\s*\{\s*userId\s*:/.test(synthetic);

        expect(violates).toBe(true);
    });

    it('and the unclaimed-filter pattern really does reject the old shape', () => {
        // The other half of the control: the pattern the three sites must match
        // must not match what they used to look like.
        const oldShape = `
            appDoc = emailQuery.docs[0];
            const appData = appDoc.data();
            if (!appData.userId) { await appDoc.ref.update({ userId: session.user.id }); }
        `;
        expect(oldShape).not.toMatch(/\.docs\.find\(\s*\w+\s*=>\s*!\w+\.data\(\)\?\.userId\s*\)/);

        const newShape = `const unclaimed = emailQuery.docs.find(d => !d.data()?.userId);`;
        expect(newShape).toMatch(/\.docs\.find\(\s*\w+\s*=>\s*!\w+\.data\(\)\?\.userId\s*\)/);
    });
});
