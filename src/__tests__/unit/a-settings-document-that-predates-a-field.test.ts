/**
 *   #604 A SETTINGS DOCUMENT THAT PREDATES A FIELD TOOK ITS WHOLE SCREEN DOWN,
 *        AND A LOADING FLAG SET ON A TIMER COULD LEAVE THE SPINNER UP FOREVER.
 *
 *   Both were found by widening the bare-row probe in
 *   `the-rest-of-admin.test.tsx` until five more admin screens actually
 *   rendered a row — which is #602's lesson arriving for the second time: of
 *   the twenty-five screens that commit declared "unreached", five were
 *   unreached because of the FIXTURE, and those five were hiding this.
 *
 * ── A PARTIAL ANSWER MUST FILL THE SHAPE, NOT REPLACE IT ────────────────────
 *
 *   Three settings screens seed their state with a complete defaults object and
 *   then throw it away:
 *
 *       const [settings, setSettings] = useState(DEFAULT_SETTINGS);
 *       ...
 *       if (result.ok) setSettings(result.settings);
 *
 *   #295 made that read fail CLOSED, so a failed load can no longer masquerade
 *   as defaults. This is the other half: a load that SUCCEEDS and answers with
 *   less than the form expects. `settings.languages.filter(...)` then runs in
 *   the render body against `undefined` and /admin/settings/localization is a
 *   blank page — not a missing section, the whole screen.
 *
 *   A stored document missing a key is not exotic. It is what every migration,
 *   every partial write and every field added after launch produces, and it is
 *   how #563, #573 and #589 each arrived.
 *
 *   The quiet half is worse than the crash. On /admin/settings/security a
 *   missing `enforceMfa` is `undefined`, which renders as OFF and SAVES as off:
 *   MFA enforcement silently switched off by a settings document that never
 *   mentioned it. That is #295's own warning, from the other direction.
 *
 * ── AND `?? []` IS NOT THE FIX ──────────────────────────────────────────────
 *
 *   #603 found `setAnnouncements(a ?? [])` letting an error OBJECT through onto
 *   /admin/cms. `fillSettings` therefore checks the SHAPE: a key whose default
 *   is an array only accepts a stored value that is also an array.
 *
 * ── THE SPINNER THAT OUTLIVED ITS LOAD ──────────────────────────────────────
 *
 *   Three screens opened their loader with
 *
 *       setTimeout(() => setLoading(true), 0);
 *       const result = await read();
 *       setLoading(false);
 *
 *   A zero-delay timer is a MACROTASK; the continuation after `await` is a
 *   MICROTASK. When the read resolves without an intervening macrotask, the
 *   order is `setLoading(false)` and THEN the timer's `setLoading(true)` — and
 *   nothing ever clears it again. The screen spins on top of data it already
 *   has, until the user reloads.
 *
 *   It is a race, so it is intermittent, so it is exactly the kind of fault
 *   that gets reported as "it broke again" and cannot be reproduced. The test
 *   below is the ordering itself rather than the screen, because the ordering
 *   is the whole defect.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { fillSettings } from '@/lib/settings-load';

describe('#604 — a partial settings document fills the shape rather than replacing it', () => {
    const DEFAULTS = {
        defaultLanguage: 'en',
        enforceMfa: true,
        sessionMinutes: 30,
        languages: [{ code: 'en', name: 'English', enabled: true }],
        currencies: [{ code: 'NGN', symbol: '₦', enabled: true }],
    };

    it('A DOCUMENT WITHOUT `languages` KEEPS THE DEFAULT LIST INSTEAD OF LEAVING undefined', () => {
        const filled = fillSettings(DEFAULTS, { defaultLanguage: 'fr' });
        //   The read that used to throw during render, run here as the screen runs it.
        expect(filled.languages.filter(l => l.enabled)).toHaveLength(1);
        expect(filled.defaultLanguage).toBe('fr');
    });

    it('A DOCUMENT WITHOUT `enforceMfa` DOES NOT TURN MFA ENFORCEMENT OFF', () => {
        //   The sharp end. `undefined` renders as off and saves as off.
        expect(fillSettings(DEFAULTS, { sessionMinutes: 45 }).enforceMfa).toBe(true);
    });

    it('A STORED VALUE STILL WINS WHEN IT IS PRESENT — INCLUDING `false` AND `0`', () => {
        //   Or the merge would be a different bug: settings that cannot be turned off.
        expect(fillSettings(DEFAULTS, { enforceMfa: false }).enforceMfa).toBe(false);
        expect(fillSettings(DEFAULTS, { sessionMinutes: 0 }).sessionMinutes).toBe(0);
    });

    it('A NON-ARRAY WHERE A LIST BELONGS IS REFUSED — `?? []` WOULD HAVE LET IT THROUGH', () => {
        //   #603's /admin/cms defect, prevented here rather than found there.
        const filled = fillSettings(DEFAULTS, { languages: { success: false } as any });
        expect(Array.isArray(filled.languages)).toBe(true);
        expect(filled.languages).toEqual(DEFAULTS.languages);
    });

    it('AND AN ANSWER THAT IS NOT AN OBJECT AT ALL LEAVES THE DEFAULTS STANDING', () => {
        for (const hostile of [null, undefined, 'settings', 42, [1, 2, 3]]) {
            expect(fillSettings(DEFAULTS, hostile)).toEqual(DEFAULTS);
        }
    });

    it('A KEY EXPLICITLY STORED AS null DOES NOT ERASE ITS DEFAULT — SCALARS INCLUDED', () => {
        //   A null in a stored document means "never written", not "no languages".
        expect(fillSettings(DEFAULTS, { languages: null }).languages).toEqual(DEFAULTS.languages);

        //   THE SCALAR CASE IS THE ONE THAT MATTERS, and it took a surviving
        //   mutant to notice: for `languages` the array shape check catches null
        //   on its way past, so a version that skipped the null guard entirely
        //   still passed the line above. Nothing catches a null `defaultLanguage`
        //   or a null `enforceMfa` except the null guard itself — and a null
        //   enforceMfa renders and saves as MFA off, which is the whole point.
        expect(fillSettings(DEFAULTS, { defaultLanguage: null }).defaultLanguage).toBe('en');
        expect(fillSettings(DEFAULTS, { enforceMfa: null }).enforceMfa).toBe(true);
    });
});

describe('#604 — a loading flag set on a zero-delay timer loses the race to its own load', () => {
    /**
     * The defect and the fix, as the two orderings they actually are. No React
     * here on purpose: the fault is in the task queue, and a test that renders a
     * component would pass or fail for reasons of its own.
     */
    async function loadWith(deferTheFlag: boolean, resolveImmediately: boolean): Promise<boolean> {
        let loading = true;
        const set = (v: boolean) => { loading = v; };

        if (deferTheFlag) setTimeout(() => set(true), 0);
        else set(true);

        if (resolveImmediately) await Promise.resolve();       // a cached read: microtask only
        else await new Promise(r => setTimeout(r, 5));          // a network read: a real macrotask

        set(false);
        //   Let any pending timer fire before we look, exactly as the browser would.
        await new Promise(r => setTimeout(r, 10));
        return loading;
    }

    it('THE DEFERRED FLAG IS STILL TRUE AFTER A FAST READ FINISHES — THE SPINNER NEVER CLEARS', async () => {
        expect(await loadWith(true, true)).toBe(true);
    });

    it('WHICH IS WHY IT LOOKED FINE: A SLOW READ HIDES IT COMPLETELY', async () => {
        //   The reason three call sites carried this for as long as they did.
        expect(await loadWith(true, false)).toBe(false);
    });

    it('SETTING THE FLAG SYNCHRONOUSLY CLEARS EITHER WAY', async () => {
        expect(await loadWith(false, true)).toBe(false);
        expect(await loadWith(false, false)).toBe(false);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one mutation at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     fillSettings: drop the Array.isArray(fallback) shape check    KILLED
 *     fillSettings: `continue` on null → assign null instead        KILLED
 *     fillSettings: skip `value === undefined` guard                KILLED
 *     fillSettings: return {...defaults, ...stored} wholesale       KILLED
 *     fillSettings: treat an array `stored` as an object            KILLED
 *     fillSettings: `if (!value) continue` (falsy, not nullish)     KILLED (the
 *                   `false`/`0` test exists for exactly this mutant)
 *     loadWith: setTimeout(..., 0) → set(true) directly             KILLED (the
 *                   first test asserts the defect, so removing it fails)
 *
 *     CONTROL — SHOULD SURVIVE
 *     fillSettings: `filled[key] = value` → `filled[key] = value as any`
 *                                                                   SURVIVED ✓
 */
