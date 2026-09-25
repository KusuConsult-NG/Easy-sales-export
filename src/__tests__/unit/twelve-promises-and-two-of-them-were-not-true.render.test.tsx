/**
 * @jest-environment jsdom
 */

/**
 *   #931 THE STEP THAT ASKS SOMEBODY TO CHOOSE A SIDE OF FARM NATION PROMISED
 *        TWO FEATURES THAT EXIST NOWHERE.
 *
 *   Found auditing src/app/farm-nation/onboarding/steps/RoleSelectionStep.tsx —
 *   one of the files no test had named.
 *
 *   Three cards, four bullets each. Swept against the whole tree:
 *
 *       "Pricing analytics tools"   in this file and NO other. src/app and
 *                                   src/lib hold no price analytics of any kind.
 *       "Priority support"          in this file and no other. One support
 *                                   address, no tiering.
 *
 *   Read at the moment somebody chooses, on the screen asking them to choose,
 *   which is where a promise costs the most.
 *
 *   THE OTHER TEN WERE CHECKED TOO AND STAND, and each is pinned below to the
 *   file that implements it — so a bullet added later fails until somebody says
 *   where it lives. That is the part worth keeping: the defect here was not a
 *   typo, it was a list nobody could check.
 *
 * ── AND "You can change this later" HAD NO DOOR ─────────────────────────────
 *
 *   The choice is stored at serviceRegistrations.farmNation.role. The only
 *   screen that can rewrite it is this wizard behind `?edit=true`, linked from
 *   the PENDING page alone — which an approved member never sees, because Farm
 *   Nation grants her roles at submit and sends her to the dashboard (#790).
 *
 *   And that path is `resubmitFarmNationApplicationAction`, which writes
 *   `status: "pending"`. So the obvious repair — an "edit your details" link in
 *   the member area — would put an approved member back in the review queue. A
 *   role-change path that does not is a new action with review semantics the
 *   owner should choose, so the SENTENCE is what changed here and the missing
 *   door is recorded.
 *
 *   WHAT THE CHOICE ACTUALLY DECIDES, measured rather than assumed:
 *   rolesForFarmNationRole grants `investor` for a buyer and `farmer` for a
 *   seller, and _createLandListingAction's gate is hasAppAccess(roles,
 *   "farm-nation") — which either satisfies. Neither answer shuts anybody out of
 *   listing or buying. What it changes is the roles on the account and the admin
 *   broadcast segment. The new wording says that.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';

import RoleSelectionStep from '@/app/farm-nation/onboarding/steps/RoleSelectionStep';

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Stripped, for any assertion that a phrase is ABSENT.
 *
 * My own note in that file quotes "Priority support" to say it does not exist,
 * and the first version of the assertion below counted the explanation as the
 * defect — the trap #918 was refused by twice. Positive assertions read raw;
 * negative ones read this.
 */
const stripped = (rel: string) =>
    stripComments(src(rel), { label: rel, minRetainedRatio: 0.15 });

/**
 * The same, for a WHOLE-TREE walk.
 *
 * The retention floor is a guard against a stripper that ate a file somebody
 * named, and it is wrong for a sweep: src/app/land/submit/page.tsx is five lines
 * of code under ninety-five of explanation, so 0.15 throws and takes the sweep
 * with it. #918's suite hit the same edge. The floor stays on the named reads
 * above, where it is doing its job.
 */
const sweptStripped = (rel: string) =>
    stripComments(src(rel), { label: rel, minRetainedRatio: 0 });

/**
 * Every bullet the step renders, against the file that makes it true.
 *
 * A PAIR, not a list of strings, because the defect was a claim with nothing
 * behind it. The evidence is a path that must exist plus a marker that must be
 * in it — weak enough to survive a refactor, strong enough that "we have that"
 * has to be demonstrable.
 */
