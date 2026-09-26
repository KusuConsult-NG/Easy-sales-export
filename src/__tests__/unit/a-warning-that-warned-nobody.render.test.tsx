/**
 * @jest-environment jsdom
 */

/**
 *   #939 WHAT AN ADMINISTRATOR ACTUALLY SEES, which is the whole claim.
 *
 *   The policy suite beside this one proves adminMfaGraceNotice decides
 *   correctly. That is not the defect. The defect was that a CORRECT decision
 *   reached nobody for fourteen days — so the thing worth asserting here is
 *   whether something APPEARS, and what it says when it does.
 *
 *   Four things a grep cannot check:
 *
 *     an unenrolled administrator inside the window is told, and told the DAY
 *     an enrolled one sees nothing at all — no empty box, no stale warning
 *     the last two days read in HOURS and change colour, because a banner that
 *       looks identical on day 14 and day 1 has trained its reader to skip it
 *     the way out is a link to the enrolment screen, not a sentence about one
 *
 *   AND ONE THING THAT IS ABOUT THE WORDING RATHER THAN THE LOGIC. The banner
 *   has to say what will happen in the words of what it will LOOK like — "every
 *   admin page will send you to the setup screen" — because #937 is the morning
 *   an administrator met exactly that and reported the admin panel as broken.
 *   "Access will be restricted" is the sentence that gets read as boilerplate.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { AdminMfaGraceBanner } from '@/components/admin/AdminMfaGraceBanner';
import { MFA_GRACE_URGENT_MS, MFA_SETUP_PATH } from '@/lib/mfa-policy';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The window the owner opened, and a clock a known distance inside it. */
const WINDOW_UNTIL = '2026-10-10T00:00:00.000Z';
const CLOSES_AT = Date.parse(WINDOW_UNTIL);

const ORIGINAL_GRACE = process.env.MFA_ADMIN_GRACE_UNTIL;

beforeEach(() => {
    //   SET, never deleted-and-hoped. #936 is the run where ten tests went red at
    //   midnight because they leaned on the wall clock; both sides of the
    //   deadline are pinned explicitly here.
    process.env.MFA_ADMIN_GRACE_UNTIL = WINDOW_UNTIL;
});

afterEach(() => {
    if (ORIGINAL_GRACE === undefined) {
        delete process.env.MFA_ADMIN_GRACE_UNTIL;
    } else {
        process.env.MFA_ADMIN_GRACE_UNTIL = ORIGINAL_GRACE;
    }
});

const unenrolledAdmin = { roles: ['admin'], mfaEnabled: false };

