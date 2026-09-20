/**
 * @jest-environment node
 */

/**
 *   THE DASHBOARD LINKED TO A ROUTE THAT DID NOT EXIST.
 *
 *   dashboard/page.tsx builds a `pendingUrl` per module. Three of four
 *   resolved:
 *
 *       /export/onboarding/pending        exists
 *       /marketplace/onboarding/pending   exists
 *       /cooperatives/onboarding/pending  ← 404
 *       /farm-nation/onboarding/pending   exists
 *
 *   From the production log, twice in thirty-two seconds from one phone,
 *   referred from /dashboard. Three of four is the one-of-N shape again.
 *
 *   AND THE PAGE IS ONLY HALF THE FIX, which is what this file is really for.
 *
 *   #799 records what a pending screen does with no entry in
 *   APPLICATION_QUERIES: every poll returns UNKNOWN,
 *   usePendingApplicationStatus sets `checkFailed` and returns early so a
 *   non-answer cannot overwrite a real status, `status` never leaves its
 *   initial "pending", and the effect that redirects on approval never fires.
 *   An approved applicant sits on "Application Under Review" for ever.
 *
 *   Export lived like that for the whole life of #415. So the assertion below
 *   is not "the page exists" — it is that EVERY pendingUrl the dashboard can
 *   produce has both a route and a lookup behind it.
 */

import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { join } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Every pendingUrl the dashboard builds, taken from the dashboard itself. */
const pendingUrls = (): string[] => {
    const src = read('src/app/dashboard/page.tsx');
    return [...src.matchAll(/pendingUrl:\s*"([^"]+)"/g)].map((m) => m[1]);
};

describe('every pendingUrl the dashboard builds has a route behind it', () => {
    it('THE test — including the cooperative one, which 404ed in production', () => {
        const missing = pendingUrls().filter(
            (url) => !existsSync(join(ROOT, 'src/app', `${url}/page.tsx`)),
        );

        expect({ missing }).toEqual({ missing: [] });
    });

    it('VACUITY GUARD: the dashboard really does build four of them', () => {
        //   A regex that matched nothing would make the assertion above pass
        //   while every link stayed broken.
        const urls = pendingUrls();

        expect(urls).toContain('/cooperatives/onboarding/pending');
        expect(urls.length).toBeGreaterThanOrEqual(4);
    });

    it('and the existsSync check would actually catch a missing one', () => {
        expect(existsSync(join(ROOT, 'src/app/cooperatives/onboarding/pending/page.tsx'))).toBe(true);
        expect(existsSync(join(ROOT, 'src/app/cooperatives/onboarding/nope/page.tsx'))).toBe(false);
    });
});

describe('and a lookup behind it, or the screen polls for ever — #799', () => {
    it('THE test — the cooperative pending screen has an APPLICATION_QUERIES entry', () => {
        /*
         *   The page asks for `users:cooperatives`. With no entry that key
         *   matches nothing, getMyApplicationStatus returns UNKNOWN, and the
         *   approval redirect never fires — which is precisely what #799
         *   found had been happening to export.
         */
        const page = read('src/app/cooperatives/onboarding/pending/page.tsx');
        const myData = read('src/app/actions/my-data.ts');

        //   What the page asks for, read off the page rather than assumed.
        expect(page).toMatch(/collectionName:\s*COLLECTIONS\.USERS/);
        expect(page).toMatch(/statusField:\s*"cooperatives"/);

        //   And the entry that answers it.
        expect(myData).toMatch(/\[`\$\{COLLECTIONS\.USERS\}:cooperatives`\]/);
        expect(myData).toMatch(/fromServiceRegistrations:\s*"cooperatives"/);
    });

    it('reads the PLURAL, which is the spelling every writer transitions', () => {
        //   Both spellings exist and schema-normalizer mirrors them, but the
        //   status transitions are written to `cooperatives`. Reading the
        //   singular would answer for a field the writers only reach through
        //   a mirror.
        //
        //   Counted in Node, not through a shell grep. The first version of
        //   this test escaped its pattern for a template, a heredoc and a
        //   regex at once, matched nothing, and reported zero for BOTH
        //   spellings — a comparison between two zeroes, which is no
        //   comparison at all.
        const dir = 'src/app/actions/cooperative';
        const sources = readdirSync(join(ROOT, dir))
            .filter((f) => f.endsWith('.ts'))
            .map((f) => stripComments(read(`${dir}/${f}`)))
            .join('\n');

        const count = (needle: string) => sources.split(needle).length - 1;
        const plural = count('serviceRegistrations.cooperatives.status');
        const singular = count('serviceRegistrations.cooperative.status');

        expect(plural).toBeGreaterThan(0);
        expect(plural).toBeGreaterThan(singular);
    });
});

describe('the screen refuses more than its siblings, on purpose', () => {
    const page = () => read('src/app/cooperatives/onboarding/pending/page.tsx');

    it('a SUSPENDED member is not sent back to the application form', () => {
        /*
         *   The sibling screens redirect on `rejected || revision_required`.
         *   Cooperative status also carries `suspended`, which
         *   registration-progress puts in DECIDED_AGAINST — so the same shape
         *   would hand a suspended member a fresh application, the
         *   reversal-for-the-price-of-the-fee this platform has met before.
         *
         *   Only revision_required, the one status that is an explicit
         *   invitation to resubmit, returns anybody to the form.
         */
        //   STRIPPED, BECAUSE PROSE IS NOT CODE. The comment inside this very
        //   effect explains why suspended is excluded — and so it contains the
        //   word. The first version of this assertion read the raw source and
        //   failed on its own explanation, which is the same hole that let a
        //   gate-check pass on a mention in a comment earlier in this sweep.
        const src = stripComments(page());
        const redirectToForm = src.slice(
            src.indexOf('useEffect('), src.indexOf('const decidedAgainst'));

        expect(redirectToForm).toContain('revision_required');
        expect(redirectToForm).not.toContain('suspended');
        expect(redirectToForm).not.toContain('rejected');
    });

    it('VACUITY GUARD: and suspended really is decided-against', () => {
        const { isDecidedAgainst } = require('@/lib/registration-progress');

        expect(isDecidedAgainst('suspended')).toBe(true);
        expect(isDecidedAgainst('revision_required')).toBe(false);
        expect(isDecidedAgainst('pending')).toBe(false);
    });
});
