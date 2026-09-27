/**
 * @jest-environment node
 */

/**
 *   #966 THE PROHIBITION THAT REPLACES CONVERTING DOORS ONE AT A TIME.
 *
 *   #951 converted forty-four `isAdmin(session.user.roles)` doors across four
 *   findings, each batch described as closing a hole. #965 then drove
 *   requireSession for the first time and found it force-syncs the live roles over
 *   the token — so those doors were already judging the ROW, and the hole was
 *   narrower than any of the four claimed.
 *
 *   What #965 also established is where the claim IS true: a session obtained by
 *   calling `auth()` directly. That session has had no force-sync, no ban check, no
 *   suspension check, no sessionsValidFrom revocation, and no fail-closed refusal
 *   of an unverifiable elevated role. Its roles are the JWT's, up to eight hours
 *   old — #356's sentence, true here and nowhere else.
 *
 *   SO THE REMAINING WORK IS NOT THIRTY-SIX MORE CONVERSIONS. Converting a door
 *   fixes that door; the next one written repeats the shape, which is how a
 *   seventy-five-door backlog came to exist after four findings had each fixed
 *   "the next bounded set". A prohibition covers the doors nobody has written yet,
 *   and it is the only thing here that prevents the class rather than instances of
 *   it.
 *
 * ── THE ONE INSTANCE, AND WHY IT IS THIN BUT REAL ───────────────────────────
 *
 *   app/wave/page.tsx was the only file in the tree deciding from a raw session:
 *
 *       const session = await auth();
 *       const roles = session.user.roles || [];
 *       const hasAccess = await checkModuleAccess(session.user.id, roles, "wave");
 *
 *   Every sibling layout — wave/(member), academy/(learner), export/(app),
 *   cooperatives/(member), marketplace/buyer, marketplace/seller, farm-nation/
 *   (member) — reaches checkModuleAccess through requireSession or
 *   requireHubRegistration. This one did not.
 *
 *   Its consequence is ROUTING rather than access: /wave decides where to send the
 *   caller, and every destination sits behind a guard that would refuse them. So a
 *   banned member was routed rather than refused, and a member whose registration
 *   the token had not caught up with could be sent to the wrong place. Thin — and
 *   it is still the only place a stale JWT reached an authorisation function, which
 *   is precisely what the whole #951 programme was for.
 */

import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { findRawSessionGates, ACCESS_PREDICATES } from '@/lib/testing/raw-session-gates';
import { stripComments } from '@/lib/testing/strip-comments';

const SRC = path.join(process.cwd(), 'src');
const DIRS = ['app', 'lib', 'components'] as const;

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
}

/**
 * The files allowed to decide from a raw auth() session, each with its reason.
 *
 * Named, not pattern-matched: an exemption list that grows by regex is how a rule
 * stops being one.
 */
const ALLOWED = new Map<string, string>([
    [
        'lib/session-guard.ts',
        'IS the guard. Calling auth() and then asking isAdmin is its job — the '
        + 'fail-closed refusal of an unverifiable elevated session is that exact call.',
    ],
    [
        'lib/require-admin.ts',
        'does its own live read of the caller\'s row and decides from that, which is '
        + 'the behaviour every other door is being pointed at.',
    ],
]);

function offenders(): string[] {
    const found: string[] = [];
    for (const dir of DIRS) {
        const full = path.join(SRC, dir);
        if (!fs.existsSync(full)) continue;
        for (const file of walk(full)) {
            const raw = fs.readFileSync(file, 'utf-8');
            if (!raw.includes('auth()')) continue;

            const rel = path.relative(SRC, file).split(path.sep).join('/');
            const stripped = stripComments(raw, { minRetainedRatio: 0, label: rel });

            for (const gate of findRawSessionGates(stripped)) {
                if (ALLOWED.has(rel)) continue;
                found.push(`${rel}:${gate.line} — ${gate.predicate}(${gate.binding}…)`);
            }
        }
    }
    return found.sort();
}

