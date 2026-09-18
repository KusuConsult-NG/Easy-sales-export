/**
 * @jest-environment node
 */

/**
 *   #870 THE MESSAGE WENT TO THE WRONG ADMIN, AND NOBODY WAS TOLD IT ARRIVED.
 *
 *   THE OWNER, two reports in one sentence: "messaging is not fixed correctly
 *   because a user tries to message an admin and other admin pops up not the
 *   module admin. Also in-app messages are not delivered meaning they are not
 *   properly wired."
 *
 *   Both measured, both exact.
 *
 * ── 1. NOBODY WAS TOLD ──────────────────────────────────────────────────────
 *
 *   `sendMessage` wrote the message row and updated `lastMessage` /
 *   `lastMessageAt` on the conversation, and stopped. No bell, no email. A
 *   message arrived only if the other party happened to open the Messages
 *   screen and look — so a member writing to support, and an admin answering
 *   them, were both shouting into a room nobody was in.
 *
 *   The same shape this audit found three times in Farm Nation (#862, #863,
 *   #864): a thing happens and the person it happened to is not told.
 *
 * ── 2. AND IT WENT TO WHICHEVER ADMIN THE ROLE ARRAY NAMED FIRST ────────────
 *
 *   The routing in startSupportConversationAction is sound — #752 hardened it,
 *   and it refuses a module the member does not belong to. The defect is one
 *   layer up: MessagesClient called it with NO argument at all.
 *
 *   With no module the action falls back to `memberModules(roles)[0]` — the
 *   first module in the member's ROLE ARRAY, whose order is whatever arrayUnion
 *   happened to produce. A member of two modules reached whichever admin their
 *   roles were written in, and the screen offered no way to say otherwise.
 *
 *   So the fix is not in the routing, which was right. It is that the question
 *   was never asked.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { memberModules } from '@/lib/conversation-scope';
import { MODULE_ADMIN_ROLE } from '@/lib/admin-permissions';
import { DEDICATED_TABLE_MAP, NATIVE_COLUMNS } from '@/lib/supabase-table-map';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));
jest.mock('@/lib/session-guard', () => ({
    requireSession: async () => ({ session: { user: { id: 'a', roles: [] } }, error: null }),
}));

const SERVICE = 'src/infrastructure/messaging/service.ts';
const CLIENT = 'src/app/messages/MessagesClient.tsx';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#870 — a message reaches the person it was sent to, EXECUTED', () => {
    /*
     *   RUN, NOT READ, and the first version of this file is why.
     *
     *   It asserted `src.includes('notifyOtherParticipants(')`. Mutating the
     *   CALL away — leaving the declaration untouched — failed nothing, because
     *   the string was still there in `async function notifyOtherParticipants(`.
     *   A source scan cannot tell a live call from a dead one; the LoanWizard
     *   suite records the same lesson about `if (false)`.
     *
     *   These send a real message through the real service against the fake
     *   store, and look for the notification row.
     */
    let store: FakeDbHandle;

    const seedConversation = () => {
        store.seed(COLLECTIONS.CONVERSATIONS, 'c-1', {
            id: 'c-1',
            participants: ['member-1', 'admin-1'],
            participantDetails: {},
        });
    };

    const send = async (text = 'Is this land still available?') => {
        const svc = await import('@/infrastructure/messaging/service');
        return svc.sendMessage('c-1', 'member-1', 'Ngozi Eze', 'ngozi@e.com', ['farmer'], text);
    };

    const notices = () => store.all(COLLECTIONS.NOTIFICATIONS)
        .map(([, d]) => d as Record<string, any>);

    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        seedConversation();
    });

    it('THE REPORTED GAP: the recipient gets a notification', async () => {
        await send();

        // Was: zero. The message was written and nobody was told it existed.
        expect(notices()).toHaveLength(1);
        expect(notices()[0].userId).toBe('admin-1');
    });

    it('AND THE MESSAGE IS STILL WRITTEN', async () => {
        /*
         *   The half that must not regress while adding the other.
         *
         *   Messages are a SUBCOLLECTION of the conversation, so the store keys
         *   them by path rather than by the bare collection name — measured with
         *   `store.collections()` rather than assumed, after this assertion
         *   first failed against correct code.
         */
        await send();

        const messages = store.all(`${COLLECTIONS.CONVERSATIONS}/c-1/${COLLECTIONS.MESSAGES}`);
        expect(messages).toHaveLength(1);
        expect((messages[0][1] as Record<string, any>).text).toContain('still available');
    });

    it('AND THE SENDER IS NOT NOTIFIED OF THEIR OWN MESSAGE', async () => {
        await send();

        expect(notices().map((n) => n.userId)).not.toContain('member-1');
    });

    it('AND EVERY OTHER PARTICIPANT IS, not just one', async () => {
        /*
         *   A conversation is an ARRAY. Assuming two works today and silently
         *   notifies one of three the moment a thread has more — the shape this
         *   audit keeps finding.
         */
        store.seed(COLLECTIONS.CONVERSATIONS, 'c-1', {
            id: 'c-1',
            participants: ['member-1', 'admin-1', 'admin-2'],
            participantDetails: {},
        });

        await send();

        expect(notices().map((n) => n.userId).sort()).toEqual(['admin-1', 'admin-2']);
    });

    it('AND THE NOTICE CARRIES THE MESSAGE AND WHO SENT IT', async () => {
        await send('Is this land still available?');

        expect(notices()[0].title).toContain('Ngozi Eze');
        expect(notices()[0].message).toContain('still available');
    });

    it('AND IT GOES TO EVERY OTHER PARTICIPANT, not "the other one"', () => {
        /*
         *   A conversation is an ARRAY of participants. Assuming two works today
         *   and silently notifies one of three the moment a thread has more —
         *   which is the shape of defect this audit keeps finding.
         */
        const src = code(SERVICE);
        const at = src.indexOf('async function notifyOtherParticipants');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 400)).toContain('.filter((id) => id && id !== senderId)');
    });

    it('AND NOT TO THE SENDER', () => {
        const src = code(SERVICE);
        const at = src.indexOf('async function notifyOtherParticipants');

        expect(src.slice(at, at + 400)).toContain('id !== senderId');
    });

    it('AND IT CANNOT UNDO THE MESSAGE', () => {
        /*
         *   The message is already written by the time the notice runs. A throw
         *   would turn a DELIVERED message into an error the sender retries,
         *   posting it twice. Same rule as the Farm Nation notifiers, and the
         *   same reason.
         */
        const src = code(SERVICE);
        const at = src.indexOf('async function notifyOtherParticipants');
        const block = src.slice(at, at + 1400);

        expect(block).toContain('Promise.allSettled');
        expect(block).toContain('catch (error)');
    });

    it('AND IT READS THE RESULT rather than assuming it worked', () => {
        //   #394's rule: createNotification RETURNS its failures instead of
        //   throwing them, so an unread result is an invisible one.
        const src = code(SERVICE);
        const at = src.indexOf('async function notifyOtherParticipants');

        expect(src.slice(at, at + 1400)).toContain('if (!result?.success)');
    });

    it('AND THE NOTICE LINKS TO THE CONVERSATION', () => {
        //   A "you have a message" that does not open the message is a second
        //   thing to go and find.
        expect(code(SERVICE)).toContain('/messages?c=${conversationId}');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#870 — and it reaches the admin the member actually wants', () => {
    it('THE REPORTED GAP: the screen says which module', () => {
        /*
         *   It called startSupportConversationAction() with no argument, so the
         *   action fell back to the first module in the role array.
         */
        const src = code(CLIENT);

        expect(src).toContain('startSupportConversationAction(supportModule || undefined)');
    });

    it('AND THE PICKER OFFERS ONLY THE MEMBER\'S OWN MODULES', () => {
        /*
         *   Derived with the SAME function the server scopes admins with, so the
         *   picker can never offer a module the action would then refuse. One
         *   rule, asked on both sides — #752 established that the action must
         *   not trust a caller-supplied module, and this does not ask it to.
         */
        const src = code(CLIENT);

        expect(src).toContain('memberModules(');
        expect(src).toContain('from "@/lib/conversation-scope"');
    });

    it('AND IT IS ONLY SHOWN WHEN THERE IS A CHOICE', () => {
        //   One module needs no question, and a picker with a single option is
        //   furniture.
        expect(code(CLIENT)).toContain('myModules.length > 1 && (');
    });

    it('AND EVERY MODULE A MEMBER CAN HOLD HAS AN ADMIN ROLE TO REACH', () => {
        /*
         *   THE POSITIVE CONTROL, and the thing that actually broke before:
         *   #752's note records that both hand-written copies of the admin list
         *   contained "farmnation_admin", which is not a role — so no farmer
         *   could reach the Farm Nation admin at all.
         *
         *   Executed against the two tables rather than read, so a module added
         *   to one and not the other fails here.
         */
        const everyMemberRole = [
            'wave_participant', 'cooperative_member', 'academy_participant',
            'marketplace_buyer', 'buyer', 'seller', 'export_participant',
            'farmer', 'land_owner', 'investor',
        ];

        for (const role of everyMemberRole) {
            const [module] = memberModules([role]);
            expect({ role, module, admin: MODULE_ADMIN_ROLE[module] })
                .toEqual({ role, module, admin: expect.any(String) });
        }
    });

    it('AND THE PICKER LABELS EVERY MODULE IT CAN SHOW', () => {
        //   A member whose module has no label would be offered a raw key like
        //   "farmnation" in a dropdown.
        const src = code(CLIENT);
        const modules = [...new Set(
            ['wave_participant', 'cooperative_member', 'academy_participant',
             'marketplace_buyer', 'export_participant', 'farmer']
                .flatMap((r) => memberModules([r])))];

        for (const m of modules) {
            expect({ m, labelled: new RegExp(`\\b${m}:`).test(src) }).toEqual({ m, labelled: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#870 — and none of this session\'s new fields needs a migration', () => {
    /*
     *   THE OWNER: "dont forget we will need to update supabase sql so we don't
     *   have errors."
     *
     *   MEASURED RATHER THAN ASSUMED, in both directions, because the answer is
     *   "no migration" and that is exactly the kind of claim that is worth
     *   nothing unless it was checked.
     *
     *   Only the collections in DEDICATED_TABLE_MAP have real SQL tables; every
     *   other collection lives in `document_collections` with a `raw_data`
     *   JSONB blob, so a new field is just a new key. And on the dedicated
     *   tables, only the columns in NATIVE_COLUMNS are real — everything else
     *   goes to raw_data there too.
     *
     *   This block fails if either of those facts stops being true, which is the
     *   only circumstance under which the fields below WOULD need SQL.
     */
    it('THE COLLECTIONS THE NEW FIELDS LIVE IN ARE JSONB-BACKED', () => {
        //   land_listings: inspectionReport (#864), rentPrice (#869),
        //   previousPrice / priceReducedAt (#867).
        //   products: previousPrice / priceReducedAt (#867).
        //   farm_nation_transactions: offerMode (#869).
        //   notifications and conversations: #862, #863, #870.
        for (const collection of [
            'land_listings', 'products', 'farm_nation_transactions',
            'notifications', 'conversations',
        ]) {
            expect({ collection, dedicated: collection in DEDICATED_TABLE_MAP })
                .toEqual({ collection, dedicated: false });
        }
    });

    it('AND THE USER FIELDS ARE NOT NATIVE COLUMNS EITHER', () => {
        //   #865 added nin, bvn and the kyc.* block to the USERS table, which IS
        //   dedicated — so this is the one place the question could have had a
        //   different answer.
        const native = NATIVE_COLUMNS['users'] ?? [];

        for (const field of ['nin', 'bvn', 'ninVerificationMethod', 'bvnVerificationMethod']) {
            expect({ field, native: native.includes(field) }).toEqual({ field, native: false });
        }
    });

    it('AND THE NATIVE COLUMN LIST IS THE ONE THIS CHECK ASSUMES', () => {
        /*
         *   A positive control on the two above. If `users` ever gained typed
         *   columns, "not in the list" would stop meaning "goes to raw_data" —
         *   and this fails rather than letting the reassurance above go stale.
         */
        expect(NATIVE_COLUMNS['users']).toEqual(
            ['id', 'email', 'roles', 'created_at', 'updated_at']);
    });
});
