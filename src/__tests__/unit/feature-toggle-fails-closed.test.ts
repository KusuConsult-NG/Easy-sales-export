/**
 * @jest-environment node
 */

/**
 *   #245 A KILL SWITCH FAILED OPEN ON A DATABASE ERROR.
 *
 *        All three toggle readers caught any read failure and returned
 *        DEFAULT_TOGGLES:
 *
 *          getFeatureToggle        actions/feature-toggles.ts
 *          hasFeatureAccess        actions/feature-toggles.ts
 *          getFeatureTogglesAction actions/health.ts
 *
 *        Seven of those defaults are `true` — farm_nation_purchases,
 *        escrow_messaging, digital_id_system, wave_program, cooperative_loans,
 *        land_verification, academy_courses — so an admin who had DISABLED one
 *        of them had that decision silently reversed by any transient database
 *        error. A kill switch exists for the moment something is going wrong,
 *        and a database error IS that moment; turning the feature back on then
 *        is precisely backwards.
 *
 *        It was also invisible. The catch logged and returned a plausible
 *        boolean, and health.ts went further: it returned `success: true` with
 *        the defaults, so no caller could distinguish "these are the real
 *        toggles" from "we could not ask".
 *
 *        The money toggles were safe only by luck — wallet_deposits,
 *        wallet_withdrawals and wave_withdrawals all default false. Safety that
 *        depends on which way a default happens to point is not a control.
 *
 *        One rule now, in lib/feature-toggles.ts: a stored value wins; no
 *        document means the default; a FAILED READ means false.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { DEFAULT_TOGGLES, resolveToggle } from '@/lib/feature-toggles';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;
const TOGGLES = COLLECTIONS.FEATURE_TOGGLES;

const actions = async () => await import('@/app/actions/feature-toggles');

/** A default-TRUE core feature an admin has switched off. */
const KILLED = 'farm_nation_purchases';

beforeEach(() => {
    // restoreAllMocks, not clearAllMocks: breakTheDatabase() installs a spy
    // implementation, and clearAllMocks only clears recorded calls — the throw
    // would leak into every later test in the file. (Which it did, on the first
    // run of this suite: five "still works" tests failed because the database
    // was still broken from a previous case.)
    jest.restoreAllMocks();
    jest.clearAllMocks();
    store = installFakeDb();
    mockRequireSession.mockResolvedValue({
        session: { user: { id: 'admin-1', email: 'a@e.com', roles: ['super_admin'] } },
        error: null,
    });
});

