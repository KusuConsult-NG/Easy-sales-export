/**
 * @jest-environment node
 */

/**
 *   #825 THE SEARCH FIX REACHED TWO MODULES OUT OF SEVEN.
 *
 *   The owner: "I need you to also confirm if the admin search has been fixed
 *   and working perfectly now across all the modules."
 *
 *   It had not been. #814 taught the WAVE and Academy queues to search the name
 *   printed on the row — the APPLICATION's name — as well as the account's. The
 *   same shape sat untouched in Farm Nation, Export and Cooperative. "A correct
 *   rule applied to some of the places it names" is the defect this audit has
 *   found more often than any other, and it had happened to the fix for it.
 *
 * ── TWO DIFFERENT WAYS TO NOT FIND SOMEBODY ─────────────────────────────────
 *
 *   FARM NATION was #814 exactly: resolve the query against USERS, and if
 *   nothing matches RETURN EMPTY WITHOUT EVER QUERYING the registrants. But the
 *   label on the row is built from the registrant document —
 *
 *       const userName = profile.firstName
 *           ? `${profile.firstName} ${profile.lastName || ''}`.trim()
 *           : (profile.fullName || uData.fullName || uData.name || "Unknown");
 *
 *   — the application's `profile`, PREFERRED over the account. Same words on
 *   the screen and in the box, and "no such person" while looking at her.
 *
 *   EXPORT AND COOPERATIVE failed a subtler way and the outcome was identical.
 *   Both DO read the record's own name fields — but in JavaScript, over
 *   `applications`, and that array is one `.limit(5000)` window ordered by
 *   createdAt descending. A member who registered before the newest five
 *   thousand was not filtered out. She was never fetched.
 *
 *   The owner counts "over 15k" WAVE applications, so the window is a bound the
 *   register has already passed, not a theoretical one.
 *
 * ── WHY THESE EXECUTE THE ACTIONS ───────────────────────────────────────────
 *
 *   Because "the file mentions searchDocIdsByNameFields" is the weakest
 *   assertion in this codebase's vocabulary, and it passes against a call whose
 *   result is thrown away. #822's suite recorded a mutant surviving on exactly
 *   that. These seed the rows, run the real action, and read the rows back.
 *
 *   The window cases seed 5,002 rows so the target is genuinely outside the
 *   page the action fetches. That is slow and it is the point: a cheaper test
 *   would only ever ask the easy question, which is how #814's own suite let a
 *   prefix range be narrowed to an equality and stayed green.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     Farm Nation: the early return restored to the user search alone KILLED
 *     Farm Nation: the by-name read never issued                      KILLED
 *     Farm Nation: the 500-user ceiling restored                      KILLED
 *     Export: the out-of-window fetch removed                         KILLED
 *     Export: the mis-parenthesised name expression restored          KILLED
 *     Cooperative: the out-of-window fetch removed                    KILLED
 *     Cooperative: fullName/otherNames dropped from the filter        KILLED
 *     Academy: the out-of-window fetch removed                        KILLED
 *     reword a comment                                    SURVIVED, intended
 *
 *     Export:     the id-set check dropped                   SURVIVED
 *     Export:     the name pair dropped from the filter      SURVIVED
 *     Academy:    the id-set check dropped                   SURVIVED
 *     Academy:    the three names dropped from the filter    SURVIVED
 *     Cooperative: the id-set check dropped                  SURVIVED
 *
 *                 …AND BOTH HALVES AT ONCE                            KILLED
 *
 *   THE FOUR SURVIVORS ARE EQUIVALENT MUTANTS, AND THE LAST LINE IS WHY. Each
 *   row is kept by two independent tests — the substring filter, which now
 *   joins the same fields the query searches, and the set of ids the DATABASE
 *   matched. Either alone suffices, so removing either alone changes nothing
 *   observable. Removing BOTH is the actual defect — the field lists drifting
 *   apart AND the database's answer being discarded — and it dies.
 *
 *   The redundancy is deliberate rather than accidental: the two lists drifting
 *   is exactly how this finding happened, and the id-set is what stops the next
 *   drift costing a row. Checked rather than assumed — the both-halves mutants
 *   were run, and they die.
 *
 *   Cooperative's filter half is NOT equivalent and was killed on its own,
 *   because a surname in the middle of a combined `fullName` is reachable by a
 *   substring test and by no prefix range the query layer can express.
 *
 *   Every case also has a CONTROL that must STAY green — a search for a name
 *   nobody has must return nothing, or "found her" would be indistinguishable
 *   from "returned the whole table", which is not a search.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ data: { id: 'e1' }, error: null }) }; },
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

let store: FakeDbHandle;

/**
 * Her account carries a DIFFERENT name from her application, which is the whole
 * finding. A search that only asks the users collection cannot find "ABUBAKAR"
 * — that name is not there.
 */
