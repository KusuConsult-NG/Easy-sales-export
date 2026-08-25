/**
 * @jest-environment node
 */

/**
 *   #252 EVERY revalidateTag CALL IN THIS CODEBASE THREW.
 *
 *        Fifteen call sites, all written the same way:
 *
 *            revalidateTag("land-listings", "page");
 *            revalidateTag(`user-status-${userId}`, "page");
 *
 *        The second argument is a cacheLife PROFILE NAME. This version of
 *        Next.js ships seven — default, seconds, minutes, hours, days, weeks,
 *        max — and next.config.ts defines no custom ones. "page" is not among
 *        them, and it is not a Next concept at all.
 *
 *        An unknown profile name is not ignored. From
 *        next/dist/server/revalidation-utils.js:
 *
 *            cacheLife = workStore?.cacheLifeProfiles[profile];
 *            if (!cacheLife) {
 *                throw new Error(`Invalid profile provided "${profile}" must be
 *                    configured under cacheLife in next.config or be "max"`);
 *            }
 *
 *        That runs in executeRevalidates, in the `finally` of the Server Action
 *        wrapper — AFTER the action's own work has completed. So the write
 *        succeeded, and then the response threw. An admin approving a land
 *        listing, an academy registration, an export registration or a
 *        marketplace seller saw the operation fail, and clicked again.
 *
 *        This is a whole class rather than a typo, so the test is a ratchet
 *        rather than a fix pinned in place: it reads the valid profile names
 *        from NEXT ITSELF, so it cannot drift from the framework, and it fails
 *        on any new call site that invents a name.
 *
 * WHICH CALL IS RIGHT WHERE
 * -------------------------
 * Both of these caches exist so a decision an admin just made is visible. Stale
 * -while-revalidate is the wrong shape for that — the point is that the next
 * reader sees the NEW value, not the old one one more time. So:
 *
 *   Server Actions   updateTag(tag)              immediate expiry, no profile
 *   Route Handlers   revalidateTag(tag, {expire: 0})
 *
 * updateTag throws inside a Route Handler by design (it checks
 * workStore.page.endsWith('/route')), which is why the three farm-nation routes
 * take the object-profile form instead. An inline object profile is validated
 * rather than looked up by name, so it cannot hit the throw above.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/** Every .ts/.tsx file under src. */
function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === 'node_modules' || entry === '__tests__') continue;
            sourceFiles(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

/**
 * The profile names Next actually accepts, read from Next's own default config
 * plus anything next.config.ts adds. Hard-coding the seven names here would be
 * a second copy of a fact the framework owns — the duplication this audit keeps
 * finding — and would go stale on an upgrade.
 */
function validProfileNames(): Set<string> {
     
    const { defaultConfig } = require('next/dist/server/config-shared');
    const names = new Set<string>(Object.keys(defaultConfig.cacheLife ?? {}));

    const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf-8');
    // A cacheLife block in next.config would add names; there is none today, and
    // this reads it rather than assuming so, because adding one is a legitimate
    // way to make a custom name valid.
    const block = config.match(/cacheLife\s*:\s*\{([\s\S]*?)\n\s{2}\}/);
    if (block) {
        for (const m of block[1].matchAll(/^\s*['"`]?([A-Za-z0-9_-]+)['"`]?\s*:/gm)) {
            names.add(m[1]);
        }
    }
    return names;
}

/** Every revalidateTag(...) call in src, with its raw second argument. */
function revalidateTagCalls(): Array<{ file: string; line: number; profile: string | null }> {
    const found: Array<{ file: string; line: number; profile: string | null }> = [];

    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
        const text = readFileSync(file, 'utf-8');
        if (!text.includes('revalidateTag(')) continue;

        text.split('\n').forEach((raw, i) => {
            const line = raw.trim();
            if (line.startsWith('//') || line.startsWith('*')) return;
            // The tag may be a template literal containing commas-free
            // interpolation; the profile is whatever follows the tag argument.
            for (const m of raw.matchAll(/revalidateTag\(\s*(?:`[^`]*`|'[^']*'|"[^"]*"|[A-Za-z0-9_.[\]]+)\s*(,\s*([\s\S]*?))?\)/g)) {
                found.push({
                    file: file.replace(process.cwd() + '/', ''),
                    line: i + 1,
                    profile: m[2] ? m[2].trim() : null,
                });
            }
        });
    }
    return found;
}

describe('#252 — revalidateTag profiles Next actually knows', () => {
    const calls = revalidateTagCalls();

    it('finds the call sites at all, so the checks below are not vacuous', () => {
        // Every assertion here is "for each call". With zero calls they all pass
        // trivially, which is the failure mode a ratchet must not have.
        expect(calls.length).toBeGreaterThan(0);
    });

    it('EVERY PROFILE NAME IS ONE NEXT ACCEPTS', () => {
        const valid = validProfileNames();

        const invalid = calls.filter(c => {
            if (!c.profile) return false;                       // covered by the next test
            if (c.profile.startsWith('{')) return false;         // inline object profile
            const name = c.profile.replace(/^['"`]|['"`]$/g, '');
            return !valid.has(name);
        });

        // Was: fifteen sites passing "page", which Next throws on.
        expect(invalid.map(c => `${c.file}:${c.line} → ${c.profile}`)).toEqual([]);
    });

    it('AND NONE USES THE DEPRECATED SINGLE-ARGUMENT FORM', () => {
        // Next logs a deprecation warning and expires the tag immediately. It
        // still works today, so this is a ratchet against re-introducing it,
        // not a live defect.
        const bare = calls.filter(c => c.profile === null);
        expect(bare.map(c => `${c.file}:${c.line}`)).toEqual([]);
    });

    it('updateTag is used only where it is legal — never in a route handler', () => {
        // updateTag throws if workStore.page endsWith '/route'. A route handler
        // has to use revalidateTag with an object profile instead.
        const offenders = sourceFiles(join(process.cwd(), 'src'))
            .filter(f => /\/route\.tsx?$/.test(f))
            .filter(f => /\bupdateTag\s*\(/.test(readFileSync(f, 'utf-8')))
            .map(f => f.replace(process.cwd() + '/', ''));

        expect(offenders).toEqual([]);
    });

    it('the three farm-nation route handlers invalidate with an object profile', () => {
        // Pinned explicitly: these are the sites that cannot use updateTag, and
        // the object form is what keeps them off the invalid-name path.
        for (const route of [
            'src/app/api/admin/farm-nation/approve-land/route.ts',
            'src/app/api/admin/farm-nation/reject-land/route.ts',
            'src/app/api/admin/farm-nation/dispatch-inspector/route.ts',
        ]) {
            const text = readFileSync(join(process.cwd(), route), 'utf-8');
            expect(text).toContain('revalidateTag("land-listings", { expire: 0 })');
        }
    });
});

describe('#252 — what the framework does with a bad name', () => {
    it('"page" is genuinely not a profile Next ships', () => {
        // The premise of the whole finding, asserted rather than assumed. If a
        // future Next adds a "page" profile this fails, and the comments above
        // stop being true.
        expect(validProfileNames().has('page')).toBe(false);
    });

    it('and the names it does ship include the one the docs recommend', () => {
        const valid = validProfileNames();
        expect(valid.has('max')).toBe(true);
        expect(valid.has('default')).toBe(true);
    });
});
