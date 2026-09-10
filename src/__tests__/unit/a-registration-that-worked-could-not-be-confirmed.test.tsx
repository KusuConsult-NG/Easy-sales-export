/**
 * @jest-environment jsdom
 */

/**
 *   #587 A BRIEFING REGISTRATION THAT SUCCEEDED COULD NEVER BE CONFIRMED.
 *
 *   registerForBriefingAction refuses a second registration for the same email
 *   — correctly, and with a true message. Both paths on /wave/briefing read
 *   that refusal as a failure, and the consequences differ:
 *
 *     THE FORM showed a woman who holds a seat a red error saying she had
 *     failed, over an empty form, with no way to discover otherwise. She has no
 *     account and no order screen; this page IS her only record.
 *
 *     THE OFFLINE QUEUE counted it as a failed attempt — and that is the trap,
 *     because a bad connection is this page's entire audience. A registration
 *     whose RESPONSE was lost is registered. The replay says "already
 *     registered", the queue calls it a failure, and after three of them she is
 *     told to fill the form in again — which says the same thing, for ever.
 *
 *     So the one case the offline path exists for — a woman on a connection
 *     that drops mid-request — ends in a permanent loop of being told she is
 *     not registered when she is.
 *
 *   READ FROM A FLAG, NEVER FROM THE MESSAGE TEXT. #574 rejected classifying
 *   these refusals by their wording — "the kind of guess that rots" — so the
 *   action carries `meta.alreadyRegistered` and the screen reads that.
 *
 *   EMAIL ONLY. A phone-number collision may be a DIFFERENT woman on a shared
 *   handset, and telling her she is registered when somebody else is would be
 *   worse than the error she gets today. The screen's half of that is asserted
 *   below; the ACTION's half is in briefing-public-registration, which has a
 *   real fake database — this suite mocks the action to watch the screen, so
 *   asserting on the real one here would mean requireActual inside a jsdom
 *   run, and a jest.resetModules() to make it stick re-instantiates React for
 *   every later case in the file. It cost two tests before it was moved.
 *
 *   #586 AND "Pending Sync (Offline)" WAS THE WHOLE ANSWER TO "DID THAT WORK?"
 *
 *   A registration taken offline greyed the button out and relabelled it in
 *   jargon. Nothing said the form had been saved, that it would send itself, or
 *   that she could close the page. For an audience on bad connections that is
 *   the difference between waiting and giving up.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   This is a SECOND PASS over the screen #573/#574 fixed. Those findings — the
 *   queued payload missing fullName, and the retry loop driven by its own state
 *   — are unchanged and still covered by their own suite.
 *
 *   Nothing here weakens the duplicate check. The action still refuses to write
 *   a second row, still sends no second email, and still refuses a duplicate
 *   phone number outright. What changed is what the CALLER may conclude.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the confirmation not saying which happened        KILLED (2 tests)
 *     the flag dropped from the action's refusal        KILLED (1)
 *     the form treating it as a failure again           KILLED (1)
 *     the offline replay treating it as a failure       KILLED (1)
 *     the phone refusal carrying the flag too           KILLED (1)
 *     the offline explanation removed                   KILLED (1)
 *     the fill helper skipping a missing field          SURVIVED — EQUIVALENT
 *     reword the finding comment                        SURVIVED, as intended
 *
 *   THE SEVENTH IS RECORDED AS EQUIVALENT, NOT AS COVERAGE. Putting
 *   `if (!el) continue;` back into the sibling suite's fill helper changes
 *   nothing TODAY, because every field it looks for is currently present — and
 *   that is exactly the point of the change: the helper skipped a field it
 *   could not find, the phone input is named "phone" while the state key is
 *   "phoneNumber", and every case in that suite ran with an empty phone number
 *   and passed anyway. The throw is a tripwire for the next rename, so no test
 *   can kill it while the form is intact. Counting it as coverage would be the
 *   dishonest reading.
 */

import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

const registerForBriefingAction = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/briefing', () => ({
    registerForBriefingAction: (...a: any[]) => registerForBriefingAction(...a),
}));
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

/** The DOM names, which are not all the state names — see #587's sibling suite. */
const FIELD_SELECTORS: Record<keyof typeof FORM, string> = {
    firstName: '[name="firstName"]',
    lastName: '[name="lastName"]',
    otherName: '[name="otherName"]',
    phoneNumber: '[name="phone"]',
    email: '[name="email"]',
    state: '[name="state"]',
    role: '[name="role"][value="woman_seeking"]',
};

