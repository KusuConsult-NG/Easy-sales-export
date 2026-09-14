/**
 * @jest-environment node
 */

/**
 *   #752 EVERY MODULE'S ADMIN APPEARED IN EVERY MODULE, BECAUSE THE PICKER'S
 *        DEFAULT LIST HAD NO SCOPING AND THE SEARCH SCOPED ON AN EMAIL ADDRESS.
 *
 *   Reported by the owner: "users are only supposed to message the admin on
 *   that module or super admin but other modules admin are also appearing in a
 *   different module why?"
 *
 *   The rule they describe is the right one and was implemented three times in
 *   actions/messages.ts, with three different answers:
 *
 *     searchUsersAction, EMPTY QUERY   returned EVERY admin, filtered only for
 *                                      "not me". This is what a member sees
 *                                      the moment they open Messages, before
 *                                      typing — so the scoping in the other
 *                                      branch was bypassed by doing nothing.
 *                                      THIS IS THE REPORTED SYMPTOM.
 *
 *     searchUsersAction, WITH A QUERY  decided from the admin's EMAIL:
 *                                          isGlobal = email.includes("super")
 *                                          matchesModule = keywords
 *                                              .some(k => email.includes(k))
 *
 *     startSupportConversationAction   matched the module's ROLE, then
 *                                      `|| email.includes(targetModule)`
 *                                      beside it — so the substring decided
 *                                      whenever the role did not.
 *
 *   #635 had already removed exactly this test from the admin INBOX, and wrote
 *   down why: "It infers authority from a substring in an address, which is not
 *   a fact about the conversation." The same sentence applies to a person, and
 *   this is the copy that decides who a member may WRITE to. The eighth
 *   appearance in this audit of one rule fixed in some of the places it names.
 *
 *   What the address form costs, in both directions:
 *
 *     - grace@easysalesexport.com holding cooperative_admin — an ordinary shape
 *       for a real person — matched no keyword and was invisible to EVERY
 *       member, including the cooperative members whose admin she is;
 *     - any address containing the five letters "super" was treated as a
 *       platform-wide admin and shown to everybody.
 *
 * ── AND TWO MORE ON THE SAME PATH, FOUND WHILE FIXING IT ────────────────────
 *
 *   startSupportConversationAction takes `module` as a PARAMETER. It is a
 *   server action, so any browser can send any string, and an unrecognised one
 *   was not rejected but PROMOTED to the front of the caller's module list:
 *
 *       if (module && !userModuleKeywords.includes(module)) {
 *           userModuleKeywords.unshift(module);
 *       }
 *
 *   So a cooperative member calling this with "wave" was routed to the wave
 *   admin — the rule inverted, by the caller, on request.
 *
 *   And the CONTEXT the thread is stamped with read the same raw parameter.
 *   #635's MODULE_CONVERSATION_SCOPES routes the admin inbox by exactly that
 *   context, so fixing only the recipient would have moved the leak one field
 *   across: the thread would reach the right admin AND still be listed, with
 *   its message text, in the wrong module's inbox.
 *
 *   Last: the final fallback was `adminDocs[0]` — whichever row the database
 *   returned first, which on this platform is very likely some other module's
 *   admin.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { adminIsReachableBy, memberModules } from '@/lib/conversation-scope';

const CALLER = 'caller-1';

/**
 * The admin directory, chosen to make the email test and the role test
 * DISAGREE — which is the whole finding. Under the old code the first two are
 * invisible to everybody and the last two are visible to everybody.
 */
const ADMINS = [
    //   A real module admin whose address carries no module word. Invisible to
    //   her own members under the email test.
    { id: 'a-coop', email: 'grace@easysalesexport.com', roles: ['cooperative_admin'], raw_data: {} },
    //   A genuine platform admin whose address says nothing either.
    { id: 'a-super', email: 'ceo@easysalesexport.com', roles: ['super_admin'], raw_data: {} },
    //   A WAVE admin whose address contains "super". Visible to everybody under
    //   the email test, and administers nothing a cooperative member does.
    { id: 'a-wave', email: 'supervisor.wave@easysalesexport.com', roles: ['wave_admin'], raw_data: {} },
    //   An academy admin, plainly named. The reported symptom: a cooperative
    //   member should never see this person in their picker.
    { id: 'a-academy', email: 'academy@easysalesexport.com', roles: ['academy_admin'], raw_data: {} },
    //   Support: unscoped, serves everybody, and is neither "super" nor a
    //   module keyword.
    { id: 'a-support', email: 'help@easysalesexport.com', roles: ['support'], raw_data: {} },
];

