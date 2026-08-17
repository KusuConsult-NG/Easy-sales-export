/**
 * @jest-environment node
 */

/**
 * Thirty-four "most recent" sorts that did not sort.
 *
 * THE EXPRESSION
 * --------------
 *     const aTime = a.data().createdAt?.toMillis?.()
 *                || a.data().createdAt?.seconds * 1000
 *                || 0;
 *
 * It handles two shapes: a Firestore Timestamp with `toMillis()`, and a plain
 * `{seconds}` object. It handles neither a Date nor an ISO string.
 *
 * WHY THAT MATTERS HERE SPECIFICALLY
 * ----------------------------------
 * _submitSellerVerificationAction writes `createdAt: new Date()`. The JSONB
 * writer serialises that to an ISO string. On the way back, `toMillis` is
 * undefined and `.seconds` is undefined, so the middle term is
 * `undefined * 1000` — NaN — and `NaN || 0` is 0.
 *
 * Every key collapses to 0. A comparator returning 0 for every pair leaves the
 * array in whatever order it arrived, so `sortedDocs[0]` is whichever row the
 * database happened to return first. The sort was decorative on exactly the
 * documents it was reading.
 *
 * WHAT DECIDED ON THAT ARBITRARY ROW
 * ----------------------------------
 *   getSellerVerificationAction        which verification the seller is shown
 *   resubmitSellerVerificationAction   which record is resubmitted, and whether
 *                                      the "must be rejected" check passes
 *   marketplace/seller/layout.tsx      whether the seller may reach their own
 *                                      dashboard at all
 *   _mp_onboarding.ts, _ac_applications.ts, _wv_applications.ts,
 *   _wv_membership.ts, _ex_onboarding.ts, _coop_registration.ts,
 *   api/marketplace/sellers/[sellerId]  — the same expression, all five modules.
 *
 * TWO OTHER SPELLINGS OF THE SAME MISTAKE
 * ---------------------------------------
 * `_ex_investments.ts` sorted with `createdAt?.toMillis()` — optional chaining on
 * the PROPERTY, then an unconditional call. On an ISO string that is
 * `undefined()`, which THROWS. It did not mis-sort; it threw inside the
 * comparator and dropped the whole action into its catch.
 *
 * `api/users/[userId]` returned `createdAt?.toMillis?.() || Date.now()`, so an
 * account whose createdAt was an ISO string reported the CURRENT MOMENT as its
 * creation date.
 *
 * THE FIX
 * -------
 * `toMillis` in lib/firestore-serialize.ts already handled all four shapes and
 * already had a test — it was written for the message-ordering defect and never
 * reached these. Nothing new was needed; thirty-four hand-rolled copies were
 * replaced by the one that works.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { toMillis } from '@/lib/firestore-serialize';

/** Every file that carried a copy of the broken expression. */
const AFFECTED = [
    'src/app/actions/academy/_ac_applications.ts',
    'src/app/actions/cooperative/_coop_registration.ts',
    'src/app/actions/cooperative/_dashboard.ts',
    'src/app/actions/export/_ex_investments.ts',
    'src/app/actions/export/_ex_onboarding.ts',
    'src/app/actions/marketplace/_mp_onboarding.ts',
    'src/app/actions/marketplace/_mp_seller_verification.ts',
    'src/app/actions/wave/_wv_applications.ts',
    'src/app/actions/wave/_wv_membership.ts',
    'src/app/api/marketplace/sellers/[sellerId]/route.ts',
    'src/app/api/users/[userId]/route.ts',
    'src/app/marketplace/seller/layout.tsx',
];

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

