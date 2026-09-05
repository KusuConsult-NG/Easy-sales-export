/**
 * @jest-environment jsdom
 */

/**
 *   #413 THE SHARED DATA ENGINE FOR TWENTY-EIGHT ADMIN SCREENS HAD NEVER BEEN
 *   RUN BY A TEST — AND IT COULD OFFER A NEXT PAGE IT HAD NO WAY TO FETCH.
 *
 *   From the untested-module sweep. src/hooks/useAdminData.ts is the pagination
 *   engine behind every admin table — users, disputes, escrow, withdrawals,
 *   audit logs, seller and land verifications, WAVE, academy, cooperative,
 *   export — twenty-eight screens, and no test named the file.
 *
 *   WHAT WAS THERE. Three ways to learn whether another page exists, tried in
 *   order: the action's own `hasMore`, then `data.hasMore`, then `meta.hasMore`
 *   — and if all three are absent, the hook GUESSES:
 *
 *       (items.length === lim)
 *
 *   A full page. Which is not the same thing as a next page, because the fetch
 *   for page N reads `cursorStack.current[N]` and that is only populated from a
 *   cursor the action returned. With no cursor, "Next" re-sent the page-0
 *   request: the same rows came back under a higher page number, and the
 *   operator concludes the queue is stuck. #192–#195's exact shape, and
 *   _wv_resources.ts already names it in its own comment — "a null cursor next
 *   to hasMore: true is a load-more button that reloads page one". Those were
 *   fixed in the ACTIONS. The hook was the one place left that could still
 *   manufacture the pair for itself.
 *
 *   HOW REACHABLE, CHECKED RATHER THAN ASSUMED. Every wired screen was walked:
 *   the three actions that return neither a cursor nor hasMore
 *   (getContentApprovalItemsAction, getAdminPendingExportProductsAction) are
 *   fed through screen adapters that set `meta: { hasMore: false }` themselves,
 *   and getWaveTrainingEventsAction returns a proper meta.cursor/meta.hasMore
 *   pair. So no screen produces the shape TODAY. This is a guard on the
 *   engine, stated as a guard — not a defect caught biting an operator.
 *
 *   FIXED, in two halves. The GUESS now requires a cursor to go with it. And
 *   `onNextPage` refuses to advance when it holds no cursor for the next page,
 *   because an action may still SAY hasMore with no cursor and that answer is
 *   honoured on purpose — advancing on it is what produced the wrong screen.
 *
 *   ALSO: two console.log calls in the hook, three lines from its own
 *   logger.debug, printing every admin's live filter values and pagination
 *   state into the browser console on each debounce and each refresh.
 *
 *   #414 AND THE MODULE THAT CALLED ITSELF THE CONTRACT. admin-action-response
 *   declares "Single source of truth for the shape that useAdminData expects.
 *   ALL paginated admin server actions MUST use paginatedOk/paginatedErr" — and
 *   has exactly one importer, with `nextCursor` and `whereFieldExists`
 *   imported by nobody. The five/six/three-way fallback fan-out in the hook is
 *   what that unkept contract costs. The actions are NOT being rewritten — they
 *   return shapes the hook reads correctly, and churning twenty live admin read
 *   paths buys nothing — so what is repaired is the claim, and the real
 *   contract is pinned below instead of asserted in prose. #314's precedent.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the hasMore guess drops the cursor requirement   KILLED
 *     onNextPage advances without a cursor             KILLED
 *     a failed fetch stops setting error               KILLED
 *     the stale-response guard is removed              KILLED
 *     reword the header prose                          SURVIVED, as intended
 */

import { describe, it, expect, jest } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { useAdminData } from '@/hooks/useAdminData';
import { paginatedOk, paginatedErr } from '@/lib/admin-action-response';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

const HOOK = 'src/hooks/useAdminData.ts';

/** A page of `n` rows, so `items.length === limit` is easy to hit deliberately. */
const rows = (n: number, tag = 'a') =>
    Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, name: `${tag} row ${i}` }));

