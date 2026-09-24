/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "when opportunities are listed on export window, it doesn't show
 *   for the users."
 *
 * ── THEY WERE NEVER LISTED ──────────────────────────────────────────────────
 *
 *   export_windows holds two entities. A SHIPMENT is one member's private
 *   export request, moving pending → in_transit → delivered → completed. An
 *   AGGREGATION is a crowdfunded opportunity — targetVolume, slotPrice,
 *   currentVolume — and members browse those through
 *   getActiveExportWindowsAction, which asks for `status == "open"`.
 *
 *   Three member screens read that action. Exactly one function writes an
 *   aggregation window with status "open" — createExportWindowAction in
 *   actions/export-aggregation.ts — AND NOTHING CALLED IT. No page, no
 *   component, no route, no cron.
 *
 *   So every part of the feature was correct and the whole of it was dead. The
 *   reader was right, the booking flow beneath it was right, and the screens
 *   could only ever say "no opportunities", because there was no door anywhere
 *   that made one. The owner was publishing through /admin/export/catalog,
 *   which writes a different collection (export_catalog) read by a different
 *   screen (/export/buyer) — a real feature, and not this one.
 *
 * ── WHAT IS ASSERTED, AND WHY IT IS SHAPED THIS WAY ─────────────────────────
 *
 *   The defect was an ABSENCE, so a test that only exercises the new screen
 *   would not have caught it and would not catch its return. What is pinned is
 *   the property that failed: every status a member's browse query asks for
 *   must be a status something in the application can write.
 *
 *   And the new screen LISTS THROUGH THE MEMBERS' OWN ACTION, unwrapped. A
 *   separate admin query would have shown a window the members' filter rejects
 *   — one whose end date has passed, say — and reported the feature working
 *   while the member screens stayed empty, which is precisely what was
 *   reported.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { stripComments } from '@/lib/testing/strip-comments';

const requireAdmin = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: (...args: any[]) => requireAdmin(...args),
}));

const ROOT = process.cwd();
const code = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const ADMIN_PAGE = 'src/app/admin/export/opportunities/page.tsx';
const MEMBER_PAGE = 'src/app/export/(app)/opportunities/ExportOpportunitiesClient.tsx';
const SIDEBAR = 'src/components/admin/AdminSidebar.tsx';

