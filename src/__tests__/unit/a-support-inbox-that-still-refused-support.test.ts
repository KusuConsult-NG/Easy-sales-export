/**
 * @jest-environment node
 */

/**
 *   #633 THE SUPPORT INBOX HANDED SUPPORT A LIST WHERE NOTHING OPENED.
 *
 *   #356 found that `getAllConversationsAdmin` refused `moderator` and
 *   `support` — "the two roles whose job this screen is" — and changed it to
 *   ask `isAdmin()`. Its note is still in the file.
 *
 *   `validateConversationAccess`, twenty lines above it, decides whether any one
 *   of those conversations may be OPENED or REPLIED TO. It kept the
 *   hand-written test:
 *
 *       roles.some(r => r === "admin" || r === "super_admin")
 *
 *   THERE WERE THREE COPIES, NOT TWO, and the third is the one that made the
 *   screen useless. `getAllConversationsAdmin` filters its results with the same
 *   hand-written test:
 *
 *       const isGlobalAdmin = roles.some(r => r === "admin" || r === "super_admin");
 *       if (isGlobalAdmin) return true;
 *       ... module-admin branches ...
 *       return false;
 *
 *   `support` and `moderator` hold no module role, so every branch answered no
 *   and the filter dropped every row. #356 turned "Access denied" into AN EMPTY
 *   LIST — a support inbox that says there are no messages, which is a worse lie
 *   than a refusal, because nothing about it looks like a permissions problem.
 *
 *   THE FIX REACHED ONE OF THREE DOORS — in the commit whose whole subject was
 *   that a fix had reached one of six.
 *
 * ── AND THE OBVIOUS PREDICATE WOULD HAVE BEEN A REGRESSION ──────────────────
 *
 *   `isAdmin()` is the natural thing to reach for and it is WRONG here: it is
 *   true for the six MODULE admins too, so using it would hand a
 *   cooperative_admin every conversation on the platform and silently delete the
 *   module scoping this file exists to enforce. `isPlatformAdmin()` is wrong in
 *   the other direction — derived from `config:update`, it is super_admin and
 *   admin only, which excludes the very two roles this is about.
 *
 *   `isUnscopedAdmin()` is the concept that was missing: an admin whose remit is
 *   the platform rather than one module. Derived from the two existing lists, so
 *   a seventh module admin removes itself from it.
 *
 *   Nothing else moves. The module branches are untouched, so a
 *   cooperative_admin still reaches only cooperative conversations, and a
 *   non-admin still has to be a participant.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { isAdmin, isPlatformAdmin, isUnscopedAdmin, UNSCOPED_ADMIN_ROLES } from '@/lib/admin-permissions';

const SERVICE = 'src/infrastructure/messaging/service.ts';

const code = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

/**
 * Ask the REAL guard, through the door that uses it.
 *
 *   THE FIRST VERSION OF THIS RE-IMPLEMENTED THE RULE, and mutation testing
 *   showed exactly what that is worth: mutants that let a stranger read any
 *   conversation, and that deleted the module scoping, BOTH SURVIVED — they
 *   changed the shipped function while this file went on asking its own copy.
 *
 *   That is #612's defect, committed in a file whose own comment cited #612.
 *   `validateConversationAccess` is module-private, so it is reached through
 *   `getMessages`, which is the door a user actually comes through.
 */
async function canOpen(
    conversation: Record<string, unknown>,
    userId: string,
    roles: string[],
): Promise<boolean> {
    const { getMessages } = await import('@/infrastructure/messaging/service');

    (global as any).mockFirestoreGet.mockResolvedValue({
        exists: true,
        data: () => conversation,
        ref: {
            collection: () => ({
                orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
            }),
        },
    });

    try {
        await getMessages('conv-1', userId, roles);
        return true;
    } catch (error) {
        if (String((error as Error).message).includes('Access denied')) return false;
        throw error;
    }
}

