/**
 * One vocabulary for an admin decision on a land listing.
 *
 * WHAT THIS GUARDS
 * ----------------
 * Five separate code paths decide whether a land listing is approved or
 * rejected, and each hand-wrote its own list of statuses it was willing to act
 * on. The lists differed:
 *
 *   approve-land                pending, pending_verification,
 *                               inspection_scheduled, rejected
 *   land-listings verify        + draft
 *   _fn_admin verifyProperty    + available, approved, verified
 *   reject-land                 pending, pending_verification,
 *                               inspection_scheduled, verified
 *   land-listings reject        + draft, available, approved
 *
 * The consequence was not theoretical. `available` is the status farm-nation's
 * own creation path writes, and approve-land omitted it — so a farm-nation
 * listing could not be approved from the admin land queue, while
 * _fn_admin.verifyPropertyAction approved it without complaint. Which admin
 * screen the operator happened to be on decided whether the action worked.
 *
 * These tests assert the property that makes that unrepeatable: there is one
 * definition, every decision path reads it, and none of them keeps a literal.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    APPROVABLE_FROM_STATUSES,
    REJECTABLE_FROM_STATUSES,
    DECISION_LOCKED_STATUSES,
    PURCHASABLE_STATUSES,
    AWAITING_REVIEW_STATUSES,
    normaliseVerificationStatus,
} from '@/lib/land-listing-status';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

/**
 * The file with its comments removed.
 *
 * Every "must not contain" assertion below runs against this rather than the raw
 * source, and three of them failed against the raw source on the first run — not
 * because the defect was still present, but because the comment explaining the
 * defect quotes it verbatim. `"pending_review"`, `verificationStatus ===
 * "verified"` and the `...previous.verificationStatus` spread are all named in
 * the prose that records why they were wrong.
 *
 * That is the third time in this audit a source-scanning guard has flagged its
 * own documentation. Written down here so the stripping is understood as
 * necessary rather than mistaken for a way of weakening the check: the guards
 * are about what the code does, and a comment is not code.
 */
function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/**
 * Every path that writes a decision to a land listing's status.
 *
 * Kept as an explicit list rather than discovered by scanning, so that adding a
 * sixth decision path is a deliberate act that shows up in this file.
 */
const DECISION_PATHS = [
    'src/app/api/admin/farm-nation/approve-land/route.ts',
    'src/app/api/admin/farm-nation/reject-land/route.ts',
    'src/app/actions/farm-nation/_fn_admin.ts',
    'src/app/actions/land-listings.ts',
    'src/app/actions/admin/_land.ts',
    'src/app/actions/admin-content.ts',
];

describe('the approvable and rejectable sets', () => {
    it('include every for-sale spelling, which is what approve-land was missing', () => {
        // The defect, stated as an assertion. A listing already on sale under any
        // of the three spellings must be re-decidable, and approve-land's own
        // copy of the list contained none of them.
        for (const status of PURCHASABLE_STATUSES) {
            expect(APPROVABLE_FROM_STATUSES).toContain(status);
            expect(REJECTABLE_FROM_STATUSES).toContain(status);
        }
    });

    it('include everything awaiting review', () => {
        for (const status of AWAITING_REVIEW_STATUSES) {
            expect(APPROVABLE_FROM_STATUSES).toContain(status);
            expect(REJECTABLE_FROM_STATUSES).toContain(status);
        }
    });

    it('allow a rejection to be reversed and a reason to be corrected', () => {
        // Reversing a rejection is a real admin action; so is fixing the wording
        // of one. Both were possible before the guards existed, because there was
        // no guard, and both have to stay possible after.
        expect(APPROVABLE_FROM_STATUSES).toContain('rejected');
        expect(REJECTABLE_FROM_STATUSES).toContain('rejected');
    });

    it('exclude every status that money or a withdrawal depends on', () => {
        // The whole point of the guard. pending_escrow means a buyer has paid and
        // the money is held against this parcel; approving from there put it back
        // on the public market with the escrow still open, and rejecting from
        // there took it off the market with the buyer's money still held.
        for (const status of DECISION_LOCKED_STATUSES) {
            expect(APPROVABLE_FROM_STATUSES).not.toContain(status);
            expect(REJECTABLE_FROM_STATUSES).not.toContain(status);
        }
    });

    it('names the escrow statuses explicitly, so the exclusion cannot be vacuous', () => {
        // Without this, the test above passes just as well against an empty
        // DECISION_LOCKED_STATUSES — which is how a guard quietly stops guarding.
        expect(DECISION_LOCKED_STATUSES).toContain('pending_escrow');
        expect(DECISION_LOCKED_STATUSES).toContain('pending_payment');
        expect(DECISION_LOCKED_STATUSES).toContain('pending_transfer');
        expect(DECISION_LOCKED_STATUSES).toContain('sold');
        expect(DECISION_LOCKED_STATUSES).toContain('deleted');
    });

    it('does not overlap the locked set in either direction', () => {
        const locked = new Set<string>(DECISION_LOCKED_STATUSES);
        const decidable = [
            ...APPROVABLE_FROM_STATUSES,
            ...REJECTABLE_FROM_STATUSES,
        ];
        expect(decidable.filter((s) => locked.has(s))).toEqual([]);
    });
});