const ALREADY_REGISTERED = {
    success: false,
    error: 'This email address is already registered for the briefing.',
    data: null,
    meta: { alreadyRegistered: true },
};

function setOnline(online: boolean) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

async function renderBriefing() {
    const { default: Page } = await import('@/app/wave/briefing/page');
    const utils = render(<Page />);
    await act(async () => { await Promise.resolve(); });
    return utils;
}

async function fillAndSubmit() {
    for (const [name, value] of Object.entries(FORM)) {
        const el = document.querySelector(FIELD_SELECTORS[name as keyof typeof FORM]) as HTMLElement | null;
        if (!el) throw new Error(`the form has no ${name} field`);
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
    (global as any).IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    registerForBriefingAction.mockResolvedValue({ success: true, error: null, data: null });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#587 — a seat she already holds is a seat', () => {
    it('THE FORM SHOWS THE CONFIRMATION, NOT A RED ERROR', async () => {
        //   THE defect. She has no account and no order screen: this page is
        //   her only record, and it told her she had failed.
        registerForBriefingAction.mockResolvedValue(ALREADY_REGISTERED);

        await renderBriefing();
        await fillAndSubmit();

        expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
        expect(document.body.textContent).toMatch(/nothing else to do/i);
        //   And the refusal is not also shown as a failure.
        expect(document.body.textContent).not.toMatch(/registration failed/i);
    });

    it('AND SAYS WHICH OF THE TWO HAPPENED', async () => {
        //   Claiming a registration that was not made just now would be the
        //   opposite mistake — she would be told her details had been taken
        //   again when they had not.
        await renderBriefing();
        await fillAndSubmit();

        expect(await screen.findByText(/registration confirmed/i)).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/already registered/i);
    });

    it('AND THE OFFLINE REPLAY STOPS, INSTEAD OF RETRYING UNTIL IT GIVES UP', async () => {
        //   THE trap on a bad connection: a registration whose response was
        //   lost IS registered. The replay used to count "already registered"
        //   as a failure, three times, and then tell her to start again.
        registerForBriefingAction.mockResolvedValue(ALREADY_REGISTERED);
        localStorage.setItem(KEY, JSON.stringify({
            data: { ...FORM, fullName: 'Ada Obi' }, attempts: 0,
        }));

        await renderBriefing();

        await waitFor(() => expect(registerForBriefingAction).toHaveBeenCalledTimes(1));
        //   The queue is done — not counted up for another attempt.
        await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
        expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/fill the form in again/i);
    });

    it('AND A DUPLICATE PHONE NUMBER IS STILL A REFUSAL', async () => {
        //   A shared handset is somebody else's registration. Treating the two
        //   refusals alike would tell her she holds a seat that is not hers.
        registerForBriefingAction.mockResolvedValue({
            success: false,
            error: 'This phone number is already registered for the briefing.',
            data: null,
        });

        await renderBriefing();
        await fillAndSubmit();

        expect(await screen.findByText(/phone number is already registered/i)).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/nothing else to do/i);
    });

    it('AND EVERY OTHER REFUSAL IS STILL A REFUSAL', async () => {
        //   Vacuity guard: a screen that showed the confirmation on any
        //   response would be worse than the defect.
        registerForBriefingAction.mockResolvedValue({
            success: false, error: 'Too many registration attempts. Please try again later.', data: null,
        });

        await renderBriefing();
        await fillAndSubmit();

        expect(await screen.findByText(/too many registration attempts/i)).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/registration confirmed|already registered/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#586 — an offline registration says what happened', () => {
    it('IN WORDS, NOT IN "Pending Sync (Offline)"', async () => {
        //   The whole acknowledgement used to be a greyed-out button relabelled
        //   in jargon, on the path that exists for people whose connection is
        //   the problem.
        setOnline(false);

        await renderBriefing();
        await fillAndSubmit();

        expect(await screen.findByText(/saved your registration on this phone/i)).toBeInTheDocument();
        expect(document.body.textContent).toMatch(/sent by itself the moment you have a connection/i);
        expect(document.body.textContent).not.toMatch(/pending sync/i);
        //   And it really was queued — the message must not be the only thing
        //   that happened.
        expect(JSON.parse(localStorage.getItem(KEY) as string).data.fullName).toBe('Ada Obi');
    });

    it('AND AN ONLINE REGISTRATION SAYS NO SUCH THING', async () => {
        //   Vacuity guard: drawing it unconditionally would tell every woman
        //   the platform had not sent her registration.
        await renderBriefing();
        await fillAndSubmit();

        expect(document.body.textContent).not.toMatch(/saved your registration on this phone/i);
    });
});
