/**
 * @jest-environment node
 */

/**
 *   #495 3,605 PROFILES CALL THEMSELVES VERIFIED AND NOBODY EVER VERIFIED THEM.
 *
 *   Measured on the production database while auditing admin/_users.ts:
 *
 *       profiles                                          42,160
 *       marked verified                                   41,338   (98.1%)
 *       carrying `_system_skeleton_backfill: true`         3,605
 *         ...marked verified                               3,605   (every one)
 *         ...whose fullName is "Unknown Member"            2,591
 *
 *   Those 2,591 have no name, no email and no phone, and they carry
 *   `verified`, `isVerified` AND `profileComplete` all true. The writer is in
 *   no commit on any branch — `git log -S` finds neither the marker nor the
 *   string "Unknown Member" — so it ran from outside this repository on
 *   29 May 2026 and its intent survives only in what it left.
 *
 *   THE ADMIN CONSOLE BELIEVED ALL OF IT. `data.isVerified ?? data.verified ??
 *   false` answered true for every one, so the badge, the "Verified" filter and
 *   every total counted 3,605 manufactured rows as verified members.
 *
 * ── AND THEY ARE NOT INERT ──────────────────────────────────────────────────
 *
 *   Referenced by 98 wallets (all zero), 48 cooperative memberships, 19 academy
 *   applications, 12 transactions and 12 processed payments. Seven of those
 *   memberships are `paymentStatus: completed, membershipStatus: active`, and
 *   the transactions are ₦10,000 "Cooperative membership registration fee",
 *   status completed. People paid, and the platform cannot name them.
 *
 *   That half is a reconciliation job against the payment provider, not a code
 *   change, and it is reported rather than guessed at here.
 *
 * ── WHAT THIS CHANGES, AND WHAT IT REFUSES TO ───────────────────────────────
 *
 *   NOT ONE STORED FIELD IS TOUCHED. Every row keeps `isVerified: true`. What
 *   changes is the conclusion drawn from it, in ONE place, so the badge, the
 *   filter and the export cannot drift — the "N doors" class this audit keeps
 *   meeting.
 *
 *   THEY ARE NOT HIDDEN EITHER. `unevidenced` is a state an admin can filter
 *   to. Dropping 3,605 rows from a count while giving nobody a way to see them
 *   is the same defect facing the other way.
 *
 *   AND AN ADMIN CAN OVERRULE IT. `verifiedBy` — which the backfill never wrote
 *   and the toggle always does — means a human decided, and then their decision
 *   is the answer. Without that escape hatch a manufactured row would read
 *   unevidenced forever, including after somebody looked at it and pressed the
 *   button.
 *
 * ── THE 34k COMMENT WAS FALSE, AND IT WAS LOAD-BEARING ──────────────────────
 *
 *       "Do NOT filter isVerified via Firestore query — 34k+ legacy users have
 *        `verified: true` but NOT `isVerified`."
 *
 *   Measured: ZERO such rows. 41,362 of 42,160 carry `isVerified`; the 798 that
 *   do not are not `verified: true` either. data-recovery.ts:305 reconciles that
 *   exact pair and has evidently already run. I reported that stale claim as a
 *   live defect before measuring it, and it was not one — the correction is
 *   recorded here because the number, not the sentence, is what settles it.
 *
 *   The in-memory filter stays, for a reason that IS true: `unevidenced` is a
 *   conjunction of two stored fields and no `where()` can express it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    isManufacturedProfile,
    hasContactableIdentity,
    hasHumanVerificationDecision,
    verificationState,
    isVerifiedMember,
    MANUFACTURED_PROFILE_MARKER,
} from '@/lib/profile-provenance';

const code = (rel: string) => stripComments(readFileSync(rel, 'utf-8'), { label: rel });

/** A row exactly as the backfill wrote it, copied from production. */
const MANUFACTURED = {
    uid: '9d8d77d4-6819-4dc8-8ffb-3c518287c85f',
    email: '',
    phone: '',
    roles: ['general_user'],
    fullName: 'Unknown Member',
    firstName: 'Unknown',
    lastName: 'Member',
    verified: true,
    isVerified: true,
    profileComplete: true,
    _schemaVersion: 2,
    serviceRegistrations: {},
    _system_skeleton_backfill: true,
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#495 — a flag a script set is not a verification', () => {
    it('THE MANUFACTURED ROW DOES NOT COUNT AS A VERIFIED MEMBER', () => {
        //   THE test. `isVerified: true` on a row with no name, no email and no
        //   phone, written by an unattended backfill.
        expect(isVerifiedMember(MANUFACTURED)).toBe(false);
        expect(verificationState(MANUFACTURED)).toBe('unevidenced');
    });

    it('AND IT IS NOT CALLED UNVERIFIED EITHER', () => {
        //   The person did not fail a check. Nobody ran one. Reporting them as
        //   "unverified" would be a second false statement about the same row,
        //   and would bury them in a list of people who can be chased.
        expect(verificationState(MANUFACTURED)).not.toBe('unverified');
    });

    it('AND A REAL VERIFIED MEMBER IS UNAFFECTED', () => {
        //   The control. A change that makes everybody unevidenced would pass
        //   every assertion above.
        expect(verificationState({ isVerified: true })).toBe('verified');
        expect(isVerifiedMember({ isVerified: true })).toBe(true);
    });

    it('AND THE LEGACY SPELLING IS STILL READ', () => {
        //   The 34k population no longer exists — measured zero — but both
        //   spellings still appear in writes, so reading one is how it drifts
        //   back. A guard now, not a population.
        expect(verificationState({ verified: true })).toBe('verified');
        expect(verificationState({ isVerified: false, verified: true })).toBe('unverified');
    });

    it('AN ADMIN DECISION OVERRULES THE PROVENANCE', () => {
        //   The escape hatch. Without it the marker is a life sentence, and an
        //   admin who reviews the row and presses Verify sees no change.
        const decided = { ...MANUFACTURED, verifiedBy: 'admin-7' };

        expect(hasHumanVerificationDecision(decided)).toBe(true);
        expect(verificationState(decided)).toBe('verified');
    });

    it('and a blank verifiedBy is not a decision', () => {
        expect(hasHumanVerificationDecision({ verifiedBy: '   ' })).toBe(false);
        expect(verificationState({ ...MANUFACTURED, verifiedBy: '' })).toBe('unevidenced');
    });

    it('and the marker is matched exactly, not by truthiness', () => {
        //   A row storing the STRING "false" would otherwise read as
        //   manufactured, and this decides whether somebody counts.
        expect(isManufacturedProfile({ [MANUFACTURED_PROFILE_MARKER]: 'false' })).toBe(false);
        expect(isManufacturedProfile({ [MANUFACTURED_PROFILE_MARKER]: true })).toBe(true);
        expect(isManufacturedProfile(null)).toBe(false);
        expect(isManufacturedProfile(undefined)).toBe(false);
    });

    it('and the unreachable ones are told apart from the merely unevidenced', () => {
        //   2,591 of the 3,605 have nothing on them at all. Both are
        //   unevidenced; only one is also uncontactable, and that is the
        //   difference between "decide about this" and "you cannot ask them".
        expect(hasContactableIdentity(MANUFACTURED)).toBe(false);
        expect(hasContactableIdentity({ ...MANUFACTURED, email: 'a@b.ng' })).toBe(true);
        expect(hasContactableIdentity({ email: '   ' })).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#495 — the admin console asks the shared question', () => {
    it('THE ROW MAPPING NO LONGER INLINES THE CHAIN', () => {
        //   The "N doors" guard. An inline `isVerified ?? verified ?? false`
        //   anywhere is a door that has not been told about provenance.
        const body = code('src/app/actions/admin/_users.ts');

        expect(body).toContain('isVerified: isVerifiedMember(data)');
        expect(body).not.toMatch(/isVerified:\s*data\.isVerified \?\? data\.verified/);
    });

    it('AND THE FILTER SPLITS THREE WAYS, ON THE STATE', () => {
        //   Anchored on the CONDITION, not the name: an assertion that the file
        //   merely mentions `verificationState` is satisfied by the import line
        //   while the filter still reads a boolean. That exact trap has been hit
        //   in #486, #490 and #493.
        const body = code('src/app/actions/admin/_users.ts');

        expect(body).toContain('u.verificationState === "verified"');
        expect(body).toContain('u.verificationState === "unverified"');
        expect(body).toContain('u.verificationState === "unevidenced"');
        expect(body).not.toMatch(/filter\(u => u\.isVerified === true\)/);
    });

    it('AND THE STALE 34k CLAIM IS GONE, WITH THE MEASUREMENT IN ITS PLACE', () => {
        //   Pins what must be TRUE rather than the absence of a phrase — #493
        //   recorded that trap after a `not.toMatch` matched neither the old
        //   wording nor its correction.
        const body = readFileSync('src/app/actions/admin/_users.ts', 'utf-8');

        expect(body).toMatch(/MEASURED ON PRODUCTION/);
        expect(body).toMatch(/ZERO/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#495 — and the toggle takes a target state, closing #294', () => {
    it('THE ACTION ACCEPTS A DESIRED STATE', () => {
        const body = code('src/app/actions/admin/_users.ts');

        expect(body).toMatch(/desired\?: boolean/);
        expect(body).toContain('typeof desired === "boolean" ? desired : !isVerifiedMember(currentData)');
    });

    it('AND IT NO LONGER FLIPS THE RAW FIELD', () => {
        //   `!currentData.isVerified` read the stored byte while the list
        //   rendered the computed state. On a manufactured row those disagree.
        const body = code('src/app/actions/admin/_users.ts');

        expect(body).not.toMatch(/!currentData\.isVerified/);
    });

    it('AND IT WRITES BOTH SPELLINGS SO THEY CANNOT DRIFT', () => {
        //   The write set `isVerified` only while readers ask for either —
        //   canonical/normalizer.ts:98 ORs them — so each click moved one and
        //   left the other.
        const body = code('src/app/actions/admin/_users.ts');
        const at = body.indexOf('isVerified: newVerificationStatus');
        const block = body.slice(at, at + 300);

        expect(at).toBeGreaterThan(-1);
        expect(block).toContain('verified: newVerificationStatus');
    });

    it('and both call sites say what they want', () => {
        //   Bulk verify asks for `true` — #294 made it skip already-verified
        //   rows and recorded that the race stayed open. The single row sends
        //   the negation of what the admin is looking at.
        const page = code('src/app/admin/users/page.tsx');

        expect(page).toContain('toggleUserVerificationAction(user.id, true)');
        expect(page).toMatch(/toggleUserVerificationAction\(userId, !\(row\?\.isVerified \?\? false\)\)/);
    });
});
