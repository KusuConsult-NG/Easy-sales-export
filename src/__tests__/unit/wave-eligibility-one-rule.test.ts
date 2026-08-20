/**
 * One eligibility rule for WAVE, and the divergence that unifying it closed.
 *
 * WAVE is a programme for women, so "may this account enrol?" is an access rule
 * with a protected characteristic in it. It was implemented four times:
 *
 *   _wv_membership.ts                    the full rule, with a 2026-06-17 cutoff
 *   api/wave/check-eligibility/route.ts  a line-for-line copy, CUTOFF_DATE literal
 *                                        included
 *   _wv_applications.ts                  a SHORTER rule, no cutoff
 *   briefing.ts                          a third shape, on a different input
 *
 * THE CASE THAT BROKE
 * -------------------
 * A male account created ON OR AFTER the cutoff that holds `wave_participant` or
 * a wave registration:
 *
 *   the /wave/application page           refused it
 *   /api/wave/check-eligibility          refused it
 *   submitMultiStepWaveApplication       ACCEPTED its application
 *
 * A gate refusing what the action behind it allows is the worse of the two
 * arrangements: the screen looks closed and the server action is reachable
 * without the screen.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    checkWaveEligibility,
    describesAWoman,
    describesAMan,
    WAVE_MALE_CUTOFF_DATE,
} from '@/lib/wave-eligibility';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

const BEFORE_CUTOFF = '2025-01-01T00:00:00.000Z';
const AFTER_CUTOFF = '2026-08-01T00:00:00.000Z';

describe('the rule itself', () => {
    it('admits a woman', () => {
        expect(checkWaveEligibility({ gender: 'female', roles: [], createdAt: AFTER_CUTOFF }).eligible).toBe(true);
    });

    it('refuses an ordinary male account', () => {
        const v = checkWaveEligibility({ gender: 'male', roles: [], createdAt: BEFORE_CUTOFF });
        expect(v.eligible).toBe(false);
        expect(v.reason).toContain('women');
    });

    it('admits an account whose gender is not recorded', () => {
        // All four copies did, and deliberately: the programme collects gender
        // during the application itself, and the block exists to stop men
        // enrolling rather than to refuse an incomplete profile.
        expect(checkWaveEligibility({ roles: [] }).eligible).toBe(true);
        expect(checkWaveEligibility({ gender: null, roles: [] }).eligible).toBe(true);
    });

    it('refuses a null user rather than admitting one', () => {
        expect(checkWaveEligibility(null).eligible).toBe(false);
        expect(checkWaveEligibility(undefined).eligible).toBe(false);
    });
});

describe('the cutoff now applies everywhere, which is the fix', () => {
    it('refuses a male account created after the cutoff EVEN WITH the WAVE role', () => {
        // THE test. The submit action admitted exactly this account while both
        // gates in front of it refused.
        const v = checkWaveEligibility({
            gender: 'male',
            roles: ['wave_participant'],
            createdAt: AFTER_CUTOFF,
        });
        expect(v.eligible).toBe(false);
    });

    it('refuses it with a wave registration too', () => {
        const v = checkWaveEligibility({
            gender: 'male',
            roles: [],
            serviceRegistrations: { wave: { status: 'approved' } },
            createdAt: AFTER_CUTOFF,
        });
        expect(v.eligible).toBe(false);
    });

    it('still admits a male account from BEFORE the cutoff that holds access', () => {
        // The other half. Removing access from existing participants is not this
        // rule's job, and a test that only checked the refusals would not notice
        // if it started doing so.
        expect(checkWaveEligibility({
            gender: 'male',
            roles: ['wave_participant'],
            createdAt: BEFORE_CUTOFF,
        }).eligible).toBe(true);
    });

    it('refuses a pre-cutoff male account with no prior access', () => {
        expect(checkWaveEligibility({
            gender: 'male',
            roles: [],
            createdAt: BEFORE_CUTOFF,
        }).eligible).toBe(false);
    });

    it('pins the cutoff date, so moving it is deliberate', () => {
        expect(WAVE_MALE_CUTOFF_DATE.toISOString()).toBe('2026-06-17T00:00:00.000Z');
    });
});

describe('admin and Academy Elite override, as they always did', () => {
    it.each([
        ['admin', { roles: ['admin'] }],
        ['super_admin', { roles: ['super_admin'] }],
        ['academy elite (approved)', { roles: [], serviceRegistrations: { academy: { plan: 'elite', status: 'approved' } } }],
        ['academy elite (active)', { roles: [], serviceRegistrations: { academy: { plan: 'elite', status: 'active' } } }],
    ])('%s is eligible even as a post-cutoff male account', (_label, extra: any) => {
        expect(checkWaveEligibility({ gender: 'male', createdAt: AFTER_CUTOFF, ...extra }).eligible).toBe(true);
    });

    it('a non-elite academy plan does not override', () => {
        // Vacuity guard on the clause above: if the plan check were dropped, every
        // academy registration would become an exemption.
        expect(checkWaveEligibility({
            gender: 'male',
            roles: [],
            createdAt: AFTER_CUTOFF,
            serviceRegistrations: { academy: { plan: 'basic', status: 'approved' } },
        }).eligible).toBe(false);
    });
});

describe('createdAt is understood in every shape it arrives in', () => {
    // Each copy handled a different subset, and a shape one of them missed
    // answered "before the cutoff" — the permissive direction.
    //
    // The fixture holds the WAVE role on purpose. With `roles: []` the account is
    // refused by the clause BELOW the cutoff whatever the date says, so every one
    // of these assertions passed for the wrong reason — a mutation disabling the
    // `seconds` branch was not caught. With the role, the cutoff is the only thing
    // that can decide, which is what these tests are about.
    const male = { gender: 'male', roles: ['wave_participant'] };

    it('a Firestore-style Timestamp', () => {
        const ts = { toDate: () => new Date(AFTER_CUTOFF) };
        expect(checkWaveEligibility({ ...male, createdAt: ts }).eligible).toBe(false);
    });

    it('a seconds object', () => {
        const secs = { seconds: Math.floor(new Date(AFTER_CUTOFF).getTime() / 1000) };
        expect(checkWaveEligibility({ ...male, createdAt: secs }).eligible).toBe(false);
    });

    it('an admin-style _seconds object', () => {
        const secs = { _seconds: Math.floor(new Date(AFTER_CUTOFF).getTime() / 1000) };
        expect(checkWaveEligibility({ ...male, createdAt: secs }).eligible).toBe(false);
    });

    it('an ISO string', () => {
        expect(checkWaveEligibility({ ...male, createdAt: AFTER_CUTOFF }).eligible).toBe(false);
    });

    it('an unparseable value falls back to pre-cutoff, not to blocked', () => {
        // A male account with an unreadable createdAt and NO prior access is still
        // refused by the clause below the cutoff, so falling back permissively here
        // does not open a hole — it just means the cutoff cannot be applied to a
        // date nobody can read.
        expect(checkWaveEligibility({
            gender: 'male',
            roles: [],
            createdAt: 'not a date',
        }).eligible).toBe(false);

        expect(checkWaveEligibility({ ...male, createdAt: 'not a date' }).eligible).toBe(true);
    });

    it('and a date it CAN read still refuses, so the fallback is not the answer', () => {
        // Pairs with the above: if every shape silently became unparseable, the
        // tests in this block would pass while the cutoff enforced nothing.
        expect(checkWaveEligibility({ ...male, createdAt: BEFORE_CUTOFF }).eligible).toBe(true);
        expect(checkWaveEligibility({ ...male, createdAt: AFTER_CUTOFF }).eligible).toBe(false);
    });
});

describe('the gender string helpers', () => {
    it('read the three spellings live rows hold', () => {
        // "Female" from the application and briefing paths, "female" from
        // registration, with whitespace from imports.
        expect(describesAWoman('Female')).toBe(true);
        expect(describesAWoman('female')).toBe(true);
        expect(describesAWoman(' FEMALE ')).toBe(true);
        expect(describesAMan('Male')).toBe(true);
    });

    it('treat anything else as neither', () => {
        for (const v of ['', 'f', 'woman', 'other', null, undefined, 42, {}]) {
            expect(describesAWoman(v)).toBe(false);
            expect(describesAMan(v)).toBe(false);
        }
    });
});

describe('every account-based call site reads the shared rule', () => {
    it.each([
        'src/app/actions/wave/_wv_membership.ts',
        'src/app/actions/wave/_wv_applications.ts',
        'src/app/api/wave/check-eligibility/route.ts',
    ])('%s calls checkWaveEligibility', (rel: string) => {
        expect(code(rel)).toContain('checkWaveEligibility(');
    });

    it.each([
        'src/app/actions/wave/_wv_membership.ts',
        'src/app/actions/wave/_wv_applications.ts',
        'src/app/api/wave/check-eligibility/route.ts',
    ])('%s keeps no local copy of the rule', (rel: string) => {
        const src = code(rel);

        expect(src).not.toContain('CUTOFF_DATE');
        expect(src).not.toMatch(/const isMale\s*=/);
        expect(src).not.toContain('isWaveBlocked');
    });

    it('briefing.ts is deliberately NOT converted', () => {
        // It answers a different question against a different input: whether a
        // SUBMITTED form value describes a woman, for a caller who may have no
        // profile at all. Forcing one function to cover both would mean inventing a
        // null-account path, which is how a rule grows branches nobody can reason
        // about. Recorded so the omission reads as a decision rather than a miss.
        const src = code('src/app/actions/briefing.ts');

        expect(src).not.toContain('checkWaveEligibility');
        expect(src).toContain('normalizedGender !== "female"');
    });
});
