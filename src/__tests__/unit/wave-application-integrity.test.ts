/**
 * The WAVE application collection: who may read one, who may resubmit one, and
 * which one is "the latest".
 *
 * THE NUMBERS, SO THE REASONING BELOW CAN BE CHECKED
 * --------------------------------------------------
 * Measured in production:
 *
 *     480      applications in WAVE_APPLICATIONS
 *     474      approved,  6 pending,  0 rejected
 *  15,128      accounts holding the `wave_participant` role
 *
 * Both figures are real and they measure different things, which is the point.
 * The admin "approved" tab counts the second and calls it the first — see the
 * last block in this file — so an earlier version of this comment said there were
 * "over ten thousand applications". There are 480. The 15,128 are members, and
 * 14,654 of them have no application on record.
 *
 * The sort defect below is not scale-dependent either way: ordering 480 rows by a
 * key that is NULL on all of them returns an arbitrary order just as surely as
 * ordering fifteen thousand would, and the 1,000-row cap never truncated the
 * applications list at all. What made it worth finding is that the ordering was
 * never meaningful, not that rows were being dropped.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const APPLICATIONS = 'src/app/actions/wave/_wv_applications.ts';
const ADMIN_APPLICATIONS = 'src/app/actions/wave/_wv_admin_applications.ts';
const RECOVERY = 'src/app/actions/data-recovery.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('reading somebody else\'s application status', () => {
    it('is refused unless the caller is an admin', () => {
        // It resolved `userId || session.user.id` with nothing comparing the two,
        // so any authenticated caller could name any user id. There is no UI
        // caller, which is why it went unnoticed and is not why it was safe: an
        // exported server action is an HTTP endpoint whether a page calls it or
        // not.
        const src = code(APPLICATIONS);

        expect(src).not.toContain('const targetId = userId || session.user.id;');
        expect(src).toContain('requestedId !== session.user.id && !isAdmin(session.user.roles)');
    });

    it('refuses rather than quietly substituting the caller\'s own record', () => {
        // Falling back to the caller's own id would be safe and misleading — she
        // would read her own status believing it was somebody else's.
        const src = code(APPLICATIONS);
        const guard = src.slice(src.indexOf('requestedId !== session.user.id'));

        expect(guard.slice(0, 300)).toContain('Unauthorized');
    });

    it('reports the registration status when no application row is found', () => {
        // The branch read the user's serviceRegistrations.wave into a variable and
        // returned null without looking at it. The dead read is the clue: the
        // review-pending page calls this to tell an applicant where she stands,
        // and an applicant whose row could not be found was told nothing.
        const src = code(APPLICATIONS);
        const emptyBranch = src.slice(src.indexOf('if (snapshot.empty)'));

        expect(emptyBranch.slice(0, 800)).toContain('reg?.status');
        expect(emptyBranch.slice(0, 800)).toContain('String(reg.status)');
    });
});

describe('duplicate identities', () => {
    it('are checked by one function, used by both application paths', () => {
        // Enrolment ran three checks; resubmission ran none, and resubmission
        // writes the same phone, NIN and email onto the application AND the user.
        // So an applicant asked for revisions could come back with an identity
        // already registered to another account, by editing those fields on the
        // revision form.
        const src = code(APPLICATIONS);
        const calls = src.match(/findConflictingApplication\(/g) || [];

        // One definition, two call sites.
        expect(calls.length).toBe(3);
    });

    it('scan more than one row per identity', () => {
        // The queries were .limit(1) while the comparison looped over snap.docs.
        // The loop is the intent; the limit made it examine exactly one row,
        // arbitrarily chosen — so whether a duplicate was caught depended on which
        // row the database happened to return.
        const src = code(APPLICATIONS);

        expect(src).toContain('const DUPLICATE_SCAN_LIMIT = 25');
        expect(src).not.toMatch(/where\("phone", "==", applicantPhone\)\s*\n\s*\.limit\(1\)/);
    });

    it('let a foreign owner win regardless of row order', () => {
        // The original single loop returned on the FIRST row, so a same-owner
        // rejected application appearing before another account's application
        // cleared the check. The two concerns are now separate passes.
        const src = code(APPLICATIONS);
        const fn = src.slice(src.indexOf('const checkDuplicate ='), src.indexOf('return checkDuplicate('));

        const foreignAt = fn.indexOf('!== callerId');
        const statusAt = fn.indexOf('!== "rejected"');

        expect(foreignAt).toBeGreaterThan(-1);
        expect(statusAt).toBeGreaterThan(foreignAt);
    });

    it('exclude the applicant\'s own row from the status check on resubmission', () => {
        // Otherwise the shared check refuses every resubmission: the pending row IS
        // the row being updated, and resubmitting from pending is deliberately
        // allowed.
        const src = code(APPLICATIONS);

        expect(src).toContain('ignoreApplicationId: applicationId');
        expect(src).toContain('if (ignoreApplicationId && doc.id === ignoreApplicationId) continue;');
    });

    it('report when an identity appears on more rows than were checked', () => {
        const src = source(APPLICATIONS);
        expect(src).toContain('applications share one');
    });
});

describe('a decided application cannot be undecided', () => {
    it('requesting a revision claims the status instead of overwriting it', () => {
        // The third verdict on this collection and the only one without a guard —
        // approve and reject both claim from ["pending","under_review"] because
        // they raced each other, and this one could overwrite either outcome
        // afterwards. On an approved application it also revoked the member's
        // module access, because module-access-check reads the registration status
        // it writes.
        const src = code(APPLICATIONS);
        const fn = src.slice(src.indexOf('_requestWaveRevisionAction'));

        expect(fn).toContain('claimStatusTransitionFromAny');
        expect(fn).toContain("to: 'revision_required'");
        expect(fn).not.toMatch(/transaction\.update\(appRef, \{\s*status: 'revision_required'/);
    });

    it('resubmission claims the application, not the user record\'s copy of it', () => {
        // The guard read serviceRegistrations.wave.status — a derived duplicate the
        // verdict paths write separately. When the two disagreed the wrong one won:
        // a user record still reading revision_required let a resubmission
        // overwrite an approval and put the applicant back to pending, undoing an
        // admin decision from the applicant's side.
        const src = code(APPLICATIONS);
        const fn = src.slice(src.indexOf('_resubmitWaveApplicationAction'));

        expect(fn).toContain('claimStatusTransitionFromAny');
        expect(fn).toContain("fromAny: ['revision_required', 'pending']");
        // pending -> pending is the same status, which the primitive refuses by
        // default; this action deliberately permits it.
        expect(fn).toContain('allowSameStatus: true');
    });
});

describe('"the latest application" is chosen by a field that exists', () => {
    it('the admin list orders by createdAt', () => {
        // It ordered by submittedAt, which NOTHING writes onto a WAVE application
        // — the submit path writes applicationDate and createdAt, and submittedAt
        // lives on the user record. The collection is JSONB-backed, so the sort key
        // was NULL on every row: no error, no warning, and rows returned in
        // whatever order the plan gave. With a 1,000 cap over ten thousand rows
        // that made the list an arbitrary subset labelled "most recent".
        const src = code(ADMIN_APPLICATIONS);

        expect(src).not.toContain('.orderBy("submittedAt", "desc")');
        expect(src).toContain('.orderBy("createdAt", "desc")');
    });

    it('the recovery tool does too, for all six modules', () => {
        // Six copies of the same sort. Counting write sites: wave 14 with 0 setting
        // submittedAt, export 7 with 0, seller_verifications 12 with 0,
        // cooperative_onboarding 0, academy 5 of 14, farm_nation 5 of 14. A repair
        // tool picking an arbitrary row and then copying that row's undefined
        // submittedAt over the registration's real date.
        const src = code(RECOVERY);

        expect(src).not.toContain('.orderBy("submittedAt", "desc")');
        expect(src).toContain('async function latestApplicationFor');

        const calls = src.match(/latestApplicationFor\(COLLECTIONS\./g) || [];
        expect(calls).toHaveLength(6);
    });

    it('the recovery tool does not write a missing date over a real one', () => {
        const src = code(RECOVERY);
        const writes = src.match(/updates\["serviceRegistrations\.\w+\.submittedAt"\]/g) || [];
        const guards = src.match(/if \(\w+\.submittedAt\) \{/g) || [];

        expect(writes).toHaveLength(6);
        expect(guards).toHaveLength(6);
    });

    it('the name backfill takes the first source that HAS a name', () => {
        // It was an `||` chain over four application records, and every candidate
        // is an object — so if a WAVE application existed at all the chain stopped
        // there, whether or not it carried a name, and the other three records were
        // never consulted.
        const src = code(RECOVERY);

        expect(src).toContain('const nameSources = [');
        expect(src).toMatch(/\.find\(Boolean\)/);
    });
});

describe('the admin list says when it truncated', () => {
    it('reports it to the caller and the log, not neither', () => {
        // A cap that is not reported reads as a complete list. "There are 1,000
        // applications" and "here are 1,000 of them" are different statements, and
        // over ten thousand rows only one of them is true.
        const src = code(ADMIN_APPLICATIONS);

        expect(src).toContain('const truncated = snapshot.docs.length > APPLICATION_SCAN_LIMIT');
        expect(src).toContain('meta: { truncated, scanLimit: APPLICATION_SCAN_LIMIT }');
        expect(src).toMatch(/logger\.warn\([\s\S]{0,200}APPLICATION_SCAN_LIMIT/);
    });

    it('fetches one more than the cap, so truncation is detectable at all', () => {
        const src = code(ADMIN_APPLICATIONS);
        expect(src).toContain('.limit(APPLICATION_SCAN_LIMIT + 1)');
        expect(src).toContain('.slice(0, APPLICATION_SCAN_LIMIT)');
    });
});

describe('a date range has both ends in the same timezone', () => {
    /**
     * dateRangeStart and dateRangeEnd build UTC day boundaries and are what the
     * DATABASE half of every admin date filter uses. The in-memory half — applied
     * in the same request, described in the code as a "definitive backstop" —
     * used `new Date(yyyy-mm-dd)` plus setHours, which is LOCAL time.
     *
     * The two agree only when the process timezone happens to be UTC. Anywhere
     * else the backstop silently dropped rows the query had correctly included, at
     * the edges of the range. Two admin routes were worse: `from` was UTC midnight
     * and `to` was local end of day, so a single range had its two ends computed
     * in different timezones.
     */
    const FILTER_FILES = [
        'src/app/actions/admin/_academy.ts',
        'src/app/actions/admin/_exports.ts',
        'src/app/actions/admin/_marketplace.ts',
        'src/app/actions/farm-nation-admin/_fna_registrants.ts',
        'src/app/actions/wave/_wv_admin_applications.ts',
        'src/app/actions/academy/_ac_admin_applications.ts',
        'src/app/api/admin/export/cooperative-members/route.ts',
        'src/app/api/admin/cooperative/members/route.ts',
    ];

    it.each(FILTER_FILES)('%s uses the shared boundaries', (rel: string) => {
        const src = code(rel);

        expect(src).toMatch(/dateRangeStart\(/);
        expect(src).toMatch(/dateRangeEnd\(/);
    });

    it.each(FILTER_FILES)('%s hand-rolls neither boundary', (rel: string) => {
        const src = code(rel);

        expect(src).not.toContain('setHours(0, 0, 0, 0)');
        expect(src).not.toContain('setHours(23, 59, 59, 999)');
    });

    it('the shared boundaries really are UTC, so this is one definition not two', () => {
        // Vacuity guard: if these ever became local-time, every assertion above
        // would still pass while the whole point was lost.
        const { dateRangeStart, dateRangeEnd } = require('@/lib/date-utils');

        expect(dateRangeStart('2026-05-18').toISOString()).toBe('2026-05-18T00:00:00.000Z');
        expect(dateRangeEnd('2026-05-18').toISOString()).toBe('2026-05-18T23:59:59.999Z');
    });
});

