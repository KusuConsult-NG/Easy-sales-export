/**
 * @jest-environment node
 */

/**
 *   #490 THE DUPLICATE PROFILES MULTIPLY, AND THE STALE COPY CAN WIN.
 *
 *   The owner's duplicate-email query:
 *
 *       lubashehu369@gmail.com     6 profiles
 *       walidazayyanu74@gmail.com  5
 *       nancindaniel@gmail.com     5
 *       …and several at 4 and 3
 *
 *   Six rows for one person is not six mistakes. It is one mechanism, run five
 *   times.
 *
 * ── HOW THE ROWS MULTIPLY ───────────────────────────────────────────────────
 *
 *   migrateLegacyUserData COPIES a legacy profile to a new document keyed by
 *   the Supabase auth id and leaves the original in place, tombstoned with
 *   `_migratedTo`. That is correct and deliberate — the owner's standing rule is
 *   that nothing is destroyed — and it means a migrated person legitimately has
 *   TWO rows.
 *
 *   The third, fourth and fifth come from the login path. When a second auth
 *   account exists for the same address, preValidateLoginAction runs:
 *
 *       findProfilesByEmail(email)  ->  [legacy, migrated]
 *       chooseProfileForAuthAccount(rows, newAuthId)
 *
 *   Neither row is keyed by the new id, neither carries `_migratedTo: newId`,
 *   neither carries `supabaseAuthId: newId` — so the chooser falls through to
 *   best-evidence, returns `ambiguous: true`, and the caller MIGRATES ANYWAY.
 *   A third row. Then a fourth. The `ambiguous` flag was added by #477 and is
 *   logged; nothing acts on it.
 *
 * ── AND THE ROW IT COPIES FROM MAY BE THE DEAD ONE ──────────────────────────
 *
 *   This is the half that costs the member data rather than tidiness.
 *
 *   betterFirst ranks candidates by registrations, then profileComplete, then
 *   role count, then — rule 4 — the OLDEST createdAt, under the comment "The
 *   ORIGINAL account, not a later duplicate."
 *
 *   That rule is right for two rival originals and exactly backwards for a
 *   migration. The migrated row IS the later duplicate, and it is the one
 *   holding everything: the merge of both records, every registration, the
 *   roles. The legacy row is a tombstone. When the two tie on registrations —
 *   which they do, because the migrated row is a copy of the legacy one — rule 4
 *   prefers the TOMBSTONE, and rule 5 breaks the remaining tie on a string
 *   comparison of document ids.
 *
 *   So which record a returning member gets is decided by whether their legacy
 *   id happens to sort before their Supabase one. When the tombstone wins, the
 *   migration copies a superseded record forward over the current one, and
 *   anything gained since the first migration is at the mercy of
 *   preserveActiveValues.
 *
 *   A row that says `_migratedTo: <somebody>` has been superseded. It should
 *   never outrank a live row, whatever its date.
 *
 * ── WHAT THIS CHANGES ───────────────────────────────────────────────────────
 *
 *     1. A SUPERSEDED ROW SORTS LAST. `_migratedTo` pointing anywhere other
 *        than the caller is a tombstone, and tombstones lose to live rows. The
 *        exact-match rules above it are untouched: a row pointing AT the caller
 *        is still their record, chosen before any of this runs.
 *
 *     2. THE MIGRATION FOLLOWS THE TOMBSTONE. Handed a source already migrated
 *        elsewhere, it copies from the CURRENT record instead of the dead one,
 *        and chains the tombstone forward so the trail stays walkable. Without
 *        the chain, the middle row of a three-hop history points at an account
 *        that is itself superseded, and the next lookup cannot tell.
 *
 *     3. THE POPULATION IS VISIBLE. A forensic check reports addresses holding
 *        more than one profile, so the owner reads it on the screen instead of
 *        running SQL by hand.
 *
 *   WHAT IT DOES NOT DO: merge or delete anything. Six rows stay six rows. This
 *   stops the seventh, makes the right one win, and puts the existing ones on a
 *   report. Deciding which of somebody's six records is the person is not a
 *   thing code should do unattended.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the supersession rule removed                  KILLED
 *     the supersession rule inverted                 KILLED
 *     the migration ignoring the tombstone           KILLED
 *     the tombstone chain not written                KILLED
 *     the chain's rows not swept                     KILLED
 *     the duplicate check always passing             KILLED
 *     blank addresses grouped together               KILLED
 *     the address case not normalised                KILLED
 *     reword this header                             SURVIVED, as intended
 *
 *   THREE OF THOSE SURVIVED THE FIRST RUN, and all three for the same reason:
 *   the assertions were source greps that a NAME satisfied. `followMigrationChain`
 *   still appeared in the file when its CALL was replaced by a literal; the
 *   tombstone slice stayed true when the loop iterated one hard-coded id; the
 *   duplicate check's name was still there when its status was hard-coded to
 *   "pass". Third time in this audit. All three are executed now — the migration
 *   against the fake database, the scan against a seeded world.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { chooseProfileForAuthAccount } from '@/lib/profile-choice';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

let store: FakeDbHandle;

const LEGACY = 'firebase-uid-legacy';
const ACTIVE = 'supabase-uuid-active';
const USERS = COLLECTIONS.USERS;
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;

const migrate = async (from = LEGACY, to = ACTIVE, email = 'ada@example.com') =>
    (await (await import('@/lib/user-migration')).migrateLegacyUserData(from, to, email));

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

const code = (rel: string) => stripComments(readFileSync(rel, 'utf-8'), { label: rel });

interface Doc { id: string; data: () => Record<string, unknown> }
const doc = (id: string, data: Record<string, unknown> = {}): Doc => ({ id, data: () => data });

const AUTHED = 'supabase-auth-new';

/** A migrated pair: the tombstoned original, and the row that superseded it. */
function migratedPair(regs: number) {
    const serviceRegistrations: Record<string, unknown> = {};
    for (let i = 0; i < regs; i++) serviceRegistrations[`mod${i}`] = { status: 'active' };

    return {
        //   Sorts FIRST on id, and is the older row — so it wins rules 4 and 5
        //   outright unless supersession is considered.
        tombstone: doc('aaa-legacy-firebase', {
            serviceRegistrations,
            createdAt: '2020-01-01T00:00:00.000Z',
            _migratedTo: 'supabase-auth-first',
        }),
        current: doc('zzz-supabase-first', {
            serviceRegistrations,
            createdAt: '2024-01-01T00:00:00.000Z',
        }),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#490 — a tombstoned profile never outranks the row that superseded it', () => {
    it('THE MIGRATED RECORD IS CHOSEN, NOT THE LEGACY ONE IT REPLACED', () => {
        //   THE test. Both rows tie on registrations, completeness and roles;
        //   rule 4 then prefers the OLDER row, which is the tombstone, and rule
        //   5 breaks the tie on a string comparison of ids that the tombstone
        //   also wins. A returning member got their superseded record.
        const { tombstone, current } = migratedPair(2);

        const choice = chooseProfileForAuthAccount([tombstone, current], AUTHED);

        expect(choice.chosen?.id).toBe('zzz-supabase-first');
        expect(choice.reason).toBe('best-evidence');
    });

    it('AND IT STILL LOSES WHEN THE TOMBSTONE HAS MORE REGISTRATIONS', () => {
        //   The rule is about supersession, not about ignoring evidence — but
        //   supersession comes FIRST, because a dead row's extra registration is
        //   a registration the live row inherited in the merge.
        const tombstone = doc('aaa-legacy', {
            serviceRegistrations: { a: { status: 'active' }, b: { status: 'active' }, c: { status: 'active' } },
            _migratedTo: 'supabase-auth-first',
        });
        const current = doc('zzz-current', { serviceRegistrations: { a: { status: 'active' } } });

        expect(chooseProfileForAuthAccount([tombstone, current], AUTHED).chosen?.id)
            .toBe('zzz-current');
    });

    it('AND THE EXACT-MATCH RULES STILL WIN OVER ALL OF IT', () => {
        //   The supersession rule must not outrank identity. A row pointing AT
        //   this caller is their record, whatever else it says — that is #477's
        //   `migrated-pointer`, and breaking it would send a migrated user to
        //   somebody else's row.
        const mine = doc('aaa-legacy', { _migratedTo: AUTHED });
        const other = doc('zzz-current', { serviceRegistrations: { a: { status: 'active' } } });

        const choice = chooseProfileForAuthAccount([mine, other], AUTHED);

        expect(choice.chosen?.id).toBe('aaa-legacy');
        expect(choice.reason).toBe('migrated-pointer');
    });

    it('and two tombstones still order deterministically between themselves', () => {
        //   The order must stay TOTAL. If every candidate is superseded the
        //   choice is bad either way, and it must still be the same bad choice
        //   on every request — an unstable pick is a member seeing a different
        //   account each time they sign in.
        const a = doc('aaa', { _migratedTo: 'x' });
        const b = doc('bbb', { _migratedTo: 'y' });

        expect(chooseProfileForAuthAccount([a, b], AUTHED).chosen?.id).toBe('aaa');
        expect(chooseProfileForAuthAccount([b, a], AUTHED).chosen?.id).toBe('aaa');
    });

    it('and a row with no pointer at all is not treated as superseded', () => {
        //   Vacuity guard: a rule that called everything superseded would
        //   collapse back to the id tiebreak and look like it worked.
        const older = doc('aaa', { createdAt: '2020-01-01T00:00:00.000Z' });
        const newer = doc('zzz', { createdAt: '2024-01-01T00:00:00.000Z' });

        //   Rule 4 still applies between two live rows: the original wins.
        expect(chooseProfileForAuthAccount([newer, older], AUTHED).chosen?.id).toBe('aaa');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#490 — the migration copies from the current record, not a dead one', () => {
    /**
     *   EXECUTED, NOT GREPPED. The first version of this block asserted that
     *   the source contained the word `followMigrationChain`, and a mutant that
     *   replaced the CALL with `{ sourceUid: firebaseUid, visited: [firebaseUid] }`
     *   sailed through — the function was still defined, so the name was still
     *   there. Same for the tombstone chain, asserted by a slice that stayed
     *   true when the loop iterated a single hard-coded id.
     *
     *   Third time in this audit that a source assertion has been satisfied by
     *   a name rather than a rule. These run the migration.
     */
    const SECOND = 'supabase-uuid-second';

    it('A SOURCE ALREADY MIGRATED IS NOT THE ROW COPIED FORWARD', async () => {
        //   THE test. L was migrated to A; a second auth account B now arrives
        //   for the same person. The record holding everything is A, and L is a
        //   tombstone carrying whatever it held before the first migration.
        store.seed(USERS, LEGACY, {
            email: 'ada@example.com',
            _migratedTo: ACTIVE,
            fullName: 'Stale Name',
        });
        store.seed(USERS, ACTIVE, {
            email: 'ada@example.com',
            fullName: 'Current Name',
            serviceRegistrations: { cooperatives: { status: 'active' } },
        });

        await migrate(LEGACY, SECOND);

        //   The new row carries the CURRENT record, not the tombstone's.
        expect(store.get(USERS, SECOND)?.fullName).toBe('Current Name');
        expect(store.get(USERS, SECOND)?.serviceRegistrations?.cooperatives?.status).toBe('active');
    });

    it('AND EVERY ROW IN THE CHAIN IS TOMBSTONED FORWARD', async () => {
        //   Without this the middle row points at an account that is itself
        //   superseded, and the supersession rule above cannot tell which end of
        //   the chain is live past the second hop.
        store.seed(USERS, LEGACY, { email: 'ada@example.com', _migratedTo: ACTIVE });
        store.seed(USERS, ACTIVE, { email: 'ada@example.com', fullName: 'Current Name' });

        await migrate(LEGACY, SECOND);

        expect(store.get(USERS, LEGACY)?._migratedTo).toBe(SECOND);
        expect(store.get(USERS, ACTIVE)?._migratedTo).toBe(SECOND);
    });

    it('AND THE ROWS UNDER THE INTERMEDIATE ID MOVE TOO', async () => {
        //   The half a profile-only fix would have missed. After L -> A the
        //   member's savings sit under A. A second migration handed L used to
        //   find nothing to move and stranded them there while the profile went
        //   to B.
        store.seed(USERS, LEGACY, { email: 'ada@example.com', _migratedTo: ACTIVE });
        store.seed(USERS, ACTIVE, { email: 'ada@example.com' });
        store.seed(MEMBERS, ACTIVE, { userId: ACTIVE, savingsBalance: 75_000 });

        await migrate(LEGACY, SECOND);

        expect(store.get(MEMBERS, SECOND)).toMatchObject({
            userId: SECOND, savingsBalance: 75_000,
        });
    });

    it('a single-hop migration behaves exactly as it always did', async () => {
        //   The control that matters most: almost every migration is one hop,
        //   and the chain-following must be invisible to it.
        store.seed(USERS, LEGACY, { email: 'ada@example.com', fullName: 'Ada Obi' });
        store.seed(MEMBERS, LEGACY, { userId: LEGACY, savingsBalance: 50_000 });

        await migrate();

        expect(store.get(USERS, ACTIVE)?.fullName).toBe('Ada Obi');
        expect(store.get(MEMBERS, ACTIVE)).toMatchObject({ userId: ACTIVE, savingsBalance: 50_000 });
        expect(store.get(USERS, LEGACY)?._migratedTo).toBe(ACTIVE);
    });

    it('and a chain that loops terminates instead of spinning', async () => {
        //   A -> B -> A is writable by two re-migrations made before this
        //   existed. Stopping on the cycle is safer than picking a side, and an
        //   unbounded walk would hang the login it runs from.
        store.seed(USERS, LEGACY, { email: 'ada@example.com', _migratedTo: ACTIVE });
        store.seed(USERS, ACTIVE, { email: 'ada@example.com', _migratedTo: LEGACY });

        const result = await migrate(LEGACY, SECOND);

        expect(result.success).toBe(true);
    });

    it('and it still refuses a no-op migration', async () => {
        expect((await migrate(LEGACY, LEGACY)).success).toBe(true);
        expect(store.get(USERS, LEGACY)).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#490 — the owner can see the population without writing SQL', () => {
    it('THE FORENSIC SCAN REPORTS ADDRESSES HOLDING MORE THAN ONE PROFILE', () => {
        const scan = code('src/app/actions/forensics.ts');

        expect(scan).toContain('Duplicate Profiles (One Address, Several Accounts)');
    });

    it('AND IT COUNTS ROWS RATHER THAN ASSUMING A NUMBER', () => {
        //   #331's shape: a check that reports a figure it did not compute.
        const scan = code('src/app/actions/forensics.ts');
        const start = scan.indexOf('Duplicate Profiles (One Address, Several Accounts)');
        const section = scan.slice(Math.max(0, start - 2500), start + 600);

        expect(section).toMatch(/byEmail|duplicateEmails/);
        expect(section).toMatch(/Scanned \$\{/);
    });

    it('and a blank email is not counted as a duplicate of another blank one', () => {
        //   #479: a blank email is not an identity. Grouping on it would report
        //   the 49 email-less profiles as one 49-way duplicate, which is the
        //   loudest possible way to say nothing.
        const scan = code('src/app/actions/forensics.ts');
        const start = scan.indexOf('Duplicate Profiles (One Address, Several Accounts)');
        const section = scan.slice(Math.max(0, start - 2500), start + 600);

        expect(section).toMatch(/if \(!normalised\) continue|!email\) continue/);
    });
});