describe('#633 — whoever can see the inbox can open it', () => {
    it('THE LIST AND THE READER ASK THE SAME QUESTION', () => {
        /*
         *   The whole finding in one assertion. Two gates on one screen, and the
         *   defect was that they disagreed.
         */
        const src = code(SERVICE);

        //   The reader, and the list's own filter.
        expect(src).toContain('if (isUnscopedAdmin(roles)) {');
        expect(src).toContain('if (isUnscopedAdmin(roles)) return true;');
        //   And the gate, which #356 already fixed.
        expect(src).toContain('if (!isAdmin(roles)) {');

        //   The hand-written test is gone from ALL THREE.
        expect(src).not.toMatch(/roles\.some\(r => r === "admin" \|\| r === "super_admin"\)/);
    });

    it.each(['support', 'moderator'])('A %s CAN NOW OPEN A CONVERSATION THEY CAN SEE', async (role) => {
        //   The two roles #356 named. Neither is a participant; both are admins.
        const conversation = { participants: ['buyer-1', 'seller-1'] };
        expect(isAdmin([role])).toBe(true);                                   // premise
        await expect(canOpen(conversation, 'staff-1', [role])).resolves.toBe(true);
    });

    it('AND THE PREDICATE IS THE ONE THAT MEANS THIS, not the nearest neighbour', () => {
        /*
         *   Both obvious choices are defects, in opposite directions, and this
         *   pins which was chosen and why.
         */
        expect([...UNSCOPED_ADMIN_ROLES].sort())
            .toEqual(['admin', 'moderator', 'super_admin', 'support']);

        for (const moduleAdmin of ['cooperative_admin', 'wave_admin', 'academy_admin',
            'marketplace_admin', 'export_admin', 'farm_nation_admin']) {
            //   isAdmin would have said yes and deleted the module scoping.
            expect(isAdmin([moduleAdmin])).toBe(true);
            expect(isUnscopedAdmin([moduleAdmin])).toBe(false);
        }

        for (const staff of ['moderator', 'support']) {
            //   isPlatformAdmin would have said no and left the screen empty.
            expect(isPlatformAdmin([staff])).toBe(false);
            expect(isUnscopedAdmin([staff])).toBe(true);
        }

        //   Holding a module role as WELL as an unscoped one is still unscoped.
        expect(isUnscopedAdmin(['admin', 'wave_admin'])).toBe(true);
    });

    it('AND SO CAN THE ROLES THAT ALWAYS COULD', async () => {
        //   The fix must not have moved anybody who was already working.
        const conversation = { participants: ['buyer-1', 'seller-1'] };
        for (const role of ['admin', 'super_admin']) {
            await expect(canOpen(conversation, 'staff-1', [role])).resolves.toBe(true);
        }
    });

    it('BUT A MEMBER WHO IS NOT A PARTICIPANT STILL CANNOT', async () => {
        /*
         *   The half that matters more than the fix. A messaging system where a
         *   stranger can read a thread is a different and much worse defect than
         *   the one being repaired, so this is asserted for every non-admin role
         *   the platform grants.
         */
        const conversation = { participants: ['buyer-1', 'seller-1'] };
        for (const role of [
            'general_user', 'buyer', 'seller', 'cooperative_member',
            'wave_participant', 'investor', 'field_officer',
        ]) {
            expect(isAdmin([role])).toBe(false);                              // premise
            expect({ role, access: await canOpen(conversation, 'stranger', [role]) })
                .toEqual({ role, access: false });
        }
    });

    it('AND A PARTICIPANT STILL CAN, with no role at all', async () => {
        const conversation = { participants: ['buyer-1', 'seller-1'] };
        await expect(canOpen(conversation, 'buyer-1', [])).resolves.toBe(true);
        await expect(canOpen(conversation, 'seller-1', [])).resolves.toBe(true);
    });

    /*
     *   EVERY MODULE ADMIN, NOT ONE. The first version checked marketplace only,
     *   and a mutant that deleted the COOPERATIVE branch survived it — the
     *   module scoping is six separate branches and testing one of them tests
     *   one of them. This file's whole subject is a fix that reached some doors
     *   and not others.
     */
    const MODULE_ADMINS: [string, string][] = [
        ['cooperative_admin', 'cooperative_support'],
        ['marketplace_admin', 'marketplace_support'],
        ['academy_admin', 'academy_support'],
        ['wave_admin', 'wave_support'],
        ['export_admin', 'export_support'],
        ['farm_nation_admin', 'farmnation_support'],
    ];

    it.each(MODULE_ADMINS)('%s REACHES ITS OWN MODULE', async (role, context) => {
        const thread = { participants: ['buyer-1', 'seller-1'], context };
        await expect(canOpen(thread, 'staff-1', [role])).resolves.toBe(true);
    });

    it.each(MODULE_ADMINS)('%s REACHES NO OTHER MODULE', async (role) => {
        //   The regression isAdmin() would have caused, asserted against the
        //   real guard rather than a copy of it.
        for (const [other, otherContext] of MODULE_ADMINS) {
            if (other === role) continue;
            const thread = { participants: ['buyer-1', 'seller-1'], context: otherContext };
            expect({ role, otherContext, access: await canOpen(thread, 'staff-1', [role]) })
                .toEqual({ role, otherContext, access: false });
        }
    });
});