describe('every decision path reads the shared set', () => {
    it.each(DECISION_PATHS)('%s imports it', (rel: string) => {
        const src = source(rel);
        expect(src).toContain('@/lib/land-listing-status');
        expect(src).toMatch(/APPROVABLE_FROM_STATUSES|REJECTABLE_FROM_STATUSES/);
    });

    it.each(DECISION_PATHS)('%s keeps no local copy of the list', (rel: string) => {
        const src = code(rel);

        // The five names the local copies were declared under. A path that
        // reintroduces one has forked the vocabulary again, which is the whole
        // defect this file exists for.
        //
        // Matched as a declaration — `const NAME = [` — not as a bare mention, so
        // the comments in these files that explain the history do not trip it.
        expect(src).not.toMatch(/const\s+(APPROVABLE_FROM|REJECTABLE_FROM|VERIFIABLE_FROM)\s*(:[^=]+)?=\s*\[/);
    });

    it.each(DECISION_PATHS)('%s does not write a bare status literal for a decision', (rel: string) => {
        // A decision path must go through claimStatusTransitionFromAny, or — where
        // it is already inside a transaction — check the status it read before
        // writing. What it must not do is call .update() with a status and no
        // check, which is what all five did.
        const src = code(rel);

        const usesTransition = src.includes('claimStatusTransitionFromAny');
        const usesGuardedTransaction =
            src.includes('APPROVABLE_FROM_STATUSES.includes') ||
            src.includes('REJECTABLE_FROM_STATUSES.includes');

        expect(usesTransition || usesGuardedTransaction).toBe(true);
    });

    it('guards BOTH branches of the transaction-based path, not just one', () => {
        // The test above was too weak, and a mutation run proved it: deleting the
        // guard from admin-content's land APPROVAL left its land REJECTION guard
        // in the file, which satisfied the `||` and passed. One guard anywhere in
        // a file is not the property — every branch that writes a decision needs
        // its own.
        //
        // admin-content.ts is the only path that guards inside a transaction
        // rather than through claimStatusTransitionFromAny, so it is checked by
        // branch. The `case "land":` blocks are the two branches.
        const src = code('src/app/actions/admin-content.ts');
        const landBlocks = src.split('case "land": {').slice(1);

        // One in approveContentAction, one in rejectContentAction. If this ever
        // reads 1 or 3, the file's structure changed and the assertions below are
        // no longer looking at what they claim to.
        expect(landBlocks).toHaveLength(2);

        for (const block of landBlocks) {
            const branch = block.split('case "export": {')[0];
            expect(branch).toMatch(/if \(!(APPROVABLE|REJECTABLE)_FROM_STATUSES\.includes\(landStatusNow\)\)/);
            // The guard has to actually stop the write.
            expect(branch).toMatch(/success: false as const/);
        }
    });
});

describe('verificationStatus is one shape', () => {
    it('normalises the four strings that were written for it', () => {
        // create-listing wrote "pending"; admin-content and admin/_land wrote
        // "approved" and "rejected"; _fn_listings wrote "pending_review", which
        // matched no reader at all.
        expect(normaliseVerificationStatus('pending')).toBe('pending');
        expect(normaliseVerificationStatus('pending_review')).toBe('pending');
        expect(normaliseVerificationStatus('approved')).toBe('approved');
        expect(normaliseVerificationStatus('rejected')).toBe('rejected');
    });

    it('normalises the legacy object shape too', () => {
        // Live rows hold this: land-listings.ts and both API routes wrote an
        // object on the same field for as long as the string writers wrote a
        // string. No reader could handle both.
        expect(normaliseVerificationStatus({ verified: true })).toBe('approved');
        expect(normaliseVerificationStatus({ verified: false, rejectionReason: 'no survey plan' }))
            .toBe('rejected');
        expect(normaliseVerificationStatus({ verified: false })).toBe('pending');
    });

    it('treats a missing value as undecided rather than approved', () => {
        expect(normaliseVerificationStatus(undefined)).toBe('pending');
        expect(normaliseVerificationStatus(null)).toBe('pending');
        expect(normaliseVerificationStatus('')).toBe('pending');
        expect(normaliseVerificationStatus(42)).toBe('pending');
    });

    it('is never spread as an object by a writer again', () => {
        // THE regression test for a defect this audit introduced and then found.
        //
        // The approve-land and reject-land routes carried the previous decision
        // forward with `...(previous.verificationStatus ?? {})`, to stop a
        // rejection reason being erased when the rejection was reversed. But
        // create-listing sets that field to the STRING "pending" on every listing
        // made through the API, and spreading a string into an object literal
        // yields its indexed characters — so approving a newly created listing
        // wrote {0:"p", 1:"e", 2:"n", ..., verified:true} to the database.
        //
        // Scanned across src rather than asserted on the two known files: the
        // spread was copied from one route to another once already.
        const { execSync } = require('child_process') as typeof import('child_process');
        const files = execSync('grep -rl "verificationStatus" src || true', {
            encoding: 'utf-8',
            cwd: process.cwd(),
        })
            .split('\n')
            .filter((f: string) => f.trim() && !f.includes('__tests__'));

        const offenders = files.filter((f: string) => {
            const src = code(f);
            const spreads = /\.\.\.\(?[A-Za-z_$][\w$]*(\?\?[^)]*)?\)?\.?\w*verificationStatus/i.test(src);
            if (!spreads) return false;

            // Spreading it is fine WITH a type guard, and one place needs to:
            // land-visibility.ts strips an admin's id and review notes out of the
            // public payload, and rows written before the shape was unified still
            // hold the object. That is a reader handling a legacy value, not a
            // writer producing a new one — and the guard is precisely what the
            // writers lacked. So the guard is the test, not an exemption list.
            const guarded = /typeof\s+[\w.?[\]]*verificationStatus\s*===\s*["']object["']/i.test(src);
            return !guarded;
        });

        expect(offenders).toEqual([]);
    });

    it('keeps the type guard on the one reader that still spreads it', () => {
        // The other half of the test above: it passes if a spread is guarded, so
        // deleting the guard AND the spread together would also pass. This pins
        // that land-visibility.ts still strips the legacy nested object, because
        // dropping it would publish verifiedBy and rejectionReason for every row
        // written before the shape was unified.
        const src = code('src/lib/land-visibility.ts');

        expect(src).toMatch(/typeof copy\.verificationStatus === "object"/);
        expect(src).toContain('copy.verificationStatus = nested');
    });

    it('is written as a string by every decision path', () => {
        // The object form is gone from the writers. Asserted per-file because a
        // single remaining object writer is enough to put both shapes back in the
        // collection, and the readers split by shape.
        for (const rel of DECISION_PATHS) {
            expect(code(rel)).not.toMatch(/verificationStatus:\s*\{/);
        }
    });

    it('is no longer what the pending review queue asks the database for', () => {
        // admin/_land.ts queried `verificationStatus == "pending"`. That misses
        // every object-shaped value, and every "pending_review" — so a listing
        // whose owner uploaded the missing documents after a rejection never
        // reappeared for review. `status` is the authoritative field, and it is
        // what the other admin queue already used.
        const src = code('src/app/actions/admin/_land.ts');
        expect(src).not.toContain('.where("verificationStatus", "==", "pending")');
        expect(src).toContain('"status", "in", [...AWAITING_REVIEW_STATUSES]');
    });
});

describe('uploading the missing documents returns a listing to review', () => {
    it('moves the status, not just the derived field', () => {
        // The action existed for an owner whose listing was rejected for missing
        // documents. It set verificationStatus to "pending_review" — a value
        // nothing reads — and never touched `status`, so the listing stayed
        // `rejected` and never came back to an admin. The owner had no way to
        // make it, and no indication anything was wrong.
        const src = code('src/app/actions/farm-nation/_fn_listings.ts');

        expect(src).not.toContain('"pending_review"');
        expect(src).toContain('to: "pending_verification"');
        expect(src).toContain('AWAITING_VERIFICATION_STATUS');
    });

    it('resubmits only from rejected and draft', () => {
        // A live listing must not be pulled off the market because its owner
        // attached another document, and one with money against it is not this
        // action's to move.
        const src = source('src/app/actions/farm-nation/_fn_listings.ts');
        expect(src).toContain('const RESUBMITTABLE_FROM = ["rejected", "draft"]');
    });
});

describe('the admin review queue does not offer decisions it cannot make', () => {
    it('reports an unrecognised status as unavailable, not as pending', () => {
        // The mapping defaulted to "pending" and only moved off it for four
        // statuses. Everything else — available, approved, sold, leased,
        // pending_escrow, pending_payment, payment_confirmed, pending_transfer,
        // deleted — was reported to the page as awaiting review, and the page
        // renders Approve and Reject buttons on anything it is told is pending.
        // An admin was shown sold parcels and parcels with live escrows and
        // invited to decide on them.
        const src = code('src/app/actions/farm-nation-admin/_fna_verifications.ts');

        expect(src).toContain('else mappedVerificationStatus = "unavailable"');
        expect(src).not.toMatch(/let mappedVerificationStatus = "pending";/);
    });

    it('resolves each tab through one function, not three', () => {
        // The tab label was resolved independently by the database query, the
        // index-error fallback and the in-memory filter used when a search is
        // active. Searching within the verified tab could return a different
        // cohort from browsing it.
        const src = source('src/app/actions/farm-nation-admin/_fna_verifications.ts');
        expect(src).toContain('function statusesForTab');
        expect((src.match(/statusesForTab\(/g) || []).length).toBeGreaterThanOrEqual(4);
    });
});

describe('readers of "for sale" agree with the writers', () => {
    it('the map no longer tests a verificationStatus value nobody writes', () => {
        // `l.verificationStatus === "verified"` — the writers emit "pending",
        // "approved" and "rejected", never "verified". Dead code shaped like a
        // fallback, next to a `status === "verified"` that missed two of the three
        // for-sale spellings. So the map showed a strict subset of what /land
        // showed, from the same HTTP response.
        const src = code('src/app/farm-nation/map/page.tsx');

        expect(src).not.toContain('verificationStatus === "verified"');
        expect(src).toContain('isPurchasable(l.status)');
    });

    it('the admin content console lists and counts the same set', () => {
        // Its approved tab queried "verified" alone while its badge counted
        // "verified" alone — consistent with each other and with neither the
        // inventory nor the other admin screens.
        const src = code('src/app/actions/admin-content.ts');

        expect(src).not.toContain('.where("status", "==", "verified")');
        expect(src).toContain('"status", "in", [...PURCHASABLE_STATUSES]');
    });

    it('the land search returns every for-sale spelling', () => {
        const src = code('src/app/actions/land-listings.ts');
        expect(src).not.toContain('.where("status", "==", "verified")');
        expect((src.match(/\[\.\.\.PURCHASABLE_STATUSES\]/g) || []).length).toBeGreaterThanOrEqual(2);
    });
});
