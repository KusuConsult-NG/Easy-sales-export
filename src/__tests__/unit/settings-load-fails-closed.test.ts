/**
 * @jest-environment node
 */

/**
 *   #295 THREE ADMIN SETTINGS SCREENS SHOWED HARDCODED DEFAULTS WHEN THE LOAD
 *        FAILED, AND SAVING THEN WROTE THOSE DEFAULTS OVER THE STORED VALUES.
 *
 *        Found by the #293/#294 sweep — four `<empty>` catch blocks under
 *        src/app/admin/settings. Three of them were the same four lines:
 *
 *            const [settings, setSettings] = useState(DEFAULTS);
 *            ...
 *            const res = await fetch("/api/admin/settings/x");
 *            const data = await res.json();
 *            if (data.success && data.settings) setSettings(data.settings);
 *            catch { }   // "use defaults if fetch fails"
 *
 *        The form starts as a hardcoded default object. EVERY failure leaves
 *        those defaults in it — a network throw, a non-2xx (two of the three
 *        never checked the status at all), a body reporting success:false, a
 *        missing `settings` key — and `isLoading` goes false regardless, so the
 *        screen renders exactly as though it had loaded.
 *
 *        AND THE SAVE POSTS THE WHOLE OBJECT. An admin who opens the page
 *        during a blip, changes one field and presses Save silently overwrites
 *        every OTHER setting with a default they never chose and were never
 *        told was a default.
 *
 *        On /admin/settings/security that is sessionDurationDays,
 *        idleTimeoutHours, maxLoginAttempts, lockoutDurationMinutes and
 *        enforceMfa. A security configuration reset by a transient fetch error
 *        is the sharp end of it — #245 was a kill switch that failed OPEN on a
 *        database error; this fails to DEFAULTS and then persists them.
 *
 * WHAT IS NOT CLAIMED
 * -------------------
 * Whether these endpoints have a real writer at all is a separate question —
 * #255 is still open on system_settings having no writer. This finding is
 * about the read: whatever the endpoints do, the form must not present
 * defaults as though they were stored, and must not save from a state it never
 * read.
 *
 * THE FOURTH EMPTY CATCH
 * ----------------------
 * /admin/settings/logs swallows its read too, and shows "no logs yet" when the
 * fetch failed. It has no Save button, so nothing is overwritten; it is
 * misleading rather than destructive, and is left for the D5 triage pass with
 * the other 54.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadSettings, SETTINGS_LOAD_FAILED_MESSAGE } from '@/lib/settings-load';

const PAGES = [
    'src/app/admin/settings/security/page.tsx',
    'src/app/admin/settings/localization/page.tsx',
    'src/app/admin/settings/notifications/page.tsx',
];

function raw(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(rel: string): string {
    return raw(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

const originalFetch = global.fetch;
const mockFetch = jest.fn() as jest.Mock<any>;

beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = mockFetch;
});

afterEach(() => {
    (global as any).fetch = originalFetch;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#295 — the shared reader fails closed', () => {
    it('accepts a well-formed response', async () => {
        // Vacuity guard first: a reader that refused everything would pass
        // every test below and break all three screens.
        mockFetch.mockResolvedValue({
            ok: true, status: 200,
            json: async () => ({ success: true, settings: { enforceMfa: false } }),
        });

        const r = await loadSettings<any>('/api/admin/settings/security');

        expect(r).toEqual({ ok: true, settings: { enforceMfa: false } });
    });

    it('REFUSES A NON-2xx, WHICH TWO OF THE THREE NEVER CHECKED', () => {
        // security and localization did `await res.json()` with no look at the
        // status, so a 500 whose body happened to parse was read as settings.
        mockFetch.mockResolvedValue({
            ok: false, status: 500,
            json: async () => ({ settings: { enforceMfa: true } }),
        });

        return loadSettings<any>('/x').then((r) => {
            expect(r.ok).toBe(false);
            expect(r.ok === false && r.reason).toMatch(/500/);
        });
    });

    it('refuses a thrown fetch', async () => {
        mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

        expect((await loadSettings<any>('/x')).ok).toBe(false);
    });

    it('refuses a body that is not JSON', async () => {
        mockFetch.mockResolvedValue({
            ok: true, status: 200,
            json: async () => { throw new SyntaxError('Unexpected token <'); },
        });

        expect((await loadSettings<any>('/x')).ok).toBe(false);
    });

    it('refuses success:false', async () => {
        mockFetch.mockResolvedValue({
            ok: true, status: 200,
            json: async () => ({ success: false, error: 'Unauthorized' }),
        });

        const r = await loadSettings<any>('/x');
        expect(r.ok).toBe(false);
        expect(r.ok === false && r.reason).toContain('Unauthorized');
    });

    it('AND REFUSES A RESPONSE CARRYING NO SETTINGS', async () => {
        // The quiet one. `if (data.success && data.settings)` simply did
        // nothing here, which is indistinguishable from a successful load of
        // the defaults.
        mockFetch.mockResolvedValue({
            ok: true, status: 200,
            json: async () => ({ success: true }),
        });

        expect((await loadSettings<any>('/x')).ok).toBe(false);
    });

    it('and never falls back to a value of its own', async () => {
        // The whole point. A reader with a default would put the defect back
        // one layer down.
        //
        // Asserted as "declares no default and has exactly one success
        // return", not as "the word DEFAULT is absent" — the first version was
        // the latter and failed on the user-facing message, which says the
        // values on screen ARE defaults. That sentence is the fix, not the
        // defect.
        const src = codeOnly('src/lib/settings-load.ts');

        expect(src).not.toMatch(/(const|let)\s+DEFAULT/i);
        // RETURNS, not occurrences — the type declaration carries `ok: true`
        // too, which is what the first count picked up.
        expect((src.match(/return \{ ok: true/g) ?? []).length).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#295 — all three screens use it, and refuse to save without it', () => {
    for (const page of PAGES) {
        const name = page.split('/').slice(-2)[0];

        it(`${name} READS THROUGH THE SHARED READER`, () => {
            const src = codeOnly(page);

            expect(src).toContain('loadSettings<');
            // The inline version, in the form all three carried.
            expect(src).not.toMatch(/const data = await res\.json\(\);\s*\n\s*if \(data\.success && data\.settings\)/);
        });

        it(`${name} KEEPS THE FAILURE, rather than silently using defaults`, () => {
            const src = codeOnly(page);

            expect(src).toMatch(/setLoadError\(result\.reason\)/);
        });

        it(`${name} REFUSES TO SAVE FROM A FORM IT NEVER LOADED`, () => {
            // The half that stops the overwrite. Disabling the button alone is
            // not enough — the handler refuses too, because a disabled button
            // is a rendering detail and the handler is the operation.
            const src = codeOnly(page);

            expect(src).toMatch(/if \(loadError\)/);
            expect(src).toContain('SETTINGS_LOAD_FAILED_MESSAGE');
            expect(src).toMatch(/disabled=\{[^}]*loadError/);
        });

        it(`${name} tells the admin what happened`, () => {
            const src = codeOnly(page);

            expect(src).toMatch(/\{loadError && \(/);
            expect(src).toContain('role="alert"');
        });

        it(`${name} still posts the settings when the load worked`, () => {
            // Vacuity guard per screen: the save path has to survive.
            const src = codeOnly(page);

            expect(src).toMatch(/method: "POST"/);
        });
    }

    it('and the message they show is one sentence, not three', () => {
        expect(SETTINGS_LOAD_FAILED_MESSAGE).toMatch(/would overwrite/i);
        for (const page of PAGES) {
            expect(codeOnly(page)).not.toMatch(/could not be loaded, so the values below/);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#295 — no settings screen reads a settings endpoint by hand', () => {
    /**
     * The ratchet. A fourth screen written the same way is how this comes back,
     * and the inline version is four lines that look entirely reasonable.
     */
    it('every fetch of /api/admin/settings/* goes through the shared reader', () => {
        const offenders: string[] = [];

        for (const page of PAGES) {
            raw(page).split('\n').forEach((line, i) => {
                const t = line.trim();
                if (t.startsWith('//') || t.startsWith('*')) return;
                if (!/fetch\(\s*["'`]\/api\/admin\/settings/.test(line)) return;
                // A POST is a save, and saves were never the problem.
                const after = raw(page).split('\n').slice(i, i + 4).join('\n');
                if (/method:\s*["']POST["']/.test(after)) return;
                offenders.push(`${page}:${i + 1}`);
            });
        }

        expect(offenders).toEqual([]);
    });
});
