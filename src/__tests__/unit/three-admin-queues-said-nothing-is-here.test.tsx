/**
 * @jest-environment jsdom
 */

/**
 *   #909 A FAILED READ IS NOT AN EMPTY TABLE, AND THIS ONE SAID BOTH.
 *
 *   Found auditing the files no test had named. AdminDataTable renders the error
 *   as a banner above the table — so unlike #384 and #408 it was never SILENT —
 *   and then the body underneath said, regardless:
 *
 *       No results found
 *
 *   So on a first-load failure an administrator is shown a red banner and, below
 *   it, a table stating there is nothing there. `useAdminData` sets `error` and
 *   leaves `data` at its initial `[]`, so the two co-occur on every first-load
 *   failure — which is measured below rather than assumed.
 *
 * ── WHY IT MATTERS MORE THAN A CONTRADICTION ────────────────────────────────
 *
 *   This table backs THREE admin screens — /admin/users,
 *   /admin/farm-nation/listings and /admin/farm-nation/applications. On the last,
 *   "No results found" means "no applications to review". #384 called that
 *   sentence "the worst available wrong answer" on the loans approval queue and
 *   #408 called the same on the land verification queue. Both were fixed one
 *   screen at a time. This is the shared component neither reached, so fixing it
 *   here fixes three queues rather than a fourth.
 *
 *   Three states, distinguishable, which is #408's own wording: loading, failed
 *   (with the reason and what to do), and genuinely empty.
 */

import React from 'react';
import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';

const code = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

const AdminDataTable = require('@/components/admin/AdminDataTable').default;
const { emptyStateMessage } = require('@/components/admin/AdminDataTable');

interface Row { id: string; name: string }

const COLUMNS = [{ header: 'Name', accessor: 'name' as const }];

const table = (props: Record<string, unknown>) =>
    render(<AdminDataTable columns={COLUMNS} data={[]} loading={false} {...props} />);

describe('what an admin queue says when it has no rows', () => {
    it('A GENUINELY EMPTY QUEUE STILL SAYS SO (control)', () => {
        /*
         *   THE control. Every assertion below is about the FAILED case, and a
         *   component that said "the read failed" unconditionally would satisfy
         *   them while telling an administrator there is work waiting when there
         *   is none.
         */
        table({ error: null });

        expect(screen.getAllByText('No results found').length).toBeGreaterThan(0);
        expect(screen.queryByText(/read failed/i)).toBeNull();
    });

    it('AND A FAILED READ DOES NOT SAY THE QUEUE IS EMPTY', () => {
        //   THE test.
        table({ error: 'permission denied for table users' });

        expect(screen.queryByText('No results found')).toBeNull();
        expect(screen.getAllByText(/this is not an empty list/i).length).toBeGreaterThan(0);
    });

    it('AND IT STILL SHOWS THE REASON, which is the half that was already right', () => {
        //   The banner is not replaced by the body's sentence — an administrator
        //   needs the server's own words to know whether to retry or escalate.
        table({ error: 'permission denied for table users' });

        expect(screen.getByText('permission denied for table users')).toBeTruthy();
    });

    it('AND IT TELLS THEM WHAT TO DO', () => {
        //   #408's rule: a refusal that names no next step leaves an operator
        //   guessing whether the queue is broken or done.
        table({ error: 'connection reset' });

        expect(screen.getAllByText(/reload before assuming/i).length).toBeGreaterThan(0);
    });

    it('AND LOADING IS STILL ITS OWN STATE', () => {
        //   The third of the three. A spinner must not be replaced by either
        //   sentence while the first read is in flight.
        table({ loading: true });

        expect(screen.queryByText('No results found')).toBeNull();
        expect(screen.queryByText(/this is not an empty list/i)).toBeNull();
    });

    it('AND ROWS ARE STILL DRAWN WHEN THERE ARE ROWS (control)', () => {
        //   The vacuity guard on the whole suite: a table that rendered only
        //   messages would pass everything above.
        render(
            <AdminDataTable
                columns={COLUMNS}
                data={[{ id: 'u1', name: 'Ada Lovelace' }] as Row[]}
                loading={false}
                error={null}
            />,
        );

        expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
        expect(screen.queryByText('No results found')).toBeNull();
    });

    it('AND A REFRESH THAT FAILS OVER EXISTING ROWS KEEPS THEM (#307 kept)', () => {
        /*
         *   The rule the hook already had and this must not undo: "an error
         *   REPLACES the results rather than emptying them. A screen that blanks
         *   on refresh tells an operator the problem went away."
         */
        render(
            <AdminDataTable
                columns={COLUMNS}
                data={[{ id: 'u1', name: 'Ada Lovelace' }] as Row[]}
                loading={false}
                error="connection reset"
            />,
        );

        expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
        expect(screen.getByText('connection reset')).toBeTruthy();
        //   And no empty-state sentence at all, because it is not empty.
        expect(screen.queryByText(/this is not an empty list/i)).toBeNull();
    });
});

describe('the rule itself', () => {
    it('emptyStateMessage DISTINGUISHES THE TWO', () => {
        expect(emptyStateMessage(null)).toBe('No results found');
        expect(emptyStateMessage(undefined)).toBe('No results found');
        //   An empty string is not an error — the hook initialises it to null and
        //   a caller passing "" means "nothing went wrong".
        expect(emptyStateMessage('')).toBe('No results found');

        expect(emptyStateMessage('boom')).toMatch(/not an empty list/i);
        expect(emptyStateMessage('boom')).toMatch(/reload/i);
    });
});

describe('the hook and the table agree about when this happens', () => {
    it('useAdminData SETS THE ERROR AND LEAVES data EMPTY ON A FIRST FAILURE', () => {
        /*
         *   The measurement the header rests on. If the hook ever started
         *   clearing `error` or seeding `data` on failure, the co-occurrence this
         *   finding is about would stop existing and the note above would be
         *   wrong.
         */
        const hook = code('src/hooks/useAdminData.ts');

        expect(hook).toContain('useState<T[]>([])');
        expect(hook).toContain('setError(msg)');
        //   And it does NOT empty the rows on an error — #307.
        expect(hook).not.toContain('setError(msg);\n            setData([])');
    });

    it('AND THE THREE SCREENS THAT USE THE TABLE ARE THE THREE NAMED', () => {
        //   Named because the reach is the reason this is worth fixing in the
        //   shared component rather than on a fourth screen.
        for (const rel of [
            'src/app/admin/users/page.tsx',
            'src/app/admin/farm-nation/listings/page.tsx',
            'src/app/admin/farm-nation/applications/page.tsx',
        ]) {
            expect({ rel, uses: code(rel).includes('AdminDataTable') })
                .toEqual({ rel, uses: true });
        }
    });

    it('AND THE TABLE NO LONGER IMPORTS HOOKS IT DOES NOT USE', () => {
        /*
         *   useState, useEffect and useDebounce were imported and never called —
         *   the useDebounce line still carried the note it was written with
         *   ("Assuming this exists, or I will implement a simple one inside
         *   useAdminData"). The debounce did end up in the hook; the import
         *   stayed. An unused hook import is what somebody reaches for when
         *   adding local state to a component whose state is all its caller's.
         */
        const src = code('src/components/admin/AdminDataTable.tsx');

        expect(src).not.toContain('useDebounce');
        expect(src).not.toContain('useState');
        expect(src).not.toContain('useEffect');
        //   Still a client component, and still rendering what it is given.
        expect(src).toContain('"use client"');
        expect(src).toContain('ReactNode');
    });
});
