/**
 * @jest-environment node
 */

/**
 *   #941 FOUR PATHS SEND AN APPLICATION BACK FOR CHANGES. NONE OF THEM RANG THE
 *        BELL, AND ONE SAID NOTHING AT ALL.
 *
 *   ── THE LEDGER I SET OUT TO CLEAR WAS WRONG, AND IN BOTH DIRECTIONS ───────
 *
 *   the-files-no-test-had-named recorded this as:
 *
 *       "RECORDED, NOT FIXED — A LEDGER AT 3. WAVE, Export and the Cooperative
 *        each have a request-revision path, each writes the status and the note,
 *        and none of them tells the applicant."
 *
 *   Measured, that is wrong three ways. There are FOUR paths, not three — Export
 *   has two, an admin one in admin/_exports and an onboarding one in
 *   export/_ex_onboarding. Only ONE of the four was silent. And the thing that
 *   WAS true of all four went unrecorded:
 *
 *       path                                          email   bell
 *       ───────────────────────────────────────────── ─────── ──────
 *       wave/_wv_applications                          NO      NO
 *       admin/_exports                                 yes     NO
 *       export/_ex_onboarding                          yes     NO
 *       cooperative/_coop_admin_members                yes     NO
 *
 *   The bell is not a nicety. member-decision-notice's own header says why:
 *   "THE BELL FIRST, because it is the channel that always exists. Email needs
 *   RESEND_API_KEY and an address on the record, and this platform is deployed
 *   today without the key in some environments." In such a deployment all four
 *   of these told the applicant NOTHING — the ledger's claim was true of every
 *   path, just not for the reason it gave.
 *
 *   ── AND THREE WORDINGS FOR ONE EVENT ─────────────────────────────────────
 *
 *   The three that did email each hand-rolled it: three subjects, three colours,
 *   three "Note from Admin" panels, three buttons pointing at three screens.
 *   That is the shape #688 and #690 exist to prevent, and it is how the fourth
 *   path came to have none of it — there was no one place that would have
 *   carried it there.
 *
 *   ── A GAP IN THE SHARED MODULE, FOUND ON THE WAY IN ──────────────────────
 *
 *   `notice.link` has been on MemberDecisionNotice since #690 and was passed to
 *   createNotification only. So the BELL knew where to send a member and the
 *   EMAIL — the channel that reaches somebody who is not on the site — said
 *   "you can see the details in your dashboard" and left them to find it.
 *   Eleven callers, every one a decision somebody was waiting on.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.15 });

const MODULE = 'src/lib/member-decision-notice.ts';

/** Every door that writes `revision_required` and must therefore tell somebody. */
const REVISION_DOORS = [
    { rel: 'src/app/actions/wave/_wv_applications.ts', link: '/wave/application' },
    { rel: 'src/app/actions/admin/_exports.ts', link: '/export' },
    { rel: 'src/app/actions/export/_ex_onboarding.ts', link: '/export/onboarding' },
    { rel: 'src/app/actions/cooperative/_coop_admin_members.ts', link: '/cooperatives/onboarding' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
describe('#941 — every revision door goes through the one notice', () => {
    it('ALL FOUR CALL notifyMemberDecision WITH outcome revision', () => {
        for (const { rel } of REVISION_DOORS) {
            const src = code(rel);

            expect({ rel, calls: src.includes('notifyMemberDecision(') })
                .toEqual({ rel, calls: true });
            expect({ rel, revision: /outcome:\s*['"]revision['"]/.test(src) })
                .toEqual({ rel, revision: true });
        }
    });

    it('AND NONE OF THEM HAND-ROLLS A REVISION EMAIL ANY MORE', () => {
        /*
         *   The three subjects that used to exist, one per module. If any comes
         *   back it means a door went round the module again — which is how there
         *   came to be three wordings and one silence in the first place.
         */
        const GONE = [
            'Action Required: Correction Needed on Your Export Application',
            'Action Required: Update Your Export Application',
            'Action Required: Update Your Cooperative Application',
        ];

        for (const { rel } of REVISION_DOORS) {
            const src = code(rel);
            for (const subject of GONE) {
                expect({ rel, subject, present: src.includes(subject) })
                    .toEqual({ rel, subject, present: false });
            }
        }
    });

    it('AND EACH KEEPS ITS OWN DESTINATION, which was not mine to unify', () => {
        /*
         *   Deliberately NOT normalised. admin/_exports sends the applicant to
         *   /export and export/_ex_onboarding to /export/onboarding, over the same
         *   collection — so either they are two applications or one of the two
         *   links is wrong. Re-routing a member to the wrong screen is a worse
         *   defect than the inconsistency, and choosing needs somebody who knows
         *   whether Export Windows onboarding and Export Services are one thing.
         *
         *   Recorded here so the drift cannot be mistaken for a decision.
         */
        for (const { rel, link } of REVISION_DOORS) {
            expect({ rel, link, kept: code(rel).includes(`'${link}'`) || code(rel).includes(`"${link}"`) })
                .toEqual({ rel, link, kept: true });
        }
    });

    it('and every one of those destinations is a route that exists', () => {
        //   A button in an email pointing at a 404 is worse than no button: the
        //   member concludes the platform is broken rather than that they misread.
        const { existsSync } = require('node:fs') as typeof import('node:fs');

        for (const { rel, link } of REVISION_DOORS) {
            expect({ rel, link, exists: existsSync(join(ROOT, 'src/app', link)) })
                .toEqual({ rel, link, exists: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#941 — what `revision` means in the module', () => {
    it('IT IS A FOURTH OUTCOME, not a rejection wearing a different label', () => {
        const src = code(MODULE);

        expect(src).toContain('"approved" | "rejected" | "completed" | "revision"');
        //   Wording that reads like a refusal stops somebody finishing an
        //   application that is still alive.
        expect(src).toContain('revision: "needs a few changes before it can be approved"');
        expect(src).toContain('revision: "Changes requested"');
        expect(src).not.toContain('revision: "was not approved"');
    });

    it('AND ITS REASON IS THE PAYLOAD, so it is carried like a rejection\'s', () => {
        /*
         *   `outcome === "rejected"` was tested in FIVE places in that function —
         *   the reason, the note, the bell type, the heading colour and the panel
         *   background. One of the five decides whether the member is told WHY.
         *   CARRIES_REASON names it so a fifth outcome does not have to find it
         *   among the other four.
         */
        const src = code(MODULE);

        expect(src).toContain('CARRIES_REASON');
        expect(src).toContain('new Set<DecisionOutcome>(["rejected", "revision"])');
        expect(src).toContain('const explains = CARRIES_REASON.has(outcome);');
        //   And a revision names the note for what it is.
        expect(src).toContain('What to change');
    });

    it('AND AN ABSENT REASON IS LOGGED rather than sent as a bare status change', () => {
        //   The notice still goes — silence is worse — but "needs a few changes"
        //   with no changes named is the defect this module exists about, so it
        //   must not pass unnoticed.
        const src = code(MODULE);

        expect(src).toContain('no reason on an outcome that needs one');
    });

    it('and it rings as info — a revision is neither a success nor a failure', () => {
        expect(code(MODULE)).toContain('outcome === "revision" ? "info"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#941 — the link the email never carried', () => {
    it('THE EMAIL NOW HAS A BUTTON, built from the same `link` the bell gets', () => {
        const src = code(MODULE);

        expect(src).toContain('linkHref');
        expect(src).toContain('notice.linkText ?? "View details"');
    });

    it('AND IT IS ABSOLUTE, because a relative href in an email client goes nowhere', () => {
        const src = code(MODULE);

        expect(src).toContain('NEXT_PUBLIC_APP_URL');
        //   An already-absolute link is left alone rather than double-prefixed.
        expect(src).toMatch(/\^https\?:\\\/\\\//);
    });

    it('and the bell still gets the path, not the absolute form', () => {
        /*
         *   The bell renders inside the app, so it wants `/wave/application`; the
         *   email wants https://…/wave/application. One field, resolved twice —
         *   rather than asking every caller to pass both and drift.
         */
        const src = code(MODULE);
        const bell = src.slice(src.indexOf('createNotification({'), src.indexOf('} as any)'));

        expect(bell).toContain('link,');
        expect(bell).not.toContain('linkHref');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#941 — and the greeting survived the consolidation', () => {
    it('recipientName EXISTS, so no door lost its "Dear <name>"', () => {
        //   Each hand-rolled email opened with one. Paying for consistency with
        //   the part the reader notices would be a poor trade.
        const src = code(MODULE);

        expect(src).toContain('recipientName?: string;');
        expect(src).toContain('notice.recipientName ? html`<p>Dear ${notice.recipientName},</p>`');
    });

    it('AND ALL THREE DOORS THAT HAD ONE STILL PASS ONE', () => {
        for (const rel of [
            'src/app/actions/admin/_exports.ts',
            'src/app/actions/export/_ex_onboarding.ts',
            'src/app/actions/cooperative/_coop_admin_members.ts',
        ]) {
            expect({ rel, greets: code(rel).includes('recipientName') })
                .toEqual({ rel, greets: true });
        }
    });

    it('and WAVE passes none, because it never had one to keep', () => {
        //   The control on the assertion above: if `recipientName` were being
        //   added everywhere by reflex rather than to preserve something, this
        //   would fail.
        expect(code('src/app/actions/wave/_wv_applications.ts')).not.toContain('recipientName');
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   drop the notifyMemberDecision call from any      "ALL FOUR CALL
 *     one of the four doors (the defect, on WAVE)    notifyMemberDecision"
 *   restore a hand-rolled revision email             "NONE OF THEM HAND-ROLLS"
 *   normalise the four links to one destination      "EACH KEEPS ITS OWN
 *                                                    DESTINATION"
 *   point a door at a route that does not exist      "every one of those
 *                                                    destinations is a route
 *                                                    that exists"
 *   give `revision` the rejection wording            "IT IS A FOURTH OUTCOME"
 *   drop "revision" from CARRIES_REASON — the        "ITS REASON IS THE PAYLOAD"
 *     revision notice stops saying what to change
 *   drop the email button again                      "THE EMAIL NOW HAS A
 *                                                    BUTTON"
 *   pass linkHref to the bell instead of link        "the bell still gets the
 *                                                    path"
 *   drop recipientName from the interface            "recipientName EXISTS"
 *   add recipientName to WAVE by reflex              "WAVE passes none"
 */
