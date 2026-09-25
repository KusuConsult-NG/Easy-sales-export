/**
 * @jest-environment node
 */

/**
 *   #928 THREE FORENSIC WORKLISTS PRESENTED A BOUNDED SCAN AS THE WHOLE
 *        POPULATION.
 *
 *   Found auditing src/app/admin/forensics/cooperative/page.tsx and
 *   src/app/admin/forensics/farm-nation/page.tsx — two of the files no test had
 *   named. Sweeping the directory they sit in put a third beside them:
 *   stranded-wallets, whose screen WAS already reached.
 *
 *   #918 fixed this exact shape on the fourth screen in that directory two
 *   findings ago, and wrote down why it matters: "a check that claims
 *   completeness it does not have is worse than no check, because the owner
 *   stops looking." The other three had none of that vocabulary — measured
 *   before anything was written:
 *
 *       cooperative     describeSample 0   scope 0   "does not cover" 0
 *       farm-nation     describeSample 0   scope 0   "does not cover" 0
 *       duplicates      describeSample 0   scope 8   "does not cover" 1
 *
 * ── AND ON FARM NATION IT IS NOT HYPOTHETICAL ───────────────────────────────
 *
 *   lib/bounded-concurrency's header records the live run of that scan:
 *
 *       "The screen reported 0 + 1 + 177 = 178 cases out of a 200-farmer scan"
 *
 *   Two hundred rows returned against a two-hundred-row ceiling. sampleOf calls
 *   that INCOMPLETE, for the reason it states: a scan that returned exactly its
 *   ceiling cannot tell "there are precisely this many" from "there are more and
 *   I stopped". So the three counts that screen renders — no application behind
 *   it, records disagree, already reviewed — were a floor presented as a total,
 *   on the screen whose job is to make sure no approval goes unreviewed.
 *
 *   RAISING THE CEILING IS NOT THE FIX AVAILABLE HERE, and that is the whole
 *   reason the sentence is the fix. #805 measured this scan at eight keyed reads
 *   per farmer sitting on the function timeout at exactly this 200 — reading
 *   further is what makes the screen answer "Could not read the Farm Nation
 *   approvals" instead of answering at all.
 *
 * ── THE THIRD ONE CARRIES THE INSTRUCTIVE VERSION ───────────────────────────
 *
 *   stranded-wallets already showed a figure for trust, and its header argues
 *   for it: "0 stranded means something quite different depending on whether 272
 *   wallets were examined or none were." That figure is `scanned` — superseded
 *   profiles FOUND to carry a wallet — and it cannot answer this question at
 *   all. 272 is below the 50,000-row ceiling whether the walk read the whole
 *   table or gave up on its fiftieth page, so comparing it would be a guard that
 *   cannot fire: the same trap forensic-scan-scope's header describes about the
 *   adapter's own `truncated` flag. The rows READ are the only figure that
 *   answers it, and that screen also stops claiming "No money is stranded" when
 *   the walk stopped short.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { sampleOf } from '@/lib/forensic-scan-scope';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const ROOT = process.cwd();

const raw = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(raw(rel), { label: rel, minRetainedRatio: 0.15 });

const FARM_ACTION = 'src/app/actions/admin/_farm_nation_approvals.ts';
const COOP_ACTION = 'src/app/actions/admin/_cooperative_memberships.ts';
const WALLET_ACTION = 'src/app/actions/admin/_wallet_consolidation.ts';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('@/lib/require-admin', () =>
    require('@/lib/testing/require-admin-mock').requireAdminMock());

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(), recordAdminAction: jest.fn(),
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: async () => undefined,
    invalidateServiceCache: async () => undefined,
    invalidateCooperativeCache: async () => undefined,
    invalidateAdminGlobalStats: async () => undefined,
    deleteCache: async () => undefined,
}));

const findFarmNationApplications = jest.fn<any>();
jest.mock('@/lib/farm-nation-application-lookup', () => ({
    findFarmNationApplications: (...a: any[]) => findFarmNationApplications(...a),
}));

//   Every cooperative member is a case: the row is missing for all of them. The
//   case BUILDER is not what this suite is about — other suites own it — so the
//   two readers it leans on are stubbed to their simplest honest answer.
jest.mock('@/lib/cooperative-member-lookup', () => ({
    findCooperativeMemberRow: async () => null,
}));
jest.mock('@/lib/owned-profile-ids', () => ({
    ownedProfileIdsFor: async (id: string) => [id],
    filterByOwner: (collection: any) => collection,
}));

let store: FakeDbHandle;

function actAs(roles: string[]): void {
    //   `session.user`, which is the shape require-admin-mock reads — it
    //   judges the caller by the SESSION's roles and says why in its own header.
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 'an-admin', email: 'admin@example.com', roles } },
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(['super_admin']);
    findFarmNationApplications.mockImplementation(async () => []);
});

const seedFarmers = (n: number) => {
    for (let i = 0; i < n; i++) {
        store.seed(COLLECTIONS.USERS, `farmer-${String(i).padStart(4, '0')}`, {
            email: `farmer${i}@example.com`,
            fullName: `Farmer ${i}`,
            roles: ['farmer'],
            serviceRegistrations: { farmNation: { status: 'approved' } },
        });
    }
};

const seedMembers = (n: number) => {
    for (let i = 0; i < n; i++) {
        store.seed(COLLECTIONS.USERS, `member-${String(i).padStart(4, '0')}`, {
            email: `member${i}@example.com`,
            fullName: `Member ${i}`,
            roles: ['cooperative_member'],
            serviceRegistrations: { cooperatives: { membershipTier: 'Member' } },
        });
    }
};

const farmScan = async () => {
    const { listFarmNationApprovalCasesAction } =
        await import('@/app/actions/admin/_farm_nation_approvals');
    return await (listFarmNationApprovalCasesAction as any)();
};

const coopScan = async () => {
    const { listMissingMembershipsAction } =
        await import('@/app/actions/admin/_cooperative_memberships');
    return await (listMissingMembershipsAction as any)();
};

const walletScan = async () => {
    const { findStrandedWalletsAction } =
        await import('@/app/actions/admin/_wallet_consolidation');
    return await (findStrandedWalletsAction as any)();
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#928 — the rule these three now share', () => {
    it('THE CONTROL: a scan that returned its whole ceiling is not complete', () => {
        //   The property the entire finding rests on, asserted before anything
        //   depends on it.
        expect(sampleOf(199, 200).complete).toBe(true);
        expect(sampleOf(200, 200).complete).toBe(false);
        expect(sampleOf(201, 200).complete).toBe(false);
    });

    it('AND THE FIGURE THE WALLET SCREEN ALREADY SHOWED CANNOT ANSWER IT', () => {
        /*
         *   272 superseded profiles carrying a wallet — the measured production
         *   figure that screen renders — sits below a 50,000-row ceiling whether
         *   the walk read the whole table or gave up halfway. A scope built from
         *   it would be a guard that cannot fire, which is why the fix counts the
         *   rows READ instead.
         */
        expect(sampleOf(272, 50_000).complete).toBe(true);
        expect(sampleOf(50_000, 50_000).complete).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#928 — the measurement, taken from the record rather than remembered', () => {
    it('THE FARM NATION SCAN IS BOUNDED AT 200, and the live run returned 200', () => {
        //   Both halves of the claim, from source, so this cannot rot into a
        //   story: the ceiling in the action, and the observed run recorded in
        //   the module written to fix that scan's timeout.
        expect(code(FARM_ACTION)).toContain('const SCAN_LIMIT = 200;');
        expect(code(FARM_ACTION)).toContain('.limit(SCAN_LIMIT)');
        expect(raw('src/lib/bounded-concurrency.ts')).toContain('178 cases out of a 200-farmer scan');
    });

    it('and the cooperative scan carries the same bound', () => {
        expect(code(COOP_ACTION)).toContain('const SCAN_LIMIT = 200;');
        expect(code(COOP_ACTION)).toContain('.limit(SCAN_LIMIT)');
    });

    it('and the wallet walk stops at fifty pages of a thousand', () => {
        const src = code(WALLET_ACTION);

        expect(src).toContain('const PAGE = 1000;');
        expect(src).toContain('const MAX_PAGES = 50;');
        expect(src).toContain('sampleOf(rowsRead, MAX_PAGES * PAGE)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#928 — the farm nation scan now says what it read', () => {
    it('A SCAN THAT FILLED ITS CEILING REPORTS INCOMPLETE', async () => {
        seedFarmers(201);

        const res = await farmScan();

        expect(res.success).toBe(true);
        expect(res.data.scope).toEqual({ scanned: 200, ceiling: 200, complete: false });
    });

    it('AND ONE THAT DID NOT REPORTS COMPLETE — the control', async () => {
        //   Without this, "complete: false" above could be a constant.
        seedFarmers(5);

        const res = await farmScan();

        expect(res.data.scope).toEqual({ scanned: 5, ceiling: 200, complete: true });
    });

    it('and the counts it always reported are unchanged', async () => {
        seedFarmers(5);

        const res = await farmScan();

        expect(res.data.cases).toHaveLength(5);
        expect(res.data.noApplication).toBe(5);
        expect(res.data.drift).toBe(0);
        expect(res.data.settled).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#928 — and so does the cooperative scan', () => {
    it('A SCAN THAT FILLED ITS CEILING REPORTS INCOMPLETE', async () => {
        seedMembers(201);

        const res = await coopScan();

        expect(res.success).toBe(true);
        expect(res.data.scope).toEqual({ scanned: 200, ceiling: 200, complete: false });
    });

    it('AND ONE THAT DID NOT REPORTS COMPLETE — the control', async () => {
        seedMembers(3);

        const res = await coopScan();

        expect(res.data.scope).toEqual({ scanned: 3, ceiling: 200, complete: true });
        expect(res.data.cases).toHaveLength(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#928 — and the wallet walk counts rows read, not rows found', () => {
    /**
     * Nine profiles, two of which are superseded AND carry a wallet. `scanned`
     * is 2 and the scope is 9: the distinction the whole fix turns on, and the
     * assertion that kills a scope built from `scanned`.
     */
    const seedTable = () => {
        for (let i = 0; i < 9; i++) {
            const superseded = i === 1 || i === 4;
            store.seed(COLLECTIONS.USERS, `user-${String(i).padStart(3, '0')}`, {
                email: `user${i}@example.com`,
                fullName: `User ${i}`,
                ...(superseded ? { _migratedTo: 'live-profile' } : {}),
            });
            if (superseded) {
                store.seed(COLLECTIONS.WALLETS, `user-${String(i).padStart(3, '0')}`, { balance: 0 });
            }
        }
    };

    it('THE SCOPE IS THE ROWS READ, WHERE `scanned` IS WHAT WAS FOUND', async () => {
        seedTable();

        const res = await walletScan();

        expect(res.success).toBe(true);
        expect(res.data.scanned).toBe(2);
        expect(res.data.scope.scanned).toBe(9);
        expect(res.data.scope.ceiling).toBe(50_000);
        expect(res.data.scope.complete).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#928 — every screen in that directory says it, swept rather than listed', () => {
    /**
     * A HAND LIST IS WHAT LET THESE TWO SIT THERE. #918 fixed one screen in this
     * directory and named it; the two beside it were not examined. So the
     * population is enumerated from the filesystem, and a fifth screen added
     * tomorrow fails here until it either says its scope or is excluded on
     * purpose, in writing.
     */
    const screens = () =>
        readdirSync(join(ROOT, 'src/app/admin/forensics'), { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => `src/app/admin/forensics/${e.name}/page.tsx`);

    it('THE POPULATION IS THE FOUR WORKLISTS', () => {
        expect(screens().sort()).toEqual([
            'src/app/admin/forensics/cooperative/page.tsx',
            'src/app/admin/forensics/duplicates/page.tsx',
            'src/app/admin/forensics/farm-nation/page.tsx',
            'src/app/admin/forensics/stranded-wallets/page.tsx',
        ]);
    });

    it('EVERY ONE OF THEM RENDERS THE SENTENCE', () => {
        for (const screen of screens()) {
            const src = code(screen).replace(/\s+/g, ' ');

            expect({ screen, says: src.includes('What this list does not cover') })
                .toEqual({ screen, says: true });
            expect({ screen, floor: /floor rather than a total|not a clean table/.test(src) })
                .toEqual({ screen, floor: true });
        }
    });

    it('AND READS THE SCOPE DEFENSIVELY, because an older server sends none', () => {
        /*
         *   #918's lesson, paid for on the duplicates screen: a report served by
         *   a deployment older than the screen carries no `scope` at runtime,
         *   whatever the type says, and `report.scope.complete` THROWS — taking
         *   down the screen an operator opened because something looked wrong.
         *
         *   `!report.scope?.complete` is the other half of the trap: an absent
         *   scope makes it TRUE, so an old report would render "the scan stopped
         *   short" about a scan that never said so.
         */
        for (const screen of screens()) {
            const src = code(screen);

            expect({ screen, guard: src.includes('scope ? scope.complete === false : false') })
                .toEqual({ screen, guard: true });
            expect(src).not.toContain('!report.scope.complete');
            expect(src).not.toContain('!report.scope?.complete');
        }
    });

    it('AND FORMATS BOTH NUMBERS THROUGH numberOrZero', () => {
        for (const screen of screens()) {
            const src = code(screen);

            expect({ screen, scanned: src.includes('numberOrZero(scope?.scanned)') })
                .toEqual({ screen, scanned: true });
            expect({ screen, ceiling: src.includes('numberOrZero(scope?.ceiling)') })
                .toEqual({ screen, ceiling: true });
            expect(src).toContain('from "@/lib/numbers"');
        }
    });

    it('and carries no comment in the shape #598 and #600 scan raw source for', () => {
        //   Both of those ratchets read RAW source, so a comment written in the
        //   shape they look for counts as an instance — #918 was refused twice
        //   for exactly that. Asserted here, next to the explanation, rather
        //   than in a ratchet three directories away.
        const shape = /(?<![A-Za-z0-9_$.])([A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*)+)\.toLocaleString\(\)/g;

        for (const screen of screens()) {
            expect({ screen, hits: raw(screen).match(shape) }).toEqual({ screen, hits: null });
        }
    });

    it('POSITIVE CONTROL: the stripper left all four screens behind', () => {
        //   Three `not`-shaped assertions above, every one of which passes on an
        //   empty string.
        for (const screen of screens()) {
            expect({ screen, big: code(screen).length > 4_000 }).toEqual({ screen, big: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#928 — and the wallet screen stops claiming a clean table', () => {
    const SCREEN = 'src/app/admin/forensics/stranded-wallets/page.tsx';

    it('"No money is stranded" NEEDS A COMPLETE WALK, not just an empty result', () => {
        //   That panel is the false green this whole module exists to prevent,
        //   on the screen somebody reads to decide whether anybody's money is
        //   stuck. The render suite proves it disappears; this pins the guard.
        expect(code(SCREEN)).toContain('report.stranded.length === 0 && !scanIncomplete');
    });

    it('and the scan logs the sentence too, so a truncated run can be found later', () => {
        for (const action of [FARM_ACTION, COOP_ACTION, WALLET_ACTION]) {
            const src = code(action);

            expect({ action, logs: /logger\.warn\(/.test(src) }).toEqual({ action, logs: true });
            expect({ action, says: src.includes('describeSample(scope,') })
                .toEqual({ action, says: true });
        }
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   Every mutant below was applied to the source, the suite run, and the
 *   failing test recorded. A row with no failure is a test that proves nothing.
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   drop `scope` from the farm nation report        "A SCAN THAT FILLED ITS
 *                                                   CEILING" (farm nation)
 *   drop `scope` from the cooperative report        the same, cooperative
 *   sampleOf(cases.length, …) instead of docs       the ceiling case reports
 *     for either scan                               scanned 201, not 200
 *   sampleOf(scanned, …) in the wallet walk         "THE SCOPE IS THE ROWS
 *     — the guard that cannot fire                  READ" (9 vs 2)
 *   drop `rowsRead += snap.docs.length`             the same test, 0 vs 9
 *   `complete: scanned <= ceiling` in sampleOf      THE CONTROL
 *   delete the notice from one screen               the sweep, naming it
 *   `!report.scope?.complete` on one screen         the defensive-read test
 *   render the numbers without numberOrZero         the numberOrZero test
 *   un-gate the green "No money is stranded"        the wallet screen test
 *     panel                                         and the render suite
 *   delete the logger.warn from one action          "it logs the sentence too"
 */
