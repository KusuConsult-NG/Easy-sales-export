/**
 * @jest-environment node
 */

/**
 *   THE userId SWEEP, TRANCHE 4 — THE DESTRUCTIVE AND ADMINISTRATIVE EDGE.
 *
 *   Three of the four things reserved for this tranche turned out to have a
 *   right answer; one did not exist at all.
 *
 * ── ERASURE, WHICH IS THE ONE THAT MATTERS ──────────────────────────────────
 *
 *   #376 found that a right-to-erasure request "scrubbed one row out of
 *   nine" — every module keeps its own copy of the member's name, phone,
 *   address, next of kin, BVN and bank account. This is that finding one
 *   axis over. The rows are found by `userId`, so a member whose profile was
 *   superseded — 765 of them in production — had their WAVE application,
 *   their cooperative membership and their seller verification scrubbed on
 *   ONE profile and left intact on the other. Same person, same NIN, same
 *   bank account, still on the platform.
 *
 *   BOTH LOOKUPS NEEDED IT, and the second is the one easy to miss:
 *   `deterministicIds(userId)` DERIVES document ids from the id it is given,
 *   so passing only the live profile cannot reach a row keyed on the old one
 *   however many collections are swept.
 *
 *   The EMAIL sweep is deliberately not widened — it is keyed on the address
 *   rather than a profile, and #36's rule stands that an email match is a
 *   claim rather than proof of ownership.
 *
 * ── AND ONE ITEM THAT WAS NOT REAL ──────────────────────────────────────────
 *
 *   `mfa.ts` was on the tranche 4 list as "security, needs a decision".
 *   There is no such file: the TOTP secret lives on the user row, which the
 *   login path already resolves. Nothing to decide, and saying so is better
 *   than leaving it on a list for somebody else to re-investigate.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

let store: FakeDbHandle;

const LIVE = 'live-profile';
const OLD = 'superseded-profile';

function seedBothProfiles(): void {
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
}

async function erase(userId: string) {
    const { eraseModuleApplications } = await import('@/lib/module-application-erasure');
    return await eraseModuleApplications(userId, {});
}

/** The PII a WAVE application keeps its own copy of. */
const WAVE_PII = {
    fullName: 'Musa Abdullahi',
    phone: '+2348030001111',
    residentialAddress: '14 Market Road, Okene',
    nin: '12345678901',
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedBothProfiles();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a right-to-erasure request, for somebody with two profile rows', () => {
    it('THE REPORTED SHAPE: reaches the application filed under the superseded profile', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'wave-old', { userId: OLD, ...WAVE_PII });

        await erase(LIVE);

        const after = store.get(COLLECTIONS.WAVE_APPLICATIONS, 'wave-old')!;
        expect(after.fullName).not.toBe('Musa Abdullahi');
        expect(after.phone).not.toBe('+2348030001111');
        expect(after.nin).not.toBe('12345678901');
    });

    it('and still reaches the one under the live profile', async () => {
        //   The control that the widening did not REPLACE the original lookup.
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'wave-live', { userId: LIVE, ...WAVE_PII });

        await erase(LIVE);

        expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, 'wave-live')!.fullName)
            .not.toBe('Musa Abdullahi');
    });

    it('and both at once, which is the case that was half-done', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'wave-live', { userId: LIVE, ...WAVE_PII });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'wave-old', { userId: OLD, ...WAVE_PII });

        await erase(LIVE);

        for (const id of ['wave-live', 'wave-old']) {
            expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, id)!.fullName)
                .not.toBe('Musa Abdullahi');
        }
    });

    it('DOES NOT TOUCH SOMEBODY ELSE’S APPLICATION', async () => {
        //   THE control. An erasure that widened its reach on a bad resolution
        //   would destroy a stranger's record irreversibly — the one failure
        //   in this sweep that cannot be undone by clearing a field.
        store.seed(COLLECTIONS.USERS, 'stranger', { email: 'other@example.com' });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'wave-stranger', {
            userId: 'stranger', ...WAVE_PII,
        });

        await erase(LIVE);

        expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, 'wave-stranger')!.fullName)
            .toBe('Musa Abdullahi');
    });

    it('AND NOT A ROW WHOSE PROFILE POINTS AT SOMEBODY ELSE', async () => {
        //   The sharper control: superseded, but at a DIFFERENT live profile.
        //   "Is superseded" would scrub it; "follows the pointer" does not.
        store.seed(COLLECTIONS.USERS, 'other-old', {
            email: 'other@example.com', _migratedTo: 'someone-else',
        });
        store.seed(COLLECTIONS.USERS, 'someone-else', { email: 'other@example.com' });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'wave-other', {
            userId: 'other-old', ...WAVE_PII,
        });

        await erase(LIVE);

        expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, 'wave-other')!.fullName)
            .toBe('Musa Abdullahi');
    });
});

describe('the profile ranking the owner asked about', () => {
    it('ranks the MOST COMPLETE profile first, and never deletes one', async () => {
        //   "do not delete profile instead the most completed should be the
        //   most active" — already the rule in both rankers, pinned here so a
        //   later change cannot quietly invert it. #303 replaced the
        //   migration's `delete()` with a `_migratedTo` marker for the same
        //   reason: a supersession is reversible, a delete is not.
        const { rankCandidates } = await import('@/lib/duplicate-profile-resolution');

        const ranked = rankCandidates([
            { id: 'stub', data: { roles: [] } },
            { id: 'complete', data: {
                profileComplete: true,
                roles: ['user', 'farmer'],
                serviceRegistrations: { wave: { status: 'approved' } },
            } },
        ]);

        expect(ranked[0]).toBe('complete');
    });

    it('and a completed profile beats an older stub', async () => {
        //   Age is rule 4, below completeness — so seniority alone does not
        //   make a stub the person.
        const { rankCandidates } = await import('@/lib/duplicate-profile-resolution');

        const ranked = rankCandidates([
            { id: 'old-stub', data: { createdAt: '2020-01-01T00:00:00.000Z', roles: [] } },
            { id: 'new-complete', data: {
                createdAt: '2026-01-01T00:00:00.000Z',
                serviceRegistrations: { wave: { status: 'approved' } },
            } },
        ]);

        expect(ranked[0]).toBe('new-complete');
    });
});
