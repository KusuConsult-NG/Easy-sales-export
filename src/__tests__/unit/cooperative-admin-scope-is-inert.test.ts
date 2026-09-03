/**
 * @jest-environment node
 */

/**
 * The cooperative-admin scoping mechanism has no data behind it — #320.
 *
 * getAdminScope(userId, roles) answers "which cooperative may this admin act
 * on?" — a cooperative id to restrict them, or null for platform-wide. Ten
 * call sites across three files consume it, each written:
 *
 *     const adminScope = await getAdminScope(session.user.id, roles);
 *     if (adminScope) { q = q.where("cooperativeId", "==", adminScope); }
 *
 * It reads `cooperativeId` off the caller's USER document. Nothing on the
 * server writes that field. dashboard.ts established it for its own read of it,
 * #319 for cron/release-escrow's, and the sweep below re-establishes it here
 * rather than trusting either. The only writer in the tree is
 * JoinCooperativeModal, a client-side Firebase-SDK component from before the
 * Supabase migration.
 *
 * So the function returns null for every caller, null means unrestricted, and
 * all ten guards are skipped — including the one at
 * _coop_admin_members.ts:253, which THIS AUDIT added after finding that a
 * scoped admin could activate, approve or suspend a member of any other
 * cooperative. Correct code that cannot currently fire.
 *
 * WHAT THIS TEST IS FOR
 * ---------------------
 * Not to assert the bug is fine. To stop it being mistaken for a working
 * control, and to catch the moment it stops being one.
 *
 * The mechanism is NOT repaired here. Repointing the read at
 * COOPERATIVE_MEMBERS — the fix #319 and dashboard.ts both used — would read
 * the wrong fact (membership is not administration) and would turn a fail-open
 * into a fail-closed on a live platform, taking access away from admins who
 * have it today. Which cooperative each cooperative_admin administers is a fact
 * nobody has recorded, and recording it is an owner decision.
 *
 * The last test couples the claim to reality in BOTH directions, the way
 * security-settings-claims.test.ts does for MFA: the day a writer for the
 * scoping fact appears, it fails and tells whoever added it to come back and
 * re-check these ten guards.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

/** userId -> user document, or undefined for "no such row". */
let USERS: Record<string, any> = {};

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: () => ({
            doc: (id: string) => ({
                get: async () => ({ exists: Boolean(USERS[id]), data: () => USERS[id] }),
            }),
        }),
    },
}));

function source(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });
}

const CONSUMERS = [
    'src/app/actions/cooperative/_coop_admin_money.ts',
    'src/app/actions/cooperative/_coop_admin_reports.ts',
    'src/app/actions/cooperative/_coop_admin_members.ts',
];

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    USERS = {};
});

