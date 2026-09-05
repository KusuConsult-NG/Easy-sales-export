/**
 * @jest-environment node
 */

/**
 *   #406 A ROLLBACK WRITTEN FOR A FAILURE THAT NEVER ARRIVES.
 *
 *   From the .tsx sweep, hunting screens whose displayed state can contradict
 *   what the server actually did — #100's and #337's class, on the screen side.
 *
 *   THE FINDING
 *   -----------
 *   NotificationCenter marks a notification read locally, then persists. The
 *   revert lived in the `catch`:
 *
 *       try { await markNotificationAsReadAction(id); }
 *       catch { … setNotifications(… read: false …) }
 *
 *   Both notification actions catch internally and RETURN
 *   `{ success: false, error }` — unauthenticated, service failure, ownership
 *   refusal, all of them resolve. Nothing throws. So the branch that undoes the
 *   optimistic write only ever ran for an exception, and never for the ordinary
 *   refusal it was written for. The result of the await was not inspected at
 *   any of the THREE call sites in that file.
 *
 *   A refused write therefore left the row shown as read and the bell badge
 *   decremented, with nothing told to the user and nothing recorded. #331's
 *   shape — a check that cannot fail — on top of #337's: a control reporting a
 *   success it did not obtain.
 *
 *   THE SIBLING TELLS THE STORY. `markAsRead` had a revert. `markAllAsRead`,
 *   ten lines below it in the same file, had none at all. One of two copies
 *   repaired — #297, #384, #397, #403, again.
 *
 *   AND THE SCREEN CONTRADICTED ITS OWN MESSAGE. /dashboard/notifications DID
 *   read `result.success` and raised a toast — then left the change on screen.
 *   The user was told "Failed to mark as read" while looking at the row marked
 *   read. Its delete did the same: the row vanished from the list and came back
 *   on the next load.
 *
 *   WHAT WAS FIXED
 *   --------------
 *   Five handlers across the two files now revert exactly what they changed,
 *   on a returned failure as well as a thrown one. Reverts are per-id rather
 *   than a whole-list snapshot: the poll in NotificationCenter can deliver new
 *   notifications while a write is in flight, and restoring a snapshot would
 *   drop them. `markAllAsRead` reverts only the ids it actually changed, so
 *   notifications that were already read are not turned back to unread.
 *
 *   The auto-mark effect used `Promise.all(...).then()` with the results
 *   discarded — and `Promise.all` rejects on the FIRST throw, so the remaining
 *   ids were unaccounted for in either direction. It is `allSettled` now, and
 *   every id that was refused or threw goes back to unread.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     a revert is dropped from any of the five        KILLED
 *     the success check reverts to catch-only         KILLED
 *     allSettled goes back to Promise.all             KILLED
 *     reword the header prose                         SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

const CENTRE = join(SRC, 'components/layout/NotificationCenter.tsx');
const SCREEN = join(SRC, 'app/dashboard/notifications/page.tsx');
const ACTIONS = join(SRC, 'app/actions/notifications.ts');

/** A named handler's body, bounded by brace matching rather than a span (#400). */
function handler(file: string, name: string): string {
    const src = code(file);
    const at = src.search(new RegExp(`(?:async\\s+function\\s+${name}\\s*\\()|(?:const\\s+${name}\\s*=\\s*async)`));
    expect({ name, found: at > -1 }).toEqual({ name, found: true });
    const open = src.indexOf('{', src.indexOf('=>', at) > at && src.indexOf('=>', at) < src.indexOf('{', at)
        ? src.indexOf('=>', at) : at);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') {
            depth--;
            if (depth === 0) return src.slice(at, j + 1);
        }
    }
    return src.slice(at);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#406 — the premise: these actions resolve, they do not throw', () => {
    it('A REFUSED WRITE RETURNS success:false RATHER THAN RAISING', () => {
        /**
         * The whole finding rests on this. If the actions threw, a catch-only
         * revert would have been correct and there would be nothing to fix.
         */
        const src = code(ACTIONS);
        for (const fn of ['markNotificationAsReadAction', 'markAllAsReadAction']) {
            const at = src.indexOf(`export async function ${fn}`);
            expect({ fn, found: at > -1 }).toEqual({ fn, found: true });
            const body = src.slice(at, at + 900);
            expect(body).toContain('Promise<ActionResponse');
            expect(body).toMatch(/return \{ success: false/);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#406 — every optimistic write reverts on a RETURNED failure', () => {
    const CASES: Array<[string, string, string]> = [
        [CENTRE, 'markAsRead', 'read: false'],
        [CENTRE, 'markAllAsRead', 'read: false'],
        [SCREEN, 'handleMarkAsRead', 'read: false'],
        [SCREEN, 'handleMarkAllAsRead', 'read: false'],
        [SCREEN, 'handleDelete', 'splice('],
    ];

    it.each(CASES)('%s :: %s reverts what it changed', (file, name, undo) => {
        const body = handler(file, name);
        // It does write optimistically — otherwise there is nothing to revert
        // and this assertion would pass on an empty handler.
        expect(body).toMatch(/setNotifications\(/);
        // And it undoes that write.
        expect(body).toContain(undo);
    });

    it('and the revert is reached on the RETURNED failure, not only on a throw', () => {
        /**
         * The defect itself. Each handler must inspect the resolved result;
         * a `catch` alone never sees a refusal from these actions.
         */
        for (const [file, name] of CASES) {
            const body = handler(file, name);
            expect({ name, checksResult: /!\s*result(\?)?\.success/.test(body) })
                .toEqual({ name, checksResult: true });
        }
    });

    it('and markAllAsRead reverts only the ids it changed', () => {
        // Reverting the whole list would mark already-read notifications unread
        // — a fix that introduces its own defect.
        for (const [file, name] of [[CENTRE, 'markAllAsRead'], [SCREEN, 'handleMarkAllAsRead']] as const) {
            const body = handler(file, name);
            expect({ name, scoped: body.includes('changed') }).toEqual({ name, scoped: true });
            expect(body).toMatch(/filter\(n => !n\.read\)/);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#406 — the background mark-all-on-open accounts for every id', () => {
    it('IT USES allSettled, NOT Promise.all', () => {
        /**
         * Promise.all rejects on the first throw and reports nothing about the
         * rest, so ids after the failure were neither confirmed nor reverted.
         */
        const src = code(CENTRE);
        expect(src).toContain('Promise.allSettled(');
        expect(src).not.toContain('Promise.all(ids.map');
    });

    it('and it reverts the ids that were refused or threw', () => {
        const src = code(CENTRE);
        expect(src).toMatch(/status === "rejected"/);
        expect(src).toMatch(/!r\.value\?\.success/);
        expect(src).toMatch(/failed\.includes\(n\.id\)/);
    });

    it('and the pending set is still cleared, so a retry is possible', () => {
        // The ref exists to stop duplicate writes. If a failure left ids in it,
        // reopening the panel would never retry them — trading one silent
        // failure for another.
        const src = code(CENTRE);
        expect(src).toMatch(/ids\.forEach\(id => pendingReadRef\.current\.delete\(id\)\)/);
    });
});
