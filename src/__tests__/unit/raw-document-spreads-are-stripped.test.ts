/**
 * @jest-environment node
 */

/**
 *   #338 THE STRIP WRITTEN FOR RAW-DOCUMENT SPREADS WAS APPLIED TO THREE SITES
 *        AND MISSED TWO.
 *
 *        lib/admin-pii.ts exists for one reason, and says so in its own header:
 *
 *            "several of those lists also spread a raw user or registration
 *             document into the response, where the same values sit nested and
 *             survive any field-by-field gate applied above them.
 *             This is the strip for those spreads."
 *
 *        It was applied in admin/_users.ts, admin/_marketplace.ts and
 *        admin/_withdrawals.ts. Two more actions spread a raw document into
 *        the response and did not use it:
 *
 *          getStandardCooperativeMembersAction   data: { ...mergedData, bankDetails }
 *          getStandardExportApplicationsAction   data: { ...mergedData, bankDetails }   (x2)
 *
 *        `mergedData` is the whole membership/application document merged with
 *        the user document; the cooperative one then RE-ATTACHES `bankDetails`
 *        beside the spread, account number in the clear. Both actions gate on
 *        isAdmin(), which is true for all TEN admin roles — a support or
 *        moderator account included.
 *
 *        AND IT IS RENDERED. Both screens hand that object to
 *        DynamicDetailModal, which renders every key not on a fixed exclude
 *        list. That list covers `bvnVerified`, `bvnStatus` and
 *        `bvnVerificationDetails` — and NOT `bvn`. Same for nin. So the numbers
 *        were displayed, field by field, with a "Verify" button beside them.
 *
 *        This is #152's finding on two more screens: there, the fix added a
 *        maySeePii gate to the admin user directory. The pattern the codebase
 *        settled on is to gate on the permission the screen exists to exercise
 *        — _withdrawals.ts uses finance:process_withdrawals, _marketplace.ts
 *        uses marketplace:approve_sellers — so these use
 *        cooperatives:approve_members and export:approve_applications. An admin
 *        who can approve the member can see what they are approving; everyone
 *        else gets the record with the identity and money keys removed at any
 *        depth.
 *
 *        CHECKED AND ALREADY CORRECT: farm-nation-admin/_fna_registrants.ts
 *        gates the same spread by destructuring bvn, nin and the bank fields
 *        out of the user document behind maySeeBankDetails. Different
 *        mechanism, same effect — left alone rather than rewritten.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { stripPii, PII_KEYS } from '@/lib/admin-pii';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const COOP = 'src/app/actions/cooperative/_coop_admin_members.ts';
const EXPORTS = 'src/app/actions/admin/_exports.ts';
const MODAL = 'src/components/admin/DynamicDetailModal.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#338 — the strip itself removes what a spread would carry', () => {
    it('REMOVES bvn, nin, bank details AND next of kin, at any depth', () => {
        const record = {
            fullName: 'A Member',
            bvn: '22222222222',
            nin: '11111111111',
            bankDetails: { accountNumber: '0123456789', bankName: 'X' },
            nextOfKin: { name: 'B', phone: '080' },
            serviceRegistrations: {
                cooperative: { status: 'active', verificationProfile: { bvn: '333' } },
            },
        };

        const out = stripPii(record) as Record<string, any>;

        expect(out.fullName).toBe('A Member');            // the admin still works
        expect(out.bvn).toBeUndefined();
        expect(out.nin).toBeUndefined();
        expect(out.bankDetails).toBeUndefined();
        expect(out.nextOfKin).toBeUndefined();
        expect(out.serviceRegistrations.cooperative.status).toBe('active');
        expect(out.serviceRegistrations.cooperative.verificationProfile).toBeUndefined();
    });

    it('VACUITY GUARD: the key list is not empty and names the identity numbers', () => {
        expect(PII_KEYS.length).toBeGreaterThan(5);
        for (const key of ['bvn', 'nin', 'bankDetails', 'nextOfKin']) {
            expect(PII_KEYS).toContain(key);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#338 — the two spreads that were not gated, now are', () => {
    it('THE COOPERATIVE MEMBER LIST STRIPS WHEN THE CALLER MAY NOT APPROVE', () => {
        // THE test.
        const coop = source(COOP);
        expect(coop).toMatch(/data: maySeeMemberPii/);
        expect(coop).toMatch(/stripPii\(\{ \.\.\.mergedData, bankDetails \}\)/);
    });

    it('gated on the permission the screen exists to exercise', () => {
        expect(source(COOP)).toMatch(
            /const maySeeMemberPii = hasAdminPermission\(liveRoles, "cooperatives:approve_members"\)/);
    });

    it('THE EXPORT APPLICATION LIST DOES THE SAME, AT BOTH OF ITS SPREADS', () => {
        const exp = source(EXPORTS);
        const gated = exp.match(/data: maySeeApplicantPii/g) ?? [];
        // Two branches — the gender-sorted one and the ordinary one. A fix that
        // reached one of them is the shape this audit keeps finding.
        expect(gated.length).toBe(2);

        const stripped = exp.match(/stripPii\(\{ \.\.\.mergedData, bankDetails \}\)/g) ?? [];
        expect(stripped.length).toBe(2);
    });

    it('and on export:approve_applications', () => {
        expect(source(EXPORTS)).toMatch(
            /const maySeeApplicantPii = hasAdminPermission\(session\.user\.roles, "export:approve_applications"\)/);
    });

    it('the raw spread is still THERE for a caller who may see it', () => {
        // The counterpart guard: this finding is a gate, not a removal. An
        // admin approving a member must still see what they are approving.
        expect(source(COOP)).toMatch(/\{ \.\.\.mergedData, bankDetails \}/);
        expect(source(EXPORTS)).toMatch(/\{ \.\.\.mergedData, bankDetails \}/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#338 — the sites that already had it still do', () => {
    it('POSITIVE CONTROL: three earlier call sites are untouched', () => {
        expect(source('src/app/actions/admin/_users.ts')).toContain('stripRegistrationPii(');
        expect(source('src/app/actions/admin/_marketplace.ts')).toContain('stripPii(canonical)');
        expect(source('src/app/actions/admin/_withdrawals.ts')).toContain('stripPii(w)');
    });

    it('and farm-nation, which gates the same spread its own way', () => {
        // Checked and left alone: it destructures the sensitive keys out of the
        // user document behind maySeeBankDetails rather than calling stripPii.
        const fna = source('src/app/actions/farm-nation-admin/_fna_registrants.ts');
        expect(fna).toContain('maySeeBankDetails');
        expect(fna).toMatch(/nin: _nin, bvn: _bvn/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#338 — why it mattered: the modal renders whatever it is handed', () => {
    it('excludes the bvn STATUS fields and not the number itself', () => {
        // The reason a server-side strip is the fix rather than a UI tweak: the
        // modal is a denylist over an arbitrary document, so anything the
        // server sends and the list does not name is displayed.
        const modal = source(MODAL);
        expect(modal).toContain('"bvnVerified", "bvnStatus", "bvnVerificationDetails"');
        expect(modal).not.toMatch(/defaultExclude[\s\S]{0,400}"bvn",/);
    });

    it('and both screens hand it their record', () => {
        for (const page of [
            'src/app/admin/cooperatives/members/page.tsx',
            'src/app/admin/export/applications/page.tsx',
        ]) {
            expect(source(page)).toContain('DynamicDetailModal');
        }
    });
});
