import fs from 'node:fs';
import path from 'node:path';

/**
 * Find a usable Chromium.
 *
 * Shared by playwright.config.ts and e2e/global-setup.ts. The config's
 * launchOptions apply only to browsers Playwright starts FOR A TEST PROJECT —
 * a browser launched by hand in globalSetup gets none of them, and fails with
 *
 *     Executable doesn't exist at .../chromium_headless_shell-1208/...
 *
 * even though the config had already solved exactly that problem. One
 * definition, used by both, rather than two that drift.
 *
 * Playwright pins an exact build per release (1208 for 1.58.1); an image that
 * ships its own Chromium generally has a different one, and downloading the
 * pinned build is blocked in the environments where this matters.
 *
 * Returns undefined when nothing is found, so Playwright falls back to its own
 * download and behaviour is unchanged wherever that works.
 */
export function detectChromium(): string | undefined {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const candidates = [
        process.env.PLAYWRIGHT_CHROMIUM_PATH,
        root ? path.join(root, 'chromium') : null,
        '/opt/pw-browsers/chromium',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
        try {
            // statSync, not existsSync: these are usually symlinks into a
            // versioned directory, and a dangling one must not be selected.
            if (fs.statSync(candidate).isFile()) return candidate;
        } catch { /* next candidate */ }
    }
    return undefined;
}
