/**
 * @jest-environment node
 */

/**
 *   #503 "SIGNED OUT" AND "SIGNED IN WITH NO EMAIL" WERE THE SAME ANSWER, AND
 *        ONLY ONE OF THEM IS A PREVIEW.
 *
 *   An invite waives the ₦10,000 cooperative registration fee —
 *   `paymentStatus: "completed"` is set from the presence of a token alone —
 *   so lib/cooperative-invite.ts binds it to the address it was issued to, and
 *   says plainly why it fails closed:
 *
 *       "A false refusal costs one invited member a support conversation; a
 *        false acceptance gives a membership away to whoever forwarded the
 *        link."
 *
 *   The binding is skipped for one case on purpose:
 *
 *       if (callerEmail !== undefined && callerEmail !== null) { …bind… }
 *
 *   `undefined` means "nobody is signed in — this is the onboarding page
 *   previewing a link", and a preview grants nothing, so it is deliberately
 *   more permissive.
 *
 *   BUT THE ACTION PRODUCED THAT SAME `undefined` TWO WAYS:
 *
 *       const callerEmail = previewSession.session?.user?.email ?? undefined;
 *
 *   No session — the intended preview. And a REAL session whose user carries no
 *   email, which is not a preview at all: it is the redemption path, on which
 *   the waiver is actually granted. That caller skipped the binding entirely and
 *   could redeem an invitation issued to somebody else.
 *
 *   A SESSION CAN LACK ONE. auth.config.ts:112 assigns `session.user.email =
 *   token.email`, and token.email comes from the profile — 2,593 of which #495
 *   measured as blank. Whether one of those can currently hold a session is a
 *   question I have NOT answered, and the binding should not depend on the
 *   answer. That is what failing closed means.
 *
 *   THE TWO CASES ARE TOLD APART BY THE SESSION NOW, NOT BY THE EMAIL. Signed
 *   out stays `undefined` and previews. Signed in with no email becomes `""`,
 *   which never matches a recorded invited address and refuses.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the derivation reverted to `?? undefined`      KILLED
 *     the empty string turned back into undefined    KILLED
 *     the signed-out preview made to bind too        KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { INVITE_WRONG_ACCOUNT_MESSAGE } from '@/lib/cooperative-invite';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;

const TOKEN = 'invite-token-1';
const INVITES = COLLECTIONS.COOPERATIVES_INVITES;

/** Session shapes, including the one the old derivation could not tell apart. */
function signedOut(): void {
    (globalThis as any).mockRequireSession.mockImplementation(() =>
        Promise.resolve({ session: null, error: { error: 'Not authenticated' } }));
}

function signedInAs(email: string | undefined): void {
    (globalThis as any).mockRequireSession.mockImplementation(() =>
        Promise.resolve({
            session: { user: { id: 'user-1', roles: ['general_user'], ...(email === undefined ? {} : { email }) } },
            error: null,
        }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(INVITES, TOKEN, {
        status: 'pending',
        email: 'invited@example.com',
        createdAt: new Date().toISOString(),
        invitedBy: 'admin-1',
    });
});

const validate = async (token = TOKEN) =>
    (await (await import('@/app/actions/cooperative/_coop_registration'))
        .validateCooperativeInviteAction(token)) as any;

// ─────────────────────────────────────────────────────────────────────────────
describe('#503 — a signed-in caller with no email does not skip the binding', () => {
    it('IT IS REFUSED, NOT WAVED THROUGH', async () => {
        //   THE test. This caller has a session — so this is the redemption
        //   path, where the fee waiver is granted — and no email, which used to
        //   produce the same `undefined` as being signed out.
        signedInAs(undefined);

        expect(await validate()).toMatchObject({
            success: false,
            error: INVITE_WRONG_ACCOUNT_MESSAGE,
        });
    });

    it('AND AN EMPTY-STRING EMAIL IS REFUSED THE SAME WAY', async () => {
        //   The adjacent shape, and the one a blank profile actually produces.
        signedInAs('');

        expect((await validate()).success).toBe(false);
    });

    it('AND THE INVITED ACCOUNT STILL REDEEMS IT', async () => {
        //   The control. A change that refused every signed-in caller would
        //   satisfy both assertions above and break the only thing this action
        //   is for.
        signedInAs('invited@example.com');

        expect(await validate()).toMatchObject({ success: true });
    });

    it('AND SOMEBODY ELSE STILL MAY NOT', async () => {
        signedInAs('someone.else@example.com');

        expect(await validate()).toMatchObject({
            success: false, error: INVITE_WRONG_ACCOUNT_MESSAGE,
        });
    });

    it('AND THE SIGNED-OUT PREVIEW IS UNCHANGED', async () => {
        //   The case the permissive branch exists for: the onboarding page
        //   previews a link before anybody signs in, and a preview grants
        //   nothing. Breaking this would send every invited member to a dead
        //   page before they could act on the invitation.
        signedOut();

        expect(await validate()).toMatchObject({ success: true });
    });

    it('and an unknown token is still refused whoever asks', async () => {
        signedInAs('invited@example.com');
        expect((await validate('no-such-token')).success).toBe(false);

        signedOut();
        expect((await validate('no-such-token')).success).toBe(false);
    });

    it('and a used invitation is still refused', async () => {
        store.seed(INVITES, 'used-token', {
            status: 'used', email: 'invited@example.com', createdAt: new Date().toISOString(),
        });
        signedInAs('invited@example.com');

        expect((await validate('used-token')).success).toBe(false);
    });
});