describe('what the function actually answers', () => {
    it('platform roles are unrestricted even when a scope IS recorded', async () => {
        // The seeded cooperativeId is what makes this test mean anything. A
        // bare toBeNull() passed with the short-circuit deleted: a super_admin
        // fell through to the read, found nothing, and got null by the other
        // route — so the assertion could not tell the guard from its absence.
        // With a scope on the row, only the short-circuit produces null.
        USERS.boss = { id: 'boss', cooperativeId: 'coop-3' };

        const { getAdminScope } = await import('@/lib/cooperative-admin-scope');

        expect(await getAdminScope('boss', ['super_admin'])).toBeNull();
        expect(await getAdminScope('boss', ['admin'])).toBeNull();
    });

    it('THE test: a cooperative_admin gets null, because the field is never set', async () => {
        // The realistic shape: a user row exists and simply has no
        // cooperativeId, because nothing ever writes one.
        USERS.coopadmin = { id: 'coopadmin', email: 'a@b.c', roles: ['cooperative_admin'] };

        const { getAdminScope } = await import('@/lib/cooperative-admin-scope');

        expect(await getAdminScope('coopadmin', ['cooperative_admin'])).toBeNull();
    });

    it('null is what every call site reads as "no restriction"', () => {
        // The consequence, pinned at the consumers rather than assumed. Each
        // guard is `if (adminScope)`, so a null scope skips it.
        for (const rel of CONSUMERS) {
            const src = source(rel);
            const uses = (src.match(/if \(adminScope\)|if \(adminScope &&|if \(memberScope &&/g) ?? []).length;

            expect(uses).toBeGreaterThan(0);
        }
    });

    it('a user row that is missing entirely is also unrestricted', async () => {
        // Not a hypothetical: the read does not distinguish "no scope recorded"
        // from "no user found". Both fail open.
        const { getAdminScope } = await import('@/lib/cooperative-admin-scope');

        expect(await getAdminScope('nobody', ['cooperative_admin'])).toBeNull();
    });

    it('the mechanism still works if the field is ever populated', async () => {
        // Vacuity guard. The read is kept, not deleted — a legacy row imported
        // from the Firebase era may carry it, and it is the shape the scoping
        // will use once there is a writer. Deleting it would satisfy every
        // assertion above and throw away the mechanism.
        USERS.scoped = { id: 'scoped', cooperativeId: 'coop-7' };

        const { getAdminScope } = await import('@/lib/cooperative-admin-scope');

        expect(await getAdminScope('scoped', ['cooperative_admin'])).toBe('coop-7');
    });
});

describe('the guards that depend on it', () => {
    it('all ten call sites are still present', async () => {
        // If the scoping is ever wired up, these are what start firing. If one
        // is deleted in the meantime, the eventual repair is silently smaller
        // than it looks. Counted, not matched: membership cannot tell one call
        // site from ten — and counting is what corrected the figure, since the
        // grep this was first written from was eyeballed as nine.
        const total = CONSUMERS.reduce(
            (n, rel) => n + (source(rel).match(/getAdminScope\(/g) ?? []).length, 0,
        );

        expect(total).toBe(10);
    });

    it('the IDOR guard this audit added is one of them', () => {
        // _coop_admin_members' membership-status action grants the
        // `cooperative_member` role and sets isVerified. Its cross-cooperative
        // check is correct and currently unreachable; it must not be removed as
        // "dead code" on that basis.
        const src = source('src/app/actions/cooperative/_coop_admin_members.ts');

        // The WHOLE condition, `memberScope &&` included. Matching only the
        // comparison let `if (false && memberData.cooperativeId !== memberScope)`
        // through — the substring survives inside a gutted guard, which is the
        // membership-versus-meaning trap this audit has now hit four times.
        expect(src).toContain(
            // The rule, not its old spelling. Both audits reached this guard;
            // the other then found its middle conjunct is falsy on a record
            // with no cooperativeId — which the bulk legacy import writes — so
            // the condition collapsed to "allowed" and a scoped admin could act
            // on another cooperative's members. It calls the shared
            // isWithinAdminScope now, which treats an absent id as the
            // "default" cooperative rather than as everyone's.
            'isWithinAdminScope(memberScope, memberData.cooperativeId)',
        );
        expect(src).toContain('Cannot change membership status for another cooperative');
    });
});

describe('the claim matches reality, in both directions', () => {
    it('nothing writes cooperativeId onto a user document', () => {
        // The coupling that makes this durable rather than a note. Comments are
        // not writers — this file's own explanation names the field repeatedly,
        // and so do #319's and dashboard.ts's, so each candidate is re-checked
        // against its source with comments removed. That trap has now cost this
        // audit three separate gates.
        const candidates = execSync('grep -rn "cooperativeId" src || true', {
            encoding: 'utf-8', cwd: process.cwd(),
        })
            .split('\n')
            .filter((l) => l.trim())
            .filter((l) => !l.includes('__tests__'));

        const writers = candidates.filter((line) => {
            const rel = line.split(':')[0];
            const lineno = Number(line.split(':')[1]);
            if (!rel || !Number.isFinite(lineno)) return false;

            const stripped = source(rel).split('\n');
            const text = stripped[lineno - 1] ?? '';
            if (!text.includes('cooperativeId')) return false;

            // A write onto a USER document specifically. The field is written
            // freely onto membership records, withdrawals and ledger rows —
            // those are not what getAdminScope reads.
            const window = stripped.slice(Math.max(0, lineno - 12), lineno).join('\n');
            const targetsUsers = /COLLECTIONS\.USERS|["']users["']/.test(window);
            const isWrite = /\.(set|update)\s*\(|updateDoc\s*\(|setDoc\s*\(/.test(window);

            return targetsUsers && isWrite;
        });

        // JoinCooperativeModal is the one writer, and it is a client-side
        // Firebase-SDK component from before the Supabase migration — listed
        // explicitly so that a NEW writer appearing fails this test rather than
        // slipping in beside it.
        expect(writers.map((l) => l.split(':')[0])).toEqual([
            'src/components/modals/JoinCooperativeModal.tsx',
        ]);
    });

    it('the module says so, rather than claiming the mechanism works', () => {
        // The comment that used to sit on the read asserted the opposite: that
        // admins carrying the field are scoped. A reader checking whether
        // cooperative admins are scoped would have been told yes.
        //
        // Asserted POSITIVELY only. A `not.toContain` on the old sentence fails
        // on the correction itself, because the replacement doc quotes the old
        // sentence in order to explain what was wrong with it — the same
        // comment-vs-code trap that has now caught three gates in this audit,
        // this time inside the gate written to record it. What the behaviour is
        // belongs to the executing tests above; this one only checks the module
        // does not present the mechanism as working.
        const raw = readFileSync(
            join(process.cwd(), 'src/lib/cooperative-admin-scope.ts'), 'utf-8',
        );

        expect(raw).toContain('RETURNS null FOR EVERY CALLER');
        expect(raw).toContain('is not met by anything');
    });
});
