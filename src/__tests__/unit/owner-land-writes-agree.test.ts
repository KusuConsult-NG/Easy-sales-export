/**
 * @jest-environment node
 */

/**
 *   #403 THREE OWNER WRITE PATHS, AND THE REPAIR REACHED TWO.
 *
 *   From the orphan queue. submitForVerificationAction has no screen, and
 *   following it turned up the same fault its siblings were fixed for.
 *
 *   WHAT IT DID
 *   -----------
 *   After an ownership check it wrote:
 *
 *       await listingRef.update({ status: "pending_verification", ... })
 *
 *   The current status was neither read nor checked. An ownership guard says
 *   who is calling, not what state the parcel is in — so the owner of a listing
 *   at `pending_escrow` (a buyer at Paystack) or `sold` could drag it back into
 *   review. The buyer's fulfilment and cancel both advance the listing FROM
 *   their status via claimStatusTransition, so after this write neither can ever
 *   fire: the money taken, the parcel back in the review queue, and nothing left
 *   that can move it out.
 *
 *   THE RULE ALREADY EXISTED
 *   -------------------------
 *   land-actions.ts had precisely this fault in updateLandListing and
 *   deleteLandListing. Both were fixed against OWNER_MUTABLE_STATUSES — the
 *   shared list of states an owner may still act from, with `pending` and every
 *   DECISION_LOCKED status refused. There are THREE owner write paths. The
 *   repair reached two. That is #297's class, and #276's, and #384's, and
 *   #397's: a fix landing on some of several copies.
 *
 *   NOT REACHED IS NOT UNREACHABLE. No screen calls this action — but
 *   land-listings.ts is "use server", so every export is a live HTTP endpoint
 *   any authenticated owner can post to. The absence of a button is not a guard,
 *   and that is the whole reason the orphan queue inspects unreached doors
 *   rather than waving them through.
 *
 *   A CONVERSION I WROTE AND THEN REVERSED
 *   ---------------------------------------
 *   The first version of this fix claimed the transition, matching the admin
 *   decision paths in the same file. #397 had already asked that exact question
 *   of the edit and delete paths and recorded why it is wrong:
 *
 *     - OWNER_MUTABLE_STATUSES admits a NULL status ON PURPOSE. Legacy listings
 *       predate the vocabulary, and the shared module says refusing them "would
 *       strand their owners entirely". claimStatusTransitionFromAny returns
 *       immediately on a null status, so a claim strands exactly those owners.
 *
 *     - The target, `pending_verification`, is itself an owner-mutable starting
 *       state, and the helper strips the target from the starting set by design.
 *
 *   So check-then-write is the design, not an oversight, and the three paths now
 *   share it. The window between the read and the write is real, is shared by
 *   all three, and is narrower than the hole it replaces. Recorded rather than
 *   closed, because closing it costs the legacy owners.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the guard is dropped                          KILLED
 *     the guard moves below the write                KILLED
 *     the guard uses a hand-written status list      KILLED
 *     the refusal stops naming the actual status     KILLED
 *     reword the header prose                        SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    OWNER_MUTABLE_STATUSES,
    DECISION_LOCKED_STATUSES,
    isOwnerMutable,
} from '@/lib/land-listing-status';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

const LISTINGS = join(SRC, 'app/actions/land-listings.ts');
const ACTIONS = join(SRC, 'app/actions/land-actions.ts');

/**
 * The body of a named function, bounded by an END MARKER rather than a span.
 *
 * #400's lesson: a fixed character count overran the function it was scoped to
 * and asserted against its neighbour. An assertion that a function does NOT do
 * something has to stop where the function does.
 */
function body(file: string, fn: string, end: string): string {
    const src = code(file);
    const at = src.indexOf(`function ${fn}(`);
    expect({ fn, found: at > -1 }).toEqual({ fn, found: true });
    const stop = src.indexOf(end, at);
    expect({ fn, bounded: stop > at }).toEqual({ fn, bounded: true });
    return src.slice(at, stop);
}

const SUBMIT = () => body(LISTINGS, '_submitForVerificationAction', 'export async function submitForVerificationAction');

// ─────────────────────────────────────────────────────────────────────────────
describe('#403 — the third owner write path applies the shared rule', () => {
    it('SUBMIT-FOR-VERIFICATION CHECKS THE STATUS BEFORE WRITING IT', () => {
        const fn = SUBMIT();
        const guardAt = fn.indexOf('isOwnerMutable(');
        const writeAt = fn.indexOf('status: "pending_verification"');

        expect({ guarded: guardAt > -1 }).toEqual({ guarded: true });
        expect({ writes: writeAt > -1 }).toEqual({ writes: true });
        expect({ guardFirst: guardAt < writeAt }).toEqual({ guardFirst: true });
    });

    it('and it uses the SHARED rule, not a hand-written status list', () => {
        /**
         * The point of the shared vocabulary (#26) is that the owner paths stop
         * disagreeing. A local array here would pass the assertion above and
         * reintroduce the drift.
         */
        const fn = SUBMIT();
        expect(fn).toContain('isOwnerMutable(listingData.status)');
        for (const status of DECISION_LOCKED_STATUSES) {
            expect({ status, hardcoded: fn.includes(`"${status}"`) })
                .toEqual({ status, hardcoded: false });
        }
    });

    it('and the refusal names the status that blocked it', () => {
        // #322: a refusal the user cannot act on is a failure in silence with
        // extra steps. The owner needs to know a purchase is in flight.
        const fn = SUBMIT();
        expect(fn).toMatch(/status: \$\{listingData\.status\}/);
        expect(fn).toMatch(/purchase is in progress or completed/i);
    });

    it('and all THREE owner write paths now apply it', () => {
        // The finding itself: the repair had reached two of three.
        const edits = code(ACTIONS);
        expect((edits.match(/isOwnerMutable\(/g) ?? []).length).toBe(2);
        expect((code(LISTINGS).match(/isOwnerMutable\(/g) ?? []).length).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#403 — the rule itself still says what the three paths rely on', () => {
    it('A LOCKED LISTING IS REFUSED AND A LEGACY ONE IS NOT', () => {
        /**
         * Both halves matter. The first is the defect; the second is why all
         * three paths check rather than claim — a claim cannot pass a null
         * status, and refusing null would strand every listing that predates the
         * vocabulary.
         */
        for (const status of DECISION_LOCKED_STATUSES) {
            expect({ status, mutable: isOwnerMutable(status) }).toEqual({ status, mutable: false });
        }
        expect(isOwnerMutable('pending')).toBe(false);

        for (const legacy of [null, undefined, '']) {
            expect({ legacy, mutable: isOwnerMutable(legacy as string | null | undefined) })
                .toEqual({ legacy, mutable: true });
        }
    });

    it('and it still admits the states an owner legitimately submits from', () => {
        // Positive control for the negatives above: the rule is not simply
        // "refuse everything", which would pass every assertion in this file.
        for (const status of ['draft', 'rejected', 'pending_verification']) {
            expect({ status, mutable: isOwnerMutable(status) }).toEqual({ status, mutable: true });
        }
        expect(OWNER_MUTABLE_STATUSES.length).toBeGreaterThan(3);
    });

    it('and the two lists it is built from stay disjoint', () => {
        // If a status ever appeared in both, the guard would admit a listing
        // whose money is in flight and no assertion above would notice.
        const locked = new Set(DECISION_LOCKED_STATUSES);
        expect(OWNER_MUTABLE_STATUSES.filter((s) => locked.has(s))).toEqual([]);
    });
});
