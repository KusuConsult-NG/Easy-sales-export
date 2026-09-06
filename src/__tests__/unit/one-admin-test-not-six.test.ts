/**
 * @jest-environment node
 */

/**
 *   #356 THE #353 FIX LANDED ON ONE OF SIX COPIES OF THE SAME HAND-WRITTEN
 *        ADMIN TEST.
 *
 *        #353 removed this from lib/hub-guard.ts:
 *
 *            r === 'admin' || r === 'super_admin' || r.endsWith('_admin')
 *
 *        and said why: `moderator` and `support` match none of it, both are
 *        keys of PERMISSION_MATRIX, both make isAdmin() true, so both are
 *        admin roles by the only definition this codebase has — and the suffix
 *        is a trap in the other direction, since any future role ending in
 *        those seven characters would be admitted without being an admin.
 *
 *        There were five more copies. This is #83's shape (the #36 fix landed
 *        on WAVE only) and #297's (the #291 fix landed on one of three copies
 *        of the retry loop): the finding was right, the sweep was not.
 *
 *          lib/require-admin.ts          THE BIG ONE. Fifteen admin action
 *                                        files route through it — the land
 *                                        queue, the withdrawal queue, legacy
 *                                        onboarding, SMS and in-app broadcast,
 *                                        maintenance, dispute escalation, the
 *                                        hard-reset route. A support account
 *                                        was refused by every one of them.
 *          infrastructure/messaging      getAllConversationsAdmin threw
 *                                        "Access denied" at moderator and
 *                                        support — the support inbox, refusing
 *                                        support.
 *          actions/messages.ts           scoped their user search as an
 *                                        ordinary member's.
 *          infrastructure/chatbot        told them they were a "general
 *                                        participant".
 *          actions/auth.ts               sent them to the member dashboard
 *                                        instead of /admin at every login.
 *
 *        All five now ask isAdmin(). auth.ts KEEPS its two legacy spellings —
 *        'superadmin' without the underscore, and anything containing
 *        'admin_dashboard' — because 'superadmin' is still honoured twenty
 *        lines below it and in api/admin/documents/[docId], so narrowing it
 *        away here would strand whoever holds it.
 *
 *        AND TWO DISPUTE WRITES WERE GATED ON "IS AN ADMIN AT ALL".
 *
 *        Found on the way. admin/marketplace/disputes/[id] calls four server
 *        actions. updateDisputeStatusAction and the resolver ask
 *        hasAdminPermission(roles, "finance:resolve_disputes") — held by
 *        super_admin and admin and nobody else — and actions/disputes.ts says
 *        in its own comment that widening dispute moderation would be "a bad
 *        trade made quietly".
 *
 *        The other two doors on the same screen made exactly that trade:
 *
 *          addEscalationNoteAction   appended a note that is immutable by
 *                                    design, and fired a `dispute_escalated`
 *                                    row into the admin audit log.
 *          escalateDisputeAction     moved the dispute to under_review and
 *                                    notified the buyer AND the seller.
 *
 *        Both took requireAdmin() with no permission, so an academy_admin or a
 *        wave_admin could do either to a marketplace dispute. That is #276 and
 *        #339's shape — the sibling door with the weaker guard. Both now ask
 *        the permission the rest of the screen asks.
 *
 *        The notes READ is deliberately left at "any admin": getDisputeByIdAction
 *        already admits any admin to the dispute itself, and narrowing the
 *        notes alone would show a moderator the case with a hole in it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { isAdmin, isSuperAdmin, adminLandingPath } from '@/lib/admin-permissions';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const GATE = 'src/lib/require-admin.ts';
const NOTES = 'src/app/actions/escalation-notes.ts';
const ESCALATE = 'src/app/actions/marketplace/_escrow_disputes.ts';

/** Drive requireAdmin: who is signed in, and what the user row says. */
async function callRequireAdmin(
    roles: string[] | null,
    permission?: any,
    extra: Record<string, any> = {},
) {
    const { auth } = await import('@/lib/auth');
    (auth as jest.Mock<any>).mockResolvedValue(
        roles === null ? null : { user: { id: 'admin-1' } } as any,
    );
    (global as any).mockFirestoreGet.mockResolvedValue({
        exists: true,
        data: () => ({ roles: roles ?? [], ...extra }),
    });

    const { requireAdmin } = await import('@/lib/require-admin');
    return requireAdmin(permission);
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#356 — requireAdmin admits every admin role', () => {
    it('MODERATOR AND SUPPORT ARE ADMITTED, AND WERE NOT', async () => {
        // THE test. Fifteen admin action files refused both of these.
        for (const role of ['moderator', 'support']) {
            await expect(callRequireAdmin([role])).resolves.toEqual({ userId: 'admin-1' });
        }
    });

    it('and the old test really did refuse them', async () => {
        // The cost, measured against isAdmin rather than asserted.
        const { isAdmin } = await import('@/lib/admin-permissions');
        const oldTest = (r: string) => r === 'admin' || r === 'super_admin' || r.endsWith('_admin');

        for (const role of ['moderator', 'support']) {
            expect(isAdmin([role])).toBe(true);
            expect(oldTest(role)).toBe(false);
        }
    });

    it('every one of the ten admin roles passes', async () => {
        const { ALL_ADMIN_ROLES } = await import('@/lib/admin-permissions');

        expect(ALL_ADMIN_ROLES.length).toBe(10);          // vacuity guard
        for (const role of ALL_ADMIN_ROLES) {
            await expect(callRequireAdmin([role])).resolves.toEqual({ userId: 'admin-1' });
        }
    });

    it('A ROLE THAT MERELY ENDS IN _admin NO LONGER GETS IN', async () => {
        // The trap in the other direction, which the suffix test left open.
        for (const role of ['pending_admin', 'former_admin', 'not_an_admin']) {
            await expect(callRequireAdmin([role]))
                .resolves.toEqual({ error: 'Unauthorized: Admin access required' });
        }
    });

    it('and an ordinary member still does not', async () => {
        for (const role of ['general_user', 'marketplace_seller', 'cooperative_member']) {
            await expect(callRequireAdmin([role]))
                .resolves.toEqual({ error: 'Unauthorized: Admin access required' });
        }
    });

    it('the banned check still runs before the role check', async () => {
        // Vacuity guard: widening the role set must not have skipped #242's
        // suspension guard.
        await expect(callRequireAdmin(['super_admin'], undefined, { isBanned: true }))
            .resolves.toEqual({ error: 'Account suspended. Contact support.' });
    });

    it('and an unauthenticated caller is still refused', async () => {
        await expect(callRequireAdmin(null)).resolves.toEqual({ error: 'Unauthenticated' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#356 — requireAdmin can ask for a specific permission', () => {
    it('A MODULE ADMIN IS REFUSED finance:resolve_disputes', async () => {
        for (const role of ['academy_admin', 'wave_admin', 'marketplace_admin', 'support', 'moderator']) {
            await expect(callRequireAdmin([role], 'finance:resolve_disputes'))
                .resolves.toEqual({ error: 'Unauthorized: Admin access required' });
        }
    });

    it('while admin and super_admin hold it', async () => {
        for (const role of ['admin', 'super_admin']) {
            await expect(callRequireAdmin([role], 'finance:resolve_disputes'))
                .resolves.toEqual({ userId: 'admin-1' });
        }
    });

    it('and the matrix agrees, so this is not a second vocabulary', async () => {
        const { hasAdminPermission } = await import('@/lib/admin-permissions');

        expect(hasAdminPermission(['admin'], 'finance:resolve_disputes')).toBe(true);
        expect(hasAdminPermission(['academy_admin'], 'finance:resolve_disputes')).toBe(false);
    });

    it('a caller that names no permission is unchanged', async () => {
        // The 13 existing call sites must behave exactly as before.
        await expect(callRequireAdmin(['academy_admin'])).resolves.toEqual({ userId: 'admin-1' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#356 — the two dispute doors ask what the screen asks', () => {
    it('ADDING AN ESCALATION NOTE REQUIRES finance:resolve_disputes', () => {
        expect(source(NOTES)).toContain('await requireAdmin("finance:resolve_disputes")');
    });

    it('AND SO DOES ESCALATING THE DISPUTE', () => {
        expect(source(ESCALATE)).toContain('await requireAdmin("finance:resolve_disputes")');
    });

    it('while READING the notes is still open to any admin, on purpose', () => {
        // Stated rather than left implicit: narrowing the read alone would
        // show a moderator the dispute with a hole in it.
        const code = source(NOTES);
        const reader = code.slice(code.indexOf('export async function getEscalationNotesAction'));

        expect(reader).toContain('await requireAdmin();');
        expect(reader).not.toContain('finance:resolve_disputes');
    });

    it('and the sibling actions on that screen really do ask for it', () => {
        // The claim the whole finding rests on, pinned against the siblings.
        const disputes = source('src/app/actions/disputes.ts');

        // Three, not two: the two write gates plus getDisputeByIdAction's
        // `isResolver`, which it uses to decide how much of the dispute to
        // show rather than whether to show it at all.
        expect(disputes.match(/hasAdminPermission\(callerRoles, "finance:resolve_disputes"\)/g) ?? [])
            .toHaveLength(3);
        expect(disputes).toContain('const isResolver = hasAdminPermission(callerRoles, "finance:resolve_disputes")');
    });

    it('the note is still append-only and still audited', () => {
        // Vacuity guard: tightening the gate must not have moved anything else.
        const code = source(NOTES);

        expect(code).toContain('await notesRef.add({');
        expect(code).toContain('action: "dispute_escalated"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#356 — the other four copies', () => {
    it('THE MESSAGING ADMIN LIST USES isAdmin', () => {
        const code = source('src/infrastructure/messaging/service.ts');

        expect(code).toContain('if (!isAdmin(roles)) {');
        expect(code).toContain('throw new Error("Access denied: Admin privileges required")');
    });

    it('THE MESSAGE SEARCH USES isAdmin', () => {
        expect(source('src/app/actions/messages.ts')).toContain('const userIsAdmin = isAdmin(userRoles);');
    });

    it('THE CHATBOT ROLE PROMPT USES isAdmin', () => {
        expect(source('src/infrastructure/chatbot/service.ts'))
            .toContain('const isAdmin = isAdminRoles(verifiedRoles);');
    });

    it('THE POST-LOGIN REDIRECT USES isAdmin — AND STILL ADMITS THE LEGACY SPELLINGS', () => {
        const code = source('src/app/actions/auth.ts');

        expect(code).toContain('const hasAdminRole = isAdmin(');

        //   #458 'superadmin' USED TO BE SPELLED OUT ON THIS LINE and is not
        //        any more — isAdmin resolves it. The spelling must still be
        //        ADMITTED, which is what actually matters and is asserted
        //        behaviourally; asserting the literal is what would force the
        //        duplication back.
        expect(isAdmin(['superadmin'])).toBe(true);

        // 'admin_dashboard' is a different legacy shape, matched as a
        // substring, and no canonical role contains it — so it stays written
        // out here, and stays pinned.
        expect(code).toContain("includes('admin_dashboard')");
    });

    it("and 'superadmin' really is still honoured elsewhere, so keeping it is not cargo", () => {
        /**
         *   #431 CORRECTION: ONE OF THE TWO REASONS IS GONE.
         *
         *   This asserted the legacy spelling was honoured in two places —
         *   auth.ts's own later check and api/admin/documents/[docId] — and
         *   said "if these two go, it can go".
         *
         *   The second has gone. That route stated the admin rule by hand,
         *   ["admin", "super_admin", "cooperative_manager", "superadmin"], read
         *   off the JWT claim; it is exactly the class #364 swept out of fifteen
         *   API routes and #356 out of requireAdmin, and it was missed by both.
         *   #431 found it while retiring the route (it reads a table nothing
         *   writes) and replaced the list with requireAdmin.
         *
         *   So the branch in auth.ts now rests on ONE site, its own. That is
         *   still a reason and it is still not cargo — a holder of the legacy
         *   spelling would be locked out of the post-login admin redirect
         *   without it — but the count is recorded honestly, because when that
         *   last site goes the branch should go with it rather than being kept
         *   by a comment nobody rechecks.
         *
         *   #458 THAT LAST SITE HAS GONE, AND THE BRANCH WENT WITH IT — which
         *   is what the paragraph above said should happen.
         *
         *   The reason it had to go is worse than redundancy. auth.ts was the
         *   ONLY file that knew the spelling: isAdmin did not, PERMISSION_MATRIX
         *   had no entry, and app/admin/page.tsx computed `isGlobalAdmin` by
         *   hand. So login sent the holder to /admin and /admin sent them to
         *   /dashboard. Honouring a legacy spelling in the one place that only
         *   decides where to send somebody, and nowhere that decides whether
         *   they may arrive, is worse than not honouring it at all.
         *
         *   lib/role-aliases resolves it now, before any predicate judges. This
         *   assertion is BEHAVIOURAL rather than a string, because a string
         *   pinned to auth.ts is what would have made #458 unfixable without
         *   first deleting a test.
         */
        expect(isAdmin(['superadmin'])).toBe(true);
        expect(isSuperAdmin(['superadmin'])).toBe(true);
        expect(adminLandingPath(['superadmin'])).toBe('/admin');

        // POSITIVE CONTROL: not everything resolves — a near miss still fails.
        expect(isAdmin(['superadmim'])).toBe(false);

        // And auth.ts states it nowhere by hand any more.
        expect(source('src/app/actions/auth.ts')).not.toContain("'superadmin'");

        // And it is NOT honoured in the retired document viewer any more.
        expect(source('src/app/api/admin/documents/[docId]/route.ts')).not.toContain('superadmin');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#356 — THE RATCHET: one admin test, not six', () => {
    function walk(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full, out);
            else if (/\.tsx?$/.test(full) && !/\.d\.ts$/.test(full)) out.push(full);
        }
        return out;
    }

    const FILES = walk(join(process.cwd(), 'src'))
        .map((f) => relative(process.cwd(), f))
        .filter((f) => !f.includes('__tests__') && !f.includes('/testing/'));

    it('finds the source tree, so this is not vacuous', () => {
        expect(FILES.length).toBeGreaterThan(400);
    });

    it('NOBODY DECIDES ADMIN-NESS BY THE _admin SUFFIX ANY MORE', () => {
        // Derived from the six. The whole finding is that one site was fixed
        // and five identical ones were not, so the ratchet is on the SHAPE —
        // specifically the suffix, which is the half that both over-grants and
        // under-grants. (My first draft of this also matched
        // `r === "admin" ||` and reported seven more files. Those are
        // deliberately NARROW module gates — "admin, super_admin or
        // academy_admin" — a different pattern with the opposite intent, and
        // widening them is not this finding's business. They are counted in
        // the next test instead of being swept up here.)
        //
        // Measured on comment-stripped source, because five of these files now
        // QUOTE the test they no longer perform — the tombstone trap that has
        // caught this suite before (#350, #354, #355).
        const offenders = FILES.filter((f) => {
            const code = stripComments(readFileSync(join(process.cwd(), f), 'utf-8'));
            return /\.endsWith\(\s*["']_admin["']\s*\)/.test(code);
        });

        // admin-permissions.ts is the one legitimate holder: MODULE_ADMIN_ROLE
        // resolution needs the suffix to pick a module admin out of a role
        // list, which is not an authorisation decision.
        expect(offenders).toEqual(['src/lib/admin-permissions.ts']);
    });

    it('RECORDED: the narrow hand-written module gates, counted so new ones show', () => {
        // Not repaired here — each of these deliberately admits a global admin
        // plus ONE module admin, which is a scope decision rather than the
        // suffix bug. Pinned so the number cannot grow unnoticed, and named so
        // the next sweep does not rediscover them.
        const narrow = FILES.filter((f) => {
            const code = stripComments(readFileSync(join(process.cwd(), f), 'utf-8'));
            return /r(ole)?\s*===\s*["']admin["']\s*\|\|/.test(code);
        });

        expect(narrow.sort()).toEqual([
            'src/app/actions/admin/_academy.ts',
            'src/app/actions/admin_extensions.ts',
            'src/app/actions/cooperative/_loans_applications.ts',
            'src/app/actions/export-aggregation.ts',
            'src/app/actions/marketplace/_mp_products.ts',
            'src/infrastructure/messaging/service.ts',
            // isAdmin() itself, which is where the list is SUPPOSED to be
            // written out once.
            'src/lib/admin-permissions.ts',
            'src/lib/notification-filter.ts',
        ]);
    });

    it('and the six sites it was are all clean', () => {
        for (const f of [
            'src/lib/hub-guard.ts',
            GATE,
            'src/infrastructure/messaging/service.ts',
            'src/infrastructure/chatbot/service.ts',
            'src/app/actions/messages.ts',
            'src/app/actions/auth.ts',
        ]) {
            expect(source(f)).not.toMatch(/\.endsWith\(\s*["']_admin["']\s*\)/);
        }
    });

    it('the one exemption is a lookup, not a gate', () => {
        // Pinned, so the exemption cannot quietly become an authorisation test.
        const code = source('src/lib/admin-permissions.ts');
        const line = code.split('\n').find((l) => l.includes(".endsWith(\"_admin\")"))!;

        //   #458 THIS PINNED THE VARIABLE NAME, `userRoles.find(`, and broke
        //        when the function started resolving legacy spellings first
        //        and read `held` instead. The name was never the point — that
        //        the line is a LOOKUP and not a gate was. Asserted as that.
        expect(line).toMatch(/const\s+\w+\s*=\s*\w+\.find\(/);
        expect(line).not.toMatch(/if\s*\(|return\s+\w+\.some/);
    });
});