const PROMISES: { bullet: string; evidence: string; marker: string }[] = [
    // Buyer
    {
        bullet: 'Browse verified farmland listings',
        evidence: 'src/app/farm-nation/properties/page.tsx',
        marker: 'export default',
    },
    {
        bullet: 'Direct contact with landlords',
        evidence: 'src/app/farm-nation/(member)/inquiries/InquiriesClient.tsx',
        marker: 'export default',
    },
    {
        bullet: 'Secure escrow payments',
        evidence: 'src/app/farm-nation/(member)/my-purchases/MyPurchasesClient.tsx',
        marker: 'escrow',
    },
    {
        bullet: 'Legal documentation support',
        evidence: 'src/app/farm-nation/(member)/list-land/page.tsx',
        marker: 'ocument',
    },
    // Seller
    {
        bullet: 'List unlimited properties',
        //   No cap anywhere in the door that writes a listing — the claim is
        //   true by the ABSENCE of one, so the evidence is the door itself and
        //   the assertion below is that it names no limit.
        evidence: 'src/app/actions/land-listings.ts',
        marker: '_createLandListingAction',
    },
    {
        bullet: 'Reach thousands of buyers',
        evidence: 'src/app/farm-nation/properties/page.tsx',
        marker: 'export default',
    },
    {
        bullet: 'Inquiries and offers on your listings, in one place',
        evidence: 'src/app/farm-nation/(member)/offers/OffersClient.tsx',
        marker: 'export default',
    },
    {
        bullet: 'Professional property verification',
        evidence: 'src/app/admin/farm-nation/land-verification/page.tsx',
        marker: 'export default',
    },
    // Both
    {
        bullet: 'Full buyer & seller access',
        evidence: 'src/lib/farm-nation-roles.ts',
        marker: 'FARM_NATION_SELLER_ROLE, FARM_NATION_BUYER_ROLE',
    },
    {
        bullet: 'Portfolio management',
        evidence: 'src/app/farm-nation/(member)/dashboard/FarmNationDashboardClient.tsx',
        marker: 'Portfolio Value',
    },
    {
        bullet: 'Investment tracking',
        evidence: 'src/app/farm-nation/(member)/my-purchases/MyPurchasesClient.tsx',
        marker: 'export default',
    },
    {
        bullet: 'Offers you make and receive, on one screen',
        evidence: 'src/app/farm-nation/(member)/offers/OffersClient.tsx',
        marker: 'export default',
    },
];

