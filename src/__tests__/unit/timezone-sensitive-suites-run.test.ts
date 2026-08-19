/**
 * @jest-environment node
 */

/**
 * src/__tests__/tz/ is excluded from the default run. This makes sure that is
 * not the same as not run.
 *
 * WHY THOSE SUITES CANNOT LIVE IN unit/
 * -------------------------------------
 * A process has ONE timezone, resolved before its first Date exists.
 * `process.env.TZ = 'Africa/Lagos'` inside a jest test does nothing — and the
 * first attempt at finding #81 did exactly that. A control assertion caught it:
 * `new Date('2026-08-19T12:00:00Z').getHours()` was still 12. Two tests had been
 * passing under UTC while claiming to prove a UTC-vs-local divergence, which is
 * the precise shape of vacuity this audit keeps finding elsewhere.
 *
 * So the timezone is set on the PROCESS by `npm run test:tz`, and this spawns
 * it. Every exclusion in jest.config.js has to answer "then what runs it?" —
 * /pg/ and /db-integration/ are answered by CI jobs; this one is answered here,
 * so `npm run test` alone is enough.
 *
 * WHAT IS OVER THERE
 * ------------------
 *   #81  calculateStreakAction walked the LOCAL calendar over day documents
 *        the writer had named by the UTC one, so east of UTC the walk began a
 *        day behind and today's lesson never counted.
 *   #82  academyCertificateNumber took the year from the HOST rather than from
 *        the completion instant, so one completion could print two different
 *        identifiers depending on where the process ran.
 *
 * Both were verified to FAIL against the pre-fix code, not merely to pass
 * against the fixed one.
 */

import { spawnSync } from 'child_process';
import { readdirSync } from 'fs';
import path from 'path';
import { describe, it, expect } from '@jest/globals';

const TZ_DIR = path.join(process.cwd(), 'src', '__tests__', 'tz');

describe('the timezone-sensitive suites', () => {
    it('are excluded from THIS run, which is why they need spawning', () => {
        // If this ever fails, the exclusion was dropped and the suites are
        // running under UTC — where they prove nothing.
        const config = require(path.join(process.cwd(), 'jest.config.js'));
        expect(typeof config).toBe('function');
        // The pattern is what jest.config.js declares; read the source rather
        // than resolving the async next/jest wrapper.
        const source = require('fs').readFileSync(
            path.join(process.cwd(), 'jest.config.js'), 'utf8');
        expect(source).toContain("'/src/__tests__/tz/'");
        expect(new Date('2026-08-19T12:00:00Z').getHours()).toBe(12);
    });

    it('exist', () => {
        const files = readdirSync(TZ_DIR).filter((f) => f.endsWith('.test.ts'));
        expect(files.length).toBeGreaterThan(0);
    });

    it('pass under TZ=Africa/Lagos', () => {
        const run = spawnSync('npm', ['run', '--silent', 'test:tz'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, CI: '1' },
        });
        const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

        // The summary is what proves the run happened. A path filter matching
        // nothing also exits 0, so a green exit code alone is not evidence.
        const tests = /Tests:\s+(\d+) passed, (\d+) total/.exec(output);
        const suites = /Test Suites:\s+(\d+) passed, (\d+) total/.exec(output);

        expect({ status: run.status, tail: tests?.[0] ?? output.slice(-1200) })
            .toMatchObject({ status: 0 });
        expect(Number(tests![1])).toBeGreaterThan(0);
        expect(tests![1]).toBe(tests![2]);

        // Every file in the directory was picked up — a rename that stops
        // matching the filter would otherwise pass silently.
        const files = readdirSync(TZ_DIR).filter((f) => f.endsWith('.test.ts'));
        expect(Number(suites![2])).toBe(files.length);
    }, 180_000);
});
