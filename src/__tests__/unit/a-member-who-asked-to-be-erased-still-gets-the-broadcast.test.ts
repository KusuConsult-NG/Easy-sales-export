/**
 * @jest-environment node
 */

/**
 *   #697 THE PLATFORM MARKS AN ACCOUNT AS ERASED, AND THE ONE PLACE THAT
 *        DECIDES WHO GETS CONTACTED DOES NOT LOOK.
 *
 *   A right-to-erasure request runs lib/user-soft-delete. It is careful work —
 *   #206, #283, #300, #371, #376 between them write a retention record first,
 *   scrub the user row, and scrub the member's identity off all EIGHT module
 *   collections that carry a copy of it. The row is left with:
 *
 *       deleted: true,  deletedAt,  suspended: true,
 *       isActive: false,  roles: ["deleted"],
 *       email: `deleted_${uid}@redacted.local`
 *
 *   Every audience builder on this platform reads `users`, takes `data.email`,
 *   and sends. None of the three checks `deleted`. So an account whose owner
 *   asked to be removed is still counted in the audience and still mailed.
 *
 * ── THE ERASED ADDRESS IS BUILT TO LOOK REAL, AND NOTHING READS IT BACK ─────
 *
 *   `erasedEmailFor()` is imported by exactly three files, and all three WRITE
 *   it — user-soft-delete, admin_extensions, actions/user. Not one reader
 *   anywhere in the application. The broadcast's own gate,
 *
 *       isPlausibleEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
 *
 *   admits `deleted_abc@redacted.local` without hesitation: it has an @ and a
 *   dot, which is all that test asks.
 *
 *   `.local` IS A RESERVED TLD — RFC 6762 assigns it to multicast DNS — so it
 *   can never resolve. Every broadcast therefore sends one guaranteed-undeliverable
 *   message per erased account. #694 is emphatic about what that costs: "Continuing
 *   to send to a hard-bounced address is exactly what degrades a sending domain,
 *   and that degradation reaches the broadcasts the existing check was written to
 *   protect." The platform is manufacturing the exact thing that finding exists
 *   to prevent, out of its own erasure marker.
 *
 * ── AND THE SECOND TOMBSTONE, WHICH NOTHING READS EITHER ────────────────────
 *
 *   #681 stopped the legacy import DELETING a member's superseded profile and
 *   marked it `_migratedTo: <the live uid>` instead. #490 states the rule in
 *   its own words: "A ROW THAT SAYS `_migratedTo: <somebody else>` HAS BEEN
 *   SUPERSEDED."
 *
 *   Identity resolution honours that everywhere — profile-choice, the payment
 *   processors, the profile actions all walk the pointer to the live row. The
 *   audience builders do not, so a superseded profile is a second recipient.
 *   The owner's own forensic report counts these: "33 address(es) hold more
 *   than one [profile] ... the original is kept and tombstoned, never deleted."
 *
 *   FOR EMAIL AND SMS THE COST IS THE COUNT, NOT A DOUBLE SEND: those two
 *   audiences deduplicate on the address and the phone, so a tombstone sharing
 *   an address collapses into the live row. The IN-APP audience keys on the
 *   UID, so it writes a notification onto an account nobody can sign into —
 *   #490's whole point is that the superseded row is not where the person is.
 *
 * ── WHAT THIS FINDING DOES NOT CLAIM ────────────────────────────────────────
 *
 *   SMS IS ALREADY SAFE FOR ERASED MEMBERS, and saying so is the point of
 *   measuring rather than assuming. `phone` and `phoneNumber` are in
 *   ERASED_FIELDS and are deleted outright, and #376 scrubs the same numbers
 *   off all eight module rows — which is where sms-broadcast reads most of its
 *   numbers from. An erased member has no number left anywhere to reach. The
 *   erasure did its job on the phone and left a synthetic EMAIL behind, and
 *   that asymmetry is the whole defect.
 *
 *   SUSPENDED-BUT-NOT-ERASED ACCOUNTS ARE LEFT IN, deliberately. Suspension is
 *   an access decision an admin can reverse, and "we suspended you" is exactly
 *   the kind of thing a platform may still need to email somebody about. Only
 *   the two tombstones the platform writes to mean "this is not a live person
 *   to contact" are excluded. That is also why the predicate does not test
 *   `suspended`: an erasure sets it too, so keying on it would have swept every
 *   suspension in.
 *
 *   A SUPERSEDED PROFILE IS NOT EXCLUDED FROM SMS, and the reasoning is recorded
 *   rather than quietly applied. Excluding it by NUMBER is wrong in both
 *   directions: a tombstone sharing the live row's number would take the live
 *   member out with it, and one carrying a DIFFERENT number may hold the only
 *   way left to reach that person. Email and in-app each have a key that
 *   identifies the account — the address, the uid — and SMS has neither. The
 *   duplicate it can cause is one message to a second number belonging to the
 *   same person, which is the cheaper mistake.
 *
 *   AND THE FIX LANDED ON THE WRONG LOOP FIRST. sms-broadcast reads `users` in
 *   eight places; the first edit went to the phone-state map rather than the
 *   `all` audience, and the SMS test above caught it. Threading the rule through
 *   all eight would have been eight restatements of it — the shape this audit
 *   keeps finding — so the two doors that can identify an account do it by key
 *   and this one does it at the row it reads.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

const mockRequireAdmin = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: (...a: any[]) => mockRequireAdmin(...a),
    liveAdminRoles: jest.fn(async () => ({ roles: ['admin'] })),
}));

const LIVE = 'live-1';
const ERASED = 'erased-1';
const TOMB = 'tomb-1';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();

    mockRequireAdmin.mockResolvedValue({ userId: 'admin-1', roles: ['admin'] });

    store.seed(COLLECTIONS.USERS, LIVE, {
        id: LIVE,
        email: 'live@example.test',
        fullName: 'Live Member',
        roles: ['general_user'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
    });

    //   Exactly what lib/user-soft-delete leaves behind.
    store.seed(COLLECTIONS.USERS, ERASED, {
        id: ERASED,
        email: `deleted_${ERASED}@redacted.local`,
        fullName: 'Redacted User',
        name: 'Redacted User',
        deleted: true,
        deletedAt: '2026-08-01T00:00:00.000Z',
        suspended: true,
        isActive: false,
        roles: ['deleted'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
    });

    //   A superseded profile, as #681 leaves it: a real address, pointing at
    //   the live row.
    store.seed(COLLECTIONS.USERS, TOMB, {
        id: TOMB,
        email: 'tombstone@example.test',
        fullName: 'Old Profile',
        roles: ['general_user'],
        _migratedTo: LIVE,
        createdAt: '2025-06-01T00:00:00.000Z',
        updatedAt: '2025-06-01T00:00:00.000Z',
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#697 — the email broadcast audience', () => {
    it('DOES NOT CARRY AN ERASED ACCOUNT', async () => {
        const { getCleanBroadcastList } = await import('@/lib/broadcast-logic');
        const res: any = await getCleanBroadcastList({ audience: 'all' } as any);

        const addresses = (res?.data?.recipients ?? []).map((r: any) => r.email);
        expect(addresses).toContain('live@example.test');
        //   Named rather than counted, so a failure shows the address that
        //   travelled.
        expect(addresses.filter((a: string) => a.endsWith('@redacted.local'))).toEqual([]);
    });

    it('AND DOES NOT CARRY A SUPERSEDED PROFILE', async () => {
        const { getCleanBroadcastList } = await import('@/lib/broadcast-logic');
        const res: any = await getCleanBroadcastList({ audience: 'all' } as any);

        const addresses = (res?.data?.recipients ?? []).map((r: any) => r.email);
        expect(addresses).not.toContain('tombstone@example.test');
    });

    it('AND STILL CARRIES THE LIVE MEMBER — the control', async () => {
        /*
         *   Every assertion above is about somebody being absent, and an
         *   audience builder that returned nobody at all would satisfy all of
         *   them. This is the one that fails if the exclusion is too wide.
         */
        const { getCleanBroadcastList } = await import('@/lib/broadcast-logic');
        const res: any = await getCleanBroadcastList({ audience: 'all' } as any);

        const addresses = (res?.data?.recipients ?? []).map((r: any) => r.email);
        expect(addresses).toEqual(['live@example.test']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#697 — the in-app broadcast audience', () => {
    it('DOES NOT WRITE A NOTIFICATION ONTO AN ERASED OR SUPERSEDED ACCOUNT', async () => {
        /*
         *   The in-app audience keys on the UID rather than on an address, so
         *   the deduplication that hides the tombstone from email and SMS does
         *   not apply here: it is a notification on a row #490 says is not
         *   where the person is.
         */
        const { collectRecipientUserIds } = await import('@/app/actions/in-app-broadcast');
        const recipients = await collectRecipientUserIds({ audience: 'all' } as any);

        const ids = recipients.map((r) => r.userId).sort();
        expect(ids).toEqual([LIVE]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#697 — the SMS broadcast audience', () => {
    it('SKIPS AN ERASED ACCOUNT EVEN WHEN IT STILL HAS A NUMBER', async () => {
        /*
         *   Driven through the real action, and seeded with a PHONE on the
         *   erased row — which an erased member does not really have, because
         *   `phone` and `phoneNumber` are in ERASED_FIELDS and #376 scrubs the
         *   module copies too.
         *
         *   That is the point of seeding it anyway: the SMS path was already
         *   safe by two independent accidents of the erasure, and a test
         *   relying on those would pass whether or not this door decided
         *   anything. This one fails unless it does.
         *
         *   THE SUPERSEDED PROFILE IS DELIBERATELY NOT ASSERTED HERE, and the
         *   reasoning is recorded rather than quietly applied. Excluding it by
         *   NUMBER is wrong in both directions: a tombstone sharing the live
         *   row's number would take the live member out with it, and one
         *   carrying a DIFFERENT number may hold the only way left to reach
         *   that person. Email and in-app both have a key that identifies the
         *   account — the address, the uid — and SMS has neither. The
         *   duplicate-send it can cause is one message to a second number
         *   belonging to the same person, which is the cheaper mistake.
         */
        store.seed(COLLECTIONS.USERS, LIVE, {
            ...store.get(COLLECTIONS.USERS, LIVE)!, phone: '08030000001',
        });
        store.seed(COLLECTIONS.USERS, ERASED, {
            ...store.get(COLLECTIONS.USERS, ERASED)!, phone: '08030000002',
        });
        store.seed(COLLECTIONS.USERS, TOMB, {
            ...store.get(COLLECTIONS.USERS, TOMB)!, phone: '08030000003',
        });

        const { previewSmsBroadcastAction } = await import('@/app/actions/sms-broadcast');
        const res: any = await previewSmsBroadcastAction({ audience: 'all' } as any);

        expect(res.success).toBe(true);
        const phones = (res.data?.sample ?? []).map((r: any) => r.phone);
        expect(phones.some((p: string) => p.endsWith('0000001'))).toBe(true);
        expect(phones.some((p: string) => p.endsWith('0000002'))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#697 — and the line this finding deliberately does not cross', () => {
    it('A SUSPENDED ACCOUNT THAT WAS NOT ERASED IS STILL REACHED', async () => {
        /*
         *   THE boundary, and the reason the predicate does not simply test
         *   `suspended`. An erasure sets `suspended: true` as well, so keying on
         *   that field would have swept every suspension into the exclusion and
         *   quietly stopped a real category of mail — including "your account
         *   has been suspended", which is the one message such a member most
         *   needs.
         */
        store.seed(COLLECTIONS.USERS, 'susp-1', {
            id: 'susp-1',
            email: 'suspended@example.test',
            fullName: 'Suspended Member',
            roles: ['general_user'],
            suspended: true,
            isActive: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z',
        });

        const { getCleanBroadcastList } = await import('@/lib/broadcast-logic');
        const res: any = await getCleanBroadcastList({ audience: 'all' } as any);
        const addresses = (res?.data?.recipients ?? []).map((r: any) => r.email);

        expect(addresses).toContain('suspended@example.test');
    });

    it('AND EACH HALF OF THE ERASURE TEST STANDS ON ITS OWN', async () => {
        /*
         *   THE INSTRUMENT, SHARPENED. A real erased row carries BOTH the
         *   `deleted` flag and the placeholder address, so a suite seeded only
         *   with that row passes if EITHER check works and cannot say which.
         *   Mutating one half would have survived and looked like a redundant
         *   rule rather than an untested one.
         *
         *   Split here: a flag with a real address, and an address with no
         *   flag. The second is not hypothetical — the placeholder is what
         *   would actually be mailed, so it has to exclude on its own.
         */
        const { isContactableAccount } = await import('@/lib/contactable-account');

        expect(isContactableAccount({ deleted: true, email: 'real@example.test' }, 'u1')).toBe(false);
        expect(isContactableAccount({ email: 'deleted_u1@redacted.local' }, 'u1')).toBe(false);
        expect(isContactableAccount({ email: 'real@example.test' }, 'u1')).toBe(true);
    });

    it('AND THE EMAIL AUDIENCE EXCLUDES A FLAGGED ROW THAT KEPT A REAL ADDRESS', async () => {
        //   The same split, behaviourally, at the door that sends.
        store.seed(COLLECTIONS.USERS, 'flagged-1', {
            id: 'flagged-1',
            email: 'flagged@example.test',
            fullName: 'Flagged Member',
            roles: ['general_user'],
            deleted: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z',
        });

        const { getCleanBroadcastList } = await import('@/lib/broadcast-logic');
        const res: any = await getCleanBroadcastList({ audience: 'all' } as any);
        const addresses = (res?.data?.recipients ?? []).map((r: any) => r.email);

        expect(addresses).not.toContain('flagged@example.test');
        expect(addresses).toContain('live@example.test');
    });

    it('AND A ROW WHOSE _migratedTo POINTS AT ITSELF IS NOT SUPERSEDED', async () => {
        //   A migration where the row was also the winner. #490's rule is about
        //   a pointer to SOMEBODY ELSE.
        const { isContactableAccount } = await import('@/lib/contactable-account');

        expect(isContactableAccount({ _migratedTo: 'me', email: 'a@b.test' }, 'me')).toBe(true);
        expect(isContactableAccount({ _migratedTo: 'other', email: 'a@b.test' }, 'me')).toBe(false);
        expect(isContactableAccount({ _migratedTo: '', email: 'a@b.test' }, 'me')).toBe(true);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     the deleted flag stops excluding                                KILLED
 *     the erased address stops excluding                              KILLED
 *     the superseded pointer stops excluding                          KILLED
 *     a self-pointer is treated as superseded                         KILLED
 *     the email audience stops checking the row                       KILLED
 *     the tombstone fields leave the projection                       KILLED
 *     the in-app audience stops consulting the set                    KILLED
 *     the SMS audience stops checking the row                         KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword the header                                            SURVIVED ✓
 *
 *   TWO OF THOSE ONLY BECAME KILLABLE AFTER THE SUITE WAS SHARPENED. A real
 *   erased row carries BOTH the `deleted` flag and the placeholder address, so
 *   seeded with only that row the suite passed if EITHER check worked and could
 *   not say which — mutating one half would have survived and read as a
 *   redundant rule rather than an untested one. The split cases above (a flag
 *   with a real address, an address with no flag) are what make each half
 *   load-bearing.
 *
 *   AND "the tombstone fields leave the projection" IS THE #696 INTERACTION
 *   UNDER TEST. Since .select() became real, a field not named in the audience's
 *   projection is not on the row — so this check could have been half-blind from
 *   the day it was written, catching an erased account by its address and never
 *   seeing a superseded one. That mutant fails the suite, which is the only
 *   reason that coupling is safe to rely on.
 */
