/**
 * @jest-environment jsdom
 */

/**
 *   THE IDLE LOGOUT WATCHED FOR HANDS, AND SIGNED OUT ANYONE WHO WAS ONLY
 *   LOOKING.
 *
 *   SessionActivityTracker signs a member out after ten minutes with no
 *   activity, where activity is exactly five events:
 *
 *       mousemove, keydown, click, scroll, touchstart
 *
 *   Every one of them is something you do with your hands. Watching a video is
 *   not, so an Academy learner fifteen minutes into a lesson recording was
 *   signed out mid-lesson having done nothing wrong.
 *
 *   The warning modal is no defence there. It renders IN THE PAGE, and a
 *   lesson video is very often fullscreen — which covers it. The first they
 *   know about it is the login screen, and whatever progress the player had not
 *   yet persisted.
 *
 * ── AND THE SAME HOLDS FOR EVERY EMBED, FOR A SECOND REASON ─────────────────
 *
 *   Events inside a cross-origin iframe never reach the parent document's
 *   listeners. The Academy lesson page embeds its course PDF and its
 *   spreadsheet in iframes, and VideoClassroom embeds a whole Jitsi call. A
 *   member scrolling a course document, or talking in a live class, generates
 *   continuous input and this tracker saw none of it.
 *
 * ── WHY IT IS BOUNDED RATHER THAN SIMPLY ALLOWED ────────────────────────────
 *
 *   "Media is playing" must not mean "signed in for ever": a video left running
 *   on an unattended machine is precisely the case #240 cared about — "on a
 *   shared computer the next person to open the browser is signed in as them".
 *   So passive engagement holds the clock open for at most two hours past the
 *   last REAL input, and the ordinary rule resumes after that.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import React from 'react';
import { render, act } from '@testing-library/react';

//   Typed to take arguments, because the mock below spreads into it. A 0-arg
//   jest.fn() runs perfectly well under jest — JavaScript does not mind — and
//   `tsc` does: "A spread argument must either have a tuple type or be passed
//   to a rest parameter." The suite was green and the typecheck was red.
const signOut = jest.fn(async (..._args: any[]) => undefined);
let session: any = { user: { authAt: 0 } };
jest.mock('next-auth/react', () => ({
    signOut: (...a: any[]) => signOut(...a),
    useSession: () => ({ data: session, status: 'authenticated' }),
}));

import SessionActivityTracker, { passivelyEngaged } from '@/components/auth/SessionActivityTracker';

const MINUTE = 60 * 1000;

/** Advance the component's one-second tick by `ms` of fake time. */
async function idle(ms: number) {
    await act(async () => { jest.advanceTimersByTime(ms); });
}

/** A <video> in whatever state the argument describes. */
function putMedia(state: Partial<{ paused: boolean; ended: boolean; readyState: number }>) {
    const el = document.createElement('video');
    Object.defineProperty(el, 'paused', { value: state.paused ?? false, configurable: true });
    Object.defineProperty(el, 'ended', { value: state.ended ?? false, configurable: true });
    Object.defineProperty(el, 'readyState', { value: state.readyState ?? 4, configurable: true });
    document.body.appendChild(el);
    return el;
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    //   `authAt: 0` with a stored timestamp of `now` means the stored value
    //   belongs to this session, so the tracker RESUMES it — the live path.
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    session = { user: { authAt: 0 } };
    document.body.innerHTML = '';
    localStorage.setItem('lastActivity', String(Date.now()));
});