describe('#966 — no gate decides from a raw auth() session', () => {
    it('THE PROHIBITION', () => {
        const bad = offenders();

        if (bad.length) {
            throw new Error(
                '\n\n⚠️  An authorisation decision is being made from a RAW auth() '
                + 'session — no force-sync, no ban check, no revocation check:\n\n'
                + bad.map((b) => `  ${b}`).join('\n')
                + '\n\nUse requireSession() (or requireAdmin / requireHubRegistration).\n'
                + 'See the-token-the-guard-had-already-replaced for what the difference is.\n',
            );
        }

        expect(bad).toEqual([]);
    });

    it('AND THE DETECTOR STILL FINDS THE SHAPE — so [] is clean, not broken', () => {
        /*
         *   The vacuity control, and the reason a zero above can be believed. A
         *   detector that has stopped detecting reports zero too, which is how a
         *   neighbouring ledger in this programme spent three batches reporting a
         *   converted file as a defect and a real one as nothing at all.
         *
         *   The fixture is wave/page.tsx's own shape, reduced — including the hop
         *   through a separate `roles` binding, which is what made the real
         *   instance invisible to a detector anchored on the session name alone.
         */
        const INSTANCE = `
            const session = await auth();
            const roles = session.user.roles || [];
            const hasAccess = await checkModuleAccess(session.user.id, roles, "wave");
        `;
        const found = findRawSessionGates(INSTANCE);

        expect({ count: found.length }).toEqual({ count: 1 });
        expect({ predicate: found[0]?.predicate }).toEqual({ predicate: 'checkModuleAccess' });
    });

    it('and it finds the INLINE shape too, not only the hop', () => {
        const INLINE = `
            const s = await auth();
            if (!isAdmin(s.user.roles)) return null;
        `;
        expect({ count: findRawSessionGates(INLINE).length }).toEqual({ count: 1 });
    });

    it('AND IT DOES NOT CRY AT A requireSession SESSION — the false-positive control', () => {
        /*
         *   Without this the prohibition would indict every door in the tree, which
         *   is worse than not having it: a rule that fires on correct code gets
         *   suppressed, and then it is not a rule.
         */
        const CORRECT = `
            const sessionResult = await requireSession();
            if (!sessionResult.session) return null;
            const { session } = sessionResult;
            if (!isAdmin(session.user.roles)) return null;
        `;
        expect({ count: findRawSessionGates(CORRECT).length }).toEqual({ count: 0 });
    });

    it('nor at a file that calls auth() and asks a predicate about something ELSE', () => {
        /*
         *   The per-call-site requirement, as a test. app/actions/auth.ts is the real
         *   shape: it calls auth() for the signed-in id and email, and separately asks
         *   isAdmin about roles it read from the database row. A file-level detector
         *   reports that as a defect; this one must not.
         */
        const UNRELATED = `
            const session = await auth();
            const sessionEmail = session?.user?.email ?? null;
            const userRoles = (userDoc.data() ?? {}).roles ?? [];
            const hasAdminRole = isAdmin(userRoles);
        `;
        expect({ count: findRawSessionGates(UNRELATED).length }).toEqual({ count: 0 });
    });

    it('and the predicate list is the whole authorisation vocabulary, floored', () => {
        /*
         *   The prohibition is only as wide as this list. Four role predicates plus
         *   the two module-access functions — #965 found the isAdmin ledger counted
         *   ONE spelling while isSuperAdmin (4 sites) and isPlatformAdmin (18) went
         *   uncounted, so a list that shrinks silently is the failure to guard
         *   against.
         */
        expect([...ACCESS_PREDICATES].sort()).toEqual([
            'checkModuleAccess', 'hasAdminPermission', 'hasAppAccess',
            'isAdmin', 'isPlatformAdmin', 'isSuperAdmin',
        ]);
    });

    it('and every exemption names a file that exists and a reason', () => {
        //   An exemption for a deleted file reads as coverage and guards nothing.
        for (const [rel, reason] of ALLOWED) {
            expect({ rel, exists: fs.existsSync(path.join(SRC, rel)) })
                .toEqual({ rel, exists: true });
            expect(reason.length).toBeGreaterThan(40);
        }
    });
});
