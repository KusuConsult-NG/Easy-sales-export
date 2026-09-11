/**
 * @jest-environment node
 */

/**
 *   #635 THE ADMIN INBOX LISTED CONVERSATIONS IT WOULD NOT OPEN — AND SOME OF
 *        THEM WERE NOBODY'S BUSINESS.
 *
 *   #633 found `validateConversationAccess` refusing the support agents that
 *   #356 had just let into the list, and repaired the admin test in both. It did
 *   not ask whether the REST of the two copies agreed. They did not.
 *
 *   Each function wrote out six module branches by hand, and the list carried a
 *   seventh that the reader had never had:
 *
 *       if (!c.context) {
 *           const email = (d.email || "").toLowerCase();
 *           if (roles.includes("wave_admin") && email.includes("wave")) return true;
 *           if (roles.includes("cooperative_admin") && email.includes("coop")) return true;
 *           ...
 *       }
 *
 *   described in its own comment as a "fallback for uncategorized legacy support
 *   chats". Two live consequences:
 *
 *     A LIST WHERE NOTHING OPENS. Nothing in this platform passes a `context`
 *     when one member messages another — the two callers pass a participant id
 *     and nothing else — so EVERY direct member-to-member conversation is
 *     contextless and reached this branch. A wave_admin saw them, clicked one,
 *     and `validateConversationAccess`, which has no such branch, refused. #633's
 *     symptom in the branch #633 did not reach.
 *
 *     AND A PRIVATE THREAD LISTED ON A SUBSTRING. The branch matches ANY
 *     participant's address, the member's included. Two members whose emails
 *     happen to contain "wave", "coop", "academy" or "export" had their private
 *     conversation shown to that module's admin — both names and the text of the
 *     last message, which is what the inbox renders under each row. Authority
 *     inferred from a substring in an email address is not a fact about the
 *     conversation, and this one was wrong in the direction that leaks.
 *
 * ── AND THE REFUSAL WAS INVISIBLE ───────────────────────────────────────────
 *
 *   getMessagesAction RESOLVES with `{ error, messages: [] }` — it does not
 *   throw — and the screen read `result.messages` and discarded `result.error`.
 *   So a refused conversation rendered "No messages yet in this conversation",
 *   which reads as "these two have not spoken". #307/#408's class, and the
 *   reason a locked door could sit in that list unnoticed for as long as it did.
 *
 * ── AND ONE MODULE'S SCOPE WAS NOT A SCOPE ──────────────────────────────────
 *
 *   `marketplace_admin` matched `conversation.productId || conversation.orderId`
 *   — ANY order — where all five siblings required their own prefix. Latent
 *   today because no conversation is created with an orderId, and a hole the
 *   moment one is.
 *
 *   Which is also how the prefixes themselves were found to be fiction: the ids
 *   this platform mints are `ORD-`, `POD-` and `EXP-ORD-`, and not one begins
 *   with `coop_`, `academy_`, `wave_`, `farm_` or `export_`. Recorded below
 *   rather than quietly rewritten, because a dead convention that everybody can
 *   see is safer than a live one nobody checked.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
    mayAccessConversation,
    conversationInModuleScope,
    MODULE_CONVERSATION_SCOPES,
} from '@/lib/conversation-scope';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Comment-stripped — a rule quoted in prose is not a rule anybody runs. */
const code = (rel: string) => read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const SERVICE = 'src/infrastructure/messaging/service.ts';
const SCOPE = 'src/lib/conversation-scope.ts';
const SCREEN = 'src/app/admin/messages/page.tsx';

/** A conversation between two members with nothing attached — the common case. */
const direct = (extra: Record<string, unknown> = {}) => ({
    participants: ['member-1', 'member-2'],
    participantDetails: {
        'member-1': { uid: 'member-1', name: 'Ada', email: 'ada.waveney@example.com' },
        'member-2': { uid: 'member-2', name: 'Bem', email: 'bem@example.com' },
    },
    ...extra,
}) as any;

