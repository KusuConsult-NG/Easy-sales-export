/**
 * @jest-environment node
 */

/**
 * The public export-opportunity feed, EXECUTED — the browse list and the
 * single-opportunity read behind /export/windows.
 *
 * At 0%. export-investments.ts is not the file the existing export suite
 * covers: export-investments-behaviour.test.ts targets
 * actions/export/_ex_investments.ts, the investor's own view and the invest
 * button. This one is the READER the two public pages call, and nothing had
 * ever run it.
 *
 * Its by-id guard — "Only a window that is actually open for investment" —
 * was written to stop an unauthenticated caller pulling an exporter's private
 * trade record by id. That guard had never been executed either.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

async function actions() {
    return import('@/app/actions/export-investments');
}

let seq = 0;

/** An aggregation window as the admin creates one: open for investment. */
function seedWindow(id: string, extra: Record<string, unknown> = {}): void {
    seq += 1;
    store.seed(COLLECTIONS.EXPORT_WINDOWS, id, {
        commodity: 'Sesame seed',
        destination: 'Türkiye',
        amount: 250_000,
        roi: '18%',
        status: 'open',
        startDate: new Date('2026-03-01').toISOString(),
        endDate: new Date('2026-05-01').toISOString(),
        description: 'Aggregated sesame export to Mersin.',
        createdAt: new Date(2026, 0, seq).toISOString(),
        ...extra,
    });
}

// ─── the browse list ─────────────────────────────────────────────────────────

describe('getExportOpportunities', () => {
    it('returns the windows that are open for investment', async () => {
        seedWindow('w-open', { status: 'open' });
        seedWindow('w-active', { status: 'active' });

        const { getExportOpportunities } = await actions();
        const result: any = await getExportOpportunities();

        expect(result.success).toBe(true);
        expect(result.data.map((o: any) => o.id).sort()).toEqual(['w-active', 'w-open']);
    });

    it('and not an exporter\'s private shipment record', async () => {
        // export_windows holds two entities. createExportWindowAction writes the
        // SHIPMENT one at status "pending" — one exporter's commodity, contract
        // value, destination and delivery date.
        seedWindow('shipment', { status: 'pending', windowKind: 'shipment' });
        seedWindow('done', { status: 'completed' });

        const { getExportOpportunities } = await actions();
        expect(((await getExportOpportunities() as any).data)).toEqual([]);
    });

    it('labels an active window as opening soon and an open one as open', async () => {
        seedWindow('w-open', { status: 'open' });
        seedWindow('w-active', { status: 'active' });

        const { getExportOpportunities } = await actions();
        const byId = Object.fromEntries(
            ((await getExportOpportunities() as any).data).map((o: any) => [o.id, o.status]),
        );

        expect(byId['w-open']).toBe('Open');
        expect(byId['w-active']).toBe('Opening Soon');
    });

    it('maps the window onto the opportunity card', async () => {
        seedWindow('w-1');

        const { getExportOpportunities } = await actions();
        const [card]: any = (await getExportOpportunities() as any).data;

        expect(card).toMatchObject({
            id: 'w-1',
            commodity: 'Sesame seed',
            destination: 'Türkiye',
            minInvestment: 250_000,
            projectedROI: '18%',
        });
        expect(card.openDate).toBe(new Date('2026-03-01').toISOString());
    });

    /**
     * THE LAST PAGE ADVERTISED A PAGE THAT DOES NOT EXIST.
     *
     *     const lastDocId = snapshot.docs.length === limit ? ...id : null;
     *     ... meta: { cursor: lastDocId, hasMore: !!lastDocId }
     *
     * `docs.length === limit` is true on the FINAL page whenever the total is an
     * exact multiple of the page size, so the feed reported more and the next
     * call came back empty. This codebase has corrected the identical line
     * twice — the academy catalogue (#216) and the export window list, both of
     * which now read one extra row so "is there more" is observed rather than
     * guessed. This is the third copy.
     */
    it('does not report more when the last page is exactly full', async () => {
        seedWindow('w-1');
        seedWindow('w-2');

        const { getExportOpportunities } = await actions();
        const result: any = await getExportOpportunities(2);

        expect(result.data).toHaveLength(2);
        expect(result.meta.hasMore).toBe(false);
        expect(result.meta.cursor).toBeNull();
    });

    it('and does report more when there genuinely is', async () => {
        seedWindow('w-1');
        seedWindow('w-2');
        seedWindow('w-3');

        const { getExportOpportunities } = await actions();
        const result: any = await getExportOpportunities(2);

        expect(result.data).toHaveLength(2);
        expect(result.meta.hasMore).toBe(true);
        expect(result.meta.cursor).not.toBeNull();
    });

    it('and the page it advertises has rows on it', async () => {
        // The end-to-end form of the same guarantee: follow the cursor and get
        // the remaining window, not an empty list.
        seedWindow('w-1');
        seedWindow('w-2');
        seedWindow('w-3');

        const { getExportOpportunities } = await actions();
        const first: any = await getExportOpportunities(2);
        const second: any = await getExportOpportunities(2, first.meta.cursor);

        expect(second.data).toHaveLength(1);
        expect(second.meta.hasMore).toBe(false);
    });
});

