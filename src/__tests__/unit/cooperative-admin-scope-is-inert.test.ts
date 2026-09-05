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
 * It reads `cooperativeId` off the caller's USER document. Nothing writes that
 * field. dashboard.ts established it for its own read of it, #319 for
 * cron/release-escrow's, and the sweep below re-establishes it here rather than
 * trusting either.
 *
 * #385 CORRECTED THIS PARAGRAPH AND STRENGTHENED THE SWEEP BELOW. It used to
 * name one writer — JoinCooperativeModal — and describe it as "a client-side
 * Firebase-SDK component from before the Supabase migration", a phrase copied
 * between four files, two of them by this audit, before anybody opened the
 * file. It was wrong in all three parts: the write went through the Supabase
 * adapter, inside a server function, in a file whose git history has never at
 * any commit contained a firebase import. The modal has since been fixed — it
 * opened a membership with a savings balance nobody had paid — so the writer
 * count is now ZERO, and the sweep asserts zero rather than listing one.
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
 * have it today.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *   #248 THE DECISION: COOPERATIVE ADMINS ARE NOT SCOPED.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *        #320 raised "should they be, and by what fact?". Taken, and the answer
 *        is no, on three measurements — each of them asserted below rather than
 *        stated:
 *
 *        1. THERE IS ONE COOPERATIVE AND NO WAY TO CREATE A SECOND. Nothing in
 *           src writes to COLLECTIONS.COOPERATIVES. Every read of it is the
 *           legacy nested Firebase-era path. joinCooperativeAction, the one
 *           action needing a cooperative document, has no caller. The live flow
 *           uses a constant — "easy-sales-cooperative" — with "default" as the
 *           fallback elsewhere. Scoping partitions an estate of one.
 *
 *        2. THE ROLE IS A MODULE ROLE. types/roles.ts calls cooperative_admin
 *           "Manages the cooperative module", beside nine siblings, not one of
 *           which is scoped to a sub-entity.
 *
 *        3. SWITCHING IT ON WOULD HAVE BEEN UNSAFE, NOT MERELY NARROWING. The
 *           two withdrawal guards read `adminScope && row?.cooperativeId && …`,
 *           and TWO OF THE THREE doors that create a cooperative withdrawal
 *           wrote no cooperativeId at all. A scoped admin could approve or
 *           reject every withdrawal from those doors, whatever their scope.
 *
 *        WHAT WAS DONE INSTEAD OF BUILDING IT. Nothing is deleted; the trap is
 *        removed. Both doors now record the cooperativeId from the MEMBERSHIP
 *        (never the caller — platform.ts takes that field from a form), and the
 *        three guards refuse a row they cannot attribute. None of it changes
 *        behaviour today: getAdminScope still returns null for every caller, so
 *        every guard short-circuits before the comparison.
 *
 * The last tests couple the claims to reality in BOTH directions, the way
 * security-settings-claims.test.ts does for MFA: the day a writer for the
 * scoping fact appears — or a writer for COOPERATIVES — they fail and tell
 * whoever added it to come back and re-check these ten guards and this
 * decision.
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

/**
 * Every place in src/ that writes `field` onto a USER document — #385.
 *
 * Parameterised on the field so the same detector can be pointed at a field
 * that IS written, as a positive control. An empty answer from an unparameterised
 * sweep proves nothing: it reads identically whether the field has no writers or
 * the sweep has stopped working.
 *
 * Comments are not writers. This file's own explanation names cooperativeId
 * repeatedly, and so do #319's and dashboard.ts's, so each candidate line is
 * re-read from the comment-stripped source. That trap has cost this audit four
 * separate gates now.
 */
