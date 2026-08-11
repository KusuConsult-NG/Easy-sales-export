/**
 * @jest-environment node
 */

/**
 * No spreadsheet, dataset or build cache may be tracked in git.
 *
 * WHY
 * ---
 * `exports/all_users.xlsx` — 41,105 users, with Full Name, Email and Phone —
 * was committed on 2026-06-20 and sat in a PUBLIC repository for 52 days,
 * alongside 40 per-state copies of the same data. No exploit was needed to read
 * it. `git clone` was sufficient.
 *
 * HOW EVERY EARLIER AUDIT MISSED IT
 * ---------------------------------
 * They scanned SOURCE — `src/app/actions`, `src/app/api`, `src/lib`,
 * `src/infrastructure` — and the secret-scanning work looked for credential
 * patterns in code and history. A 4.4 MB binary spreadsheet is none of those
 * things, so it sat outside every tool aimed at the problem.
 *
 * Worse, `outstanding-work.md` referred to the file as a *recovery asset* —
 * "your safety net if data is missing" — so it had been read and filed as a
 * backup rather than an exposure.
 *
 * An audit scoped to source reports on source. It says nothing about the
 * repository. This test asks the repository.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';

/** Extensions that carry data rather than code. */
const DATA_FILE = /\.(xlsx|xls|csv|tsv|db|sqlite|sqlite3|dump|bak|parquet)$/i;

/** Directories that must never be tracked. */
const FORBIDDEN_DIR = /^(exports|\.turbo|\.next|coverage|node_modules)\//;

/**
 * Fixtures a test legitimately needs. Deliberately tiny — anything added here
 * should be small, synthetic, and obviously not real people.
 */
const ALLOWED = [
    /^src\/.*__tests__\/.*fixtures?\//,
    /^e2e\/fixtures?\//,
];

function trackedFiles(): string[] {
    try {
        return execSync('git ls-files', { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 })
            .split('\n')
            .filter(Boolean);
    } catch {
        return [];
    }
}

describe('the repository itself', () => {
    const files = trackedFiles();

    it('can enumerate tracked files (sanity)', () => {
        // Without this, a failure to run git makes every assertion below pass
        // against an empty list — the vacuity failure that has recurred all
        // week, and the exact way this exposure could hide again.
        expect(files.length).toBeGreaterThan(500);
    });

    it('tracks no spreadsheet or dataset', () => {
        const offenders = files
            .filter((f) => DATA_FILE.test(f))
            .filter((f) => !ALLOWED.some((a) => a.test(f)));

        if (offenders.length > 0) {
            throw new Error(
                `\n\n🚨 ${offenders.length} data file(s) are tracked in git:\n\n` +
                offenders.map((o) => `  ${o}`).join('\n') +
                `\n\nexports/all_users.xlsx held 41,105 people's names, emails and\n` +
                `phone numbers in a PUBLIC repository for 52 days. Deleting it from\n` +
                `the tip does not remove it from history.\n\n` +
                `Personal data does not belong in version control. If a test needs a\n` +
                `fixture, make it synthetic and put it under a fixtures/ directory.\n`
            );
        }
        expect(offenders).toEqual([]);
    });

    it('tracks no build cache or generated directory', () => {
        const offenders = files.filter((f) => FORBIDDEN_DIR.test(f));

        if (offenders.length > 0) {
            throw new Error(
                `\n\n${offenders.length} file(s) from a generated directory are tracked:\n\n` +
                offenders.slice(0, 10).map((o) => `  ${o}`).join('\n') +
                (offenders.length > 10 ? `\n  … and ${offenders.length - 10} more` : '') +
                `\n\n66 files of Turborepo cache were tracked. Caches hold compiled\n` +
                `output and can hold environment values.\n`
            );
        }
        expect(offenders).toEqual([]);
    });

    it('tracks no environment file', () => {
        // Checked and clean in the earlier review, but that was a point-in-time
        // grep. This makes it standing.
        const offenders = files.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !/\.example$/.test(f));

        expect(offenders).toEqual([]);
    });

    it('tracks no private key or service account', () => {
        const offenders = files.filter(
            (f) => /\.(pem|key|p12|pfx)$/i.test(f) ||
                (/service-account.*\.json$/i.test(f) && !/\.example$/i.test(f))
        );

        expect(offenders).toEqual([]);
    });
});
