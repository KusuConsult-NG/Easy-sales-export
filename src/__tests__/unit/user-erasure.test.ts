/**
 * @jest-environment node
 */

/**
 *   #283 THE RIGHT-TO-ERASURE SCRUB DELETED THE NESTED COPY AND LEFT THE FLAT
 *        ONE, AND NEVER TOUCHED BVN, NIN OR NEXT OF KIN.
 *
 *        deleteAccountAction's own comment says "Scrub all PII". It removed ten
 *        fields: fullName, email, phone, gender, address, bankDetails,
 *        serviceRegistrations, mfaEnabled, totpSecret, mfaRecoveryCodes.
 *
 *        A user document carries considerably more, and the omissions are the
 *        fields that matter most:
 *
 *          bvn, nin        Nigerian national identity numbers
 *          nextOfKin       a THIRD PARTY's name, phone and address — somebody
 *                          who never consented and cannot request erasure here
 *          documents       URLs to the ID scan, passport photo and proof of
 *                          address
 *          dateOfBirth, occupation, votersCardNumber, taxId, cacNumber,
 *          companyName, idNumber
 *
 *        AND ON EVERY FIELD THIS CODEBASE STORES TWICE, IT REMOVED ONE COPY:
 *
 *          address        deleted   residentialAddress  KEPT
 *          bankDetails    deleted   bankAccountNumber, bankAccountName,
 *                                   bankCode            KEPT
 *          fullName       redacted  firstName, lastName, otherName  KEPT
 *
 *        The type itself flags both duplications in its own comments —
 *        "Top-level bank fields — written directly by payout actions" and
 *        "Synced globally for dispatch/delivery routing". So erasure removed
 *        the copy somebody remembered and left the copy added later. #85's
 *        shape ("the admin user table skipped users.name"), as a compliance
 *        failure.
 *
 *        IT COMPOUNDS #280. Those `documents` URLs are public Cloudinary links
 *        with no expiry, so after a "deletion" the person's ID document was
 *        still downloadable AND the link was still sitting on their row.
 *
 * WHY A SHARED MODULE
 * -------------------
 * A hand-written list in one file is how the omission happened. The set lives
 * in lib/user-erasure.ts now, and the ratchet at the bottom of this file checks
 * it against the User interface: a new PII field on that type fails here rather
 * than quietly surviving erasure.
 *
 * AND ONE THING NOT CHANGED, ON PURPOSE — see the report to the owner
 * ------------------------------------------------------------------
 * There are TWO deletion paths. bulk-user-operations.ts, the admin's bulk
 * delete, scrubs NOTHING: it writes `deleted`, `deletedAt`, `deletedBy`,
 * `deletionReason` and `suspended`, and every personal field survives intact.
 *
 * That is left alone deliberately. A member exercising erasure and an admin
 * removing an account for moderation are different requests, and destroying the
 * record an admin may need to investigate is not a change to make unasked. It
 * is reported rather than fixed, and pinned below so the difference is a
 * decision instead of an oversight.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ERASED_FIELDS, userErasurePatch, erasedEmailFor } from '@/lib/user-erasure';

const SHARED_TYPES = 'src/lib/types/shared.ts';
const USER_ACTIONS = 'src/app/actions/user.ts';
const BULK = 'src/app/actions/bulk-user-operations.ts';
/** #206 — the one implementation both admin doors call. */
const OPERATION = 'src/lib/user-soft-delete.ts';

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** The fields declared on `interface User`. */
function userTypeFields(): string[] {
    const src = readFileSync(join(process.cwd(), SHARED_TYPES), 'utf-8');
    const start = src.indexOf('export interface User {');
    const body = src.slice(start, src.indexOf('\n}', start));

    return [...body.matchAll(/^\s{4}(\w+)\??\s*:/gm)].map((m) => m[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#283 — what erasure removes', () => {
    const patch = userErasurePatch('u-1');

    it('REMOVES THE NATIONAL IDENTITY NUMBERS', () => {
        // The sharpest omission: these are the most sensitive values on the
        // record and the old list did not mention them.
        for (const f of ['bvn', 'nin', 'votersCardNumber', 'idNumber']) {
            expect({ f, erased: f in patch }).toEqual({ f, erased: true });
        }
    });

    it('REMOVES THE NEXT OF KIN, WHO NEVER CONSENTED', () => {
        // A third party's name, phone and address, held because somebody else
        // filled in a form. They cannot request their own erasure here.
        expect('nextOfKin' in patch).toBe(true);
    });

    it('REMOVES THE IDENTITY DOCUMENT URLS', () => {
        // #280: those links are public and unexpiring, so leaving them on the
        // row leaves the documents themselves reachable after "deletion".
        expect('documents' in patch).toBe(true);
    });

    it('REMOVES BOTH COPIES OF THE BANK DETAILS', () => {
        // The defect in one assertion. The old list deleted the nested object
        // and left the three flat fields the type says payout actions write.
        for (const f of ['bankDetails', 'bankAccountNumber', 'bankAccountName', 'bankCode']) {
            expect({ f, erased: f in patch }).toEqual({ f, erased: true });
        }
    });

    it('AND BOTH COPIES OF THE ADDRESS, AND EVERY SPELLING OF THE NAME', () => {
        for (const f of ['address', 'residentialAddress', 'firstName', 'lastName', 'otherName']) {
            expect({ f, erased: f in patch }).toEqual({ f, erased: true });
        }
    });

    it('replaces fullName and email rather than deleting them', () => {
        // Deliberate: several screens read both unconditionally and would
        // render "undefined", and the placeholder address is what the auth
        // revocation is handed.
        expect(patch.fullName).toBe('Redacted User');
        expect(patch.email).toBe(erasedEmailFor('u-1'));
    });

    it('and keeps the uid and roles, which is the documented choice', () => {
        // Vacuity guard from the other side: a patch that erased everything
        // would break `sellerId` on historical orders. uid and roles are not in
        // the erased set.
        expect(ERASED_FIELDS).not.toContain('uid');
        expect(ERASED_FIELDS).not.toContain('roles');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#283 — the action uses the shared definition', () => {
    it('deleteAccountAction spreads userErasurePatch', () => {
        const src = codeOnly(USER_ACTIONS);

        expect(src).toContain('userErasurePatch(userId)');
    });

    it('and no longer carries its own hand-written field list', () => {
        // The ratchet on the shape of the defect: a second list beside the
        // shared one is how the two would drift apart again.
        const src = codeOnly(USER_ACTIONS);
        const start = src.indexOf('userErasurePatch(userId)');
        const block = src.slice(start, start + 700);

        expect(block).not.toMatch(/bankDetails:\s*FieldValue\.delete/);
        expect(block).not.toMatch(/phone:\s*FieldValue\.delete/);
    });

    it('and the revocation placeholder comes from the same module', () => {
        // It was spelled out twice, in the scrub and in revokeAuthAccess. Two
        // copies of the address a deleted account is renamed to is a small
        // version of the same problem.
        expect(codeOnly(USER_ACTIONS)).toContain('erasedEmailFor(userId)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#283 — a new PII field cannot be added without erasure hearing about it', () => {
    /**
     * The point of the module. Every field on `interface User` is either
     * erased, or listed below as deliberately kept — and anything else fails,
     * so adding a field to the type forces the decision.
     */
    const KEPT: string[] = [
        // Identity of the ROW, not of the person.
        'uid', 'roles',

        // Verification and status flags. Booleans about a decision, carrying no
        // personal detail once the values behind them are gone.
        'verified', 'isVerified', 'ninVerified', 'bvnVerified', 'idVerified',
        'tinVerified', 'cacVerified', 'sellerPhoneVerified',
        'sellerVerificationStatus', 'sellerVerificationId', 'isVerifiedBadge',
        'verifiedBadgeGrantedAt', 'allowsPaymentOnDelivery', 'sellerCategory',

        // Cooperative membership pointers — ids and a tier, needed by the
        // member's own historical rows.
        'cooperativeId', 'cooperativeMembershipId', 'cooperativeTier',
        'cooperativeRegistrationFee',

        // Consent bookkeeping. Deleting the record that consent was given, and
        // when, would remove the evidence a regulator asks for.
        'consentVersion', 'consentDate', 'marketingOptIn',

        // Preferences and product state, not personal data.
        'mfaEnabled', 'notifications', 'onboardingCompleted',

        // Replaced rather than deleted; asserted above.
        'fullName', 'email',

        // Row bookkeeping, not personal data. `_version` is the adapter's
        // optimistic-concurrency counter; the timestamps say when the row
        // changed, and deletedAt is itself one of them.
        'createdAt', 'updatedAt', '_version',
    ];

    it('the type is readable, so this is not vacuous', () => {
        expect(userTypeFields().length).toBeGreaterThan(25);
    });

    it('EVERY FIELD ON THE User TYPE IS ERASED OR DELIBERATELY KEPT', () => {
        const unaccounted = userTypeFields()
            .filter((f) => !(ERASED_FIELDS as readonly string[]).includes(f))
            .filter((f) => !KEPT.includes(f));

        // If this fails, somebody added a field to `interface User`. Decide
        // which list it belongs on — that decision is the whole point.
        expect(unaccounted).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#283 — the admin deletion path, pinned as OPEN', () => {
    /**
     * bulk-user-operations.ts scrubs nothing. Left that way on purpose: an
     * admin removing an account for moderation is not the same request as a
     * member exercising erasure, and destroying a record an admin may need to
     * investigate is not a change to make unasked.
     *
     * Pinned so it stays a decision. When the owner says which it should be,
     * this test fails and gets replaced.
     */
    it('#206 — THE ADMIN BULK DELETE SCRUBS NOW, and through the same operation', () => {
        // WAS: "the admin bulk delete still retains every personal field —
        // owner decision", pinning the defect so it stayed a decision rather
        // than a habit. The decision is taken.
        //
        // The bulk door wrote five bookkeeping fields and nothing else, for up
        // to fifty people at a time, while five successive fixes all landed on
        // its sibling. Both now call softDeleteUserRecord, so there is one
        // implementation of "delete a user" rather than two that agree today.
        const src = codeOnly(BULK);

        expect(src).toContain('softDeleteUserRecord(userId');
        // The bookkeeping it always did is still there — the reason and the
        // mark are what an operator reads afterwards.
        expect(src).toContain('deletionReason: reason');
        // And it does NOT keep its own copy of the scrub.
        expect(src).not.toContain('userErasurePatch');
    });

    it('and the scrub it runs is the one this module defines', () => {
        // The link between the two, so "calls the operation" cannot become
        // true of an operation that scrubs nothing.
        expect(codeOnly(OPERATION)).toContain('userErasurePatch(targetUserId)');
        expect(codeOnly(OPERATION)).toContain('eraseModuleApplications(targetUserId)');
    });
});
