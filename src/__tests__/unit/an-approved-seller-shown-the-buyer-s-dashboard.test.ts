/**
 * @jest-environment node
 */

/**
 *   AN APPROVED SELLER WAS SHOWN THE BUYER'S DASHBOARD, AND THE BUYER'S
 *   FEATURES.
 *
 *   THE OWNER: "users sign up as seller but sees buyer's dashboard and all
 *   features, why?"
 *
 *   The hub picked the marketplace link like this:
 *
 *       dashboardUrl: (roles.includes("seller") || roles.includes("marketplace_seller"))
 *           ? "/marketplace/seller/dashboard"
 *           : "/marketplace/buyer/dashboard"
 *
 *   which asks the SESSION's roles array. Admin approval grants the role with
 *   `arrayUnion` on the user document, and the JWT keeps the old array until it
 *   is minted again — up to the eight-hour session lifetime. So a freshly
 *   approved seller reached the hub, fell down the `:` branch, and got the
 *   buyer dashboard with nothing on screen to say why.
 *
 *   It is the same staleness getPostLoginRedirect's own comment warned about —
 *   "JWT session roles can be stale for hours after admin approval" — and this
 *   was the third place deciding a marketplace destination, and the only one
 *   deciding it from a source that can be out of date.
 *
 * ── WHY THE FIX IS A DELETION ───────────────────────────────────────────────
 *
 *   /marketplace/dashboard already answers this from the right source. Its own
 *   comment: "Check Firestore for authoritative accountType (JWT may be
 *   stale)". It reads serviceRegistrations.marketplace.accountType and routes
 *   seller and "both" to the seller dashboard, buyer to the buyer dashboard,
 *   and anyone with neither to onboarding.
 *
 *   So the hub stops answering a question it cannot answer and links to the
 *   router that can.
 *
 *   AND A PENDING SELLER WAS NEVER THE CASE. Their registration status is
 *   `pending`, so the hub's own status resolution gives 'pending' and the href
 *   is pendingUrl — the "your verification is being reviewed" page. That is
 *   pinned below too, because it is the half that must not move while fixing
 *   the other.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

const HUB = 'src/app/dashboard/page.tsx';
const ROUTER = 'src/app/marketplace/dashboard/page.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('the hub does not choose a marketplace dashboard from session roles', () => {
    it('THE HUB LINKS TO THE ROUTER, NOT TO A DASHBOARD IT PICKED — the defect', () => {
        //   THE test. The hub used to name one of the two dashboards directly,
        //   chosen from `roles`.
        const src = code(HUB);
        const at = src.indexOf('id: "marketplace"');
        expect(at).toBeGreaterThan(-1);

        const block = src.slice(at, at + 600);
        expect(block).toContain('dashboardUrl: "/marketplace/dashboard"');
    });

    it('AND IT NO LONGER BRANCHES ON A SELLER ROLE TO BUILD THAT URL', () => {
        //   The precise shape of the defect: a ternary over `roles` producing
        //   one of the two dashboards. Asserted on the marketplace block only,
        //   because other modules legitimately consult roles elsewhere.
        const src = code(HUB);
        const at = src.indexOf('id: "marketplace"');
        const block = src.slice(at, at + 600);

        expect(block).not.toContain('/marketplace/seller/dashboard');
        expect(block).not.toContain('/marketplace/buyer/dashboard');
    });

    it('AND THE ROUTER IT DEFERS TO READS THE DATABASE, not the session', () => {
        //   The whole reason for deferring. If this router ever started
        //   deciding from roles too, the bug would be back with an extra hop.
        const src = code(ROUTER);

        expect(src).toContain('serviceRegistrations?.marketplace');
        expect(src).toContain('accountType');
        expect(src).toContain('/marketplace/seller/dashboard');
        expect(src).toContain('/marketplace/buyer/dashboard');
    });

    it('and the router sends "both" to the seller side, not the buyer side', () => {
        //   #844 measured 91 accounts with accountType "both". Whichever side
        //   they land on must be the one with more capability, or the fix for
        //   one group silently strands another.
        const src = code(ROUTER);
        const at = src.indexOf('"/marketplace/seller/dashboard"');
        expect(at).toBeGreaterThan(-1);

        //   The branch that names the seller dashboard mentions "both".
        const before = src.slice(Math.max(0, at - 300), at);
        expect(before).toContain('both');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the halves that must not move', () => {
    it('POSITIVE CONTROL: A SELLER STILL IN REVIEW STILL GOES TO THE PENDING PAGE', () => {
        //   Not the reported case, and easy to break while fixing it: a
        //   pending registration resolves to status 'pending', whose href is
        //   pendingUrl — the page that explains the wait.
        const src = code(HUB);

        expect(src).toContain("pendingUrl: \"/marketplace/onboarding/pending\"");
        expect(src).toContain("status === 'pending' ? mod.pendingUrl");
    });

    it('POSITIVE CONTROL: the hub still offers every module', () => {
        //   Vacuity guard. A modulesDef that lost its marketplace entry would
        //   satisfy both "not.toContain" assertions above.
        const src = code(HUB);

        for (const id of ['marketplace', 'academy', 'cooperatives', 'export', 'wave', 'farmNation']) {
            expect(src).toContain(`id: "${id}"`);
        }
    });

    it('and an unapplied member is still sent to onboarding', () => {
        const src = code(HUB);

        expect(src).toContain('onboardingUrl: "/marketplace/onboarding"');
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/app/dashboard/page.tsx and
 *   src/app/marketplace/dashboard/page.tsx, this suite re-run each time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   restore the roles ternary — the defect      2   "THE HUB LINKS TO THE
 *                                                   ROUTER"
 *
 *   hub hardcodes /marketplace/buyer/dashboard  2   same
 *
 *   hub hardcodes /marketplace/seller/dashboard 2   same
 *   (looks like a fix, strands every buyer)
 *
 *   the router starts deciding from roles       1   "AND THE ROUTER IT DEFERS
 *   instead of the stored accountType               TO READS THE DATABASE"
 *
 *   the router sends "both" to the buyer side   1   "and the router sends
 *                                                   'both' to the seller side"
 *
 *   pendingUrl dropped from the marketplace     1   "POSITIVE CONTROL: A
 *   entry                                          SELLER STILL IN REVIEW"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the comment above dashboardUrl       0   SURVIVED ✓
 */
