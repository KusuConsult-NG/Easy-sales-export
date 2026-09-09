/**
 * @jest-environment jsdom
 */

/**
 *   #573 A REGISTRATION TAKEN WHILE OFFLINE COULD NEVER SUCCEED.
 *
 *   /wave/briefing has an offline path — the whole point of it is a woman
 *   filling the form in on a bad connection, which is most of the audience this
 *   briefing is for. It queued the form and replayed it when the browser came
 *   back online.
 *
 *   It queued the WRONG PAYLOAD. The form's state carries firstName, lastName
 *   and otherName; the ONLINE path builds what it sends by adding a `fullName`
 *   composed from those three. The offline path stored the raw form state.
 *
 *   briefingRegistrationSchema requires it — `fullName: strictNameSchema`, not
 *   optional — so the replay was refused by validation every single time, with
 *   a message about a field the form never showed.
 *
 *   She was never registered, and was never told she was not.
 *
 *   #574 AND THE QUEUE RETRIED IT FOREVER.
 *
 *   Three things compounded, and because #573 meant the first attempt could
 *   never succeed, every offline registration reached all three:
 *
 *     THE PAYLOAD WAS ONLY CLEARED ON SUCCESS, so a refusal left her name,
 *     email and phone number in localStorage indefinitely — the #569 shape,
 *     reached from the other direction.
 *
 *     THE EFFECT DEPENDED ON `isSubmitting`, WHICH IT SETS ITSELF. Each attempt
 *     re-ran the effect, which re-ran its mount check, which started another
 *     attempt. A retry loop driven by its own state rather than by the network.
 *
 *     AND THE `!isSubmitting` GUARD COULD NOT STOP IT, because it reads a value
 *     captured when the effect ran — two overlapping invocations both saw false.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   No duplicate registrations. The action refuses a second one by email and by
 *   phone, so the retry loop cost requests and left data on the machine; it did
 *   not create rows. Saying otherwise would be the louder claim and a false one.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the queued payload back to raw formData        KILLED (1 test)
 *     the refusal branch never counting the attempt  KILLED (1)
 *     the attempt ceiling removed                    KILLED (1)
 *     the in-flight ref guard removed                KILLED (1)
 *     reword the finding comment                     SURVIVED, as intended
 *
 *   THE REF-GUARD MUTANT SURVIVED THE FIRST RUN, and it was a real gap, not an
 *   equivalent mutant: nothing here fired `online` while a sync was in flight,
 *   which is the only condition that guard exists for — and it is exactly what
 *   a flaky connection does. Covered now, by the bouncing-connection test below.
 *
 *   AND ONE "MUTANT" WAS DISCARDED AS A NO-OP. I wrote one that appended a
 *   comment to the refusal branch and called it "the queue kept after a
 *   refusal"; it changed no behaviour, so its survival meant nothing. Removing
 *   the rememberAttempt CALL is the same claim written properly, and that one
 *   dies.
 */

import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

const registerForBriefingAction = jest.fn();

jest.mock('@/app/actions/briefing', () => ({
    registerForBriefingAction: (...a: any[]) => registerForBriefingAction(...a),
}));
//   The page renders BackToHub, which pulls in next-auth/react — untransformed
//   ESM under this jest config. Mocked because this suite is about what the
//   offline queue holds, and a real hub link adds nothing to that.
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: null, status: 'unauthenticated' }),
    signOut: jest.fn(),
}));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/wave/briefing',
}));

const KEY = 'wave_briefing_pending_sync';

const FORM = {
    firstName: 'Ada',
    lastName: 'Obi',
    otherName: '',
    phoneNumber: '08030000000',
    email: 'ada@example.test',
    state: 'Enugu',
    role: 'woman_seeking',
};

function setOnline(online: boolean) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

async function renderBriefing() {
    const { default: Page } = await import('@/app/wave/briefing/page');
    render(<Page />);
    await act(async () => { await Promise.resolve(); });
}