const MODULE_ADMINS: Array<[string, string]> = [
    ['cooperative_admin', 'cooperative_support'],
    ['marketplace_admin', 'marketplace_support'],
    ['academy_admin', 'academy_support'],
    ['wave_admin', 'wave_support'],
    ['export_admin', 'export_support'],
    ['farm_nation_admin', 'farmnation_support'],
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#635 — the list and the reader cannot disagree, because they are one call', () => {
    it('BOTH DOORS ASK THE SAME FUNCTION', () => {
        const src = code(SERVICE);
        expect(src).toContain('return mayAccessConversation(conversation, userId, roles);');
        expect(src).toContain('filter(c => mayAccessConversation(c, userId, roles))');

        //   And the service keeps no second copy of the rule. Named roles are
        //   the tell: if any appear here again, the branches have been rewritten
        //   beside the call.
        for (const [role] of MODULE_ADMINS) expect(src).not.toContain(role);
        expect(src).not.toContain('isUnscopedAdmin');
    });

    it('AND THE LIST STILL TAKES THE CALLER, not only their roles', () => {
        /*
         *   Part of the repair rather than a detail. The list used to be
         *   filtered on roles alone, so a conversation the admin is personally a
         *   participant of could be absent from the inbox while being perfectly
         *   openable — the same disagreement, pointing the other way.
         */
        expect(code(SERVICE)).toContain('getAllConversationsAdmin(userId: string, roles: string[])');
        expect(code('src/app/actions/messages.ts'))
            .toMatch(/getAllConversationsAdmin\(\s*session\.user\.id,/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#635 — a private thread is not a module admin\'s to read', () => {
    it('AN EMAIL ADDRESS NO LONGER GRANTS ANYTHING', () => {
        /*
         *   The leak, stated as the thing it was. "ada.waveney@example.com"
         *   contains "wave"; that is a fact about a string, not about a
         *   conversation, and it used to put a private thread in front of the
         *   WAVE administrator.
         */
        expect(mayAccessConversation(direct(), 'wave-staff', ['wave_admin'])).toBe(false);

        //   The other three keywords the branch tested, each against an address
        //   that contains it.
        const cases: Array<[string, string]> = [
            ['cooperative_admin', 'coop.adeyemi@example.com'],
            ['academy_admin', 'academy.jones@example.com'],
            ['export_admin', 'exporter.nnamdi@example.com'],
        ];
        for (const [role, email] of cases) {
            const conversation = direct({
                participantDetails: { 'member-1': { uid: 'member-1', name: 'X', email } },
            });
            expect({ role, email, access: mayAccessConversation(conversation, 'staff', [role]) })
                .toEqual({ role, email, access: false });
        }
    });

    it('AND THE FALLBACK IS GONE FROM THE SOURCE, not merely unreachable', () => {
        //   A branch left in place and bypassed is a branch somebody re-enables.
        const service = code(SERVICE);
        const scope = code(SCOPE);
        for (const src of [service, scope]) {
            expect(src).not.toMatch(/email\.includes\(/);
            expect(src).not.toMatch(/participantDetails \|\| \{\}/);
        }
    });

    it('AND THE PEOPLE WHOSE JOB THOSE CHATS ARE STILL SEE THEM', () => {
        /*
         *   The other half. Removing the fallback would be a regression if the
         *   uncategorised legacy support chats it was written for became
         *   unreachable — they do not: an unscoped admin sees every conversation
         *   whatever its context, which is the whole point of #356 and #633.
         */
        for (const role of ['admin', 'super_admin', 'moderator', 'support']) {
            expect({ role, access: mayAccessConversation(direct(), 'staff', [role]) })
                .toEqual({ role, access: true });
        }
    });

    it('AND A PARTICIPANT STILL READS THEIR OWN THREAD, with no role at all', () => {
        expect(mayAccessConversation(direct(), 'member-1', [])).toBe(true);
        expect(mayAccessConversation(direct(), 'member-2', undefined)).toBe(true);
        expect(mayAccessConversation(direct(), 'stranger', [])).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#635 — module scoping, preserved and closed', () => {
    it.each(MODULE_ADMINS)('%s REACHES ITS OWN CONTEXT AND NO OTHER', (role, context) => {
        expect(mayAccessConversation(direct({ context }), 'staff', [role])).toBe(true);
        for (const [, otherContext] of MODULE_ADMINS) {
            if (otherContext === context) continue;
            expect({ role, otherContext, access: mayAccessConversation(direct({ context: otherContext }), 'staff', [role]) })
                .toEqual({ role, otherContext, access: false });
        }
    });

    it('MARKETPLACE NO LONGER MATCHES EVERY ORDER THERE IS', () => {
        /*
         *   The hole. `productId || orderId` admitted the cooperative's,
         *   the academy's and Farm Nation's order threads to the marketplace
         *   administrator the moment any conversation carried an orderId.
         */
        for (const orderId of ['coop_88', 'academy_12', 'wave_3', 'farm_7', 'EXP-ORD-99']) {
            expect({ orderId, access: mayAccessConversation(direct({ orderId }), 'staff', ['marketplace_admin']) })
                .toEqual({ orderId, access: false });
        }

        //   And it still reaches its own: a product thread, and the two order id
        //   shapes the marketplace actually mints.
        expect(mayAccessConversation(direct({ productId: 'p-1' }), 'staff', ['marketplace_admin'])).toBe(true);
        expect(mayAccessConversation(direct({ orderId: 'ORD-1730000000-abc' }), 'staff', ['marketplace_admin'])).toBe(true);
        expect(mayAccessConversation(direct({ orderId: 'POD-1730000000-abc' }), 'staff', ['marketplace_admin'])).toBe(true);
    });

    it('AND A PRODUCT THREAD BELONGS TO THE MARKETPLACE ALONE', () => {
        //   `ownsProducts` is one flag on one row; asserted so it cannot spread.
        const owners = MODULE_CONVERSATION_SCOPES.filter((s) => s.ownsProducts).map((s) => s.role);
        expect(owners).toEqual(['marketplace_admin']);

        for (const [role] of MODULE_ADMINS) {
            if (role === 'marketplace_admin') continue;
            expect({ role, access: conversationInModuleScope({ productId: 'p-1' } as any, [role]) })
                .toEqual({ role, access: false });
        }
    });

    it('AND AN EXPORT ORDER GOES TO THE EXPORT ADMIN, not the marketplace one', () => {
        //   `EXP-ORD-` does not begin with `ORD-`, and the table depends on that.
        expect(mayAccessConversation(direct({ orderId: 'EXP-ORD-1' }), 'staff', ['export_admin'])).toBe(true);
        expect('EXP-ORD-1'.startsWith('ORD-')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#635 — the order-id convention is fiction, and says so', () => {
    it('NO ID THIS PLATFORM MINTS MATCHES THE `module_` PREFIXES', () => {
        /*
         *   Read out of the code that mints them rather than retyped, so this
         *   cannot drift into describing an old format. If somebody starts
         *   issuing `coop_…` order ids, this fails — which is the moment to
         *   notice that six branches have come alive.
         */
        const minted = [
            ...[...code('src/app/actions/marketplace/_payment_orders.ts')
                .matchAll(/const orderId = `([A-Z-]+)\$\{/g)].map((m) => m[1]),
            ...[...code('src/app/actions/export-payment.ts')
                .matchAll(/const orderId = `([A-Z-]+)\$\{/g)].map((m) => m[1]),
        ];
        //   Deduplicated: checkout mints `ORD-` at two call sites, and this is
        //   a question about FORMATS, not about how many places issue one.
        expect([...new Set(minted)].sort()).toEqual(['EXP-ORD-', 'ORD-', 'POD-']);
        expect(minted.length).toBeGreaterThanOrEqual(4);

        const aspirational = MODULE_CONVERSATION_SCOPES
            .flatMap((s) => s.orderIdPrefixes)
            .filter((p) => p.endsWith('_'));
        expect(aspirational.length).toBeGreaterThanOrEqual(5);
        for (const prefix of aspirational) {
            expect({ prefix, matchesSomethingReal: minted.some((id) => id.startsWith(prefix)) })
                .toEqual({ prefix, matchesSomethingReal: false });
        }
    });

    it('AND NOTHING ATTACHES AN ORDER ID TO A CONVERSATION TODAY', () => {
        //   The reason the whole prefix table is latent. Both callers pass a
        //   participant and, at most, a context.
        const service = code(SERVICE);
        expect(service).toContain('if (orderId) conversationData.orderId = orderId;');

        const callers = ['src/app/cooperatives/(member)/directory/CooperativeDirectoryClient.tsx',
            'src/app/messages/MessagesClient.tsx'];
        for (const caller of callers) {
            const calls = [...code(caller).matchAll(/startConversationAction\(([^)]*)\)/g)].map((m) => m[1]);
            expect(calls.length).toBeGreaterThan(0);
            for (const args of calls) {
                expect({ caller, args, arity: args.split(',').length }).toEqual({ caller, args, arity: 1 });
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#635 — a thread that cannot be read does not say "no messages yet"', () => {
    it('THE SCREEN READS THE ERROR IT WAS THROWING AWAY', () => {
        const src = code(SCREEN);
        expect(src).toContain('if (result.error) {');
        expect(src).toContain('setThreadError(result.error);');
        expect(src).toContain('We could not open this conversation');
        //   …and the genuine empty state is still there for the case that is
        //   really empty, which is the distinction #307/#408 is about.
        expect(src).toContain('No messages yet in this conversation');
    });

    it('AND THE ERROR IS CLEARED, so one refusal does not stick to every thread', () => {
        const src = code(SCREEN);
        expect(src).toContain('setThreadError(null);');
        //   Cleared on a successful poll AND when the selection is dropped.
        expect((src.match(/setThreadError\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the email-keyword fallback comes back              KILLED
 *     THE DEFECT: marketplace matches any orderId again              KILLED
 *     THE DEFECT: the screen drops the error again                   KILLED
 *     the list filters on roles and forgets the caller               KILLED
 *     a module admin reaches another module's context                KILLED
 *     the scope table gives products to a second module              KILLED
 *     a stranger can open a thread                                   KILLED
 *     an unscoped admin is refused a contextless thread              KILLED
 *     export's real prefix is dropped from the table                 KILLED
 *     the service keeps its own copy of the module branches          KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   The last two are the ones that matter most for a consolidation like this.
 *   "A stranger can open a thread" guards the direction in which a refactor of
 *   an authorisation rule goes catastrophically wrong rather than merely wrong.
 *   "The service keeps its own copy" guards the direction this finding is
 *   about: a second copy added back beside the call would pass every
 *   behavioural test here — it only ever ADMITS more — and is exactly how the
 *   two copies came to exist in the first place.
 *
 * ── A STALE TEST DOUBLE WAS FOUND BY THE SAME CHANGE ────────────────────────
 *
 *   message-user-search's stub for getAllConversationsAdmin spelled out
 *
 *       r === 'admin' || r === 'super_admin' || r.endsWith('_admin')
 *
 *   which is the exact test #356 and #633 removed from the real service. It had
 *   gone on passing because a double that keeps its own copy of the thing under
 *   test never disagrees with itself — #612's shape, in a mock. It asks
 *   isAdmin() now.
 */
