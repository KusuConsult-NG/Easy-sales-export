/**
 * @jest-environment node
 */

/**
 * An academy subscription minted a paid cooperative membership, through a
 * passport-photo upload.
 *
 * WHAT HAPPENED
 * -------------
 * updatePassportPhotoAction(passportUrl, passportName) and
 * updateMemberProfileDetailsAction(gender, stateOfOrigin) are profile editors on
 * /cooperatives/id-card. Both did the same thing when no member document
 * existed and the caller held an academy plan of foundation/standard/elite/
 * advanced: they created one.
 *
 *     membershipStatus: "active",
 *     status:           "active",
 *     paymentStatus:    "completed",
 *
 * A completed payment that never happened. The cooperative registration fee was
 * skipped outright, and _checkCooperativeStatusAction finishes the job — it
 * reads a member document at "active", heals the user document from it, and
 * grants `roles: arrayUnion("cooperative_member")`. Full cooperative access:
 * dashboard, contributions, loans, withdrawals, the member directory.
 *
 * WHY THIS IS A HOLE AND NOT A FEATURE
 * ------------------------------------
 * The platform HAS sanctioned auto-provisioning, in lib/cooperative-provisioning.ts,
 * and both of its paths are tightly gated:
 *
 *   autoProvisionZereCooperative    isPaymentBypassAccount(email)
 *   autoProvisionLegacyCooperative  userData.legacyOnboardedBy, under the
 *                                   comment "Restrict strictly to legacy
 *                                   onboarded members only to prevent
 *                                   auto-provisioning normal users"
 *
 * That module's own header says it lives outside "use server" precisely so
 * "provision a paid membership for an arbitrary user" cannot be reached as an
 * RPC. These two actions were that RPC, gated on nothing but a subscription.
 *
 * And the branch served nobody real. Cooperative access requires the
 * `cooperative_member` role or a cooperatives registration of approved/active;
 * an academy plan is neither. So /cooperatives/id-card — the only caller of
 * both actions, and the page the branch existed for — is unreachable to the
 * subscribers it was written for. The only way in was to call the action
 * directly.
 *
 * Both refuse now, exactly as they already did for everybody else.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const IDENTITY = 'src/app/actions/cooperative/_coop_identity.ts';
const PROVISIONING = 'src/lib/cooperative-provisioning.ts';
const MEMBERSHIP = 'src/app/actions/cooperative/_coop_membership.ts';
const ROLE_MAP = 'src/lib/module-access-check.ts';
const ID_CARD_PAGE = 'src/app/cooperatives/(member)/id-card/page.tsx';
const MEMBER_LAYOUT = 'src/app/cooperatives/(member)/layout.tsx';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

function fn(rel: string, name: string): string {
    const src = code(rel);
    const start = src.search(new RegExp(`(export )?(async )?function ${name}\\(`));
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 10);
    const end = after.search(/\n(export )?(async )?function /);
    return end > 0 ? after.slice(0, end) : after;
}

const EDITORS: Array<[string, string]> = [
    ['the passport-photo editor', 'updatePassportPhotoAction'],
    ['the gender/state editor', 'updateMemberProfileDetailsAction'],
];

describe('sanctioned provisioning is narrow, which is the premise', () => {
    it('one path is the payment-bypass account and nothing else', () => {
        const prov = code(PROVISIONING);

        expect(prov).toContain('if (!isPaymentBypassAccount(email)) return;');
    });

    it('the other is an admin-set legacy marker, and says why', () => {
        const raw = readFileSync(join(process.cwd(), PROVISIONING), 'utf-8');

        expect(code(PROVISIONING)).toContain('if (!userData?.legacyOnboardedBy) {');
        expect(raw).toContain('prevent auto-provisioning normal users');
    });

    it('and neither lives in a "use server" module, deliberately', () => {
        const raw = readFileSync(join(process.cwd(), PROVISIONING), 'utf-8');

        // The directive, not the word — the header discusses it at length.
        expect(code(PROVISIONING).trimStart()).not.toMatch(/^"use server"/);
        expect(raw).toContain('every export of a "use server" module is a callable endpoint');
    });

    it('while the identity actions ARE such endpoints', () => {
        expect(readFileSync(join(process.cwd(), IDENTITY), 'utf-8').trimStart()).toMatch(/^"use server"/);
    });
});

describe.each(EDITORS)('%s', (_label: string, name: string) => {
    const body = fn(IDENTITY, name);

    it('no longer creates a membership when none exists', () => {
        // THE test.
        expect(body).not.toContain('paymentStatus: "completed"');
        expect(body).not.toContain('membershipStatus: "active"');
        expect(body).not.toContain('COOPERATIVE_MEMBERS).doc(userId).set(');
    });

    it('and refuses the subscriber the same way it refuses everyone else', () => {
        expect(body).toContain('No cooperative membership found. Please register first.');
    });

    it('logging the refusal, so a real need for this would surface', () => {
        expect(body).toContain('refused rather than provisioning one');
    });

    it('while still editing the record of a member who has one', () => {
        // Vacuity guard: the action must still do its actual job.
        expect(body).toContain('COOPERATIVE_MEMBERS');
        expect(body).toContain('.update({');
    });
});

describe('the escalation this closed was real', () => {
    it('a member document at "active" grants the cooperative role', () => {
        // THE mechanism. Without this the fabricated record would be cosmetic.
        const membership = code(MEMBERSHIP);

        expect(membership).toContain("roles: FieldValue.arrayUnion(\"cooperative_member\")");
        expect(membership).toContain('const needsUserDocHeal =');
    });

    it('and that role is exactly what cooperative access is', () => {
        expect(code(ROLE_MAP)).toContain('cooperatives: ["cooperative_member"]');
    });

    it('which an academy plan does not confer', () => {
        // Vacuity guard for "the branch served nobody real": if a plan granted
        // access, the page would have been reachable and this a feature.
        const roleMap = code(ROLE_MAP);

        expect(roleMap).toContain('academy:      ["academy_participant"]');
        expect(roleMap).not.toContain('cooperatives: ["cooperative_member", "academy_participant"]');
    });

    it('so the page these branches existed for was gated against them', () => {
        expect(code(MEMBER_LAYOUT)).toContain('checkModuleAccess(userId, session.user.roles || [], "cooperatives")');
        expect(code(ID_CARD_PAGE)).toContain('updatePassportPhotoAction(');
        expect(code(ID_CARD_PAGE)).toContain('updateMemberProfileDetailsAction(');
    });
});
