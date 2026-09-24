/**
 * @jest-environment node
 */

/**
 *   #763 A REJECTED APPLICANT KEPT THE MODULE, ON TWO OF THE FIVE, AND THE
 *        RATCHET BUILT TO PREVENT IT REPORTED CLEAN.
 *
 *   Found answering the owner's question about the three module applications:
 *   "what about export window, farm nation, wave applications? are they verified
 *   and fixed? will users get an error or stucked?"
 *
 *   Nobody gets stuck. Every one of the three submits, reads its status back and
 *   opens on approval — measured end to end against the real actions and the
 *   real access check, below and in the sibling suites. What the sweep found was
 *   the opposite direction: the REFUSALS did not take.
 *
 * ── MEASURED, WITH THE JWT EMPTY SO THE DATABASE DECIDES ────────────────────
 *
 *       module / role at submit        roles granted      after rejection   in?
 *       ───────────────────────────────────────────────────────────────────────
 *       Farm Nation, buyer             investor           investor          YES
 *       Farm Nation, seller            farmer             —                 no
 *       Farm Nation, both              investor, farmer   investor          YES
 *       Export, approved then rejected export_participant export_participant YES
 *       WAVE, rejected                 wave_participant   —                 no
 *
 *   So rejecting a Farm Nation BUYER revoked nothing at all; rejecting a BOTH
 *   applicant revoked half; and rejecting an approved Export member — which is
 *   that module's revoke path, since nothing guards the status it comes from —
 *   revoked nothing. The word on the admin's screen changed and the member kept
 *   the dashboard.
 *
 * ── THREE THINGS HAD TO BE TRUE AT ONCE, AND EACH LOOKED FINE ALONE ─────────
 *
 *   (1) `_submitFarmNationOnboardingAction` grants `investor` for two of its
 *       three role choices — which is correct, and is self-service by design.
 *
 *   (2) lib/module-grant-roles.ts mapped each module to ONE role, and its header
 *       said, of Farm Nation: "`land_owner` and `investor` … neither is granted
 *       by its application flow". True of `land_owner`. False of `investor`,
 *       measurably, and that sentence is why the rejection only ever took
 *       `farmer` back.
 *
 *   (3) checkModuleAccess Layer 2.5 grants a module from the roles array with no
 *       regard for what the module's own registration says. registration-
 *       progress.ts states the rule it was missing — "A decision is a decision.
 *       Nothing derived may overwrite one." — and module-access-check.ts imports
 *       isDecidedAgainst already, applying it at Layer 2.6 for cooperatives and
 *       nowhere else.
 *
 *   ALL THREE ARE FIXED. (1) is left alone: granting on submit is how Farm
 *   Nation works and removing it would lock out every pending applicant.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { MODULE_GRANT_ROLES, moduleGrantRoles } from '@/lib/module-grant-roles';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('@/lib/auth', () => ({
    auth: async () => null, signIn: async () => undefined,
    signOut: async () => undefined, handlers: {},
}));
jest.mock('@/lib/require-admin', () =>
    require('@/lib/testing/require-admin-mock').requireAdminMock());
//   Export onboarding re-resolves the settlement account through Paystack
//   (#346) and uploads two documents. Neither is what this finding is about.
jest.mock('@/lib/bank-account-resolve', () => ({
    resolveBankAccount: async () => ({ ok: true, accountName: 'ADA OBI', accountNumber: '0123456789', bankId: 1 }),
    isPlausibleAccountNumber: () => true,
}));
jest.mock('@/lib/storage-admin', () => ({ uploadFileToStorage: async () => 'https://cdn.example/doc.pdf' }));

let store: FakeDbHandle;
const USER = 'applicant-1';
const ADMIN = 'admin-1';

/*
 *   Numbers that pass the platform's own placeholder rule — not all one digit,
 *   not a run up or down the keypad, not a short block repeated. The owner's
 *   instruction is that a real-looking NIN or BVN is accepted without an
 *   external check and 11111111111 is not; see lib/kyc-validators.ts.
 */
const NIN = '74920385617';
const BVN = '50831726495';