/** Every source file that ships, tests excluded. */
function appFiles(dir = join(ROOT, 'src'), out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== 'node_modules') appFiles(full, out);
        } else if (/\.tsx?$/.test(full) && !/__tests__|\.test\./.test(full)) {
            out.push(full);
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the door that did not exist', () => {
    it('SOMETHING IN THE APPLICATION CALLS THE AGGREGATION CREATOR', () => {
        //   THE test, and it is a search rather than an assertion about one
        //   file, because the defect was that NO file anywhere did this.
        const callers = appFiles()
            .filter((f) => !f.endsWith(join('actions', 'export-aggregation.ts')))
            .filter((f) => {
                const src = stripComments(readFileSync(f, 'utf-8'), { label: f });
                return src.includes('export-aggregation')
                    && /createExportWindowAction\s*\(/.test(src);
            })
            .map((f) => f.slice(ROOT.length + 1));

        expect(callers.length).toBeGreaterThan(0);
        expect(callers).toContain(ADMIN_PAGE);
    });

    it('AND IT IS REACHABLE — the admin nav links to it', () => {
        //   #362's rule. A built and guarded screen nobody can navigate to is
        //   the same as no screen; ten of them had already been found.
        expect(code(SIDEBAR)).toContain('"/admin/export/opportunities"');
    });

    it('AND IT LISTS THROUGH THE MEMBERS\' OWN ACTION', () => {
        /*
         *   The property that makes this screen honest. Both files call
         *   getActiveExportWindowsAction, so an admin cannot be shown a window
         *   a member is not — which is the failure being repaired, in the one
         *   form it could come back.
         */
        for (const rel of [ADMIN_PAGE, MEMBER_PAGE]) {
            expect({ rel, reads: code(rel).includes('getActiveExportWindowsAction') })
                .toEqual({ rel, reads: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and a window made here is a window they can see', () => {
    let store: FakeDbHandle;
    const ADMIN = 'admin-1';

    const soon = (days: number) =>
        new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const draft = (over: Record<string, unknown> = {}) => ({
        title: 'March sesame shipment to Turkey',
        commodity: 'Sesame seeds',
        targetVolume: 20_000,
        slotPrice: 1_800,
        startDate: soon(1),
        endDate: soon(30),
        destination: 'Istanbul, Turkey',
        ...over,
    });

    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        //   The gate itself is proved in its own suite; what matters here is
        //   which permission this action asks it for, and that a refusal
        //   writes nothing.
        requireAdmin.mockResolvedValue({ userId: ADMIN, roles: ['super_admin'] });
    });

    const aggregation = async () => import('@/app/actions/export-aggregation');

    it('CREATED, THEN READ BACK BY THE ACTION THE MEMBER SCREENS CALL', async () => {
        //   The whole chain, executed. This is what could not happen before,
        //   and asserting it on the member's reader rather than on the row is
        //   the point.
        const { createExportWindowAction, getActiveExportWindowsAction } = await aggregation();

        expect(await createExportWindowAction(draft())).toMatchObject({ success: true });

        const live: any = await getActiveExportWindowsAction();
        expect(live.success).toBe(true);
        expect(live.data).toHaveLength(1);
        expect(live.data[0]).toMatchObject({
            title: 'March sesame shipment to Turkey',
            status: 'open',
            windowKind: 'aggregation',
            currentVolume: 0,
        });
    });

    it('AND IT RECORDS WHAT IT IS RAISING', () => {
        //   fundingGoal is read through a Postgres function by
        //   incrementWithinCeiling, so a window without it is uncapped and the
        //   overfunding machinery is inert.
        return aggregation().then(async ({ createExportWindowAction }) => {
            await createExportWindowAction(draft());
            const [, row] = store.all(COLLECTIONS.EXPORT_WINDOWS)[0] as any;
            expect(row.fundingGoal).toBe(20_000 * 1_800);
        });
    });

    it('AND IT ASKS FOR THE EXPORT QUEUE\'S OWN PERMISSION', async () => {
        //   #375 — every gate names the permission matching what the action
        //   does. A bare `requireAdmin()` here would admit all ten admin roles
        //   to publishing an opportunity members pay into.
        const { createExportWindowAction } = await aggregation();
        await createExportWindowAction(draft());

        expect(requireAdmin).toHaveBeenCalledWith('export:approve_applications');
    });

    it('AND A CALLER THE GATE REFUSES CREATES NOTHING', async () => {
        requireAdmin.mockResolvedValue({ error: 'Unauthorized: Permission required' });
        const { createExportWindowAction } = await aggregation();

        expect(await createExportWindowAction(draft())).toMatchObject({ success: false });
        expect(store.size(COLLECTIONS.EXPORT_WINDOWS)).toBe(0);
    });

    it('AND A ZERO SLOT PRICE IS REFUSED, because a booking multiplies by it', async () => {
        const { createExportWindowAction } = await aggregation();

        expect(await createExportWindowAction(draft({ slotPrice: 0 }))).toMatchObject({ success: false });
        expect(store.size(COLLECTIONS.EXPORT_WINDOWS)).toBe(0);
    });

    it('AND AN EXPIRED WINDOW IS NOT OFFERED (the shape of the report)', async () => {
        /*
         *   #196 — an ENDED window is not an active one, and the members' list
         *   filters it out. So a window created with a past closing date would
         *   succeed on the admin screen and appear on no member's. The screen
         *   refuses that date before the round trip for exactly this reason;
         *   what is pinned here is the reader's half, which is the authority.
         */
        const { createExportWindowAction, getActiveExportWindowsAction } = await aggregation();
        await createExportWindowAction(draft({ startDate: soon(-60), endDate: soon(-30) }));

        const live: any = await getActiveExportWindowsAction();
        expect(live.data).toHaveLength(0);

        //   And the form says so rather than letting an admin find out this way.
        expect(stripComments(code(ADMIN_PAGE), { label: ADMIN_PAGE }))
            .toContain('has already passed');
    });
});