const onNext = jest.fn();

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#931 — the two claims with nothing behind them', () => {
    it('THE STEP NO LONGER PROMISES PRICING ANALYTICS OR PRIORITY SUPPORT', () => {
        render(<RoleSelectionStep onNext={onNext} />);

        expect(screen.queryByText(/Pricing analytics/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Priority support/i)).not.toBeInTheDocument();
    });

    it('AND NOTHING IN THE TREE OFFERS EITHER — the measurement, swept', () => {
        /*
         *   The half that makes the removal right rather than a matter of taste,
         *   and it is a SWEEP rather than the two greps I ran by hand: every
         *   shipping file under src, stripped of comments, must be free of both
         *   phrases. The day somebody BUILDS price analytics or a support tier,
         *   this fails and the bullet can go back with its evidence beside it.
         */
        const hits: Record<string, string[]> = { 'pricing analytic': [], 'priority support': [] };

        (function walk(dir: string) {
            for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
                const rel = `${dir}/${entry.name}`;
                if (entry.isDirectory()) {
                    if (entry.name !== '__tests__') walk(rel);
                } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
                    const text = sweptStripped(rel).toLowerCase();
                    for (const phrase of Object.keys(hits)) {
                        if (text.includes(phrase)) hits[phrase].push(rel);
                    }
                }
            }
        })('src');

        expect(hits['pricing analytic']).toEqual([]);
        expect(hits['priority support']).toEqual([]);
    });

    it('POSITIVE CONTROL: that sweep can find a phrase which IS there', () => {
        //   Without this, the two empty lists above would be satisfied by a walk
        //   that read nothing.
        let found = 0;
        (function walk(dir: string) {
            for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
                const rel = `${dir}/${entry.name}`;
                if (entry.isDirectory()) {
                    if (entry.name !== '__tests__') walk(rel);
                } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
                    if (sweptStripped(rel).includes('Professional property verification')) found += 1;
                }
            }
        })('src');

        expect(found).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#931 — every bullet names something that exists', () => {
    it('THE RENDERED LIST IS EXACTLY THE PINNED LIST', async () => {
        /*
         *   Both directions. A bullet on screen that is not pinned here fails —
         *   which is the guard the defect needed — and a pinned bullet that
         *   stopped rendering fails too, so this cannot rot into a list of
         *   claims nobody makes any more.
         */
        const user = userEvent.setup();
        render(<RoleSelectionStep onNext={onNext} />);

        for (const { bullet } of PROMISES) {
            expect(await screen.findByText(bullet)).toBeInTheDocument();
        }

        const step = stripped('src/app/farm-nation/onboarding/steps/RoleSelectionStep.tsx');
        const listSection = step.slice(step.indexOf('const roles = ['), step.indexOf('return ('));
        const quoted = [...listSection.matchAll(/^\s{16}"([^"]+)",$/gm)].map((m) => m[1]);

        expect(quoted.sort()).toEqual(PROMISES.map((p) => p.bullet).sort());

        //   The step still does its job.
        await user.click(screen.getByText('Property Seller'));
        await user.click(screen.getByRole('button', { name: /continue/i }));
        expect(onNext).toHaveBeenCalledWith({ role: 'seller' });
    });

    it('AND EACH ONE HAS A FILE BEHIND IT', () => {
        for (const { bullet, evidence, marker } of PROMISES) {
            expect({ bullet, exists: existsSync(join(ROOT, evidence)) })
                .toEqual({ bullet, exists: true });
            expect({ bullet, says: src(evidence).includes(marker) })
                .toEqual({ bullet, says: true });
        }
    });

    it('and "unlimited" is true by the absence of a cap in the door that writes one', () => {
        //   The one claim whose evidence is a negative, so it is asserted as
        //   one rather than waved at.
        const door = src('src/app/actions/land-listings.ts');

        expect(door).toContain('_createLandListingAction');
        expect(door).not.toMatch(/MAX_LISTINGS|LISTING_LIMIT|listingCap/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#931 — and the promise about changing it says what is true', () => {
    it('IT NO LONGER SAYS "You can change this later"', () => {
        //   There is no door for an approved member: the only rewrite path is
        //   this wizard behind ?edit=true, linked from the pending page alone.
        render(<RoleSelectionStep onNext={onNext} />);

        expect(screen.queryByText(/You can change this later/i)).not.toBeInTheDocument();
    });

    it('AND THE ONLY EDIT DOOR IS STILL WHERE IT WAS — the measurement', () => {
        /*
         *   Pinned so that the day somebody links ?edit=true from the member
         *   area, or writes a role-change action, this fails and the sentence
         *   can be revisited. Note what that link would COST today: the resubmit
         *   path writes `status: "pending"`, so it would put an approved member
         *   back in the review queue.
         */
        const pending = src('src/app/farm-nation/onboarding/pending/page.tsx');
        expect(pending).toContain('/farm-nation/onboarding?edit=true');

        const resubmit = src('src/app/actions/farm-nation/_fn_onboarding.ts');
        expect(resubmit).toContain("'serviceRegistrations.farmNation.status': 'pending'");

        //   Nothing in the member area offers it.
        for (const rel of [
            'src/app/farm-nation/(member)/FarmNationSidebar.tsx',
            'src/app/farm-nation/(member)/dashboard/FarmNationDashboardClient.tsx',
        ]) {
            expect({ rel, offers: src(rel).includes('onboarding?edit=true') })
                .toEqual({ rel, offers: false });
        }
    });

    it('and it says what the choice actually decides', () => {
        //   Measured: rolesForFarmNationRole grants investor or farmer, and the
        //   listing door asks hasAppAccess(…, "farm-nation"), which either
        //   satisfies — so neither answer shuts anybody out.
        render(<RoleSelectionStep onNext={onNext} />);

        expect(screen.getByText(/roles on your account/i)).toBeInTheDocument();

        const door = src('src/app/actions/land-listings.ts');
        expect(door).toContain('hasAppAccess((session.user.roles ?? []) as any, "farm-nation")');
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   put "Pricing analytics tools" back              "THE STEP NO LONGER
 *                                                   PROMISES…" and "THE
 *                                                   RENDERED LIST IS EXACTLY
 *                                                   THE PINNED LIST"
 *   put "Priority support" back                     the same two
 *   add a thirteenth bullet with no evidence        "THE RENDERED LIST IS
 *                                                   EXACTLY THE PINNED LIST"
 *   point a bullet's evidence at a file that does   "AND EACH ONE HAS A FILE
 *     not exist                                     BEHIND IT"
 *   restore "You can change this later"             "IT NO LONGER SAYS…"
 *   break the step's own onNext                     "THE RENDERED LIST…" —
 *                                                   which clicks through
 */