function actAs(id: string, roles: string[]) {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@e.com`, name: 'Ada Obi' } }, error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(USER, ['general_user']);
    store.seed(COLLECTIONS.USERS, USER, {
        fullName: 'Ada Obi', email: `${USER}@e.com`, roles: ['general_user'], gender: 'female',
    });
    store.seed(COLLECTIONS.USERS, ADMIN, { email: `${ADMIN}@e.com`, roles: ['super_admin'] });
});

/**
 * The real access check, with an EMPTY token.
 *
 * Layer 1 answers from the JWT and returns before anything else runs, so a test
 * that passed the member's roles in would measure the token rather than the
 * database. Empty is the state a member is in once their token refreshes — which
 * is the state a rejection is supposed to be effective in.
 */
const mayEnter = async (app: string) => {
    const { checkModuleAccess } = await import('@/lib/module-access-check');
    return checkModuleAccess(USER, [] as any, app as any);
};

const farmNationApplication = (role: 'buyer' | 'seller' | 'both') => ({
    role,
    profile: {
        firstName: 'Ada', lastName: 'Obi', otherName: '', phone: '08012345678',
        businessName: 'Obi Farms', state: 'Lagos', lga: 'Ikeja',
        address: '12 Broad Street, Ikeja',
        //   #865 A Farm Nation profile carries its identity numbers now. Both
        //   are eleven digits and neither is a recognisable placeholder, which
        //   is the whole of the rule — lib/kyc-validators contacts no provider.
        nin: '20481956372',
        bvn: '31749206853',
    },
    interests: { propertyTypes: ['farmland'] },
    terms: { termsAccepted: true, privacyAccepted: true, feeDisclosureAccepted: true },
});

function exportApplicationForm(): FormData {
    const fd = new FormData();
    fd.append('profile', JSON.stringify({
        firstName: 'Ada', lastName: 'Obi', otherName: '', phone: '08012345678',
        email: `${USER}@e.com`, state: 'Lagos', lga: 'Ikeja', address: '12 Broad Street, Ikeja',
    }));
    //   Both verified: export onboarding requires a NIN and a BVN, each one
    //   actually checked rather than merely typed. See lib/export-identity.
    fd.append('kycData', JSON.stringify({
        nin: NIN, ninVerified: true,
        bvn: BVN, bvnVerified: true,
    }));
    fd.append('bank', JSON.stringify({
        accountNumber: '0123456789', bankName: 'GTBank', accountName: 'Ada Obi', bankCode: '058',
    }));
    fd.append('terms', JSON.stringify({ termsAccepted: true, privacyAccepted: true }));
    fd.append('idDocument', new File(['id'], 'id.pdf', { type: 'application/pdf' }));
    fd.append('proofOfAddress', new File(['poa'], 'poa.pdf', { type: 'application/pdf' }));
    return fd;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#763 — the premise: Farm Nation onboarding grants two roles, not one', () => {
    it.each([
        ['buyer', ['investor']],
        ['seller', ['farmer']],
        ['both', ['investor', 'farmer']],
    ] as const)('role=%s grants %s', async (role, expected) => {
        /*
         *   The fact the old map denied. Run against the real action, because
         *   the claim it replaces — "neither is granted by its application flow"
         *   — was written from reading and was wrong.
         */
        const on = await import('@/app/actions/farm-nation/_fn_onboarding');
        const res: any = await on.submitFarmNationOnboardingAction(farmNationApplication(role) as any);

        expect(res.success).toBe(true);
        const granted = store.get(COLLECTIONS.USERS, USER)!.roles as string[];
        expect(granted.filter((r) => r !== 'general_user').sort()).toEqual([...expected].sort());
    });

    it('AND THE MAP NOW SAYS SO', () => {
        //   Asserted against the map rather than only through behaviour, so that
        //   narrowing it back to `farmer` fails here and not only three suites
        //   away.
        expect(moduleGrantRoles('farm-nation').sort()).toEqual(['farmer', 'investor']);
    });

    it('and land_owner is deliberately NOT in it', () => {
        /*
         *   The half of the old reasoning that was right. No Farm Nation flow
         *   grants `land_owner`; it is the capability to list land, and a
         *   registration decision is not about it.
         */
        expect(moduleGrantRoles('farm-nation')).not.toContain('land_owner');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#763 — a rejected Farm Nation applicant is out, whichever role they chose', () => {
    it.each(['buyer', 'seller', 'both'] as const)('role=%s', async (role) => {
        const on = await import('@/app/actions/farm-nation/_fn_onboarding');
        await on.submitFarmNationOnboardingAction(farmNationApplication(role) as any);

        //   In BEFORE the decision — self-service by design, and the reason the
        //   rejection has to be the thing that closes the door.
        expect(await mayEnter('farm-nation')).toBe(true);

        actAs(ADMIN, ['super_admin']);
        const admin = await import('@/app/actions/farm-nation/_fn_admin');
        const res: any = await admin.rejectFarmNationSellerAction(USER, 'incomplete documents');
        expect(res.success).toBe(true);

        actAs(USER, ['general_user']);
        const after = store.get(COLLECTIONS.USERS, USER)!;

        expect(after.serviceRegistrations.farmNation.status).toBe('rejected');
        //   Was: ["general_user","investor"] for buyer and for both.
        expect(after.roles).toEqual(['general_user']);
        expect(await mayEnter('farm-nation')).toBe(false);
    });

    it('and an unrelated role survives the rejection', async () => {
        //   The revocation is scoped to the roles this module granted. Taking
        //   somebody's cooperative membership away because their Farm Nation
        //   application was refused would be a worse defect than the one fixed.
        store.seed(COLLECTIONS.USERS, USER, {
            email: `${USER}@e.com`, fullName: 'Ada Obi', gender: 'female',
            roles: ['general_user', 'cooperative_member', 'land_owner'],
        });
        const on = await import('@/app/actions/farm-nation/_fn_onboarding');
        await on.submitFarmNationOnboardingAction(farmNationApplication('both') as any);

        actAs(ADMIN, ['super_admin']);
        const admin = await import('@/app/actions/farm-nation/_fn_admin');
        await admin.rejectFarmNationSellerAction(USER, 'incomplete');

        const after = store.get(COLLECTIONS.USERS, USER)!.roles as string[];
        expect(after).toContain('cooperative_member');
        expect(after).toContain('land_owner');
        expect(after).not.toContain('investor');
        expect(after).not.toContain('farmer');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#763 — and the export revoke path takes the role back', () => {
    it('APPROVED, THEN REJECTED, IS OUT', async () => {
        const member = await import('@/app/actions/export/_ex_onboarding');
        const submitted: any = await member.submitExportOnboardingAction(null, exportApplicationForm());
        expect(submitted.success).toBe(true);

        const applicationId = store.get(COLLECTIONS.USERS, USER)!
            .serviceRegistrations.export.applicationId;

        actAs(ADMIN, ['super_admin']);
        const admin = await import('@/app/actions/admin/_exports');
        const approved: any = await admin.approveExportOnboardingAction(applicationId);
        expect(approved.success).toBe(true);

        actAs(USER, ['general_user']);
        expect(store.get(COLLECTIONS.USERS, USER)!.roles).toContain('export_participant');
        expect(await mayEnter('export')).toBe(true);

        actAs(ADMIN, ['super_admin']);
        const rejected: any = await admin.rejectExportApplicationAction(applicationId, 'documents were forged');
        expect(rejected.success).toBe(true);

        actAs(USER, ['general_user']);
        const after = store.get(COLLECTIONS.USERS, USER)!;
        expect(after.serviceRegistrations.export.status).toBe('rejected');
        //   Was: the role stayed and the member kept the module.
        expect(after.roles).not.toContain('export_participant');
        expect(await mayEnter('export')).toBe(false);
    });

    it('and the member is told, by their own status check', async () => {
        //   The other half of "will users get stuck": a refused member must be
        //   able to read the refusal rather than find a door that no longer
        //   opens and no explanation.
        const member = await import('@/app/actions/export/_ex_onboarding');
        await member.submitExportOnboardingAction(null, exportApplicationForm());
        const applicationId = store.get(COLLECTIONS.USERS, USER)!
            .serviceRegistrations.export.applicationId;

        actAs(ADMIN, ['super_admin']);
        const admin = await import('@/app/actions/admin/_exports');
        await admin.rejectExportApplicationAction(applicationId, 'documents were forged');

        actAs(USER, ['general_user']);
        expect(await member.checkExportStatusAction()).toBe('rejected');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#763 — Layer 2.5 no longer overrides a recorded decision', () => {
    /*
     *   The structural half. Fixing the two grants closes two instances; this
     *   closes the class, for every module and for the next one written.
     */
    const seedWith = (status: string | undefined, roles: string[]) =>
        store.seed(COLLECTIONS.USERS, USER, {
            email: `${USER}@e.com`, fullName: 'Ada Obi', roles,
            ...(status === undefined ? {} : { serviceRegistrations: { export: { status } } }),
        });

    it.each(['rejected', 'suspended', 'revoked', 'declined', 'banned'])(
        'a %s registration is not overridden by the role', async (status) => {
            seedWith(status, ['general_user', 'export_participant']);
            expect(await mayEnter('export')).toBe(false);
        });

    it('CONTROL — no registration at all still gets in', async () => {
        /*
         *   What Layer 2.5 is FOR, in its own words: "Handles users who were
         *   manually assigned a role via the admin Update Roles panel BEFORE the
         *   serviceRegistrations backfill was added." isDecidedAgainst('') is
         *   false, so they are untouched — and if this ever stopped being true,
         *   the fix would lock out the very people the layer exists for.
         */
        seedWith(undefined, ['general_user', 'export_participant']);
        expect(await mayEnter('export')).toBe(true);
    });

    it('CONTROL — approved and pending registrations still get in', async () => {
        seedWith('approved', ['general_user', 'export_participant']);
        expect(await mayEnter('export')).toBe(true);

        seedWith('pending_approval', ['general_user', 'export_participant']);
        expect(await mayEnter('export')).toBe(true);
    });

    it('AND THE RULE IS THE SHARED ONE, NOT A SECOND SPELLING OF IT', () => {
        /*
         *   registration-progress.ts holds the list — rejected, declined,
         *   denied, suspended, revoked, cancelled, canceled, banned, withdrawn,
         *   terminated — and a hand-written `status === "rejected"` here would
         *   be the eighth copy of a rule this audit has spent findings merging.
         */
        const fs = require('fs') as typeof import('fs');
        const path = require('path') as typeof import('path');
        const src = fs.readFileSync(
            path.join(process.cwd(), 'src/lib/module-access-check.ts'), 'utf8');

        /*
         *   Anchored on the SECTION RULES, not on "Layer 2.5"/"Layer 2.6".
         *   A first draft used the bare names and the slice ended early —
         *   because the note added by this fix mentions Layer 2.6 by name, so
         *   `indexOf` found the reference rather than the section. The same trap
         *   this audit has now been caught by four times: an anchor that occurs
         *   more than once, matched against whichever came first.
         */
        const layer = src.slice(src.indexOf('── Layer 2.5'), src.indexOf('── Layer 2.6'));
        expect(layer.length).toBeGreaterThan(500);
        expect(layer).toContain('isDecidedAgainst(resolvedStatus)');
        expect(layer).not.toMatch(/===\s*["']rejected["']/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#763 — and the map cannot go back to one role per module', () => {
    it('EVERY ENTRY IS A LIST', () => {
        //   The singular shape is what made the Farm Nation gap inexpressible.
        for (const [module, roles] of Object.entries(MODULE_GRANT_ROLES)) {
            expect(`${module}: ${Array.isArray(roles)}`).toBe(`${module}: true`);
            expect(`${module}: ${roles.length > 0}`).toBe(`${module}: true`);
        }
    });

    it('and the sweep is not vacuous', () => {
        expect(Object.keys(MODULE_GRANT_ROLES).length).toBeGreaterThan(4);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH, each mutant proving its edit landed.
 *
 *     MUTANT                                                        RESULT
 *     farm-nation's map entry narrowed back to ["farmer"]            KILLED
 *     the FN rejection goes back to arrayRemove("farmer")            KILLED
 *     the export rejection stops removing the role                   KILLED
 *     Layer 2.5's decided-against guard removed                      KILLED
 *     that guard inverted to admit ONLY decided-against members      KILLED
 *     the FN rejection also strips land_owner                        KILLED
 *     the FN rejection strips every role the member holds            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   The last two matter as much as the first five: a revocation that overshoots
 *   takes away a capability the decision was not about, and "the rejection did
 *   too much" is the failure mode a fix like this one produces. Both are pinned
 *   by the unrelated-role test above.
 */