describe('the approved tab does not call a role holder an applicant', () => {
    /**
     * Measured in production: 480 applications, 474 of them approved, and 15,128
     * accounts holding `wave_participant`. The approved tab reads USERS by role and
     * synthesises an application-shaped row per user, so it reported 15,128
     * "approved applications" — and an admin could not tell which of those rows
     * belonged to somebody who had actually applied.
     *
     * The rows are deliberately still shown. `wave_participant` was auto-assigned
     * by an earlier registration flow and is granted by the legacy import, so the
     * 14,654 without an application may be real members; hiding them would hide the
     * people whose status has to be decided. What changes is that each row says
     * where it came from and the meta reports both counts.
     */
    it('marks each row with its provenance', () => {
        const src = code(ADMIN_APPLICATIONS);

        expect(src).toContain('source: hasApplication ? "application" : "role_only"');
        expect(src).toContain('hasApplication,');
    });

    it('resolves provenance from the applications collection, not from the role', () => {
        // The claim has to be checked against WAVE_APPLICATIONS, or `source` is
        // just another unverified label.
        const src = code(ADMIN_APPLICATIONS);

        expect(src).toContain('const backedByApplication = new Set<string>()');
        expect(src).toMatch(/COLLECTIONS\.WAVE_APPLICATIONS\)\s*\n\s*\.where\("userId", "in", chunk\)/);
        expect(src).toContain('if (appData.status === "approved")');

        // And the flag has to be READ from that set. The first version of this test
        // checked only that the set was built, so replacing the derivation with
        // `const hasApplication = true` — marking all 15,128 as applicants again,
        // the exact defect — still passed.
        expect(src).toContain('const hasApplication = backedByApplication.has(uid);');
    });

    it('resolves it for the page slice only', () => {
        // Fifteen thousand lookups per page load would be a different defect.
        const src = code(ADMIN_APPLICATIONS);

        expect(src).toContain('const pageUserIds = slicedDocs.map((d: any) => d.id)');
        expect(src).toMatch(/for \(let i = 0; i < pageUserIds\.length; i \+= 30\)/);
    });

    it('links a backed row to its real application id', () => {
        // `legacy-${uid}` is an id no collection contains, so a row an admin clicks
        // through led nowhere for the 474 who did apply.
        const src = code(ADMIN_APPLICATIONS);

        expect(src).toContain('id: applicationIdFor.get(uid) ?? `legacy-${uid}`');
    });

    it('reports both counts rather than one standing in for two', () => {
        const src = code(ADMIN_APPLICATIONS);

        expect(src).toContain('roleHolderCount: totalCount');
        expect(src).toContain('approvedApplicationCount,');
        expect(src).toContain('countsDifferentPopulations: true');
    });

    it('counts approved applications from the applications collection', () => {
        const src = code(ADMIN_APPLICATIONS);
        const block = src.slice(src.indexOf('let approvedApplicationCount = 0'));

        expect(block.slice(0, 900)).toMatch(/COLLECTIONS\.WAVE_APPLICATIONS\)[\s\S]{0,120}\.where\("status", "==", "approved"\)/);
    });

    it('warns when the two populations differ', () => {
        const src = source(ADMIN_APPLICATIONS);
        expect(src).toContain('members have no application on record');
    });
});