// ─────────────────────────────────────────────────────────────────────────────
describe('#413 — a full page is not a next page', () => {
    it('A FULL PAGE WITH NO CURSOR DOES NOT OFFER A NEXT ONE', async () => {
        /**
         * The pre-fix behaviour: 20 of 20 rows and no cursor set hasMore=true,
         * and the Next button then re-requested page 0.
         */
        const fetchAction = jest.fn(async () => ({ success: true, data: rows(20) })) as any;
        const { result } = renderHook(() => useAdminData<any>({ fetchAction, limit: 20 }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.data).toHaveLength(20);
        expect(result.current.hasMore).toBe(false);
    });

    it('and a full page WITH a cursor does', async () => {
        const fetchAction = jest.fn(async () =>
            paginatedOk(rows(20), 'cursor-for-page-2')) as any;
        const { result } = renderHook(() => useAdminData<any>({ fetchAction, limit: 20 }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.hasMore).toBe(true);
    });

    it('and an EXPLICIT hasMore from the action is still honoured, both ways', async () => {
        // The guard constrains the hook's guess, not the action's answer.
        const saysNo = jest.fn(async () => ({
            success: true, data: rows(20), lastDocId: 'c1', hasMore: false,
        })) as any;
        const { result: a } = renderHook(() => useAdminData<any>({ fetchAction: saysNo, limit: 20 }));
        await waitFor(() => expect(a.current.loading).toBe(false));
        expect(a.current.hasMore).toBe(false);

        const saysYes = jest.fn(async () => ({
            success: true, data: rows(3), meta: { hasMore: true, cursor: 'c2' },
        })) as any;
        const { result: b } = renderHook(() => useAdminData<any>({ fetchAction: saysYes, limit: 20 }));
        await waitFor(() => expect(b.current.loading).toBe(false));
        expect(b.current.hasMore).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#413 — and Next will not re-serve page one under a higher number', () => {
    it('IT REFUSES TO ADVANCE WITH NO CURSOR, RATHER THAN REFETCHING PAGE 0', async () => {
        /**
         * An action that claims another page and hands over nothing to fetch it
         * with. Before the fix, this incremented pageIndex and re-ran the
         * page-0 request — the operator sees the same twenty rows on "page 2".
         */
        const fetchAction = jest.fn(async () => ({
            success: true, data: rows(20), hasMore: true,
        })) as any;
        const { result } = renderHook(() => useAdminData<any>({ fetchAction, limit: 20 }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.hasMore).toBe(true);
        expect(fetchAction).toHaveBeenCalledTimes(1);

        act(() => { result.current.onNextPage(); });

        expect(result.current.pageIndex).toBe(0);
        expect(fetchAction).toHaveBeenCalledTimes(1);
        // …and it stops offering, so the button does not sit there lying.
        await waitFor(() => expect(result.current.hasMore).toBe(false));
    });

    it('and it DOES advance when there is a cursor, sending it as lastDocId', async () => {
        const fetchAction = jest.fn(async (params: any) =>
            params.lastDocId === 'c1'
                ? paginatedOk(rows(2, 'b'), undefined)
                : paginatedOk(rows(20, 'a'), 'c1')) as any;

        const { result } = renderHook(() => useAdminData<any>({ fetchAction, limit: 20 }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.onNextPage(); });
        await waitFor(() => expect(result.current.pageIndex).toBe(1));
        await waitFor(() => expect(result.current.data[0]?.id).toBe('b0'));

        expect((fetchAction.mock.calls[1] as any[])[0]).toMatchObject({ lastDocId: 'c1' });
        // Second page is short and cursorless — the end of the list.
        await waitFor(() => expect(result.current.hasMore).toBe(false));
    });

    it('and a NUMERIC cursor is sent as an offset page, not a document id', async () => {
        // The offset-based branch: _getUsersAction returns lastDocId: String(page+1).
        const fetchAction = jest.fn(async () => ({
            success: true, data: rows(20), lastDocId: '1', hasMore: true,
        })) as any;
        const { result } = renderHook(() => useAdminData<any>({ fetchAction, limit: 20 }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.onNextPage(); });
        await waitFor(() => expect(fetchAction).toHaveBeenCalledTimes(2));

        const params = (fetchAction.mock.calls[1] as any[])[0];
        expect(params).toMatchObject({ page: 1 });
        expect(params.lastDocId).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#413 — a refusal is an error, not an empty table', () => {
    it('A REFUSED READ SETS error AND DOES NOT CLAIM A NEXT PAGE', async () => {
        const fetchAction = jest.fn(async () => paginatedErr('Unauthorized: users:read required')) as any;
        const { result } = renderHook(() => useAdminData<any>({ fetchAction, limit: 20 }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('Unauthorized: users:read required');
        expect(result.current.hasMore).toBe(false);
    });

    it('and a THROWN action is caught and surfaced, not swallowed', async () => {
        const fetchAction = jest.fn(async () => { throw new Error('socket hang up'); }) as any;
        const { result } = renderHook(() => useAdminData<any>({ fetchAction, limit: 20 }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('socket hang up');
    });

    it('and a SLOW EARLIER response cannot overwrite the newer one it lost to', async () => {
        /**
         * The race guard, exercised properly. The first request is held open;
         * a second is issued and answers immediately; only THEN does the first
         * land. Without `currentFetchId !== fetchIdRef.current` the stale
         * answer wins and the operator is shown the rows they navigated away
         * from — silently, because nothing else changes.
         *
         * (The first version of this test handed both calls the same promise,
         * so removing the guard changed nothing and the mutant survived. It is
         * two distinct payloads now.)
         */
        let releaseStale: (v: any) => void = () => {};
        const stale = new Promise<any>((res) => { releaseStale = res; });

        let call = 0;
        const fetchAction = jest.fn(async () => {
            call += 1;
            return call === 1 ? stale : paginatedOk(rows(2, 'fresh'), undefined);
        }) as any;

        const { result } = renderHook(() => useAdminData<any>({ fetchAction, limit: 20 }));
        // The mount fetch is call 1 and is still hanging.
        await waitFor(() => expect(fetchAction).toHaveBeenCalledTimes(1));
        expect(result.current.data).toHaveLength(0);

        // Call 2 supersedes it and answers first.
        await act(async () => { result.current.refresh(true); });
        await waitFor(() => expect(result.current.data).toHaveLength(2));
        expect(result.current.data[0].id).toBe('fresh0');

        // Now the superseded one lands, carrying different rows.
        await act(async () => {
            releaseStale(paginatedOk(rows(20, 'stale'), 'old-cursor'));
            await stale;
        });

        expect(result.current.data).toHaveLength(2);
        expect(result.current.data[0].id).toBe('fresh0');
        // …and it must not have installed its cursor either.
        expect(result.current.hasMore).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#413 — the shapes the hook actually accepts', () => {
    it('ITEMS COME FROM data, data.<key>, OR THE ROOT — ALL SIX', async () => {
        /**
         * #414's point, asserted. This fan-out exists because the actions do
         * not share a response builder; it is pinned so a "tidy-up" cannot
         * silently blank a table that relies on one of the rarer branches.
         */
        const shapes: Array<[string, any]> = [
            ['data array', { success: true, data: rows(2) }],
            ['data.transactions', { success: true, data: { transactions: rows(2) } }],
            ['data.loans', { success: true, data: { loans: rows(2) } }],
            ['data.properties', { success: true, data: { properties: rows(2) } }],
            ['data.users', { success: true, data: { users: rows(2) } }],
            ['root .users', { success: true, users: rows(2) }],
        ];
        for (const [label, payload] of shapes) {
            const fetchAction = jest.fn(async () => payload) as any;
            const { result } = renderHook(() => useAdminData<any>({ fetchAction, limit: 20 }));
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect({ label, count: result.current.data.length }).toEqual({ label, count: 2 });
        }
    });

    it('and the cursor is read from any of the six places an action puts it', async () => {
        const places: Array<[string, any]> = [
            ['lastDocId', { success: true, data: rows(1), lastDocId: 'X' }],
            ['data.lastDocId', { success: true, data: { users: rows(1), lastDocId: 'X' } }],
            ['meta.lastDocId', { success: true, data: rows(1), meta: { lastDocId: 'X' } }],
            ['meta.cursor', { success: true, data: rows(1), meta: { cursor: 'X' } }],
            ['cursor', { success: true, data: rows(1), cursor: 'X' }],
            ['data.cursor', { success: true, data: { users: rows(1), cursor: 'X' } }],
        ];
        for (const [label, payload] of places) {
            const fetchAction = jest.fn(async (p: any) => (p.lastDocId ? paginatedOk(rows(1, 'z'), undefined) : payload)) as any;
            const { result } = renderHook(() => useAdminData<any>({ fetchAction, limit: 1 }));
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect({ label, hasMore: result.current.hasMore }).toEqual({ label, hasMore: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#413 — and the hook logs through the logger, like the rest of it', () => {
    it('NO console.log IN THE SHARED ADMIN DATA ENGINE', () => {
        const src = code(HOOK);
        expect(src).not.toMatch(/console\.log/);
        // It already had logger.debug three lines away from both of them.
        expect(src).toMatch(/import \{ logger \} from '@\/lib\/logger'/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#414 — the contract module says what is true of it', () => {
    it('IT NO LONGER CLAIMS AN ADOPTION IT DOES NOT HAVE', () => {
        const raw = readFileSync(join(ROOT, 'src/lib/admin-action-response.ts'), 'utf-8');
        expect(raw).not.toMatch(/ALL paginated admin server actions MUST use/);
        expect(raw).toMatch(/#414/);
    });

    it('and the helpers still produce the shape the hook reads first', () => {
        // Whatever the adoption, what these two return must stay correct —
        // that is what makes them the right thing for a NEW action to use.
        expect(paginatedOk([1, 2], 'cur', { totalCount: 9 })).toEqual({
            success: true, data: [1, 2], lastDocId: 'cur', hasMore: true, meta: { totalCount: 9 },
        });
        expect(paginatedOk([1], undefined)).toMatchObject({ hasMore: false, lastDocId: undefined });
        expect(paginatedErr('nope')).toEqual({
            success: false, data: [], hasMore: false, error: 'nope',
        });
    });
});