/** Make the next collection read throw, as a transient database error would. */
function breakTheDatabase() {
    const { supabaseDb } = require('@/lib/supabase-db');
    jest.spyOn(supabaseDb, 'collection').mockImplementation(() => {
        throw new Error('ECONNRESET: connection terminated unexpectedly');
    });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#245 — the rule itself', () => {
    it('a stored value always wins, either way', () => {
        expect(resolveToggle(KILLED, { stored: false })).toBe(false);
        expect(resolveToggle('advanced_analytics', { stored: true })).toBe(true);
    });

    it('no document means the default — a feature never configured', () => {
        expect(resolveToggle(KILLED, { stored: undefined })).toBe(DEFAULT_TOGGLES[KILLED]);
        expect(resolveToggle('wallet_withdrawals', { stored: undefined })).toBe(false);
        expect(resolveToggle('not_a_real_feature', { stored: undefined })).toBe(false);
    });

    it('A FAILED READ MEANS FALSE, WHATEVER THE DEFAULT SAYS', () => {
        // The whole defect in one line: this used to be DEFAULT_TOGGLES[name].
        for (const name of Object.keys(DEFAULT_TOGGLES)) {
            expect(resolveToggle(name, { readFailed: true })).toBe(false);
        }
    });

    it('and a read failure beats a stored value too — we did not read it', () => {
        expect(resolveToggle(KILLED, { stored: true, readFailed: true })).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#245 — getFeatureToggle', () => {
    it("HONOURS AN ADMIN'S DISABLE OF A DEFAULT-TRUE FEATURE", async () => {
        store.seed(TOGGLES, KILLED, { id: KILLED, name: KILLED, enabled: false });

        expect(await (await actions()).getFeatureToggle(KILLED)).toBe(false);
    });

    it('AND DOES NOT RE-ENABLE IT WHEN THE DATABASE ERRORS', async () => {
        store.seed(TOGGLES, KILLED, { id: KILLED, name: KILLED, enabled: false });
        breakTheDatabase();

        // Was: DEFAULT_TOGGLES.farm_nation_purchases === true — the kill switch
        // reversed by a transient error.
        expect(await (await actions()).getFeatureToggle(KILLED)).toBe(false);
        expect(DEFAULT_TOGGLES[KILLED]).toBe(true); // the default that used to leak through
    });

    it.each(['escrow_messaging', 'cooperative_loans', 'academy_courses', 'wave_program'])(
        'fails closed for %s too, not just one feature', async (name) => {
            breakTheDatabase();
            expect(await (await actions()).getFeatureToggle(name)).toBe(false);
        });

    // ── and the ordinary paths still behave ─────────────────────────────────

    it('still returns the default for a feature never configured', async () => {
        expect(await (await actions()).getFeatureToggle(KILLED)).toBe(true);
        expect(await (await actions()).getFeatureToggle('wallet_withdrawals')).toBe(false);
    });

    it('still returns a stored TRUE', async () => {
        store.seed(TOGGLES, 'advanced_analytics', { id: 'advanced_analytics', enabled: true });
        expect(await (await actions()).getFeatureToggle('advanced_analytics')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#245 — hasFeatureAccess', () => {
    it('FAILS CLOSED ON A DATABASE ERROR', async () => {
        breakTheDatabase();
        expect(await (await actions()).hasFeatureAccess(KILLED, 'user-1', 'general_user')).toBe(false);
    });

    it('still refuses a disabled feature', async () => {
        store.seed(TOGGLES, KILLED, { id: KILLED, enabled: false });
        expect(await (await actions()).hasFeatureAccess(KILLED, 'user-1')).toBe(false);
    });

    it('still honours targetRoles and targetUsers on an enabled feature', async () => {
        store.seed(TOGGLES, 'beta', { id: 'beta', enabled: true, targetRoles: ['seller'] });
        expect(await (await actions()).hasFeatureAccess('beta', 'user-1', 'seller')).toBe(true);
        expect(await (await actions()).hasFeatureAccess('beta', 'user-1', 'buyer')).toBe(false);

        store.seed(TOGGLES, 'closed-beta', { id: 'closed-beta', enabled: true, targetUsers: ['user-9'] });
        expect(await (await actions()).hasFeatureAccess('closed-beta', 'user-9')).toBe(true);
        expect(await (await actions()).hasFeatureAccess('closed-beta', 'user-1')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#245 — getFeatureTogglesAction, the third reader', () => {
    // The one in actions/health.ts, read by the wallet page and the seller
    // dashboard. It is the reader that went furthest: it did not merely return
    // the defaults, it returned them with `success: true`, so no caller could
    // tell "these are the real toggles" from "we could not ask".
    const read = async () => await (await import('@/app/actions/health')).getFeatureTogglesAction();

    it('merges stored values over the defaults when the read works', async () => {
        store.seed(TOGGLES, KILLED, { id: KILLED, enabled: false });
        store.seed(TOGGLES, 'advanced_analytics', { id: 'advanced_analytics', enabled: true });

        const res = await read() as any;
        expect(res.success).toBe(true);
        expect(res.data[KILLED]).toBe(false);            // the admin's decision
        expect(res.data.advanced_analytics).toBe(true);  // an opt-in
        expect(res.data.escrow_messaging).toBe(true);    // never configured → default
    });

    it('REPORTS FAILURE RATHER THAN DEFAULTS WHEN THE DATABASE ERRORS', async () => {
        store.seed(TOGGLES, KILLED, { id: KILLED, enabled: false });
        breakTheDatabase();

        // Was: { success: true, data: DEFAULT_TOGGLES } — seven true values
        // presented as fact, including the one this admin had switched off.
        const res = await read() as any;
        expect(res.success).toBe(false);
        expect(res.data).toBeNull();
    });

    it('and both consumers then see every toggle as off, which is the safe direction', async () => {
        breakTheDatabase();
        const res = await read() as any;

        // Exactly what the wallet page and the seller dashboard do:
        //     const toggles = {}; if (res.success && res.data) toggles = res.data;
        const toggles: Record<string, boolean> = (res.success && res.data) ? res.data : {};
        expect(toggles[KILLED]).toBeFalsy();
        expect(toggles.wallet_withdrawals).toBeFalsy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#245 — the admin write path, executed', () => {
    const update = async (name: string, enabled: boolean) =>
        (await (await actions()).updateFeatureToggle(name, enabled)) as any;

    it('an admin can disable a feature, and it persists', async () => {
        expect(await update(KILLED, false)).toMatchObject({ success: true });
        expect(store.get(TOGGLES, KILLED)?.enabled).toBe(false);
    });

    it('records who did it in the audit log', async () => {
        const { createAdminAuditLog } = await import('@/lib/audit-log');
        await update(KILLED, false);

        expect(createAdminAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'feature_toggled', targetId: KILLED }));
    });

    it('refuses a non-admin', async () => {
        mockRequireSession.mockResolvedValue({
            session: { user: { id: 'u1', email: 'u@e.com', roles: ['general_user'] } },
            error: null,
        });

        expect(await update(KILLED, false)).toMatchObject({ success: false });
        expect(store.get(TOGGLES, KILLED)).toBeUndefined();
    });

    it('refuses an unauthenticated caller', async () => {
        mockRequireSession.mockResolvedValue({ session: null, error: { error: 'Unauthorized' } });
        expect(await update(KILLED, false)).toMatchObject({ success: false });
    });
});