jest.mock('@/lib/supabase', () => ({
    supabase: {},
    supabaseAdmin: {
        from: () => ({
            select: () => ({
                overlaps: async () => ({
                    data: (globalThis as any).__admins,
                    error: null,
                }),
            }),
        }),
    },
}));

const startConversation = jest.fn(
    async (..._a: unknown[]) => ({ conversationId: 'c1', error: null }));

jest.mock('@/infrastructure/messaging/service', () => ({
    getConversations: jest.fn(async () => []),
    getAllConversationsAdmin: jest.fn(async () => []),
    getMessages: jest.fn(async () => []),
    sendMessage: jest.fn(async () => ({ id: 'm1' })),
    markAsRead: jest.fn(async () => undefined),
    startConversation: (...a: unknown[]) => startConversation(...a),
    createSupportConversation: jest.fn(async () => ({ id: 'c1' })),
}));

function setCaller(roles: string[]) {
    (globalThis as any).__admins = ADMINS;
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: CALLER, email: `${CALLER}@e.com`, name: CALLER, roles } },
        error: null,
    }));
    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        if (idOrCollection === CALLER) {
            return Promise.resolve({ exists: true, empty: false, docs: [], data: () => ({ roles }) });
        }
        /*
         *   The three user queries the search runs. Read from `__admins`, NOT
         *   from the ADMINS constant — a first draft hardcoded the constant, so
         *   a test that installed a different roster changed only the
         *   empty-query branch and the search branch went on seeing the full
         *   five. The lockout tests then disagreed between branches for a
         *   reason that was entirely the harness.
         */
        const roster = (globalThis as any).__admins as typeof ADMINS;
        return Promise.resolve({
            exists: false, empty: false,
            docs: roster.map((a) => ({
                id: a.id,
                data: () => ({ fullName: a.email.split('@')[0], email: a.email, roles: a.roles }),
            })),
            data: () => ({}),
        });
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: false, empty: true, docs: [], data: () => ({}),
    }));
}

const search = async (q: string) =>
    (await import('@/app/actions/messages')).searchUsersAction(q) as any;

const startSupport = async (module?: string) =>
    (await import('@/app/actions/messages')).startSupportConversationAction(module) as any;

