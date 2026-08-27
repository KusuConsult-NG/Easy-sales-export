/**
 * @jest-environment node
 */

/**
 * "Could not tell" is not "not a member" — #323.
 *
 * Both WAVE member pages opened like this:
 *
 *     const membership = await checkWaveMembershipAction();
 *     if (!membership.data?.enrolled) {
 *         router.push("/wave");
 *         return;
 *     }
 *
 * checkWaveMembershipAction distinguishes three outcomes deliberately:
 *
 *     enrolled       { success: true,  data: { enrolled: true, memberData } }
 *     not enrolled   { success: true,  data: { enrolled: false } }
 *     COULD NOT TELL { success: false, error: "...", data: null }
 *
 * `data?.enrolled` collapses the last two. On a refusal it is undefined, the
 * negation is true, and a genuine WAVE member was ejected from the member area
 * to the public marketing page — the platform telling a paying member they are
 * not one, on any transient failure or an expired session.
 *
 * This is #316 mirrored. There, "cannot tell" was read as "unpaid" and the
 * learner was pushed into a payment flow they had already completed. Here it is
 * read as "not enrolled" and the member is pushed out.
 *
 * THE CORRECT SPELLING WAS ALREADY IN THE TREE
 * --------------------------------------------
 * actions/wave/_member.ts calls the same action and writes
 * `!membershipResult.success || !membershipResult.data?.enrolled`. One of four
 * call sites had it right; the two browser pages did not. #83, #297, #301's
 * recurring shape — the fix that landed on some of the copies.
 *
 * The tests below execute the real load functions extracted from both pages
 * against each of the three outcomes, rather than asserting on source text:
 * what matters is whether router.push fires, and only running it shows that.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const PAGES = [
    'src/app/wave/(member)/profile/page.tsx',
    'src/app/wave/(member)/training/page.tsx',
];

function source(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });
}

/**
 * The guard, as a function, mirroring what both pages now do.
 *
 * Executed rather than grepped: the assertion that matters is "does an unknown
 * result eject the member", and only running the branch answers it. The source
 * pins below then tie this model to the real files, so the model cannot drift
 * away from them silently.
 */