/** Source with comments stripped, so a fix's own explanation is not evidence. */
function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('the shape the application actually writes', () => {
    it('a Date survives the JSONB writer as an ISO string', () => {
        // The premise. If this stopped being true the defect would change shape,
        // and so should this test.
        const stored = JSON.parse(JSON.stringify({ createdAt: new Date('2026-08-01T10:00:00Z') })).createdAt;

        expect(typeof stored).toBe('string');
        expect(stored).toBe('2026-08-01T10:00:00.000Z');
    });

    it('and the old expression scored it ZERO', () => {
        const stored: any = '2026-08-01T10:00:00.000Z';
        const oldKey = stored?.toMillis?.() || stored?.seconds * 1000 || 0;

        expect(oldKey).toBe(0);
    });

    it('while toMillis reads it correctly', () => {
        expect(toMillis('2026-08-01T10:00:00.000Z')).toBe(Date.parse('2026-08-01T10:00:00.000Z'));
    });

    it('and toMillis handles the other three shapes too', () => {
        const ms = Date.parse('2026-08-01T10:00:00.000Z');

        expect(toMillis(new Date(ms))).toBe(ms);
        expect(toMillis({ toDate: () => new Date(ms) })).toBe(ms);
        expect(toMillis({ seconds: Math.floor(ms / 1000), nanoseconds: 0 })).toBe(ms);
        expect(toMillis({ _seconds: Math.floor(ms / 1000), _nanoseconds: 0 })).toBe(ms);
        expect(toMillis(null)).toBe(0);
        expect(toMillis('not a date')).toBe(0);
    });
});

describe('a comparator built on it actually orders', () => {
    const rows = [
        { id: 'old', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'new', createdAt: '2026-08-01T00:00:00.000Z' },
        { id: 'mid', createdAt: '2026-04-01T00:00:00.000Z' },
    ];

    it('newest first, across mixed shapes', () => {
        const mixed = [
            { id: 'iso', createdAt: '2026-04-01T00:00:00.000Z' },
            { id: 'date', createdAt: new Date('2026-08-01T00:00:00.000Z') },
            { id: 'ts', createdAt: { seconds: Date.parse('2026-01-01T00:00:00.000Z') / 1000 } },
        ];

        const sorted = [...mixed].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

        expect(sorted.map((r) => r.id)).toEqual(['date', 'iso', 'ts']);
    });

    it('and the OLD comparator left the same rows untouched', () => {
        // The heart of it: a comparator returning 0 for every pair is not a sort.
        const oldKey = (v: any) => v?.toMillis?.() || v?.seconds * 1000 || 0;
        const sorted = [...rows].sort((a, b) => oldKey(b.createdAt) - oldKey(a.createdAt));

        expect(sorted.map((r) => r.id)).toEqual(['old', 'new', 'mid']);
        expect(sorted[0].id).not.toBe('new');
    });
});

describe('no copy of the broken expression survives', () => {
    it.each(AFFECTED)('%s uses the shared toMillis', (rel: string) => {
        const src = source(rel);

        expect(src).toContain('toMillis(');
        expect(src).not.toMatch(/createdAt\?\.toMillis\?\.\(\)\s*\|\|/);
        expect(src).not.toMatch(/createdAt\?\.seconds\s*\*\s*1000/);
    });

    it('and the throwing spelling is gone as well', () => {
        // `x?.toMillis()` is optional-chained on the PROPERTY and then called
        // unconditionally — undefined() throws.
        //
        // Comments stripped first: the fix's own explanation quotes the broken
        // expression, and asserting on raw source failed on the note describing
        // what was fixed.
        const src = code('src/app/actions/export/_ex_investments.ts');

        expect(src).not.toMatch(/createdAt\?\.toMillis\(\)/);
        expect(src).not.toMatch(/bookedAt\?\.toMillis\(\)/);
    });

    it('nowhere else in the tree either', () => {
        // A file-by-file list goes stale. This is the sweep.
        const { execSync } = require('child_process');
        // __tests__ excluded: this file quotes the broken expression in order to
        // assert against it, and would otherwise report itself.
        const hits = execSync(
            `grep -rl "createdAt?.toMillis?.() ||" src/ --include=*.ts --include=*.tsx | grep -v __tests__ || true`,
            { encoding: 'utf-8' },
        ).trim();

        expect(hits).toBe('');
    });

    it('and an account\'s creation date is not reported as "now"', () => {
        const src = source('src/app/api/users/[userId]/route.ts');

        expect(src).not.toContain('userData?.createdAt?.toMillis?.() || Date.now()');
        expect(src).toContain('toMillis(userData?.createdAt) || Date.now()');
    });
});