/** Who the picker offered, by id. */
const offered = (r: any) => (r.users as any[]).map((u) => u.uid).sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('#752 — the rule itself, asked of the role', () => {
    it('AN UNSCOPED ADMIN IS REACHABLE BY EVERYBODY', () => {
        //   admin, super_admin, moderator, support — #633's set, derived from
        //   the matrix rather than written out.
        for (const role of ['admin', 'super_admin', 'moderator', 'support']) {
            expect({ role, reachable: adminIsReachableBy([role], ['cooperative_member']) })
                .toEqual({ role, reachable: true });
        }
    });

    it('AND A MODULE ADMIN ONLY BY THAT MODULE\'S MEMBERS', () => {
        expect(adminIsReachableBy(['cooperative_admin'], ['cooperative_member'])).toBe(true);
        //   THE reported symptom, as one assertion.
        expect(adminIsReachableBy(['wave_admin'], ['cooperative_member'])).toBe(false);
        expect(adminIsReachableBy(['academy_admin'], ['cooperative_member'])).toBe(false);
        expect(adminIsReachableBy(['marketplace_admin'], ['cooperative_member'])).toBe(false);
    });

    it('AND THE ADDRESS DECIDES NOTHING, IN EITHER DIRECTION', () => {
        //   The two cases the old email test got backwards. Neither function
        //   below is given an address at all, which is the point.
        expect(adminIsReachableBy(['wave_admin'], ['wave_participant'])).toBe(true);
        expect(adminIsReachableBy(['wave_admin'], ['farmer'])).toBe(false);
    });

    it('a member of several modules reaches each of their admins', () => {
        const roles = ['cooperative_member', 'seller'];

        expect(adminIsReachableBy(['cooperative_admin'], roles)).toBe(true);
        expect(adminIsReachableBy(['marketplace_admin'], roles)).toBe(true);
        expect(adminIsReachableBy(['wave_admin'], roles)).toBe(false);
    });

    it('and a member of none reaches only the unscoped admins', () => {
        expect(memberModules(['general_user'])).toEqual([]);
        expect(adminIsReachableBy(['cooperative_admin'], ['general_user'])).toBe(false);
        expect(adminIsReachableBy(['support'], ['general_user'])).toBe(true);
    });

    it('the module map covers every module admin role, so none is unreachable', () => {
        /*
         *   Vacuity guard with teeth: a module admin absent from ROLE_MODULE's
         *   values can be reached by nobody at all, which is #635's Farm Nation
         *   symptom — an admin who matched no filter and saw an empty list.
         */
        const { MODULE_ADMIN_ROLE } = jest.requireActual(
            '@/lib/admin-permissions') as typeof import('@/lib/admin-permissions');
        const { ROLE_MODULE } = jest.requireActual(
            '@/lib/conversation-scope') as typeof import('@/lib/conversation-scope');

        const modulesWithMembers = new Set(Object.values(ROLE_MODULE));
        const unreachable = Object.entries(MODULE_ADMIN_ROLE)
            .filter(([m]) => !modulesWithMembers.has(m))
            .map(([, role]) => role);

        expect(unreachable).toEqual([]);
        expect(Object.keys(MODULE_ADMIN_ROLE)).toHaveLength(6);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#752 — the picker a member actually sees', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setCaller(['cooperative_member']);
    });

    it('THE DEFAULT LIST NO LONGER OFFERS EVERY MODULE\'S ADMIN', async () => {
        /*
         *   THE reported defect. An empty query is what Messages opens with,
         *   and it returned all five of these rows to a cooperative member.
         *   Their own admin, the platform admin and support — not wave, not
         *   academy.
         */
        expect(offered(await search(''))).toEqual(['a-coop', 'a-super', 'a-support']);
    });

    it('AND THE SEARCH BRANCH AGREES WITH IT', async () => {
        /*
         *   The two branches gave different answers, which is how the empty one
         *   went unnoticed. `easysalesexport` matches every address in the
         *   directory, so this asks the same question of the same five people.
         */
        expect(offered(await search('easysalesexport')))
            .toEqual(['a-coop', 'a-super', 'a-support']);
    });

    it('AND THE ADMIN WITH NO MODULE WORD IN HER ADDRESS IS FOUND AT LAST', async () => {
        /*
         *   grace@easysalesexport.com holds cooperative_admin. Under the email
         *   test she matched neither `includes("super")` nor
         *   `includes("cooperative")`, so the members whose admin she is could
         *   not see her in either branch — the defect that hides support rather
         *   than leaking it, and the one nobody reports as a security bug.
         */
        expect(offered(await search('grace'))).toEqual(['a-coop']);
    });

    it('AND THE WAVE ADMIN WHOSE ADDRESS SAYS "super" IS NOT A PLATFORM ADMIN', async () => {
        //   `email.includes("super")` promoted supervisor.wave@... to
        //   platform-wide reachability. They administer WAVE.
        expect(offered(await search('supervisor'))).toEqual([]);
        //   And to their own members, they are reachable.
        setCaller(['wave_participant']);
        expect(offered(await search('supervisor'))).toEqual(['a-wave']);
    });

    it('a wave member gets the wave admin and not the cooperative one', async () => {
        setCaller(['wave_participant']);

        expect(offered(await search(''))).toEqual(['a-super', 'a-support', 'a-wave']);
    });

    it('AND AN ADMIN CALLER STILL SEES EVERY ADMIN', async () => {
        /*
         *   Deliberately unscoped, and the vacuity guard that matters: module
         *   admins have to be able to hand a case to one another, so a fix that
         *   scoped the admins' own directory would break the support workflow
         *   while passing every test above.
         */
        setCaller(['marketplace_admin']);

        //   BOTH BRANCHES. A first draft asserted only the empty-query one, and
        //   the mutant that scoped the SEARCH branch's admin caller survived —
        //   the two branches carry the bypass separately, which is how they
        //   came apart in the first place. `marketplace_admin` is not a
        //   participant role, so a scoped admin would see only the two
        //   unscoped rows here rather than all five.
        expect(offered(await search(''))).toHaveLength(5);
        expect(offered(await search('easysalesexport'))).toHaveLength(5);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#752 — and the scoping never leaves a member with nobody', () => {
    /**
     *   THE REGRESSION THIS FIX NEARLY SHIPPED, found by checking the fix
     *   rather than the defect.
     *
     *   Every new account is created with `roles: ["general_user"]` and nothing
     *   else — auth.ts, lib/auth.ts, session-guard.ts and orphaned-user-repair
     *   .ts all four write exactly that — and `general_user` belongs to no
     *   module. So scoping alone leaves such a member with only the UNSCOPED
     *   admins, and on a platform staffed entirely by module admins, with an
     *   EMPTY PICKER and no way to reach support at all.
     *
     *   That is worse than the defect being fixed. A member shown the wrong
     *   admin can still get help; a member shown nobody cannot. The owner's own
     *   figures say how many accounts this shape describes: 19,978 of them,
     *   46.9%, carrying no application, bank details or address.
     *
     *   My first suite missed it because every directory I wrote seeded an
     *   unscoped admin — the instrument was built around the happy case, which
     *   is the failure mode this audit keeps finding in other people's tests.
     */
    beforeEach(() => {
        jest.clearAllMocks();
        setCaller(['general_user']);
        //   A platform whose entire admin roster is module admins.
        (globalThis as any).__admins = [
            { id: 'a-coop', email: 'grace@easysalesexport.com', roles: ['cooperative_admin'], raw_data: {} },
            { id: 'a-wave', email: 'wave@easysalesexport.com', roles: ['wave_admin'], raw_data: {} },
        ];
    });

    it('A MEMBER WITH NO MODULE STILL SEES ADMINS RATHER THAN AN EMPTY LIST', async () => {
        expect(offered(await search(''))).toEqual(['a-coop', 'a-wave']);
    });

    it('AND THE SEARCH BRANCH DOES THE SAME', async () => {
        //   The guard is computed per branch, so it has to be asserted per
        //   branch — the two branches coming apart is this finding's own shape.
        expect(offered(await search('easysalesexport'))).toEqual(['a-coop', 'a-wave']);
    });

    it('AND THE SUPPORT ROUTER STILL FINDS SOMEBODY', async () => {
        /*
         *   My first version of this fix returned "No admin available" here,
         *   having replaced `adminDocs[0]` with an unscoped-only lookup. The
         *   defect in `adminDocs[0]` was its POSITION — first after the module
         *   lookup, so an arbitrary row beat a platform admin — not its
         *   existence. It is last now.
         */
        const r = await startSupport();

        expect(r.conversationId).toBeTruthy();
        expect(r.error).toBeNull();
    });

    it('but a member WITH a module is still scoped, which is the finding', async () => {
        //   The vacuity guard that matters most: a lockout guard that always
        //   fired would undo the whole fix and pass every test above.
        setCaller(['cooperative_member']);
        //   setCaller restores the FULL directory, so the module-only roster
        //   has to be re-installed after it.
        (globalThis as any).__admins = [
            { id: 'a-coop', email: 'grace@easysalesexport.com', roles: ['cooperative_admin'], raw_data: {} },
            { id: 'a-wave', email: 'wave@easysalesexport.com', roles: ['wave_admin'], raw_data: {} },
        ];

        expect(offered(await search(''))).toEqual(['a-coop']);
        expect(offered(await search('easysalesexport'))).toEqual(['a-coop']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#752 — and the support router cannot be pointed at another module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setCaller(['cooperative_member']);
        startConversation.mockClear();
    });

    /*
     *   messagingService.startConversation takes the CALLER first:
     *   (callerId, callerName, callerEmail, participantUid, productId,
     *   orderId, context). A first draft read index 0 as the recipient and
     *   index 3 as the context, and got 'caller-1' and a uid back — the
     *   assertions failed loudly rather than passing on the wrong field, which
     *   is the only reason to prefer positional reads over a spy on the action.
     */
    const RECIPIENT = 3;
    const CONTEXT = 6;
    const routed = () => startConversation.mock.calls[0] as unknown[];

    it('A MODULE THE CALLER DOES NOT BELONG TO IS IGNORED, NOT PROMOTED', async () => {
        /*
         *   THE test for the parameter. A cooperative member asking for "wave"
         *   used to have "wave" unshifted to the front of their own module list
         *   and be routed to the wave admin.
         */
        await startSupport('wave');

        expect(routed()[RECIPIENT]).toBe('a-coop');
    });

    it('AND THE THREAD IS NOT STAMPED WITH THAT MODULE EITHER', async () => {
        /*
         *   The same leak through the other door. #635 routes the admin INBOX
         *   by context, so `wave_support` would have listed this thread — names
         *   and last message — to the wave admin regardless of who received it.
         */
        await startSupport('wave');

        expect(routed()[CONTEXT]).toBe('general_support');
        expect(routed()[CONTEXT]).not.toContain('wave');
    });

    it('and a module the caller DOES belong to is still honoured', async () => {
        //   Vacuity guard. The parameter exists because the screen knows which
        //   of a member's own modules they are asking about.
        setCaller(['cooperative_member', 'seller']);
        await startSupport('marketplace');

        expect(routed()[CONTEXT]).toBe('marketplace_support');
    });

    it('AND WITH NO MODULE ADMIN THE FALLBACK IS AN UNSCOPED ADMIN, NOT ROW ZERO', async () => {
        /*
         *   The last resort was `adminDocs[0]`. Here row zero is the academy
         *   admin, who administers nothing this member does and — under #635 —
         *   may not even be able to open the thread they were just sent.
         */
        (globalThis as any).__admins = [
            { id: 'a-academy', email: 'academy@easysalesexport.com', roles: ['academy_admin'], raw_data: {} },
            { id: 'a-support', email: 'help@easysalesexport.com', roles: ['support'], raw_data: {} },
        ];

        await startSupport();

        expect(routed()[RECIPIENT]).toBe('a-support');
    });

    it('and when there is genuinely NO ADMIN AT ALL, it says so', async () => {
        /*
         *   A CORRECTION TO MY OWN FIRST DRAFT, which seeded a lone
         *   academy_admin and expected a refusal. That asserted the regression
         *   described in the lockout section above: an admin existed, and
         *   refusing to route a member's support request to them makes support
         *   unreachable rather than correctly scoped.
         *
         *   The refusal belongs to the one case that really has nobody.
         */
        (globalThis as any).__admins = [];

        const r = await startSupport();

        expect(r.conversationId).toBeNull();
        expect(String(r.error)).toMatch(/no admin available/i);
        expect(startConversation).not.toHaveBeenCalled();
    });

    it('and a lone module admin IS used rather than refused', async () => {
        //   The other side of that correction, asserted so the refusal above
        //   cannot quietly widen again.
        (globalThis as any).__admins = [
            { id: 'a-academy', email: 'academy@easysalesexport.com', roles: ['academy_admin'], raw_data: {} },
        ];

        expect((await startSupport()).conversationId).toBeTruthy();
        expect(routed()[RECIPIENT]).toBe('a-academy');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#752 — and the rule is written down once', () => {
    const MESSAGES = 'src/app/actions/messages.ts';

    it('NO COPY OF THE EMAIL-SUBSTRING TEST SURVIVES', () => {
        const { readFileSync } = require('fs');
        const { stripComments } = require('@/lib/testing/strip-comments');
        const src = stripComments(readFileSync(MESSAGES, 'utf-8'), { label: MESSAGES });

        expect(src).not.toContain('email.includes("super")');
        expect(src).not.toContain('email.includes(targetModule)');
        expect(src).not.toMatch(/keyword\s*=>\s*email\.includes\(keyword\)/);
    });

    it('AND THE ROLE-TO-MODULE MAP IS NOT WRITTEN TWICE ANY MORE', () => {
        const { readFileSync } = require('fs');
        const src = readFileSync(MESSAGES, 'utf-8');

        //   It was declared in full inside BOTH functions. One copy now, in
        //   conversation-scope, where MODULE_ADMIN_ROLE already lives.
        expect(src.split('cooperative_member: "cooperative"').length - 1).toBe(0);
        expect(src).toContain('memberModules');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *     MUTANT                                                        RESULT
 *     the empty-query branch drops its scoping filter                KILLED
 *     the empty-query lockout guard always fires                     KILLED
 *     the search-branch lockout guard always fires                   KILLED
 *     the search-branch lockout guard never fires                    KILLED
 *     the support router errors instead of falling back to any admin KILLED
 *     the search branch admits every admin                           KILLED
 *     adminIsReachableBy treats a module admin as unscoped           KILLED
 *     adminIsReachableBy ignores the member's modules                KILLED
 *     the caller-supplied module is trusted again                    KILLED
 *     the context tag reads the raw parameter again                  KILLED
 *     the unscoped lookup is skipped, leaving row zero               KILLED
 *     an admin caller is scoped like a member                        KILLED †
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   † SURVIVED ON THE FIRST PASS. The admin-caller bypass is written TWICE —
 *     once per branch — and the test exercised only the empty-query one, so
 *     scoping the search branch's admin caller changed nothing it could see.
 *     That the bypass is duplicated at all is this finding's own shape in
 *     miniature. The assertion now asks both branches.
 *
 *   THE FIRST SWEEP RAN AGAINST A FIX THAT WAS WRONG, and is recorded rather
 *   than tidied away. Eight mutants were killed against a version with no
 *   lockout guard — the version that would have left a general_user-only
 *   member with an empty picker. Mutation testing measures whether the tests
 *   pin the code; it cannot tell you the code is the right code. The four
 *   guard mutants above exist because checking the FIX, not the defect, found
 *   what the sweep could not.
 */