const HER = 'her-doc';
const HER_USER = 'her-user';
const ACCOUNT_NAME = { fullName: 'J. Musa', firstName: 'J.', lastName: 'Musa' };

function actAs(id: string | null, roles: string[] = ['super_admin']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@example.com`, name: id } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('admin-1');
    store.seed(COLLECTIONS.USERS, 'admin-1', { roles: ['super_admin'], email: 'admin-1@example.com' });
    store.seed(COLLECTIONS.USERS, HER_USER, { roles: ['user'], email: 'her@example.com', ...ACCOUNT_NAME });
});

/** An ISO date `n` days before a fixed epoch — smaller n is NEWER. */
const daysAgo = (n: number) => new Date(Date.UTC(2026, 0, 1) - n * 86_400_000).toISOString();

/** The window the memory-pagination readers fetch: `.limit(fetchLimit + 1)`. */
const WINDOW = 5001;

const rowIds = (res: any): string[] => ((res?.data ?? []) as any[]).map((r) => r.id);

// ─────────────────────────────────────────────────────────────────────────────
describe('#825 Farm Nation — the registrant list never queried the registrants', () => {
    async function registrants(options: any) {
        const mod = await import('@/app/actions/farm-nation-admin/_fna_registrants');
        //   The one the /admin/farm-nation/applications screen calls.
        return (await mod.getStandardFarmNationRegistrantsAction(options)) as any;
    }

    beforeEach(() => {
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, HER, {
            userId: HER_USER,
            status: 'pending',
            //   Exactly what _fn_onboarding writes: the form's `profile`.
            profile: { firstName: 'AISHAT', lastName: 'ABUBAKAR', otherName: 'Yahaya' },
            submittedAt: daysAgo(1),
        });
        store.seed(COLLECTIONS.USERS, 'other-user', { roles: ['user'], email: 'other@example.com', fullName: 'Chinwe Okafor' });
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'other-doc', {
            userId: 'other-user',
            status: 'pending',
            profile: { firstName: 'Chinwe', lastName: 'OKAFOR' },
            submittedAt: daysAgo(2),
        });
    });

    it.each([
        ['her SURNAME, which is what the admin reads off the row', 'ABUBAKAR'],
        ['her FIRST NAME', 'AISHAT'],
        ['the surname in ordinary case', 'Abubakar'],
    ])('FINDS HER BY %s, though her ACCOUNT says "J. Musa"', async (_label, search) => {
        /*
         *   Every one of these returned an empty list before this finding: the
         *   user search found nothing and the action returned without ever
         *   reading FARM_NATION_APPLICATIONS.
         */
        const res = await registrants({ search });
        expect({ search, found: rowIds(res) }).toEqual({ search, found: [HER] });
    }, 60_000);

    it('AND THE ROW IT RETURNS IS LABELLED WITH THE NAME THAT WAS SEARCHED', async () => {
        //   Finding the document is only half of it. If the row came back
        //   labelled "Unknown" the admin still could not act on it.
        const res = await registrants({ search: 'ABUBAKAR' });
        expect((res.data as any[])[0]?.user?.name).toBe('AISHAT ABUBAKAR');
    }, 60_000);

    it('AND THE ACCOUNT NAME STILL WORKS — this widens the search, it does not move it', async () => {
        const res = await registrants({ search: 'Musa' });
        expect(rowIds(res)).toEqual([HER]);
    }, 60_000);

    it('CONTROL: a name nobody has finds nobody', async () => {
        const res = await registrants({ search: 'Zzzznobody' });
        expect(rowIds(res)).toEqual([]);
    }, 60_000);

    it('CONTROL: it does not return everybody', async () => {
        //   Or every assertion above passes against a search that matches the
        //   whole table, which is not a search.
        const res = await registrants({ search: 'OKAFOR' });
        expect(rowIds(res)).toEqual(['other-doc']);
    }, 60_000);

    /*
     *   AND THE OTHER READER IN THE SAME FILE, which listed registrants by
     *   reading 500 arbitrary user documents and keeping whichever of them
     *   carried a farmNation registration. There is no orderBy on that query,
     *   so WHICH 500 was whatever came back first, and #495 measured 42,160
     *   user documents — about one registrant in eighty, chosen arbitrarily,
     *   with the rest reported as not registered.
     *
     *   No screen calls it. It is exported through
     *   actions/farm-nation-admin/index and returns registrant rows, so it is
     *   held to what the screen's reader does.
     */
    describe('and the reader that could only ever see 500 users', () => {
        async function legacyReader(options: any) {
            const mod = await import('@/app/actions/farm-nation-admin/_fna_registrants');
            return (await mod.getFarmNationRegistrantsAction(options)) as any;
        }

        beforeEach(() => {
            //   Her account carries the farmNation mirror; the register also
            //   holds 600 other users with no Farm Nation registration at all,
            //   which is what used to fill the 500 the query took.
            store.seed(COLLECTIONS.USERS, HER_USER, {
                roles: ['user'], email: 'her@example.com', ...ACCOUNT_NAME,
                serviceRegistrations: { farmNation: { status: 'pending' } },
            });
            for (let i = 0; i < 600; i++) {
                store.seed(COLLECTIONS.USERS, `bystander-${i}`, {
                    roles: ['user'], email: `bystander-${i}@example.com`, fullName: `Bystander ${i}`,
                });
            }
        });

        it('FINDS HER, though 600 unrelated accounts were seeded ahead of her', async () => {
            const res = await legacyReader({ search: 'ABUBAKAR' });
            expect(((res?.data ?? []) as any[]).map(u => u.id)).toEqual([HER_USER]);
        }, 60_000);

        it('AND LISTS HER WITH NO SEARCH AT ALL', async () => {
            //   The ceiling was not a search defect. It decided who existed.
            const res = await legacyReader({ limit: 100 });
            expect(((res?.data ?? []) as any[]).map(u => u.id)).toContain(HER_USER);
        }, 60_000);

        it('CONTROL: the 600 bystanders are not registrants and are not listed', async () => {
            const res = await legacyReader({ limit: 1000 });
            const listed = ((res?.data ?? []) as any[]).map(u => u.id);
            expect(listed.filter(id => id.startsWith('bystander-'))).toEqual([]);
        }, 60_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#825 Export — she was outside the page, so she did not exist', () => {
    async function exports_(options: any) {
        const mod = await import('@/app/actions/admin/_exports');
        return (await mod.getStandardExportApplicationsAction(options)) as any;
    }

    beforeEach(() => {
        /*
         *   FILL THE WINDOW, then put her BEHIND it. The reader orders by
         *   createdAt descending and takes `.limit(5001)`, so the oldest row in
         *   a register of 5,002 is the one row the page cannot see — and the
         *   in-memory filter that reads her name only ever runs over the page.
         */
        for (let i = 0; i < WINDOW; i++) {
            store.seed(COLLECTIONS.EXPORT_APPLICATIONS, `filler-${i}`, {
                userId: `filler-user-${i}`,
                status: 'pending',
                profile: { fullName: `Filler Person ${i}` },
                createdAt: daysAgo(1 + i),
            });
        }
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, HER, {
            userId: HER_USER,
            status: 'pending',
            profile: { fullName: 'AISHAT Yahaya ABUBAKAR', firstName: 'AISHAT', lastName: 'ABUBAKAR' },
            createdAt: daysAgo(WINDOW + 10),
        });
    });

    it('FINDS HER THOUGH SHE IS OLDER THAN THE 5,001 ROWS THE PAGE FETCHES', async () => {
        const res = await exports_({ search: 'ABUBAKAR' });
        expect(rowIds(res)).toEqual([HER]);
    }, 120_000);

    it('CONTROL: a name nobody has still finds nobody', async () => {
        const res = await exports_({ search: 'Zzzznobody' });
        expect(rowIds(res)).toEqual([]);
    }, 120_000);

    it('AND A ROW THE DATABASE MATCHED IS NOT DISCARDED IN JAVASCRIPT', async () => {
        /*
         *   THE CASE EVERY OTHER ASSERTION HERE WAS TOO EASY TO REACH.
         *
         *   Mutation found it: deleting the `matchingAppIdSet` check left this
         *   suite GREEN, because every applicant it had seeded carried
         *   `profile.fullName`, which the in-memory string ALSO joins. So the
         *   database's answer was never the only thing keeping her in.
         *
         *   The two field lists do not agree. The database searches
         *   profile.firstName and profile.lastName; the string joins
         *   profile.fullName and the kyc pair and NOT those two. An applicant
         *   whose form filled in the first/last pair and left fullName empty is
         *   found by the query and then dropped by the filter — a round trip to
         *   fetch the right row and a line of JavaScript to throw it away.
         *
         *   This is #814's own lesson arriving again: a suite can execute the
         *   right code against the right data and still only ever ask the
         *   question that was going to pass.
         */
        store.seed(COLLECTIONS.USERS, 'split-user', {
            roles: ['user'], email: 'split@example.com', fullName: 'J. Musa',
        });
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'split-doc', {
            userId: 'split-user',
            status: 'pending',
            //   First and last, no fullName — which is most forms.
            profile: { firstName: 'NGOZI', lastName: 'ELEDUMARE' },
            createdAt: daysAgo(0),
        });

        const res = await exports_({ search: 'ELEDUMARE' });
        expect(rowIds(res)).toEqual(['split-doc']);
    }, 120_000);

    it('AND THE ROW IS NOT LABELLED WITH THE WORD "undefined"', async () => {
        /*
         *   A SECOND DEFECT ON THE SAME SCREEN, twice in the same file:
         *
         *       const userName = uData.name || uData.firstName
         *           ? `${uData.firstName} ${uData.lastName || ''}`.trim()
         *           : (profile?.fullName || kycName || "Unknown User");
         *
         *   `||` binds tighter than `?:`, so the condition is
         *   `(uData.name || uData.firstName)` and the TRUE branch interpolates
         *   `uData.firstName` — the value the condition did not establish. An
         *   account with `name` and no `firstName` rendered `${undefined} `
         *   and trimmed it to the five-letter string "undefined", and the
         *   `profile.fullName` fallback written for that case was unreachable.
         *
         *   `name` without `firstName` is the ordinary shape for an account
         *   created by OAuth or by a bulk import — most of the legacy register.
         */
        store.seed(COLLECTIONS.USERS, 'oauth-user', {
            roles: ['user'], email: 'oauth@example.com',
            //   What an OAuth or bulk-import account carries: a display name
            //   and no first/last pair.
            name: 'Aishat Abubakar',
        });
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'oauth-doc', {
            userId: 'oauth-user',
            status: 'pending',
            profile: { fullName: 'AISHAT Yahaya ABUBAKAR' },
            createdAt: daysAgo(0),
        });

        const res = await exports_({ search: 'Abubakar' });
        const row = (res.data as any[]).find((r) => r.id === 'oauth-doc');
        expect(row?.user?.name).toBe('Aishat Abubakar');
    }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#825 Academy — the reader #814 did not reach', () => {
    /*
     *   #814 fixed the Academy queue the screen calls
     *   (_ac_admin_applications). getAcademyApplicationsAction, in
     *   actions/admin/_academy, was left on the 5,000-row window — which is the
     *   shape this whole finding is about, found inside the fix for it.
     */
    async function academy(options: any) {
        const mod = await import('@/app/actions/admin/_academy');
        return (await mod.getAcademyApplicationsAction(options)) as any;
    }

    beforeEach(() => {
        for (let i = 0; i < WINDOW; i++) {
            store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, `filler-${i}`, {
                userId: `filler-user-${i}`,
                status: 'pending',
                personalInfo: { fullName: `Filler Person ${i}` },
                createdAt: daysAgo(1 + i),
                submittedAt: daysAgo(1 + i),
            });
        }
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, HER, {
            userId: HER_USER,
            status: 'pending',
            personalInfo: { surname: 'ABUBAKAR', firstName: 'AISHAT', otherNames: 'Yahaya' },
            createdAt: daysAgo(WINDOW + 10),
            submittedAt: daysAgo(WINDOW + 10),
        });
    });

    it('FINDS HER THOUGH SHE APPLIED BEFORE THE NEWEST FIVE THOUSAND', async () => {
        const res = await academy({ search: 'ABUBAKAR' });
        expect(rowIds(res)).toEqual([HER]);
    }, 120_000);

    it('CONTROL: a name nobody has still finds nobody', async () => {
        const res = await academy({ search: 'Zzzznobody' });
        expect(rowIds(res)).toEqual([]);
    }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#825 Cooperative — the same window, the same repair', () => {
    async function members(options: any) {
        const mod = await import('@/app/actions/cooperative/_coop_admin_members');
        return (await mod.getStandardCooperativeMembersAction(options)) as any;
    }

    beforeEach(() => {
        for (let i = 0; i < WINDOW; i++) {
            store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, `filler-${i}`, {
                userId: `filler-user-${i}`,
                firstName: 'Filler',
                lastName: `Person${i}`,
                membershipStatus: 'pending',
                paymentStatus: 'pending',
                createdAt: daysAgo(1 + i),
            });
        }
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, HER, {
            userId: HER_USER,
            firstName: 'AISHAT',
            lastName: 'ABUBAKAR',
            membershipStatus: 'pending',
            paymentStatus: 'pending',
            createdAt: daysAgo(WINDOW + 10),
        });
    });

    it('FINDS HER THOUGH SHE ENROLLED BEFORE THE NEWEST FIVE THOUSAND', async () => {
        const res = await members({ search: 'ABUBAKAR' });
        expect(rowIds(res)).toEqual([HER]);
    }, 120_000);

    it('FINDS A LEGACY MEMBER WHOSE NAME WAS IMPORTED AS ONE STRING', async () => {
        /*
         *   The bulk import wrote `fullName`, not a first/last pair — and
         *   neither the database search nor the in-memory string looked at it.
         *   Both do now.
         */
        store.seed(COLLECTIONS.USERS, 'legacy-user', {
            roles: ['user'], email: 'legacy@example.com', fullName: 'J. Musa',
        });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'legacy-member', {
            userId: 'legacy-user',
            fullName: 'ELEDUMARE Ngozi',
            membershipStatus: 'pending',
            paymentStatus: 'pending',
            createdAt: daysAgo(0),
        });

        const res = await members({ search: 'ELEDUMARE' });
        expect(rowIds(res)).toEqual(['legacy-member']);
    }, 120_000);

    it('AND FINDS HER BY A SURNAME IN THE MIDDLE OF THAT STRING, INSIDE THE PAGE', async () => {
        /*
         *   A BOUND WORTH STATING PLAINLY, because it is the one thing here
         *   that is not fully fixed.
         *
         *   `searchDocIdsByNameFields` works by PREFIX RANGE — `>= value` and
         *   `< prefixUpperBound(value)`. A prefix only matches a field that
         *   STARTS with it, so "ELEDUMARE" cannot be found in
         *   `fullName: "NGOZI ELEDUMARE"` by the database. The query layer
         *   offers Firestore's operator set and has no `like`/`ilike`, so there
         *   is no query that would.
         *
         *   What DOES find her is the in-memory substring check, which now
         *   joins fullName — so she is found while she is inside the page the
         *   reader fetches. A member in that shape who is ALSO older than the
         *   window is not findable by her surname at all. That is recorded in
         *   the finding as an open bound rather than described as fixed;
         *   closing it means either an `ilike` on the data layer everything
         *   else shares, or a written name-token index, and neither is a change
         *   to make on the strength of a defect proved only here.
         */
        store.seed(COLLECTIONS.USERS, 'mid-user', {
            roles: ['user'], email: 'mid@example.com', fullName: 'J. Musa',
        });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mid-member', {
            userId: 'mid-user',
            fullName: 'NGOZI ELEDUMARE',
            membershipStatus: 'pending',
            paymentStatus: 'pending',
            createdAt: daysAgo(0),
        });

        const res = await members({ search: 'ELEDUMARE' });
        expect(rowIds(res)).toContain('mid-member');
    }, 120_000);

    it('CONTROL: a name nobody has still finds nobody', async () => {
        const res = await members({ search: 'Zzzznobody' });
        expect(rowIds(res)).toEqual([]);
    }, 120_000);
});
