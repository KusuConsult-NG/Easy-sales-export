/**
 * @jest-environment node
 */

/**
 *   #395 A THIRD BULK-EMAIL SUBSYSTEM WITH A HISTORY SCREEN OF ITS OWN, AND
 *        NOT ONE ROW EVER WRITTEN THROUGH IT.
 *
 *   THE MEASUREMENT, AND THE CLAIM IT CORRECTS
 *   ------------------------------------------
 *   #394 recorded actions/admin-communications.ts as "a second BULK sender"
 *   worth folding into sendBatchEmailNotifications, and I described it as the
 *   last duplicate door to convert. Counting callers across all of src/:
 *
 *        sendBulkEmailAction     0 live callers (1 test)
 *        getEmailHistoryAction   0 live callers, 0 tests
 *
 *   Neither has ever been reached. There was nothing to fold and no second
 *   door to close by folding it. "Which door is more featureful" is not the
 *   same question as "which door has ever run" — the lesson of #384 and #386,
 *   and I asked the wrong one again.
 *
 *   WHAT ACTUALLY SENDS A BROADCAST, AND WHY THE RETIRED PAIR IS A HAZARD
 *   ---------------------------------------------------------------------
 *   /admin/communications/broadcast → POST /api/admin/broadcast/send →
 *   sendBatchEmailNotifications, with bounce suppression from BOUNCED_EMAILS,
 *   List-Unsubscribe and Precedence: bulk headers, and a BROADCAST_LOGS row
 *   updated with progress and a final status. /admin/communications/history
 *   reads that same collection.
 *
 *   The retired pair does none of those things, and EMAIL_HISTORY — which it
 *   alone writes and it alone reads — is empty and always has been. The hazard
 *   is that sendBulkEmailAction is named exactly what somebody wiring a
 *   bulk-email screen would reach for: wiring it would send broadcasts that
 *   skip the bounce list, carry no unsubscribe header, and land in a history
 *   nothing displays.
 *
 *   NOTHING IS LOST. BROADCAST_LOGS carries strictly more than EMAIL_HISTORY —
 *   subject, body, audience, filters, sender and sender name, recipient total,
 *   bounce exclusions, success and failure counts, status. That is checked
 *   below rather than asserted, because "retiring is only a fix if what takes
 *   its place carries the same behaviour" is #384's rule and this is where it
 *   applies.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the refusal is dropped from the sender      KILLED
 *     the flag accepts any truthy value           KILLED
 *     the refusal stops naming the live route     KILLED
 *     reword the header prose                     SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    ADMIN_BULK_EMAIL_ENV,
    ADMIN_BULK_EMAIL_ENABLED_VALUE,
    ADMIN_BULK_EMAIL_REFUSAL,
    isAdminBulkEmailEnabled,
} from '@/lib/admin-bulk-email';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === 'node_modules') continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

const FILES = walk(SRC);
const MODULE = join(SRC, 'app/actions/admin-communications.ts');
const ROUTE = join(SRC, 'app/api/admin/broadcast/send/route.ts');

/** Files outside the defining module that mention `name`, split live vs test. */
function callersOf(name: string): { live: string[]; tests: string[] } {
    const pattern = new RegExp(`\\b${name}\\b`);
    const hits = FILES.filter((p) => p !== MODULE && pattern.test(code(p))).map((p) => relative(ROOT, p));
    return {
        live: hits.filter((p) => !p.includes('__tests__') && !/\.test\.tsx?$/.test(p)),
        tests: hits.filter((p) => p.includes('__tests__') || /\.test\.tsx?$/.test(p)),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#395 — the measurement that decided it', () => {
    it('NEITHER RETIRED ACTION HAS A LIVE CALLER', () => {
        expect(callersOf('sendBulkEmailAction').live).toEqual([]);
        expect(callersOf('getEmailHistoryAction').live).toEqual([]);
    });

    it('and the counter can tell a reached action from an unreached one', () => {
        // The positive control: the third export of the same module IS wired,
        // from the CMS screen. Without this, "no callers" could mean the
        // counter is broken rather than that nothing calls them.
        expect(callersOf('createAnnouncementAction').live.length).toBeGreaterThan(0);
    });

    it('and EMAIL_HISTORY is touched only by the retired pair', () => {
        const users = FILES
            .filter((p) => /EMAIL_HISTORY/.test(code(p)))
            .map((p) => relative(ROOT, p))
            .filter((p) => !p.includes('__tests__') && !/\.test\.tsx?$/.test(p))
            .sort();

        // The module itself, and the constant's own declaration. One writer and
        // one reader, both inside the retired pair, so the collection is empty.
        expect(users).toEqual([
            'src/app/actions/admin-communications.ts',
            'src/lib/types/firestore.ts',
        ]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#395 — the live path carries everything the retired one did', () => {
    it('BROADCAST_LOGS RECORDS AT LEAST WHAT EMAIL_HISTORY RECORDED', () => {
        // #384's rule: retiring is only a fix if what takes its place carries
        // the same behaviour. EMAIL_HISTORY held recipients, subject, body,
        // counts, sentBy, sentAt and a status.
        const route = code(ROUTE);
        for (const field of [
            'subject', 'body', 'audience', 'filters', 'sentBy', 'sentAt',
            'totalRecipients', 'successCount', 'failCount', 'status',
        ]) {
            expect({ field, present: route.includes(`${field}`) }).toEqual({ field, present: true });
        }
    });

    it('and it does two things the retired pair never did', () => {
        const route = code(ROUTE);
        // Bounce suppression and an unsubscribe header — the reason turning the
        // flag on is a deliverability decision rather than a wiring one.
        expect(route).toContain('BOUNCED_EMAILS');
        expect(route).toContain('List-Unsubscribe');
    });

    it('and the history screen reads the LIVE collection', () => {
        const history = code(join(SRC, 'app/admin/communications/history/page.tsx'));
        expect(history).toContain('getBroadcastHistoryAction');
        expect(history).not.toContain('getEmailHistoryAction');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#395 — retired at the door, kept behind a flag', () => {
    it('BOTH ACTIONS REFUSE BEFORE THE ADMIN CHECK', () => {
        const source = code(MODULE);
        for (const action of ['sendBulkEmailAction', 'getEmailHistoryAction']) {
            const start = source.indexOf(`export async function ${action}(`);
            expect({ action, found: start > -1 }).toEqual({ action, found: true });

            const head = source.slice(start, start + 700);
            const refusalAt = head.indexOf('isAdminBulkEmailEnabled()');
            const adminAt = head.indexOf('requireAdmin(');

            expect({ action, refused: refusalAt > -1 }).toEqual({ action, refused: true });
            // Order is the claim: a caller must not reach the admin check, let
            // alone the send, while the flag is off.
            expect({ action, first: refusalAt < adminAt }).toEqual({ action, first: true });
        }
    });

    it('and the flag takes one exact word, not any truthy value', () => {
        const original = process.env[ADMIN_BULK_EMAIL_ENV];
        try {
            for (const value of ['1', 'true', 'yes', 'ENABLED', 'enabled ', '']) {
                process.env[ADMIN_BULK_EMAIL_ENV] = value;
                expect({ value, on: isAdminBulkEmailEnabled() }).toEqual({ value, on: false });
            }
            delete process.env[ADMIN_BULK_EMAIL_ENV];
            expect(isAdminBulkEmailEnabled()).toBe(false);

            process.env[ADMIN_BULK_EMAIL_ENV] = ADMIN_BULK_EMAIL_ENABLED_VALUE;
            expect(isAdminBulkEmailEnabled()).toBe(true);
        } finally {
            if (original === undefined) delete process.env[ADMIN_BULK_EMAIL_ENV];
            else process.env[ADMIN_BULK_EMAIL_ENV] = original;
        }
    });

    it('and the refusal points at the door that works', () => {
        // A refusal that only says no sends the next developer looking. #322.
        expect(ADMIN_BULK_EMAIL_REFUSAL).toContain('/api/admin/broadcast/send');
        expect(ADMIN_BULK_EMAIL_REFUSAL).toContain('/admin/communications/history');
        expect(ADMIN_BULK_EMAIL_REFUSAL).toMatch(/bounced/i);
        expect(ADMIN_BULK_EMAIL_REFUSAL).toMatch(/unsubscribe/i);
    });

    it('and the implementation is KEPT, not deleted', () => {
        // The standing rule for this codebase: retire, never destroy. The send
        // and the history query are both still there behind the flag.
        const source = code(MODULE);
        expect(source).toContain('batch.send');
        expect(source).toContain('EMAIL_HISTORY');
    });
});