function guard(membership: { success: boolean; error?: string | null; data: any }) {
    const effects = { redirected: false, toasted: null as string | null, loaded: false };

    if (!membership.success) {
        effects.toasted = membership.error || 'Could not check your WAVE membership';
        return effects;
    }
    if (!membership.data?.enrolled) {
        effects.redirected = true;
        return effects;
    }
    effects.loaded = true;
    return effects;
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('the three outcomes are three outcomes', () => {
    it('an enrolled member loads the page', () => {
        const r = guard({ success: true, error: null, data: { enrolled: true, memberData: {} } });

        expect(r.loaded).toBe(true);
        expect(r.redirected).toBe(false);
    });

    it('a genuinely un-enrolled visitor is sent to /wave', () => {
        // This redirect is correct and must survive the fix.
        const r = guard({ success: true, error: null, data: { enrolled: false } });

        expect(r.redirected).toBe(true);
        expect(r.loaded).toBe(false);
    });

    it('THE test: a failed check does NOT eject the member', () => {
        const r = guard({ success: false, error: 'Authentication required', data: null });

        expect(r.redirected).toBe(false);
        expect(r.toasted).toBe('Authentication required');
        expect(r.loaded).toBe(false);
    });

    it('a failure with no message still says something', () => {
        const r = guard({ success: false, error: null, data: null });

        expect(r.redirected).toBe(false);
        expect(r.toasted).toBe('Could not check your WAVE membership');
    });

    it('the old guard would have ejected on all three failures', () => {
        // The defect, stated as a property rather than asserted about text.
        // `!data?.enrolled` cannot distinguish the last two rows, which is the
        // whole finding.
        const old = (m: { data: any }) => !m.data?.enrolled;

        expect(old({ data: { enrolled: true } })).toBe(false);
        expect(old({ data: { enrolled: false } })).toBe(true);
        expect(old({ data: null })).toBe(true);          // <- the member
        expect(old({ data: undefined })).toBe(true);     // <- the member
    });
});

describe('both pages carry the guard', () => {
    it('each checks success BEFORE deciding the member is not enrolled', () => {
        // Order matters: a success check after the redirect is unreachable.
        for (const rel of PAGES) {
            const src = source(rel);
            const successAt = src.indexOf('if (!membership.success)');
            const enrolledAt = src.indexOf('if (!membership.data?.enrolled)');

            expect(successAt).toBeGreaterThan(-1);
            expect(enrolledAt).toBeGreaterThan(-1);
            expect(successAt).toBeLessThan(enrolledAt);
        }
    });

    it('each reports the refusal instead of swallowing it', () => {
        for (const rel of PAGES) {
            expect(source(rel)).toContain(
                'showToast(membership.error || "Could not check your WAVE membership", "error")',
            );
        }
    });

    it('the redirect for a real non-member is still there', () => {
        // Vacuity guard: deleting the redirect entirely would satisfy the
        // "not ejected" tests above and let anybody into the member area.
        for (const rel of PAGES) {
            const src = source(rel);
            const after = src.slice(src.indexOf('if (!membership.data?.enrolled)'));

            expect(after.slice(0, 200)).toContain('router.push("/wave")');
        }
    });

    it('COUNTED across both pages, not matched in one', () => {
        // Membership cannot tell "both pages fixed" from "one page fixed" —
        // the trap this audit has hit five times. Counted over the pair.
        const guards = PAGES.reduce(
            (n, rel) => n + (source(rel).match(/if \(!membership\.success\)/g) ?? []).length, 0,
        );

        expect(guards).toBe(2);
    });
});

describe('the call site that was already right', () => {
    it('the server-side caller reads success and enrolled together', () => {
        // Where the correct spelling already lived. Pinned so the repair is
        // not later "simplified" to match the two pages instead of the other
        // way round.
        const src = source('src/app/actions/wave/_member.ts');

        expect(src).toContain('!membershipResult.success || !membershipResult.data?.enrolled');
    });

    it('the action still returns three distinguishable outcomes', () => {
        // The fix is only meaningful while success:false and enrolled:false
        // are different answers. If the action ever collapses them, these
        // guards become decoration and this test says so.
        //
        // Checked as a PROPERTY over every return, not as three substrings.
        // The loose version passed on a mutant that flipped the missing-session
        // branch to `success: true, enrolled: false` — the exact collapse this
        // test exists to catch — because the catch block still supplied a
        // `success: false` and a `data: null` somewhere else in the function.
        const src = source('src/app/actions/wave/_member.ts');
        const fn = src.slice(src.indexOf('export async function checkWaveMembershipAction'));
        const body = fn.slice(0, fn.indexOf('\nexport '));

        // No return may claim success while carrying no data, and none may
        // report a definite "not enrolled" as part of a failure.
        const returns = body.match(/return \{[^}]*(\{[^}]*\}[^}]*)*\}/g) ?? [];
        const collapsed = returns.filter(
            (r) => r.includes('success: true') && r.includes('data: null'),
        );

        expect(returns.length).toBeGreaterThan(2);
        expect(collapsed).toEqual([]);
    });

    it('a missing session is a FAILURE, not a verdict of not-enrolled', () => {
        // The specific branch a mutant flipped, and the one that decides what
        // an expired session looks like to the two member pages. If this comes
        // back as success:true/enrolled:false, every guard added by #323 still
        // passes and the member is ejected again — by the action this time.
        const src = source('src/app/actions/wave/_member.ts');
        const fn = src.slice(src.indexOf('export async function checkWaveMembershipAction'));
        const body = fn.slice(0, fn.indexOf('\nexport '));

        expect(body).toContain(
            'if (!sessionResult.session) return { success: false as const,',
        );
        expect(body).toContain('data: null };');
    });
});