function usersDocWritersOf(field: string): string[] {
    const candidates = execSync(`grep -rn "${field}" src || true`, {
        encoding: 'utf-8', cwd: process.cwd(),
    })
        .split('\n')
        .filter((l) => l.trim())
        .filter((l) => !l.includes('__tests__'));

    return candidates.filter((line) => {
        const rel = line.split(':')[0];
        const lineno = Number(line.split(':')[1]);
        if (!rel || !Number.isFinite(lineno)) return false;

        const stripped = source(rel).split('\n');
        const text = stripped[lineno - 1] ?? '';
        if (!text.includes(field)) return false;

        // A write onto a USER document specifically. cooperativeId is written
        // freely onto membership records, withdrawals and ledger rows — those
        // are not what getAdminScope reads.
        const window = stripped.slice(Math.max(0, lineno - 12), lineno).join('\n');
        const targetsUsers = /COLLECTIONS\.USERS|["']users["']/.test(window);
        const isWrite = /\.(set|update)\s*\(|updateDoc\s*\(|setDoc\s*\(/.test(window);

        return targetsUsers && isWrite;
    }).map((l) => l.split(':')[0]);
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
        //
        //   #248 The middle clause is GONE. It read
        //        `memberScope && memberData.cooperativeId && … !== memberScope`,
        //        so a membership row with no cooperativeId passed — and those
        //        are the ordinary case, not an edge (autoProvisionZereCooperative
        //        writes one). The guard now refuses a row it cannot attribute.
        const src = source('src/app/actions/cooperative/_coop_admin_members.ts');

        // The WHOLE condition, `memberScope &&` included. Matching only the
        // comparison let `if (false && memberData.cooperativeId !== memberScope)`
        // through — the substring survives inside a gutted guard, which is the
        // membership-versus-meaning trap this audit has now hit four times.
        expect(src).toContain(
            'if (memberScope && memberData.cooperativeId !== memberScope) {',
        );
        expect(src).toContain('Cannot change membership status for another cooperative');
    });

    it('AND NONE OF THE THREE STILL FAILS OPEN ON AN UNATTRIBUTABLE ROW', () => {
        //   #248 The shape, swept rather than listed, because the three were
        //        written at different times and a fourth will be too. Any guard
        //        of the form `scope && row.cooperativeId && …` waves through
        //        every row that carries no cooperativeId — which was two of the
        //        three withdrawal doors and every auto-provisioned membership.
        const offenders: string[] = [];

        for (const rel of CONSUMERS) {
            for (const line of source(rel).split('\n')) {
                if (/\b(adminScope|memberScope)\s*&&\s*\w*[Dd]ata\??\.cooperativeId\s*&&/.test(line)) {
                    offenders.push(`${rel}: ${line.trim()}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    it('and all three still compare against the scope, so they were not just emptied', () => {
        // Vacuity guard on the sweep above: deleting the guards entirely would
        // satisfy it.
        const comparisons = CONSUMERS.reduce(
            (n, rel) => n + (source(rel).match(/!==\s*(adminScope|memberScope)/g) ?? []).length, 0,
        );

        expect(comparisons).toBe(3);
    });
});

describe('the claim matches reality, in both directions', () => {
    it('nothing writes cooperativeId onto a user document', () => {
        // The coupling that makes this durable rather than a note. Comments are
        // not writers — this file's own explanation names the field repeatedly,
        // and so do #319's and dashboard.ts's, so each candidate is re-checked
        // against its source with comments removed. That trap has now cost this
        // audit three separate gates.
        // #385: THE POSITIVE CONTROL COMES FIRST, because the answer is now an
        // EMPTY LIST. "No writers found" and "the detector finds nothing at
        // all" are the same assertion result and different facts — a broken
        // grep, a renamed collection constant or a widened comment-stripper
        // would each turn this green while measuring nothing. So the same
        // detector is first pointed at a field this codebase demonstrably DOES
        // write onto user documents, and must find it.
        const control = usersDocWritersOf('sessionsValidFrom');
        expect(control.length).toBeGreaterThan(0);

        expect(usersDocWritersOf('cooperativeId')).toEqual([]);
    });

    it('#248 REASON 1 — nothing creates a cooperative, so there is an estate of one', () => {
        // The measurement the decision rests on. Every reference to
        // COLLECTIONS.COOPERATIVES is a READ — the legacy nested
        // cooperatives/{id}/members/{uid} path. If a writer ever appears, this
        // fails and the decision has to be retaken.
        const lines = execSync('grep -rn "COLLECTIONS.COOPERATIVES)" src || true', {
            encoding: 'utf-8', cwd: process.cwd(),
        })
            .split('\n')
            .filter((l) => l.trim() && !l.includes('__tests__'));

        expect(lines.length).toBeGreaterThan(0);   // vacuity guard on the grep

        const writers = lines.filter((line) => {
            const rel = line.split(':')[0];
            const lineno = Number(line.split(':')[1]);
            if (!rel || !Number.isFinite(lineno)) return false;

            // The write, if there were one, follows the collection reference
            // within a few lines — `.doc(x).set(...)`, `.add(...)`.
            const after = source(rel).split('\n').slice(lineno - 1, lineno + 4).join('\n');
            return /\.(set|add)\s*\(/.test(after);
        });

        expect(writers).toEqual([]);
    });

    it('#248 REASON 1 — and the one action that needs a cooperative document has no caller', () => {
        // joinCooperativeAction requires `cooperatives/{id}` to exist. Every
        // mention of it outside its own module is a comment about the row shape
        // it produces, which is why the check is on stripped source.
        //
        // Scoped to executable source. The one non-source hit was the help
        // centre's API docs, which told a developer to import it from a module
        // path that does not exist and call it with a shape it does not take —
        // corrected in the same change, and asserted separately below rather
        // than exempted here.
        const callers = execSync(
            'grep -rln --include=*.ts --include=*.tsx "joinCooperativeAction" src || true',
            { encoding: 'utf-8', cwd: process.cwd() },
        )
            .split('\n')
            .filter((f) => f.trim() && !f.includes('__tests__'))
            .filter((f) => !f.endsWith('_coop_registration.ts'))
            .filter((f) => !f.endsWith('cooperative/index.ts'))
            .filter((f) => /\bjoinCooperativeAction\s*\(/.test(source(f)));

        expect(callers).toEqual([]);
    });

    it('#248 — and the API docs no longer tell a developer to call it', () => {
        // #362's shape in documentation: instructions for an action that cannot
        // succeed, with an import path that does not resolve.
        const docs = readFileSync(
            join(process.cwd(), 'src/app/help/api-docs/page.mdx'), 'utf-8',
        );

        expect(docs).toContain('**Not currently available.**');
        expect(docs).not.toMatch(/^import \{ joinCooperativeAction \} from "@\/app\/actions\/cooperatives";$/m);
        // The sibling example was importing from the same wrong path.
        expect(docs).not.toMatch(/@\/app\/actions\/cooperatives"/);
    });

    it('#248 REASON 2 — cooperative_admin is a module role, like its nine siblings', () => {
        // If per-cooperative administration were a concept here, it would show
        // up in the role vocabulary. It does not: the role sits in the same list
        // as marketplace_admin and export_admin, described the same way.
        const roles = readFileSync(join(process.cwd(), 'src/lib/types/roles.ts'), 'utf-8');

        expect(roles).toMatch(/"cooperative_admin"\s*\/\/ Manages the cooperative module/);
    });

    it('#248 REASON 3 — every door that files a cooperative withdrawal now labels the row', () => {
        // The trap that made switching the scoping on unsafe. Two of these three
        // wrote no cooperativeId, so the approve and reject guards had nothing
        // to compare and let the row through. Derived from the writers rather
        // than a hand-written list, so a fourth door has to label its rows too.
        const doors = execSync(
            'grep -rln "COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc()" src || true',
            { encoding: 'utf-8', cwd: process.cwd() },
        ).split('\n').filter((f) => f.trim() && !f.includes('__tests__'));

        expect(doors.length).toBe(3);

        for (const rel of doors) {
            // WINDOWED, not file-wide. The first version of this asked whether
            // `cooperativeId:` appeared anywhere in the door's file, and
            // _coop_money.ts mentions the field in a different function — so
            // deleting the label from the withdrawal write left it passing.
            // Mutation testing caught that; the assertion now looks only at the
            // rows written after the request document is created.
            const lines = source(rel).split('\n');
            const start = lines.findIndex((l) => l.includes('COOPERATIVE_WITHDRAWALS).doc()'));
            const window = lines.slice(start, start + 30).join('\n');

            expect({ rel, found: start > -1 }).toEqual({ rel, found: true });
            expect({ rel, labels: /cooperativeId:/.test(window) }).toEqual({ rel, labels: true });
            // And from the membership, never from what the caller sent. A
            // caller-supplied value would let a member choose which admin may
            // act on their withdrawal.
            const label = window.split('\n').find((l) => l.includes('cooperativeId:')) ?? '';
            expect({ rel, fromCaller: /formData|body\.|req\.|request\./.test(label) })
                .toEqual({ rel, fromCaller: false });
        }

        // What actually proves the values, rather than the spelling:
        // cooperative-withdrawal-doors.test.ts executes two of these doors and
        // asserts the stored row carries the MEMBERSHIP's cooperative even when
        // the caller sent a different one.
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
        // #248 — and it records the decision rather than leaving it open, so a
        // reader does not go and build the tenancy screen.
        expect(raw).toContain('COOPERATIVE ADMINS ARE NOT SCOPED');
    });
});