afterEach(() => { jest.useRealTimers(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('a member watching a video is not idle', () => {
    it('IS NOT SIGNED OUT AT TEN MINUTES — the defect', async () => {
        //   THE test. Before this, a playing video changed nothing and the
        //   tick signed them out on schedule.
        putMedia({ paused: false });
        render(<SessionActivityTracker />);

        await idle(12 * MINUTE);

        expect(signOut).not.toHaveBeenCalled();
    });

    it('AND IS NOT SHOWN THE WARNING EITHER', async () => {
        //   A countdown they cannot see, over a video they are watching, is
        //   noise even when it does not end in a logout.
        putMedia({ paused: false });
        const { queryByText } = render(<SessionActivityTracker />);

        await idle(9.7 * MINUTE);

        expect(queryByText('Session Timeout Warning')).toBeNull();
    });

    it('AND A PAUSED VIDEO DOES NOT COUNT, which is the whole distinction', async () => {
        //   Paused is not watching. A tab left open on a lesson is the ordinary
        //   idle case and must stay so.
        putMedia({ paused: true });
        render(<SessionActivityTracker />);

        await idle(12 * MINUTE);

        expect(signOut).toHaveBeenCalled();
    });

    it('nor does one that has ended, or has no data yet', () => {
        expect(passivelyEngaged(document)).toBe(false);

        putMedia({ paused: false, ended: true });
        expect(passivelyEngaged(document)).toBe(false);

        document.body.innerHTML = '';
        putMedia({ paused: false, readyState: 0 });
        expect(passivelyEngaged(document)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and a member working inside an embed is not idle', () => {
    it('FOCUS IN AN IFRAME COUNTS — events in there never reach us', () => {
        const frame = document.createElement('iframe');
        document.body.appendChild(frame);
        frame.focus();
        jest.spyOn(document, 'hasFocus').mockReturnValue(true);

        expect(passivelyEngaged(document)).toBe(true);
    });

    it('BUT NOT WHEN THIS DOCUMENT HAS LOST FOCUS', () => {
        //   activeElement stays on the iframe after the member switches to
        //   another application. Without hasFocus() this would mean anyone who
        //   ever clicked an embed is present for ever.
        const frame = document.createElement('iframe');
        document.body.appendChild(frame);
        frame.focus();
        jest.spyOn(document, 'hasFocus').mockReturnValue(false);

        expect(passivelyEngaged(document)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('but watching does not hold the session open for ever', () => {
    it('THE CEILING ENDS IT — an unattended machine is still signed out', async () => {
        //   #240's case: a video playing to an empty room. Two hours past the
        //   last real input, the ordinary rule comes back.
        putMedia({ paused: false });
        render(<SessionActivityTracker />);

        await idle(130 * MINUTE);

        expect(signOut).toHaveBeenCalled();
    });

    it('AND IT IS MEASURED FROM REAL INPUT, not from the last extension', async () => {
        //   The mutant that matters: measuring the ceiling from `lastActivity`
        //   — which passive engagement itself writes — makes every extension
        //   renew its own budget, and "two hours" becomes unlimited.
        putMedia({ paused: false });
        render(<SessionActivityTracker />);

        await idle(115 * MINUTE);
        expect(signOut).not.toHaveBeenCalled();

        await idle(20 * MINUTE);
        expect(signOut).toHaveBeenCalled();
    });

    it('and a real interaction buys a fresh two hours, because they are there', async () => {
        putMedia({ paused: false });
        render(<SessionActivityTracker />);

        await idle(100 * MINUTE);
        await act(async () => { window.dispatchEvent(new Event('click')); });
        await idle(100 * MINUTE);

        expect(signOut).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the control still works for everybody else', () => {
    it('POSITIVE CONTROL: AN IDLE MEMBER IS STILL SIGNED OUT', async () => {
        //   The direction that must not move. A change that simply stopped
        //   signing people out would pass every assertion above and remove the
        //   control entirely.
        render(<SessionActivityTracker />);

        await idle(11 * MINUTE);

        expect(signOut).toHaveBeenCalled();
    });

    it('POSITIVE CONTROL: and is sent to the login page, not just signed out', async () => {
        render(<SessionActivityTracker />);

        await idle(11 * MINUTE);

        expect(signOut).toHaveBeenCalledWith(
            expect.objectContaining({ callbackUrl: expect.stringContaining('/auth/login') }));
    });

    it('POSITIVE CONTROL: an idle member still gets the warning first', async () => {
        const { queryByText } = render(<SessionActivityTracker />);

        await idle(9.5 * MINUTE);

        expect(queryByText('Session Timeout Warning')).not.toBeNull();
    });

    it('a DOM that throws is treated as "not engaged", not as engaged', () => {
        //   #350's rule. Failing open here would disarm the timeout for
        //   everyone on any browser where this read is unavailable.
        const hostile = { querySelectorAll() { throw new Error('no'); } } as unknown as Document;

        expect(passivelyEngaged(hostile)).toBe(false);
    });

    it('and no document at all is not engaged', () => {
        expect(passivelyEngaged(undefined)).toBe(false);
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/components/auth/SessionActivityTracker.tsx, this suite
 *   re-run each time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   remove the passive check — the defect        2  "IS NOT SIGNED OUT AT TEN
 *                                                   MINUTES"
 *
 *   passivelyEngaged returns true always         4  "AND A PAUSED VIDEO DOES
 *                                                   NOT COUNT"
 *
 *   it ignores `paused`                          1  same
 *
 *   it drops the `doc.hasFocus()` half           1  "BUT NOT WHEN THIS
 *                                                   DOCUMENT HAS LOST FOCUS"
 *
 *   the ceiling is measured from lastActivity    1  "AND IT IS MEASURED FROM
 *   rather than lastRealInput                       REAL INPUT"
 *
 *   the ceiling is removed entirely              2  "THE CEILING ENDS IT"
 *
 *   the catch returns true instead of false      1  "a DOM that throws"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the comment above PASSIVE_CEILING_MS  0  SURVIVED ✓
 */
