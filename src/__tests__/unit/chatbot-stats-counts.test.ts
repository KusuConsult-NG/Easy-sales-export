/**
 * @jest-environment node
 */

/**
 * A stats panel whose "total" was pinned at 100.
 *
 * chatbot-admin.ts is well guarded — all four exports go through
 * requireSuperAdmin, the tightest gate in this codebase, and it is the right one
 * for a screen that shows other people's chat transcripts. Nothing needed doing
 * about access.
 *
 * THE COUNTS WERE FETCHED ROWS, NOT COUNTS
 * ----------------------------------------
 * getChatbotStatsAction built its figures by calling getAdminChatSessions three
 * times with `limit: 100` and taking `.length` of what came back. That query
 * hard-caps its page:
 *
 *     const pageSize = Math.min(filters.limit ?? 25, 100);
 *
 * So once the platform passed a hundred sessions, `totalSessions` read exactly
 * 100 and stayed there. Not approximately — exactly, permanently. A panel
 * reporting a constant is worse than one reporting an error, because 100 looks
 * like a measurement.
 *
 * `escalatedUnresolved` had the same ceiling, and `mostActiveModule` was the
 * busiest module among the hundred most recent sessions rather than overall.
 *
 * The query returns `hasMore`, and the caller discarded it. The information that
 * the figure was incomplete was already in hand — the same shape as the Paystack
 * paging in #141 and the audit export in #150.
 *
 * TWO OF THE THREE QUERIES WERE IDENTICAL
 * ---------------------------------------
 *     getAdminChatSessions({ limit: 100 })   // as `all`
 *     getAdminChatSessions({ limit: 100 })   // as `allForModule`
 *
 * Run twice, in parallel, for the same rows.
 *
 * resolvedToday READ THE WRONG FIELD
 * ----------------------------------
 * It filtered `s.resolved && s.lastMessageAt >= today`. resolveSession writes
 * `resolvedAt`, which is when an admin resolved it; `lastMessageAt` is when the
 * user last wrote. So a session resolved this morning whose last message was
 * yesterday did not count, and one resolved last week whose user wrote again
 * today did. It measured neither thing.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const action = source('src/app/actions/chatbot-admin.ts');
const dbLayer = source('src/lib/chatbot-db.ts');

describe('the totals are counted, not fetched', () => {
    it('no longer builds figures from a page of rows', () => {
        // THE test. `.length` of a capped page is not a total.
        const stats = codeOnly(action).slice(codeOnly(action).indexOf('getChatbotStatsAction'));

        expect(stats).not.toContain('getAdminChatSessions({ limit: 100 })');
        expect(stats).not.toContain('.sessions.length');
    });

    it('uses database counts', () => {
        expect(action).toContain('getChatbotSessionStats(');
        expect(dbLayer).toContain('sessions().count().get()');
    });

    it('the cap that made the old figure constant is still there', () => {
        // Pinning WHY the old approach was wrong. If this ever goes, the
        // reasoning changes and whoever changes it should see this.
        expect(dbLayer).toContain('Math.min(filters.limit ?? 25, 100)');
    });

    it('counts escalated-and-unresolved in the query, not in memory', () => {
        expect(dbLayer).toMatch(
            /where\("escalated", "==", true\)\.where\("resolved", "==", false\)\.count\(\)/
        );
    });
});

describe('resolvedToday means resolved, today', () => {
    it('reads the field resolveSession writes', () => {
        // resolvedAt, not lastMessageAt.
        expect(dbLayer).toContain('.where("resolvedAt", ">=", startOfToday)');
    });

    it('resolveSession really does write it', () => {
        // Vacuity guard: filtering on a field nothing writes is the defect this
        // audit has met repeatedly (#151), and would make the count zero rather
        // than wrong.
        //
        // This read the first 500 characters of the function and looked for the
        // literal `resolvedAt: Timestamp.now()`. It broke the moment #247 added
        // a not-found guard ahead of the write — the write was still there, 500
        // characters further down. A substring window is not a fact about
        // behaviour; the executed version of this claim lives in
        // chatbot-admin-behaviour.test.ts ("still resolves a session that does
        // exist, and records who did it"), which seeds a session, resolves it
        // and asserts resolvedAt is on the stored row.
        const resolve = dbLayer.slice(
            dbLayer.indexOf('export async function resolveSession'),
            dbLayer.indexOf('function inSpokenOrder'),
        );

        expect(resolve).toContain('resolvedAt: Timestamp.now()');
    });

    it('no longer filters on lastMessageAt', () => {
        expect(codeOnly(action)).not.toContain('lastMessageAt >= today');
    });
});

describe('the busiest module is the busiest module', () => {
    it('counts every module rather than sampling recent sessions', () => {
        expect(dbLayer).toContain('modules.map(m => sessions().where("module", "==", m).count().get())');
    });

    it('takes the module list from the config rather than a second copy', () => {
        // A module added to MODULE_CONFIGS is counted without anyone having to
        // remember a list here — the duplication this audit keeps finding
        // drifted apart.
        expect(action).toContain('Object.keys(MODULE_CONFIGS)');
    });

    it('answers null when there are no sessions at all', () => {
        // "No sessions yet" and "hub is busiest" are different answers, and
        // picking the first module by default gives the second.
        const stats = dbLayer.slice(dbLayer.indexOf('export async function getChatbotSessionStats'));

        expect(stats).toContain('let mostActiveModule: ChatbotModule | null = null');
        expect(stats).toContain('if (count > highest)');
    });
});

describe('the access control that was already right', () => {
    it('every export requires super_admin', () => {
        // Chat transcripts are other people's conversations. This is the
        // tightest guard in the codebase and it is the correct one here.
        const guards = action.match(/await requireSuperAdmin\(\);/g) ?? [];

        expect(guards.length).toBe(4);
    });

    it('the guard checks the role rather than a generic admin helper', () => {
        // isAdmin() would admit moderator, support and every module admin — the
        // widening refused in #115, #138 and #146. Not appropriate for reading
        // transcripts.
        //
        // #365. Was a literal `roles.includes("super_admin")`. isSuperAdmin()
        // from admin-permissions.ts is that exact test and nothing wider — the
        // point of the change was that the rule comes from one module, not that
        // the audience moved. `isAdmin(` is still refused below, and
        // `isSuperAdmin(` does not contain it as a substring.
        expect(codeOnly(action)).toContain('isSuperAdmin(roles)');
        expect(codeOnly(action)).not.toMatch(/\bisAdmin\(/);
        expect(codeOnly(action)).not.toContain('isPlatformAdmin(');
    });

    it('resolving a session is audited', () => {
        expect(action).toContain('chatbot_session_resolved');
    });
});
