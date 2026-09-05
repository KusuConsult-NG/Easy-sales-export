/**
 * @jest-environment node
 */

/**
 *   #397 THE SIXTH BLIND LAND STATUS WRITE — AND THE ONLY ONE WITH A SCREEN.
 *
 *   HOW THIS WAS FOUND
 *   ------------------
 *   #396's caller count left 45 unreached actions. Following the land ones
 *   turned up something better than an orphan: TWO exported symbols both named
 *   `verifyLandListing`.
 *
 *     admin/_land.ts        claims the transition from the shared status sets,
 *                           refuses a listing mid-purchase by name, notifies
 *                           the owner — and NO SCREEN IMPORTS IT
 *     land-actions.ts       a raw .update() — and /land/verify, a protected
 *                           admin route in route-manifest.ts, imports THIS one
 *
 *   The hardened door had no way in and the wired door was the unhardened one.
 *   That is #276's shape and #297's, and it is why "which door is more
 *   featureful" is never the question — #384, #386, #395.
 *
 *   #27's note on the hardened copy says it converted five blind land status
 *   writes, "the other four are now converted to" that shape. This was a sixth
 *   and was not among them.
 *
 *   TWO FAULTS, BOTH OF THEM #27's
 *   ------------------------------
 *   1. THE WRITE WAS UNCONDITIONAL. Farm Nation holds a buyer's money against
 *      `pending_escrow`. Approving from there put the parcel back on the public
 *      market with the escrow still open; rejecting from there took it off the
 *      market with the buyer's money still held and nothing in the flow to
 *      release it. #137's fault, fixed on the other doors, left standing here.
 *
 *   2. IT WROTE `status` ALONE. The decision is carried by three fields, and
 *      land-listing-status.ts derives verificationStatus from
 *      `obj.verified === true`. A listing approved through /land/verify was
 *      'verified' to a status reader and undecided to every reader that goes
 *      through the normaliser — #25 and #28 are the same split.
 *
 *   WHAT WAS CHECKED AND DELIBERATELY NOT CHANGED
 *   ----------------------------------------------
 *   The same file's owner EDIT and DELETE paths guard on isOwnerMutable() —
 *   read, check, then write — rather than claiming. That is a real race window,
 *   and converting it was the obvious next move. It is wrong, for two reasons
 *   the shared module states outright:
 *
 *     - OWNER_MUTABLE_STATUSES admits a NULL status on purpose: "legacy
 *       listings predate the vocabulary, and refusing them would strand their
 *       owners entirely". A claim refuses a null status, so converting would
 *       strand exactly those owners.
 *
 *     - The edit's target is `pending_verification`, which is itself an
 *       owner-mutable starting state. claimStatusTransitionFromAny strips the
 *       target from the starting set by design — `to → to` is not a transition
 *       — so editing an already-pending listing, the ordinary case, would be
 *       refused.
 *
 *   So check-then-write is the deliberate design there, not an oversight, and
 *   converting it would have broken two live flows to close a narrower window.
 *   Recorded rather than "fixed" — #384's rule applies to me as much as to the
 *   code.
 *
 *   The hardened admin/_land.ts copy is likewise LEFT IN PLACE. Both doors now
 *   claim, so neither is a trap; they take different arguments and serve
 *   different callers, and removing a "use server" export is a bigger change
 *   than this finding warrants.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the claim reverts to a raw .update()          KILLED
 *     the decision fields drop `verified`           KILLED
 *     the starting set becomes a hand-written list  KILLED
 *     the refusal stops naming the actual status    KILLED
 *     reword the header prose                       SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    APPROVABLE_FROM_STATUSES,
    REJECTABLE_FROM_STATUSES,
    OWNER_MUTABLE_STATUSES,
    isOwnerMutable,
} from '@/lib/land-listing-status';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

const LIVE = join(SRC, 'app/actions/land-actions.ts');
const HARDENED = join(SRC, 'app/actions/admin/_land.ts');
const SCREEN = join(SRC, 'app/land/verify/page.tsx');

/** The body of a named function in a file, read with comments stripped. */
function body(file: string, fn: string, span = 4000): string {
    const src = code(file);
    const at = src.indexOf(`function ${fn}(`);
    expect({ fn, found: at > -1 }).toEqual({ fn, found: true });
    return src.slice(at, at + span);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#397 — the wired door is the one that was blind', () => {
    it('THE SCREEN IMPORTS THE land-actions COPY, NOT THE ADMIN ONE', () => {
        const screen = code(SCREEN);
        expect(screen).toMatch(/from ["']@\/app\/actions\/land-actions["']/);
        expect(screen).toContain('verifyLandListing');
        // The finding is that this screen never reached admin/_land.ts.
        expect(screen).not.toMatch(/from ["']@\/app\/actions\/admin/);
    });

    it('and /land/verify is a real protected route, not a stray file', () => {
        const manifest = code(join(SRC, 'lib/route-manifest.ts'));
        expect(manifest).toContain('"/land/verify"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#397 — the decision is now one atomic claim', () => {
    it('THE LIVE DOOR CLAIMS THE TRANSITION AND NO LONGER RAW-UPDATES', () => {
        const fn = body(LIVE, '_verifyLandListing');
        expect(fn).toContain('claimStatusTransitionFromAny(');
        // The specific thing that was there before: a bare update of the row.
        expect(fn).not.toMatch(/collection\(COLLECTIONS\.LAND_LISTINGS\)[\s\S]{0,120}\.update\(/);
    });

    it('and its starting states come from the shared sets, not a sixth list', () => {
        // #26 was five hand-written approvable/rejectable sets that disagreed.
        const fn = body(LIVE, '_verifyLandListing');
        expect(fn).toContain('APPROVABLE_FROM_STATUSES');
        expect(fn).toContain('REJECTABLE_FROM_STATUSES');
        // Both sets are non-empty, so the assertion above is not satisfied by
        // an empty list that would refuse everything.
        expect(APPROVABLE_FROM_STATUSES.length).toBeGreaterThan(0);
        expect(REJECTABLE_FROM_STATUSES.length).toBeGreaterThan(0);
        // The state a buyer's money sits against must NOT be approvable.
        expect(APPROVABLE_FROM_STATUSES).not.toContain('pending_escrow');
        expect(APPROVABLE_FROM_STATUSES).not.toContain('pending');
    });

    it('and it writes all three fields the decision is carried by', () => {
        /**
         * Scoped to the CLAIM'S PATCH, not the function.
         *
         * The first draft asserted over the whole body and a mutant that
         * deleted `verified` from the patch SURVIVED: the audit log a few lines
         * below records `verified: validated.verified` in its metadata, which
         * satisfied the same check while the field had stopped being persisted.
         * An assertion that a row is written must read the write.
         */
        const fn = body(LIVE, '_verifyLandListing');
        const from = fn.indexOf('patch: {');
        expect(from).toBeGreaterThan(-1);
        const patch = fn.slice(from, fn.indexOf('recordPreviousAs'));

        // Writing `status` alone left the listing undecided to every reader
        // that goes through the verificationStatus normaliser.
        for (const field of ['verificationStatus', 'verified', 'verifiedBy', 'verifiedAt']) {
            expect({ field, written: new RegExp(`^\\s*${field}:`, 'm').test(patch) })
                .toEqual({ field, written: true });
        }
        // The audit metadata is NOT the write, and must not be mistaken for it.
        expect(patch).not.toContain('createAdminAuditLog');

        // And it records where it came from, so a reversal can restore it.
        expect(fn).toContain('recordPreviousAs');
    });

    it('and a refused decision tells the admin the actual state', () => {
        // A refusal that only says no sends the admin looking. #322.
        const fn = body(LIVE, '_verifyLandListing');
        expect(fn).toContain('transition.claimed');
        expect(fn).toMatch(/transition\.status/);
        expect(fn).toMatch(/purchase in progress/i);
    });

    it('and it matches the hardened sibling it was diverging from', () => {
        const live = body(LIVE, '_verifyLandListing');
        const admin = body(HARDENED, '_verifyLandListing');
        for (const shared of [
            'claimStatusTransitionFromAny(',
            'APPROVABLE_FROM_STATUSES',
            'REJECTABLE_FROM_STATUSES',
            'recordPreviousAs',
            'verificationStatus',
        ]) {
            expect({ shared, live: live.includes(shared), admin: admin.includes(shared) })
                .toEqual({ shared, live: true, admin: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#397 — why the owner edit and delete were NOT converted', () => {
    it('A CLAIM WOULD STRAND EVERY LEGACY LISTING WITH NO STATUS', () => {
        // OWNER_MUTABLE_STATUSES admits null on purpose; a claim cannot.
        expect(isOwnerMutable(null)).toBe(true);
        expect(isOwnerMutable(undefined)).toBe(true);
        expect(isOwnerMutable('')).toBe(true);
        // And it still refuses the states a purchase sits in.
        expect(isOwnerMutable('pending')).toBe(false);
        expect(isOwnerMutable('sold')).toBe(false);
    });

    it("and the edit's target is itself an owner-mutable starting state", () => {
        /**
         * claimStatusTransitionFromAny strips `to` from the starting set by
         * design — `to → to` is not a transition, and allowing it destroys the
         * single-winner property. The edit sets pending_verification, which is
         * owner-mutable, so a claim would refuse the ordinary case: editing a
         * listing that is already awaiting review.
         */
        expect(OWNER_MUTABLE_STATUSES).toContain('pending_verification');
    });

    it('and both paths still refuse a listing mid-purchase', () => {
        // The guard is check-then-write rather than a claim, which is the
        // deliberate trade. What it must not do is disappear.
        for (const fn of ['_updateLandListing', '_deleteLandListing']) {
            const src = body(LIVE, fn, 3000);
            expect({ fn, guarded: src.includes('isOwnerMutable(') })
                .toEqual({ fn, guarded: true });
        }
    });
});