// ─── the single read ─────────────────────────────────────────────────────────

describe('getExportOpportunityById', () => {
    it('returns a window that is open', async () => {
        seedWindow('w-1');

        const { getExportOpportunityById } = await actions();
        const result: any = await getExportOpportunityById('w-1');

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ id: 'w-1', commodity: 'Sesame seed', status: 'Open' });
    });

    it('refuses an id that does not exist', async () => {
        const { getExportOpportunityById } = await actions();
        expect(await getExportOpportunityById('nope')).toMatchObject({
            success: false, error: 'Opportunity not found',
        });
    });

    it.each(['pending', 'in_transit', 'delivered', 'completed', 'closed'])(
        'refuses a %s window, which is not an investment opportunity',
        async (status: string) => {
            // The guard this file was given and never ran: a pending window is
            // one exporter's private trade record, and every non-active status
            // used to be relabelled "Open" and served to anybody with the id.
            seedWindow('w-1', { status });

            const { getExportOpportunityById } = await actions();
            const result: any = await getExportOpportunityById('w-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('This export opportunity is no longer open');
            expect(result.data).toBeUndefined();
        },
    );
});

// ─── the capacity meter ──────────────────────────────────────────────────────

/**
 * "AVAILABLE SPOTS 0/0", ON A WINDOW WITH NO SPOT LIMIT.
 *
 *     spotsLeft: (data.totalSpots || 0) - (data.spotsFilled || 0),
 *     totalSpots: data.totalSpots || 0,
 *
 * Nothing in this repository writes `totalSpots`. It is read in exactly three
 * places and the investment action says so out loud — "Check Funding Limit
 * (Optional - if totalSpots defined)", and `if (exportData?.totalSpots && ...)`
 * treats absent as NO LIMIT and accepts the investment.
 *
 * The two public pages do not. `||  0` collapses "no limit" into "zero", so
 * /export/windows renders "0 spots" and /export/windows/{id} renders
 *
 *     {window.spotsLeft}/{window.totalSpots}          →  0/0
 *     style={{ width: `${(spotsLeft / totalSpots) * 100}%` }}   →  width: NaN%
 *
 * A width of `NaN%` is not a value the browser accepts, so the declaration is
 * dropped and the bar falls back to `width: auto` inside a `w-full` parent —
 * it renders COMPLETELY FULL. Every open opportunity was therefore presented
 * as sold out, above an invest button that works.
 *
 * `null` is the honest answer for a window that has no cap, and the pages omit
 * the meter rather than drawing an empty one.
 */
describe('a window with no spot limit', () => {
    it('reports no limit rather than zero', async () => {
        seedWindow('w-1');

        const { getExportOpportunityById } = await actions();
        const opportunity: any = (await getExportOpportunityById('w-1') as any).data;

        expect(opportunity.totalSpots).toBeNull();
        expect(opportunity.spotsLeft).toBeNull();
    });

    it('in the list as well as the single read', async () => {
        seedWindow('w-1');

        const { getExportOpportunities } = await actions();
        const [card]: any = (await getExportOpportunities() as any).data;

        expect(card.totalSpots).toBeNull();
        expect(card.spotsLeft).toBeNull();
    });

    it('while a window that HAS a limit still counts down', async () => {
        // Vacuity guard: the meter has to keep working where there is one.
        seedWindow('w-1', { totalSpots: 20, spotsFilled: 8 });

        const { getExportOpportunityById } = await actions();
        const opportunity: any = (await getExportOpportunityById('w-1') as any).data;

        expect(opportunity.totalSpots).toBe(20);
        expect(opportunity.spotsLeft).toBe(12);
    });

    it('and a full one reports zero left, which is a real zero', async () => {
        seedWindow('w-1', { totalSpots: 20, spotsFilled: 20 });

        const { getExportOpportunityById } = await actions();
        const opportunity: any = (await getExportOpportunityById('w-1') as any).data;

        expect(opportunity.spotsLeft).toBe(0);
        expect(opportunity.totalSpots).toBe(20);
    });
});

