/**
 * @jest-environment node
 */

/**
 * A filter offering a state nothing writes, and omitting one it does.
 *
 * cooperative/_admin.ts is 1,755 lines and is in good shape. Every export
 * re-validates the admin role against the LIVE user document rather than
 * trusting the session, `getAdminScope` prevents one cooperative's admin acting
 * on another's records, and the withdrawal path claims its status transition
 * before the balance moves — with a comment explaining that approve and reject
 * compete for the same field, so an unclaimed transition released the member's
 * locked funds AND refunded them to savings. None of that needed touching.
 *
 * What was wrong is on the screen in front of the admin.
 *
 * "UNDER REVIEW" COULD NEVER MATCH
 * --------------------------------
 * The members filter offered it. `membershipStatus: "under_review"` appears in
 * the type in lib/types/firestore.ts and is written by NOTHING:
 *
 *   _updateMemberStatusAction   takes "active" | "approved" | "suspended"
 *   registration                writes "pending"
 *   reject-member route         writes "rejected"
 *
 * So selecting it returned an empty list, which reads as "no members are under
 * review" rather than "this filter does nothing". An admin checking whether
 * anyone was waiting on review would have been told, convincingly, that nobody
 * was.
 *
 * "REJECTED" WAS MISSING FOR THE OPPOSITE REASON
 * ----------------------------------------------
 * It IS written, by /api/admin/cooperative/reject-member. So rejected members
 * existed and could only be found mixed into All Applications.
 *
 * The two together are one mistake: the filter was built from the TYPE rather
 * than from what anything writes, and the type contains an aspiration.
 *
 * WHAT THE FIRST PASS GOT WRONG
 * -----------------------------
 * "suspended" looked dead too — `grep 'membershipStatus: "suspended"'` finds
 * nothing. It is written by `membershipStatus: status`, where status is a
 * union-typed parameter of _updateMemberStatusAction. The same shape that made
 * the status-vocabulary scanner report three review collections in #151, and
 * the same shape as `escrowDoc.ref.update({ status: "delivered" })`.
 *
 * A grep for a literal write is evidence of nothing on its own. Both statuses
 * below are verified against the actual setter.
 *
 * THE STATE ITSELF IS LEFT IN THE TYPE
 * ------------------------------------
 * `under_review` stays in lib/types/firestore.ts. Whether the cooperative
 * SHOULD have a review state is a product question and may well be intended;
 * offering a filter for it today is a wrong answer today. Those are different
 * decisions and only the second one is this change's business.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

/** Non-comment lines only — the fix's own comments name both statuses. */
function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('{/*');
        })
        .join('\n');
}

describe('the filter offers states that exist', () => {
    const page = source('src/app/admin/cooperatives/members/page.tsx');

    it('no longer offers "Under Review"', () => {
        // THE test. Nothing writes it, so the option returned an empty list that
        // read as an answer.
        expect(codeOnly(page)).not.toContain('value="under_review"');
    });

    it('offers "Rejected", which members really are', () => {
        expect(page).toContain('value="rejected"');
    });

    it('still offers the states that were already right', () => {
        // Vacuity guard: removing options until the assertions pass would empty
        // the filter.
        for (const status of ['all', 'pending', 'approved', 'suspended']) {
            expect(page).toContain(`value="${status}"`);
        }
    });
});

describe('the states behind those options', () => {
    it('nothing writes membershipStatus "under_review"', () => {
        // The property that made the option dead. If a writer is added later,
        // this fails and the option should come back.
        const { execSync } = require('child_process') as typeof import('child_process');
        const hits = execSync(
            `grep -rn 'membershipStatus' src --include=*.ts --include=*.tsx | grep 'under_review' || true`,
            { encoding: 'utf-8', cwd: process.cwd() }
        )
            .split('\n')
            .filter((l) => l.trim() && !l.includes('__tests__'))
            .filter((l) => {
                const body = l.slice(l.indexOf(':', l.indexOf(':') + 1) + 1).trim();
                return !body.startsWith('//') && !body.startsWith('*');
            })
            // The canonical type may still declare it; a WRITE may not exist.
            .filter((l) => !l.includes('lib/types/firestore.ts'))
            .filter((l) => !/status\?:/.test(l));

        expect(hits).toEqual([]);
    });

    it('something does write membershipStatus "rejected"', () => {
        // The property that makes the new option meaningful, and the vacuity
        // guard for the assertion above — a test that only ever proves absence
        // would pass against a filter with no options at all.
        expect(source('src/app/api/admin/cooperative/reject-member/route.ts'))
            .toContain('membershipStatus: "rejected"');
    });

    it('"suspended" is written through a union-typed parameter, not a literal', () => {
        // Recorded because it is what a grep for the literal misses, and the
        // reason the first pass nearly removed a working option.
        const admin = source('src/app/actions/cooperative/_coop_admin_members.ts');

        expect(admin).toContain('status: "active" | "approved" | "suspended"');
        expect(admin).toContain('membershipStatus: status');
    });
});

describe('the action accepts what the screen can ask for', () => {
    const admin = source('src/app/actions/cooperative/_coop_admin_members.ts');

    it('takes "rejected" and not "under_review"', () => {
        const signature = admin.slice(
            admin.indexOf('export async function getStandardCooperativeMembersAction'),
            admin.indexOf('const {', admin.indexOf('export async function getStandardCooperativeMembersAction'))
        );

        expect(codeOnly(signature)).toContain('"rejected"');
        expect(codeOnly(signature)).not.toContain('"under_review"');
    });

    it('filters by it on both the indexed and the in-memory path', () => {
        // The function has two routes — a Firestore query, and an in-memory
        // filter used when a search or date range is active. A status handled by
        // only one of them is handled inconsistently, which is worse than not at
        // all because it depends on which other filters are set.
        expect(admin).toContain('q.where("membershipStatus", "==", statusFilter)');
        expect(admin).toContain('applications.filter(app => app.membershipStatus === statusFilter)');
    });
});
