/**
 * @jest-environment node
 */

/**
 *   #929 THE PLATFORM ASKED A WAVE APPLICANT FOR CHANGES AND THEN TOLD HER TO
 *        APPLY.
 *
 *   Found auditing src/app/wave/page.tsx — one of the files no test had named.
 *
 *   `requestWaveRevisionAction` writes `serviceRegistrations.wave.status =
 *   'revision_required'` on the user, stores the reviewer's `revisionNote`
 *   beside it, and sends NOTHING. Measured in its own file, which is what makes
 *   that a finding rather than a shrug: the submission path four hundred lines
 *   above it calls `sendEmailNotification` to acknowledge her application, and
 *   notifies every admin. The one message that asks HER to act is the silent
 *   one. So she learns of it by coming to the site.
 *
 *   Three screens decided where a WAVE visitor goes, each with its own
 *   hand-written list of statuses, and not one named that status:
 *
 *       /wave              pending | under_review -> review-pending,
 *                          everything else        -> landing
 *       /wave/landing      approved | active      -> dashboard,
 *                          pending | under_review -> review-pending
 *       DashboardNav       approved | active      -> dashboard,
 *                          pending | under_review | pending_review -> pending
 *
 *   She reached /wave, fell through every branch, and read "Begin Here - Apply
 *   Now!" — while /wave/application was already waiting with her reviewer's
 *   note in an amber panel.
 *
 * ── THE GATE KNEW ALL FIVE ──────────────────────────────────────────────────
 *
 *   lib/wave-access's WAVE_ACCESS_STATUSES has listed `revision_required` since
 *   it was written, and the middleware admits her on it. Only the screens
 *   deciding where she should GO had a smaller list — three times, each
 *   different. That asymmetry is the whole shape of this finding, and the
 *   invariant below is the guard against it: every status the gate admits must
 *   have somewhere to go that is not the marketing page.
 *
 * ── WHAT WAS MEASURED AND NOT CHANGED ───────────────────────────────────────
 *
 *   THE MISSING EMAIL IS A LEDGER AT 3, not a fix. WAVE, Export and the
 *   Cooperative each have a request-revision path, each writes the status and
 *   the note, and NONE of them tells the applicant. Writing customer-facing
 *   copy for three modules is the owner's call with the programme, the same
 *   line #927 drew about the absent suspension email.
 *
 *   AND THE DEAD SPELLINGS ARE MEASURED, not guessed. Across every writer of
 *   that field the values are approved, rejected, pending and revision_required.
 *   `enrolled` (read in _member) and `pending_review` (read in DashboardNav)
 *   are written nowhere — both were disjuncts that could not fire. `active` and
 *   `under_review` are kept although current code writes neither, because a
 *   legacy row may carry them and dropping a status from an ACCEPTING list
 *   locks somebody out, which is the direction that costs a member her place.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    WAVE_ACCESS_STATUSES,
    WAVE_IN_PROGRAMME_STATUSES,
    WAVE_AWAITING_REVIEW_STATUSES,
    WAVE_REVISION_STATUS,
    hasWaveAccess,
    isInWaveProgramme,
    waveDestinationFor,
} from '@/lib/wave-access';

const ROOT = process.cwd();
const raw = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(raw(rel), { label: rel, minRetainedRatio: 0.15 });

const FRONT_DOOR = 'src/app/wave/page.tsx';
const LANDING = 'src/app/wave/landing/page.tsx';
const NAV = 'src/components/dashboard/DashboardNav.tsx';
const WRITER = 'src/app/actions/wave/_wv_applications.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#929 — the invariant the three screens broke', () => {
    it('EVERY STATUS THE GATE ADMITS HAS SOMEWHERE TO GO', () => {
        /*
         *   The property, stated once. The defect was a status the middleware
         *   lets through with no screen willing to route it, and this is the
         *   only assertion that would have caught it before somebody reported
         *   it — a sixth status added to the gate fails here until the front
         *   door knows what it means.
         */
        for (const status of WAVE_ACCESS_STATUSES) {
            expect({ status, to: waveDestinationFor({ waveRegStatus: status }) })
                .not.toEqual({ status, to: '/wave/landing' });

            //   And the gate really does admit it, so this is not a set of
            //   statuses nothing believes in.
            expect({ status, admitted: hasWaveAccess({ waveRegStatus: status }) })
                .toEqual({ status, admitted: true });
        }
    });

    it('IN THE PROGRAMME IS NARROWER THAN THROUGH THE DOOR', () => {
        /*
         *   The distinction three screens were drawing by hand, and the one a
         *   future reader is most likely to collapse. hasWaveAccess answers
         *   "may she through the door" and admits the whole pipeline — the
         *   training is open to somebody awaiting a decision, which its own
         *   header argues for. isInWaveProgramme answers "is she in", which is
         *   what a dashboard link and the member heal ask. Collapsing them
         *   would hand an applicant the member's screens.
         */
        for (const status of [...WAVE_AWAITING_REVIEW_STATUSES, WAVE_REVISION_STATUS]) {
            expect({ status, door: hasWaveAccess({ waveRegStatus: status }) })
                .toEqual({ status, door: true });
            expect({ status, inside: isInWaveProgramme({ waveRegStatus: status }) })
                .toEqual({ status, inside: false });
        }

        for (const status of WAVE_IN_PROGRAMME_STATUSES) {
            expect({ status, inside: isInWaveProgramme({ waveRegStatus: status }) })
                .toEqual({ status, inside: true });
        }

        //   And the role alone is enough for both.
        expect(isInWaveProgramme({ roles: ['wave_participant'] })).toBe(true);
        expect(isInWaveProgramme({ roles: ['buyer'] })).toBe(false);
        expect(isInWaveProgramme({})).toBe(false);
    });

    it('THE CONTROL: a status the gate refuses goes to the landing page', () => {
        //   Without this the assertion above passes on a function that returns
        //   the dashboard for everything.
        for (const status of ['rejected', 'not_started', 'something_new', '']) {
            expect({ status, to: waveDestinationFor({ waveRegStatus: status }) })
                .toEqual({ status, to: '/wave/landing' });
            expect(hasWaveAccess({ waveRegStatus: status })).toBe(false);
        }
        expect(waveDestinationFor({})).toBe('/wave/landing');
    });

    it('and the gate list is still the five the middleware enforced', () => {
        //   Composed from the three parts now. The value must not move: another
        //   suite pins this same list as the middleware's contract.
        expect([...WAVE_ACCESS_STATUSES]).toEqual([
            'approved', 'active', 'pending', 'under_review', 'revision_required',
        ]);
        expect([...WAVE_IN_PROGRAMME_STATUSES, ...WAVE_AWAITING_REVIEW_STATUSES, WAVE_REVISION_STATUS])
            .toEqual([...WAVE_ACCESS_STATUSES]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#929 — where each of them goes', () => {
    it('A REVISION GOES TO THE APPLICATION, not to "we will let you know"', () => {
        //   The finding itself. review-pending would be the wrong sentence
        //   twice over: the platform is not reviewing anything, it is waiting
        //   on her.
        expect(waveDestinationFor({ waveRegStatus: 'revision_required' })).toBe('/wave/application');
    });

    it('an admitted member goes to the dashboard, by status or by role', () => {
        expect(waveDestinationFor({ waveRegStatus: 'approved' })).toBe('/wave/dashboard');
        expect(waveDestinationFor({ waveRegStatus: 'active' })).toBe('/wave/dashboard');
        //   The role alone, for a member whose registration row says nothing.
        expect(waveDestinationFor({ roles: ['wave_participant'] })).toBe('/wave/dashboard');
        //   And the role wins over a status that would say otherwise.
        expect(waveDestinationFor({ roles: ['wave_participant'], waveRegStatus: 'pending' }))
            .toBe('/wave/dashboard');
    });

    it('and somebody waiting on us waits', () => {
        expect(waveDestinationFor({ waveRegStatus: 'pending' }))
            .toBe('/wave/application/review-pending');
        expect(waveDestinationFor({ waveRegStatus: 'under_review' }))
            .toBe('/wave/application/review-pending');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#929 — the measurement, from the source rather than remembered', () => {
    it('THE REVISION IS WRITTEN, WITH A NOTE, AND NOTHING IS SENT', () => {
        const src = code(WRITER);

        expect(src).toContain("'serviceRegistrations.wave.status': 'revision_required'");
        expect(src).toContain('revisionNote: reason');

        /*
         *   The negative, made meaningful by its own control: this file DOES
         *   send email — the submission acknowledgement — so "no send" here is
         *   a fact about the revision path and not about the module's plumbing.
         */
        expect(src).toContain('sendEmailNotification');

        const fn = src.slice(src.indexOf('_requestWaveRevisionAction'));
        const body = fn.slice(0, fn.indexOf('export const requestWaveRevisionAction'));
        expect(body.length).toBeGreaterThan(500);
        expect(body).not.toContain('sendEmailNotification');
        expect(body).not.toContain('notifyAdmins');
    });

    it('AND THE DESTINATION IS A SCREEN THAT SHOWS HER THE NOTE', () => {
        //   Routing her somewhere that would not explain itself would be a
        //   different defect with the same shape.
        const page = code('src/app/wave/application/page.tsx');
        const client = code('src/app/wave/application/WaveApplicationClient.tsx');

        expect(page).toContain('waveStatus === "revision_required"');
        expect(client).toContain('revisionNote');
        expect(client).toContain('setRevisionNote(result.meta.revisionNote)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#929 — and no screen decides it alone any more', () => {
    const SITES = [FRONT_DOOR, LANDING, NAV, 'src/app/actions/wave/_member.ts'];

    it('ALL FOUR ASK THE SHARED MODULE', () => {
        for (const site of SITES) {
            expect({ site, asks: code(site).includes('@/lib/wave-access') })
                .toEqual({ site, asks: true });
        }
    });

    it('AND NONE OF THEM SPELLS THE STATUS SET OUT AGAIN', () => {
        /*
         *   The sweep, on stripped source — the comments in these files QUOTE
         *   the old expressions deliberately, and a scan that read raw would
         *   count the explanation as the defect. #918 was refused twice for
         *   exactly that.
         */
        for (const site of [FRONT_DOOR, LANDING, NAV]) {
            const src = code(site);

            for (const spelling of ['"approved"', "'approved'", '"under_review"', "'under_review'",
                '"pending_review"', "'pending_review'", '"active"', "'active'"]) {
                expect({ site, spelling, present: src.includes(`wave?.status === ${spelling}`) })
                    .toEqual({ site, spelling, present: false });
                expect({ site, spelling, present: src.includes(`waveStatus === ${spelling}`) })
                    .toEqual({ site, spelling, present: false });
                expect({ site, spelling, present: src.includes(`waveRegStatus === ${spelling}`) })
                    .toEqual({ site, spelling, present: false });
            }
        }
    });

    it('THE FRONT DOOR KEEPS THE DATABASE GATE for the dashboard', () => {
        /*
         *   The one thing the shared rule cannot do. checkModuleAccess reads the
         *   registration rather than the token, so it admits a member whose JWT
         *   has not caught up with her approval; waveDestinationFor is pure,
         *   because middleware shares it and runs on the edge. Replacing the
         *   call with the pure rule would be a quiet regression for exactly the
         *   member who was just approved.
         */
        const src = code(FRONT_DOOR);

        expect(src).toContain('checkModuleAccess(session.user.id');
        expect(src).toContain('redirect("/wave/dashboard")');
        expect(src).toContain('waveDestinationFor({');
    });

    it('the landing page sends anyone the rule places elsewhere', () => {
        const src = code(LANDING).replace(/\s+/g, ' ');

        expect(src).toContain('if (destination !== "/wave/landing")');
        expect(src).toContain('router.replace(destination)');
    });

    it('and the nav keeps its call to action for an account with no registration', () => {
        //   The nav is where somebody JOINS from, so the destination for "no
        //   live relationship" stays the application rather than the marketing
        //   page the rule names.
        const src = code(NAV).replace(/\s+/g, ' ');

        expect(src).toContain('destination === "/wave/landing" ? "/wave/application" : destination');
        expect(src).toContain('"/wave/application": "WAVE (Changes requested)"');
    });

    it('POSITIVE CONTROL: the stripper left all four files behind', () => {
        for (const site of SITES) {
            expect({ site, big: code(site).length > 400 }).toEqual({ site, big: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#929 — the ledger: three revision paths and not one message', () => {
    /**
     * RECORDED, NOT FIXED. Each of these writes a revision status and a note an
     * applicant cannot see until she happens to visit. Adding customer-facing
     * mail for three modules is the owner's call with the programme — the same
     * line #927 drew about the absent suspension email — and this is a ledger so
     * that the day one of them gains a message, the count improves and asks to
     * be updated rather than going stale.
     */
    const SILENT_REVISION_PATHS = [
        'src/app/actions/wave/_wv_applications.ts',
        'src/app/actions/admin/_exports.ts',
        'src/app/actions/cooperative/_coop_admin_members.ts',
    ];

    it('THREE OF THEM, AND EACH WRITES THE NOTE IT NEVER SENDS', () => {
        for (const path of SILENT_REVISION_PATHS) {
            const src = code(path);

            expect({ path, writes: /revision_required/.test(src) })
                .toEqual({ path, writes: true });
            expect({ path, note: /revisionNote/.test(src) })
                .toEqual({ path, note: true });
        }
        expect(SILENT_REVISION_PATHS).toHaveLength(3);
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   drop the revision branch from                   "EVERY STATUS THE GATE
 *     waveDestinationFor (the original defect)      ADMITS HAS SOMEWHERE TO GO"
 *                                                   and "A REVISION GOES TO
 *                                                   THE APPLICATION"
 *   waveDestinationFor returns the dashboard for    "THE CONTROL: a status the
 *     everything                                    gate refuses"
 *   put the revision branch AFTER the awaiting      "A REVISION GOES TO THE
 *     one, so pending wins                          APPLICATION" stays green —
 *                                                   the sets are disjoint; the
 *                                                   ORDER is documented, not
 *                                                   asserted (noted here so the
 *                                                   next reader does not trust
 *                                                   a guard that is not there)
 *   restore the hand-rolled list on any one screen  "NONE OF THEM SPELLS THE
 *                                                   STATUS SET OUT AGAIN"
 *   replace checkModuleAccess with the pure rule    "THE FRONT DOOR KEEPS THE
 *     on the front door                             DATABASE GATE"
 *   drop a status from WAVE_ACCESS_STATUSES         "the gate list is still the
 *                                                   five"
 */