describe('#633 — and the module scoping is untouched', () => {
    it('THE MODULE-ADMIN BRANCHES ARE STILL THERE', () => {
        /*
         *   The way this fix could quietly become a much bigger grant: replacing
         *   the global test with isAdmin() ABOVE the module branches means a
         *   module admin now matches the earlier branch — which is correct,
         *   because isAdmin() is true for them and #356 settled that they are
         *   administrators. What must not happen is the module scoping being
         *   deleted as newly-redundant: it still decides for anyone the platform
         *   later grants a module role WITHOUT admin standing.
         */
        const src = code(SERVICE);
        expect(src).toContain('cooperative_admin');
        expect(src).toContain('marketplace_admin');
        expect(src).toContain('conversation.context');
    });

    it('AND THE READER IS STILL CONSULTED BY BOTH DOORS IT GUARDS', () => {
        //   "The list and the reader agree" is also satisfied by a reader nobody
        //   calls. getMessages and sendMessage must both still ask it.
        const src = code(SERVICE);
        const calls = src.match(/validateConversationAccess\(/g) ?? [];
        //   One definition plus two call sites.
        expect(calls.length).toBeGreaterThanOrEqual(3);
        expect(src).toContain('export async function getMessages');
        expect(src).toContain('export async function sendMessage');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the reader hand-writes the test again              KILLED
 *     THE DEFECT: the list filter hand-writes it again               KILLED
 *     THE REGRESSION: isAdmin, which deletes the module scoping      KILLED
 *     THE OTHER REGRESSION: isPlatformAdmin, which empties the inbox KILLED
 *     the unscoped list stops excluding module admins                KILLED
 *     a stranger can read any conversation                           KILLED
 *     the module branches are deleted as newly redundant             KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   The two REGRESSION mutants are the point of this file. Both are the obvious
 *   fix, and both are defects: isAdmin() hands a cooperative_admin every
 *   conversation on the platform, and isPlatformAdmin() leaves the support inbox
 *   exactly as empty as it was.
 *
 * ── THREE MUTANTS SURVIVED FIRST, AND EACH NAMED A FAULT IN THIS FILE ───────
 *
 *   1. The baseline came back RED and the control came back KILLED, which is the
 *      signature of a void run rather than a thorough one. #356's ratchet had
 *      gone red because messaging/service.ts LEFT its recorded list of narrow
 *      hand-written gates — the ratchet reporting an improvement. Updated
 *      deliberately rather than by shortening an array.
 *
 *   2. "A stranger can read any conversation" and "the module branches are
 *      deleted" both survived, because this file RE-IMPLEMENTED the guard
 *      instead of calling it. Mutating the shipped function could not fail a
 *      copy. That is #612's defect — committed in a helper whose own comment
 *      cited #612. The guard is private, so it is reached through getMessages,
 *      which is the door a user comes through.
 *
 *   3. Then the module mutant survived AGAIN, because the scoping test covered
 *      marketplace and the mutant deleted the cooperative branch. Six branches;
 *      testing one tests one. All six now, in both directions.
 */
