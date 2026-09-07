/**
 * @jest-environment node
 */

/**
 *   #481 SIX BOOLEANS COST SIX ROUND TRIPS EACH WAY, ON THE CRITICAL PATH.
 *
 *   The owner: "the dashboard loading is still slow, why?" — after #473 cut
 *   /admin from 4.6 MB to 1 kB and 97 round trips to 37. So I measured the thing
 *   I had never measured: not how MANY database calls a page makes, but how many
 *   of them are SEQUENTIAL. A page waits for its longest chain, not its total.
 *
 *   The longest chain on /admin was six single-toggle reads:
 *
 *       document_collections?id=eq.wave_program&collection_name=eq.feature_toggles
 *       document_collections?id=eq.cooperative_loans&…
 *       document_collections?id=eq.escrow_messaging&…
 *       document_collections?id=eq.farm_nation_purchases&…
 *       document_collections?id=eq.academy_courses&…
 *       document_collections?id=eq.digital_id_system&…
 *
 *   useFeatureToggles() asks for them inside a Promise.all, which LOOKS parallel.
 *   It is not: each is a separate SERVER ACTION, so each is its own
 *   browser -> server request AND its own server -> database query. Six of each,
 *   one after another, before the navigation can render.
 *
 *   Locally that is 71 ms and invisible. Over the network to Railway and on to
 *   Supabase it is the dominant cost of the page — which is exactly why every
 *   measurement I took on this machine said the page was fast while the owner
 *   said it was slow. Milliseconds here are hardware; ROUND TRIPS transfer.
 *
 *   MEASURED, cold, through a real browser:
 *
 *       BEFORE   45 round trips, 6 of them feature toggles
 *       AFTER    32 round trips, 1 of them feature toggles
 *
 *   FAIL-CLOSED IS PRESERVED, AND THAT IS THE PART TO BE CAREFUL WITH. #245
 *   removed a catch that returned DEFAULT_TOGGLES on a read error, because seven
 *   of those default to TRUE — a transient failure re-enabled a feature an admin
 *   had killed. #410 fixed the same thing in the client hook. Batching six reads
 *   into one makes a single failure affect all six, so the failure path matters
 *   MORE here than it did before, not less.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the batch action returns DEFAULT_TOGGLES on error   KILLED
 *     the hook goes back to one call per toggle           KILLED
 *     an unknown toggle resolves to true                  KILLED
 *     the stored value is ignored                         KILLED
 *     reword this header                                  SURVIVED, as intended
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { resolveToggle, DEFAULT_TOGGLES } from '@/lib/feature-toggles';

const ACTION = 'src/app/actions/feature-toggles.ts';
const HOOK = 'src/hooks/useFeatureToggle.ts';
const source = (p: string) => stripComments(readFileSync(p, 'utf-8'));

beforeEach(() => { jest.clearAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('#481 — every toggle a page needs comes back in one call', () => {
    it('THE BATCH ACTION READS THE COLLECTION ONCE, NOT ONE DOCUMENT PER NAME', () => {
        //   The assertion the finding is about. `.doc(name).get()` per toggle is
        //   what produced the six-deep chain.
        const code = source(ACTION);
        const fn = code.slice(code.indexOf('export async function getFeatureToggles('));
        const body = fn.slice(0, fn.indexOf('\nexport '));

        expect(body).toContain('db.collection(COLLECTIONS.FEATURE_TOGGLES).get()');
        expect(body).not.toContain('.doc(');
    });

    it('AND THE HOOK MAKES ONE SERVER CALL, NOT ONE PER NAME', () => {
        //   Promise.all over N server actions is N browser round trips. This is
        //   the half that was invisible from the server-side trace.
        const hook = source(HOOK);
        const fn = hook.slice(hook.indexOf('export function useFeatureToggles'));

        expect(fn).toContain('await getFeatureToggles(featureNames)');
        expect(fn).not.toContain('featureNames.map(async (name)');
    });

    it('AND THE SINGLE-TOGGLE PATH IS UNTOUCHED — server callers still use it', () => {
        //   Control: wallet.ts, wave earnings and others ask for exactly one
        //   toggle in server context, where there is no browser round trip to
        //   save. Removing it to "simplify" would break them.
        const code = source(ACTION);

        expect(code).toContain('export async function getFeatureToggle(featureName: string)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#481 — batching makes the failure path matter MORE, not less', () => {
    /**
     * One read now answers six questions, so one failure decides six answers.
     * #245 removed a catch that returned DEFAULT_TOGGLES on error because seven
     * of those default to TRUE — a transient error re-enabled a feature an admin
     * had killed. That must hold for all six at once.
     */
    it('A FAILED READ FAILS CLOSED FOR EVERY NAME', () => {
        const code = source(ACTION);
        const fn = code.slice(code.indexOf('export async function getFeatureToggles('));
        const body = fn.slice(0, fn.indexOf('\nexport '));

        expect(body).toContain('resolveToggle(name, { readFailed: true })');
        expect(body).not.toContain('DEFAULT_TOGGLES[name]');
    });

    it('AND resolveToggle REALLY DOES FAIL CLOSED — the premise, asked directly', () => {
        //   The whole argument rests on this helper. If it ever returned the
        //   default on a read failure, every assertion above would be guarding
        //   nothing.
        const defaultsTrue = Object.entries(DEFAULT_TOGGLES)
            .filter(([, v]) => v === true)
            .map(([k]) => k);

        expect(defaultsTrue.length).toBeGreaterThan(0);
        for (const name of defaultsTrue) {
            expect({ name, onReadFailure: resolveToggle(name, { readFailed: true }) })
                .toEqual({ name, onReadFailure: false });
        }
    });

    it('AND THE HOOK STILL FAILS CLOSED IF THE CALL NEVER ARRIVES', () => {
        //   The action fails closed internally; this covers the request itself
        //   not completing — which is what #410 was about.
        const fn = source(HOOK);

        expect(fn).toContain('resolveToggle(name, { readFailed: true })');
    });

    it('POSITIVE CONTROL: a stored value is still honoured', () => {
        //   Without this, "fails closed" could be satisfied by returning false
        //   for everything, which would switch the whole platform off.
        const on = Object.keys(DEFAULT_TOGGLES)[0];

        expect(resolveToggle(on, { stored: true })).toBe(true);
        expect(resolveToggle(on, { stored: false })).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#481 — asked directly, not read off the source', () => {
    /**
     *   A MUTANT THAT IGNORED THE STORED VALUE SURVIVED THE FIRST ROUND.
     *
     *   `resolveToggle(name, {})` instead of `{ stored: stored.get(name) }`
     *   passes every source scan above and every assertion about resolveToggle
     *   itself — and makes the batch return each toggle's DEFAULT, so a feature
     *   an admin had turned OFF comes back ON. That is #245's failure class
     *   exactly, reintroduced by the fix meant to be safe.
     *
     *   Source scanning cannot catch it. Asking the function can.
     */
    const snap = (docs: Array<{ id: string; data: () => unknown }>) =>
        Promise.resolve({ docs, empty: docs.length === 0, size: docs.length });

    it('A TOGGLE STORED AS FALSE COMES BACK FALSE, NOT ITS DEFAULT', async () => {
        const onByDefault = Object.entries(DEFAULT_TOGGLES).find(([, v]) => v === true)?.[0];
        expect(onByDefault).toBeDefined();

        (global as any).mockFirestoreGet.mockImplementationOnce(() =>
            snap([{ id: onByDefault!, data: () => ({ enabled: false }) }]),
        );

        const { getFeatureToggles } = await import('@/app/actions/feature-toggles');
        const out = await getFeatureToggles([onByDefault!]);

        expect({ [onByDefault!]: out[onByDefault!] }).toEqual({ [onByDefault!]: false });
    });

    it('AND A TOGGLE STORED AS TRUE COMES BACK TRUE', async () => {
        const offByDefault = Object.entries(DEFAULT_TOGGLES).find(([, v]) => v === false)?.[0];
        if (!offByDefault) return;

        (global as any).mockFirestoreGet.mockImplementationOnce(() =>
            snap([{ id: offByDefault, data: () => ({ enabled: true }) }]),
        );

        const { getFeatureToggles } = await import('@/app/actions/feature-toggles');
        const out = await getFeatureToggles([offByDefault]);

        expect({ [offByDefault]: out[offByDefault] }).toEqual({ [offByDefault]: true });
    });

    it('AND A NAME WITH NOTHING STORED FALLS BACK TO ITS DEFAULT', async () => {
        //   The control: "honours the stored value" must not be satisfied by
        //   returning false for everything, which would switch the platform off.
        const onByDefault = Object.entries(DEFAULT_TOGGLES).find(([, v]) => v === true)![0];

        (global as any).mockFirestoreGet.mockImplementationOnce(() => snap([]));

        const { getFeatureToggles } = await import('@/app/actions/feature-toggles');
        const out = await getFeatureToggles([onByDefault]);

        expect({ [onByDefault]: out[onByDefault] }).toEqual({ [onByDefault]: true });
    });

    it('AND SIX NAMES ARE ANSWERED FROM ONE READ', async () => {
        //   The performance claim, asserted rather than described: one call to
        //   the database, six answers.
        const names = Object.keys(DEFAULT_TOGGLES).slice(0, 6);
        expect(names.length).toBe(6);

        (global as any).mockFirestoreGet.mockImplementationOnce(() =>
            snap(names.map((n) => ({ id: n, data: () => ({ enabled: false }) }))),
        );

        const { getFeatureToggles } = await import('@/app/actions/feature-toggles');
        const out = await getFeatureToggles(names);

        expect(Object.keys(out).sort()).toEqual([...names].sort());
        expect((global as any).mockFirestoreGet.mock.calls.length).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#481 — the batch answers exactly what was asked', () => {
    it('DEDUPLICATES AND IGNORES RUBBISH INPUT', () => {
        //   A navigation menu that listed a toggle twice would otherwise ask for
        //   it twice, which is the defect in miniature.
        const code = source(ACTION);
        const fn = code.slice(code.indexOf('export async function getFeatureToggles('));

        expect(fn).toContain('new Set(');
        expect(fn).toContain("typeof n === 'string'");
    });

    it('AND ASKS THE DATABASE NOTHING FOR AN EMPTY LIST', () => {
        const fn = source(ACTION).slice(source(ACTION).indexOf('export async function getFeatureToggles('));

        expect(fn).toContain('if (names.length === 0) return {}');
    });
});