// ─────────────────────────────────────────────────────────────────────────────
describe('#939 — the banner an unenrolled administrator sees', () => {
    it('IT APPEARS, AND IT COUNTS DOWN', () => {
        render(<AdminMfaGraceBanner {...unenrolledAdmin} now={CLOSES_AT - 5 * DAY} />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/5 days left/i)).toBeInTheDocument();
    });

    it('AND IT NAMES THE DAY, in the platform\'s own timezone', () => {
        /*
         *   The deadline is 2026-10-10T00:00:00Z. Nigeria is UTC+1, so in WAT
         *   that instant is 1:00 am on the 10th — and a banner that printed the
         *   UTC clock would be an hour out for every person reading it, which on
         *   the final day is the difference between "tomorrow" and "tonight".
         */
        render(<AdminMfaGraceBanner {...unenrolledAdmin} now={CLOSES_AT - 5 * DAY} />);

        const alert = screen.getByRole('alert');

        expect(alert.textContent).toMatch(/10 October 2026/);
        expect(alert.textContent).toMatch(/1:00/);
    });

    it('AND IT SAYS WHAT WILL HAPPEN, in the words of what it will look like', () => {
        //   Not "access will be restricted". #937 is the morning an administrator
        //   met this and filed it as the admin panel being broken.
        render(<AdminMfaGraceBanner {...unenrolledAdmin} now={CLOSES_AT - 5 * DAY} />);

        expect(screen.getByRole('alert').textContent)
            .toMatch(/every admin page will send you to the setup screen/i);
    });

    it('AND THE WAY OUT IS A LINK, pointing where the gate itself redirects', () => {
        render(<AdminMfaGraceBanner {...unenrolledAdmin} now={CLOSES_AT - 5 * DAY} />);

        expect(screen.getByRole('link', { name: /set it up now/i }))
            .toHaveAttribute('href', MFA_SETUP_PATH);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#939 — the production path, where nothing injects a clock', () => {
    it('WITH NO `now` PROP IT STILL WARNS, because the policy supplies the clock', () => {
        /*
         *   Every case above injects `now`, so none of them exercises the way this
         *   renders in production — and the signature CHANGED to get there.
         *
         *   `now = Date.now()` as a default parameter is an impure call during
         *   render, which react-hooks/purity refused and which nothing else in
         *   this codebase does. The default lives in adminMfaGraceNotice now, so
         *   an omitted prop arrives as undefined and JS falls through to it. If
         *   that fall-through ever breaks, the banner silently stops appearing —
         *   which is the original defect, restored by a refactor.
         *
         *   The window is set to 2999 rather than to a fixed offset from the real
         *   clock: this asserts only that the clock is READ, not what it reads,
         *   so it cannot go red at midnight the way #936's ten tests did.
         */
        process.env.MFA_ADMIN_GRACE_UNTIL = '2999-01-01T00:00:00.000Z';

        render(<AdminMfaGraceBanner {...unenrolledAdmin} />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/days left/i)).toBeInTheDocument();
    });

    it('and with the window long closed it stays silent, on the same real clock', () => {
        //   The control: the case above must not pass merely because the banner
        //   renders unconditionally when `now` is absent.
        process.env.MFA_ADMIN_GRACE_UNTIL = '2000-01-01T00:00:00.000Z';

        const { container } = render(<AdminMfaGraceBanner {...unenrolledAdmin} />);

        expect(container).toBeEmptyDOMElement();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#939 — and it is silent for everyone it is not about', () => {
    it('AN ENROLLED ADMINISTRATOR SEES NOTHING AT ALL', () => {
        //   Not an empty box, not a congratulatory panel. Nothing. Enrolling is
        //   the dismissal, so there must be nothing left behind.
        const { container } = render(
            <AdminMfaGraceBanner roles={['admin']} mfaEnabled now={CLOSES_AT - 5 * DAY} />,
        );

        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('A MEMBER SEES NOTHING — the deadline will never apply to them', () => {
        const { container } = render(
            <AdminMfaGraceBanner roles={['seller']} mfaEnabled={false} now={CLOSES_AT - 5 * DAY} />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('AND ONCE THE WINDOW CLOSES IT GOES QUIET, because the gate is the message now', () => {
        const { container } = render(
            <AdminMfaGraceBanner {...unenrolledAdmin} now={CLOSES_AT} />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('and an account with no roles at all renders nothing rather than throwing', () => {
        const { container } = render(
            <AdminMfaGraceBanner roles={undefined} mfaEnabled={undefined} now={CLOSES_AT - DAY} />,
        );

        expect(container).toBeEmptyDOMElement();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#939 — the last two days do not look like the first twelve', () => {
    it('INSIDE FORTY-EIGHT HOURS IT COUNTS IN HOURS', () => {
        render(<AdminMfaGraceBanner {...unenrolledAdmin} now={CLOSES_AT - 6 * HOUR} />);

        expect(screen.getByText(/about 6 hours left/i)).toBeInTheDocument();
    });

    it('AND ON THE LAST HOUR IT SAYS SO WITHOUT A NUMBER', () => {
        //   "about 0 hours left" is the kind of sentence that makes a reader
        //   distrust the whole banner.
        render(<AdminMfaGraceBanner {...unenrolledAdmin} now={CLOSES_AT - 20 * 60 * 1000} />);

        expect(screen.getByText(/less than an hour left/i)).toBeInTheDocument();
    });

    it('AND IT TURNS RED, where the fortnight-out version is amber', () => {
        const urgent = render(
            <AdminMfaGraceBanner {...unenrolledAdmin} now={CLOSES_AT - HOUR} />,
        );
        expect(urgent.getByRole('alert').className).toMatch(/red/);
        urgent.unmount();

        const calm = render(
            <AdminMfaGraceBanner {...unenrolledAdmin} now={CLOSES_AT - 10 * DAY} />,
        );
        expect(calm.getByRole('alert').className).toMatch(/amber/);
        //   The control: if both rendered the same tone the first assertion would
        //   still pass on a banner that never changes.
        expect(calm.getByRole('alert').className).not.toMatch(/red/);
    });

    it('AND THE COUNT NEVER ROUNDS UP — five days and twenty hours reads five', () => {
        //   Overstating the time left is the one direction that costs the reader
        //   their admin panel. Math.round here survived a mutation run until this
        //   case existed.
        render(
            <AdminMfaGraceBanner {...unenrolledAdmin} now={CLOSES_AT - (5 * DAY + 20 * HOUR)} />,
        );

        expect(screen.getByText(/5 days left/i)).toBeInTheDocument();
        expect(screen.queryByText(/6 days left/i)).not.toBeInTheDocument();
    });

    it('and the boundary hands over cleanly: hours on one side, days on the other', () => {
        /*
         *   Written to exercise a "1 day left" singular, which is how I found
         *   there cannot be one: urgent is msLeft <= 48h, so one day left counts
         *   in hours and the day branch never sees a value below 2. The dead
         *   singular came out of the component; this pins the handover that
         *   replaced it.
         */
        const urgent = render(
            <AdminMfaGraceBanner {...unenrolledAdmin} now={CLOSES_AT - MFA_GRACE_URGENT_MS} />,
        );
        expect(urgent.getByText(/about 48 hours left/i)).toBeInTheDocument();
        urgent.unmount();

        const calm = render(
            <AdminMfaGraceBanner {...unenrolledAdmin} now={CLOSES_AT - MFA_GRACE_URGENT_MS - 1} />,
        );
        expect(calm.getByText(/2 days left/i)).toBeInTheDocument();
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   the banner renders for an enrolled admin         "AN ENROLLED ADMINISTRATOR
 *     (drop the `if (!notice) return null`)          SEES NOTHING AT ALL"
 *   …for a member                                    "A MEMBER SEES NOTHING"
 *   …after the window closes                         "ONCE THE WINDOW CLOSES IT
 *                                                    GOES QUIET"
 *   the countdown is dropped from the heading        "IT APPEARS, AND IT COUNTS
 *                                                    DOWN"
 *   the date is formatted in UTC instead of WAT      "IT NAMES THE DAY, in the
 *                                                    platform's own timezone"
 *   the urgent tone is removed (one colour always)   "IT TURNS RED"
 *   urgent still counts in days                      "INSIDE FORTY-EIGHT HOURS
 *                                                    IT COUNTS IN HOURS"
 *   the final hour prints "about 0 hours"            "ON THE LAST HOUR IT SAYS
 *                                                    SO WITHOUT A NUMBER"
 *   the link is replaced with plain text             "THE WAY OUT IS A LINK"
 *   the link is hand-typed instead of MFA_SETUP_PATH the same test, by href
 *   the "what will happen" sentence is softened to   "IT SAYS WHAT WILL HAPPEN"
 *     "access will be restricted"
 *
 *   AND ONE FINDING THAT WAS NOT A MUTANT: the component shipped a
 *   `daysLeft === 1 ? "1 day"` branch that cannot execute, because one day left
 *   is inside the urgent window and counts in hours. The test written to
 *   exercise it is what proved it unreachable. The branch is gone.
 */
