/**
 * @jest-environment node
 */

/**
 *   #317 THE PLATFORM SETTINGS SCREEN HAS NEVER LOADED OR SAVED A SETTING —
 *        AND THE ACTION HANDED IT DEFAULTS WHEN THE READ FAILED.
 *
 *        Found by sweeping for one shape rather than by reading another file.
 *        #296, #313 and #316 are all the same defect: a catch block that
 *        returns `success: true` with a fabricated value, which silently
 *        disarms every caller's `if (result.success)` check. Three times is a
 *        class, so this suite scans for the whole class at once.
 *
 *        Four catch blocks in the codebase return success:true. Three are
 *        correct and are pinned below as such. The fourth was
 *        _getPlatformSettingsAction:
 *
 *            } catch (error: any) {
 *                logger.error("Get platform settings error:", error);
 *                return { success: true, error: null, data: {
 *                    platformName: "Easy Sales Export",
 *                    supportEmail: "info@easysalesexport.com",
 *                    contactPhone: "+234 000 000 0000",
 *                    defaultCurrency: "NGN",
 *                    maintenanceMode: false,
 *                }};
 *            }
 *
 *        A read failure presented as the platform's live configuration —
 *        including a placeholder phone number, and `maintenanceMode: false`
 *        when maintenance mode may be ON. The identical defaults are returned
 *        for a MISSING document, which is legitimate: no settings row means the
 *        defaults genuinely apply. A thrown error means nobody knows.
 *
 *        And once again it defeated the caller doing the right thing.
 *        admin/settings/general checks `data?.success === false` and toasts —
 *        the check #295 exists to have. success:true made it unreachable.
 *
 *   AND THEN THE SCREEN NEVER READ THE ANSWER ANYWAY
 *
 *        The bigger half, found while verifying the smaller one:
 *
 *            getPlatformSettingsAction().then((data: any) => { ...
 *                setSettings(data);          // <- the WHOLE response
 *
 *        withFlexibleSafeAction passes the action's result straight through, so
 *        `settings` became { success, error, data }. Every
 *        `settings.platformName` was undefined and all four inputs went blank
 *        the moment the load resolved. Save then posted that same object to
 *        savePlatformSettingsAction, which spread it into a merge write — so
 *        pressing Save stored `success: true` and `error: null` in
 *        platform_settings/general and wrote none of the five real fields.
 *
 *        #211–#216's shape: an admin control that had never done the thing it
 *        is named for. The spread is also #43's class — a type is not a runtime
 *        guard — so the write now names its keys.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const ACTION = 'src/app/actions/admin/_settings.ts';
const SCREEN = 'src/app/admin/settings/general/page.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#317 — the settings read, executed', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    async function load(get: () => any) {
        jest.doMock('@/lib/supabase-db', () => ({
            supabaseDb: { collection: () => ({ doc: () => ({ get, set: () => Promise.resolve() }) }) },
        }));
        const mod = await import('@/app/actions/admin/_settings');
        return (await mod.getPlatformSettingsAction()) as any;
    }

    it('REFUSES rather than presenting defaults as the live configuration', async () => {
        const res = await load(() => { throw new Error('connection refused'); });

        expect(res.success).toBe(false);
        expect(res.data).toBeNull();
        // The placeholder phone number must not come back wearing success.
        expect(JSON.stringify(res)).not.toContain('+234 000 000 0000');
        expect(JSON.stringify(res)).not.toContain('maintenanceMode');
    });

    it('but a MISSING document still yields defaults, which is a real answer', async () => {
        // The distinction the fix rests on: absent settings means the defaults
        // apply; an unreadable settings row means nobody knows.
        const res = await load(() => Promise.resolve({ exists: false }));

        expect(res.success).toBe(true);
        expect(res.data.maintenanceMode).toBe(false);
        expect(res.data.platformName).toBe('Easy Sales Export');
    });

    it('and a stored document comes back as stored', async () => {
        const res = await load(() => Promise.resolve({
            exists: true,
            data: () => ({ platformName: 'Real Name', maintenanceMode: true }),
        }));

        expect({ ok: res.success, name: res.data.platformName, maint: res.data.maintenanceMode })
            .toEqual({ ok: true, name: 'Real Name', maint: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#317 — the write stores the five fields and nothing else', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    it('IGNORES EXTRA KEYS a caller sends, envelope included', async () => {
        // THE test for the half that had never worked: the screen was posting
        // { success, error, data } and the spread wrote it verbatim.
        const written: any[] = [];
        jest.doMock('@/lib/supabase-db', () => ({
            supabaseDb: {
                collection: () => ({
                    doc: () => ({
                        get: () => Promise.resolve({ exists: false }),
                        set: (v: any) => { written.push(v); return Promise.resolve(); },
                    }),
                }),
            },
        }));
        (globalThis as any).mockRequireSession.mockImplementationOnce(() =>
            Promise.resolve({ session: { user: { id: 'a1', roles: ['super_admin'] } }, error: null }));

        const mod = await import('@/app/actions/admin/_settings');
        await (mod.savePlatformSettingsAction as any)({
            platformName: 'Real Name',
            supportEmail: 's@e.com',
            contactPhone: '080',
            defaultCurrency: 'NGN',
            maintenanceMode: true,
            // What the screen was actually sending:
            success: true,
            error: null,
            data: { platformName: 'nested' },
        });

        expect(written).toHaveLength(1);
        expect(Object.keys(written[0]).sort()).toEqual([
            'contactPhone', 'defaultCurrency', 'maintenanceMode',
            'platformName', 'supportEmail', 'updatedAt', 'updatedBy',
        ]);
        expect(written[0].platformName).toBe('Real Name');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#317 — the screen reads response.data, not the response', () => {
    it('assigns res.data, so the form holds settings rather than an envelope', () => {
        const src = code(SCREEN);

        expect(src).toMatch(/if \(res\?\.data\) setSettings\(res\.data\)/);
        expect(src).not.toMatch(/setSettings\(data\)/);
    });

    it('and still reports a refusal, which is the check #295 added', () => {
        expect(code(SCREEN)).toMatch(/if \(res\?\.success === false\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#317 — the class, swept', () => {
    /**
     * The ratchet. Every catch that reports success is listed here with the
     * reason it is allowed. A new one fails this test rather than waiting to be
     * found by hand for a fourth time.
     */
    const ALLOWED: Record<string, string> = {
        'src/app/actions/password-reset.ts':
            'Deliberate: replying identically whether or not the address exists is what stops account enumeration.',
        'src/app/actions/farm-nation/_fn_listings.ts':
            'Catches a MISSING INDEX specifically, re-runs the query unsorted, sorts in memory and returns real rows. Anything else is rethrown.',
        'src/app/actions/farm-nation/_fn_purchases.ts':
            'Same missing-index fallback as _fn_listings.',
    };

    function sourceFiles(): string[] {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir)) {
                if (e === 'node_modules' || e === '__tests__') continue;
                const full = join(dir, e);
                if (statSync(full).isDirectory()) walk(full);
                else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full.slice(ROOT.length + 1));
            }
        };
        walk(join(ROOT, 'src'));
        return out.sort();
    }

    /** The braced block starting at `open`, comments already stripped. */
    function block(text: string, open: number): string {
        let depth = 0;
        for (let i = open; i < Math.min(text.length, open + 12000); i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(open + 1, i); }
        }
        return '';
    }

    it('NO CATCH REPORTS SUCCESS EXCEPT THE THREE THAT SHOULD', () => {
        const offenders: string[] = [];
        for (const rel of sourceFiles()) {
            const src = code(rel);
            for (const m of src.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) {
                const body = block(src, m.index! + m[0].length - 1);
                if (/success:\s*true/.test(body) && !(rel in ALLOWED)) offenders.push(rel);
            }
        }

        expect([...new Set(offenders)]).toEqual([]);
    });

    it('and the three allowed ones still exist, so the list is not stale', () => {
        // Vacuity guard: if these were rewritten, ALLOWED would be silently
        // permitting nothing and a real regression could hide behind a name.
        for (const rel of Object.keys(ALLOWED)) {
            const src = code(rel);
            const found = [...src.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)]
                .some((m) => /success:\s*true/.test(block(src, m.index! + m[0].length - 1)));
            expect({ rel, stillReportsSuccessInACatch: found })
                .toEqual({ rel, stillReportsSuccessInACatch: true });
        }
    });
});