// ─── the pages that render it ────────────────────────────────────────────────

describe('the pages draw the meter only when there is one', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');

    /** Source with comments removed — the notes quote the defect verbatim. */
    const page = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .split('\n')
        .filter((l: string) => !l.trim().startsWith('//'))
        .join('\n');

    it('the detail page draws the meter only for a window that has a cap', () => {
        const src = page('src/app/export/windows/[id]/page.tsx');

        // The block is conditional, and the division that produced NaN% cannot
        // run with a null numerator any more.
        expect(src).toContain('typeof window.totalSpots === "number" && window.totalSpots > 0');
        expect(src).not.toContain('(window.spotsLeft / window.totalSpots) * 100');
    });

    it('and reaches toString only once it knows there is a number', () => {
        const src = page('src/app/export/windows/[id]/page.tsx');

        // Stringifying the total is fine — it is inside the guard. What must
        // not exist is an UNGUARDED one, so the guard is what is pinned, not
        // the spelling: the merge took the other audit's `String(x)` over this
        // branch's `x.toString()`, which is the same operation and would have
        // made this assertion fail while the property it cares about held.
        const call = Math.max(
            src.indexOf('windowData.totalSpots.toString()'),
            src.indexOf('String(windowData.totalSpots)'),
        );
        expect(call).toBeGreaterThan(-1);
        const guard = src.lastIndexOf('typeof windowData.totalSpots === "number"', call);
        expect(guard).toBeGreaterThan(-1);
    });

    it('the list page claims a remaining count only when there is one', () => {
        const src = page('src/app/export/windows/page.tsx');

        expect(src).toContain('typeof window.spotsLeft === "number"');
    });
});

// ─── the cache tags ──────────────────────────────────────────────────────────

/**
 * TWO CACHE TAGS THAT NOTHING COULD EVER TRIGGER.
 *
 * This file declares them:
 *
 *     { revalidate: 60,   tags: ["export-opportunities"] }
 *     { revalidate: 3600, tags: [`export-opportunity-${id}`] }
 *
 * and `revalidateTag` appeared nowhere in the codebase for either. A tag with
 * no writer is just a `revalidate` interval wearing a tag's clothes, so the
 * single-opportunity entry lived its full HOUR: a window an admin closed, or
 * whose ROI they corrected, kept serving the old copy with no way to flush it.
 *
 * The invest action re-reads the window and refuses a status that is not open,
 * so this cost a visitor a filled-in form and a refusal rather than a bad
 * investment — but the page was telling them something the server would not
 * honour.
 *
 * A reader/writer contract, checked the way the collection-field-drift scanner
 * checks the others: every tag declared here is revalidated by the actions that
 * change an export window.
 */
describe('the cache tags this file declares', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

    const READER = 'src/app/actions/export-investments.ts';
    const WRITER = 'src/app/actions/export/_ex_windows.ts';

    it('are both revalidated by the actions that change a window', () => {
        const reader = read(READER);
        const writer = read(WRITER);

        // The premise: the reader really does tag its cache entries.
        expect(reader).toContain('tags: ["export-opportunities"]');
        expect(reader).toContain('tags: [`export-opportunity-${id}`]');

        expect(writer).toContain('revalidateTag("export-opportunities"');
        expect(writer).toContain('revalidateTag(`export-opportunity-${windowId}`');
    });

    it('and every action that changes a window calls the flush', () => {
        const writer = read(WRITER);

        // Create, status change, and admin edit — the three writers of a window.
        const calls = writer.match(/revalidateExportOpportunities\(/g) || [];
        // One definition plus three call sites.
        expect(calls.length).toBeGreaterThanOrEqual(4);
    });

    it('passing the cache-life profile this version of Next.js requires', () => {
        // `revalidateTag(tag)` with one argument is deprecated here and does a
        // blocking expiry; the documented form is `revalidateTag(tag, "max")`.
        const writer = read(WRITER);

        expect(writer).not.toMatch(/revalidateTag\([^,)]+\)/);
        expect(writer).toContain('"max"');
    });
});