/** Fill the form the way a person does, then submit. */
async function fillAndSubmit() {
    const byName = (name: string) =>
        document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement;

    for (const [name, value] of Object.entries(FORM)) {
        const el = byName(name);
        if (!el) continue;
        await act(async () => { fireEvent.change(el, { target: { value } }); });
    }

    const form = document.querySelector('form') as HTMLFormElement;
    await act(async () => { fireEvent.submit(form); });
}

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    setOnline(true);
    (Element.prototype as any).scrollIntoView = jest.fn();
    //   jsdom has neither of these. The page uses an IntersectionObserver for
    //   its scroll animations — real behaviour, just not what this suite is
    //   about — and scrollIntoView after a successful submit.
    (global as any).IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    registerForBriefingAction.mockResolvedValue({ success: true, error: null, data: null });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#573 — what is queued offline is what the server accepts', () => {
    it('THE QUEUED PAYLOAD CARRIES fullName', async () => {
        //   THE DEFECT. Without it the replay is refused by validation, every
        //   time, for a field the form never showed.
        setOnline(false);
        await renderBriefing();
        await fillAndSubmit();

        const queued = JSON.parse(localStorage.getItem(KEY) as string);

        expect(queued.data.fullName).toBe('Ada Obi');
        expect(registerForBriefingAction).not.toHaveBeenCalled();
    });

    it('AND IT IS THE SAME PAYLOAD THE ONLINE PATH SENDS', async () => {
        //   The claim that matters: one payload shape, not two. The online path
        //   is the reference, so it is read here rather than described.
        await renderBriefing();
        await fillAndSubmit();

        await waitFor(() => expect(registerForBriefingAction).toHaveBeenCalled());
        const sentOnline = registerForBriefingAction.mock.calls[0][0];

        localStorage.clear();
        jest.clearAllMocks();
        setOnline(false);
        await renderBriefing();
        await fillAndSubmit();

        const queued = JSON.parse(localStorage.getItem(KEY) as string);

        expect(queued.data).toEqual(sentOnline);
    });

    it('AND THE REPLAY REGISTERS HER', async () => {
        //   End to end: a queued payload, a browser that comes back online, and
        //   a registration that actually happens.
        localStorage.setItem(KEY, JSON.stringify({
            data: { ...FORM, fullName: 'Ada Obi' }, attempts: 0,
        }));

        await renderBriefing();

        await waitFor(() => expect(registerForBriefingAction).toHaveBeenCalledTimes(1));
        expect(registerForBriefingAction.mock.calls[0][0].fullName).toBe('Ada Obi');
        await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#574 — the queue is bounded, and does not drive itself', () => {
    it('A REFUSED REPLAY IS NOT RETRIED FOREVER', async () => {
        //   THE LOOP. The effect depended on `isSubmitting`, which it sets
        //   itself, so every failure started the next attempt.
        registerForBriefingAction.mockResolvedValue({
            success: false, error: 'This email address is already registered for the briefing.', data: null,
        });
        localStorage.setItem(KEY, JSON.stringify({
            data: { ...FORM, fullName: 'Ada Obi' }, attempts: 0,
        }));

        await renderBriefing();
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        //   One attempt per mount, not a cascade.
        expect(registerForBriefingAction).toHaveBeenCalledTimes(1);
        //   And the attempt was counted, so it cannot go on forever.
        expect(JSON.parse(localStorage.getItem(KEY) as string).attempts).toBe(1);
    });

    it('AND AFTER THE LAST ATTEMPT IT IS CLEARED, AND SHE IS TOLD', async () => {
        //   Leaving a name, email and phone number on the machine forever to
        //   keep proving a payload will not send is the #569 shape.
        registerForBriefingAction.mockResolvedValue({
            success: false, error: 'Registration failed', data: null,
        });
        localStorage.setItem(KEY, JSON.stringify({
            data: { ...FORM, fullName: 'Ada Obi' }, attempts: 2,
        }));

        await renderBriefing();

        await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
        expect(await screen.findByText(/fill the form in again/i)).toBeInTheDocument();
    });

    it('AND A CONNECTION THAT BOUNCES DOES NOT START A SECOND SYNC', async () => {
        //   THE RACE the ref guard exists for. A flaky connection fires `online`
        //   more than once, and the old `!isSubmitting` check read a value
        //   captured when the effect ran — so two invocations both saw false and
        //   both sent the same registration.
        //
        //   The action refuses the duplicate by email, so this never created two
        //   rows; it sent two requests and showed the second one's refusal to
        //   somebody who had just succeeded.
        let release: (v: any) => void = () => {};
        registerForBriefingAction.mockReturnValue(new Promise((resolve) => { release = resolve; }));

        localStorage.setItem(KEY, JSON.stringify({
            data: { ...FORM, fullName: 'Ada Obi' }, attempts: 0,
        }));

        await renderBriefing();
        await waitFor(() => expect(registerForBriefingAction).toHaveBeenCalledTimes(1));

        //   Still in flight — and the browser announces it is online again.
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await act(async () => { window.dispatchEvent(new Event('online')); });

        expect(registerForBriefingAction).toHaveBeenCalledTimes(1);

        await act(async () => {
            release({ success: true, error: null, data: null });
            await Promise.resolve();
        });

        await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    });

    it('AND AN UNPARSEABLE QUEUE IS DROPPED, NOT REPLAYED', async () => {
        localStorage.setItem(KEY, 'not json');

        await renderBriefing();

        expect(registerForBriefingAction).not.toHaveBeenCalled();
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('AND NOTHING QUEUED MEANS NOTHING SENT', async () => {
        //   The vacuity guard: a sync that fired on an empty queue would
        //   register whoever last used the browser.
        await renderBriefing();

        expect(registerForBriefingAction).not.toHaveBeenCalled();
    });
});
