/**
 * @jest-environment node
 */

/**
 *   #864 THE PLATFORM PROMISED AN INSPECTION TWICE AND REQUIRED ONE NOWHERE.
 *
 *   THE OWNER: "The flow is when an admin approves a listing on Farm Nation,
 *   admin sends an inspector — the new flow should be that admin sends an
 *   inspector with all the details submitted from the listing and all the
 *   documents, then after inspector verifies then admin can approve."
 *
 *   MEASURED, and the platform was already CLAIMING this flow in two places
 *   while enforcing it in neither:
 *
 *     the dispatch tab   "An email notification will be sent to the inspector
 *                        with the property location and document links."
 *                        The route sent the inspector nothing. The form
 *                        collected their NAME as free text and no address, so
 *                        there was nobody to send to even in principle.
 *
 *     the approve button window.confirm("Approve this land listing? Ensure the
 *                        inspector report has been reviewed.")
 *                        There was no inspector report anywhere in the data
 *                        model. `inspectionDetails` records who was SENT and
 *                        when — a dispatch, not a finding. The dialog asked an
 *                        admin to remember.
 *
 *   A rule stated in prose and enforced by nothing is this audit's most common
 *   defect. Here it was stated twice, in the two screens the flow runs through.
 *
 * ── SIX DOORS, BECAUSE FIVE WOULD BE THE SAME MISTAKE AGAIN ─────────────────
 *
 *   Six paths in this codebase write a land approval, and APPROVABLE_FROM_
 *   STATUSES exists because each once hand-wrote its own rule and they
 *   disagreed. Gating the Farm Nation route alone would leave five ways to
 *   approve uninspected land — #340 (one badge of three), #717 (eight
 *   boundaries of fifteen) and #838 (one screen of two) are all that shape.
 *   The last describe block enumerates them from disk.
 *
 * ── THE INSPECTOR HAS NO ACCOUNT ────────────────────────────────────────────
 *
 *   Confirmed by the owner: "the inspector doesn't have an admin account and
 *   the details will be mailed by email from the admin." So the job goes out by
 *   email, the verdict comes back to the admin, and the admin files it —
 *   `recordedBy` is the admin, `inspectorName` is the person who went, and the
 *   audit trail never claims an inspector signed in.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    revalidateTag: () => undefined,
    revalidatePath: () => undefined,
    unstable_cache: (fn: any) => fn,
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateAdminGlobalStats: async () => undefined,
}));

const auditActions: string[] = [];
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: async (p: any) => { auditActions.push(p?.action); },
    createAdminAuditLog: async (p: any) => { auditActions.push(p?.action); },
    logAdminAction: jest.fn(async () => ({})),
}));

const sent: Array<{ to: unknown; subject: string; message: string }> = [];
jest.mock('@/lib/email-notifications', () => ({
    canSendEmail: (_c: string, to: unknown) => typeof to === 'string' && !!to.trim(),
    getBaseUrl: () => 'https://easysalesexport.com',
    sendEmailNotification: async (data: any) => { sent.push(data); return { success: true }; },
}));

/** The CAS transition, against the store. See #862's suite for why it is honest. */
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: async (args: any) => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        const ref = supabaseDb.collection(args.collection).doc(args.id);
        const snap = await ref.get();
        if (!snap.exists) return { claimed: false, status: null, exists: false };

        const status = (snap.data() ?? {}).status ?? null;
        const from: string[] = args.allowSameStatus
            ? args.fromAny
            : args.fromAny.filter((s: string) => s !== args.to);
        if (!from.includes(status)) return { claimed: false, status, exists: true };

        await ref.update({
            ...(args.patch ?? {}),
            status: args.to,
            ...(args.recordPreviousAs ? { [args.recordPreviousAs]: status } : {}),
        });
        return { claimed: true, status, exists: true };
    },
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

/**
 * `auth()`, because record-inspection re-validates its admin LIVE.
 *
 *   It uses `requireAdmin`, which asks the database for the caller's roles
 *   rather than believing the JWT — #532's rule, and the reason it matters here
 *   is that a revoked admin could otherwise file "passed" on land nobody
 *   inspected and let the approval through behind it.
 *
 *   So the real check runs: this supplies only the session id, and the roles
 *   come from the seeded USERS row below. Mocking requireAdmin itself would
 *   have skipped exactly the thing worth exercising.
 */
jest.mock('@/lib/auth', () => ({
    auth: async () => ({ user: { id: 'admin-1', email: 'admin@e.com' } }),
    signIn: async () => undefined, signOut: async () => undefined, handlers: {},
}));

let store: FakeDbHandle;

const OWNER = 'owner-1';
const ADMIN = 'admin-1';
const LISTINGS = COLLECTIONS.LAND_LISTINGS;

const asAdmin = () => mockRequireSession.mockResolvedValue({
    session: { user: { id: ADMIN, email: 'admin@e.com', roles: ['super_admin'] } },
    error: null,
});

const seedListing = (over: Record<string, unknown> = {}) => {
    store.seed(LISTINGS, 'land-1', {
        id: 'land-1',
        title: '2 hectares at Ugwuoba',
        description: 'Cleared farmland with road access.',
        ownerId: OWNER,
        ownerName: 'Ngozi Eze',
        ownerEmail: 'ngozi@example.com',
        status: 'pending_verification',
        size: 2,
        price: 5_000_000,
        type: 'sale',
        location: { state: 'Enugu', lga: 'Oji River', address: 'Ugwuoba' },
        gpsCoordinates: { latitude: 6.21, longitude: 7.15 },
        documents: ['https://files/cofo.pdf', 'https://files/survey.pdf'],
        ...over,
    });
    store.seed(COLLECTIONS.USERS, OWNER, { email: 'ngozi@example.com' });
};

const post = async (route: string, body: Record<string, unknown>) => {
    const mod = await import(`@/app/api/admin/farm-nation/${route}/route`);
    const req = new Request(`http://localhost/api/admin/farm-nation/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const res = await mod.POST(req as never);
    return { status: res.status, body: await res.json() as any };
};

const dispatch = (over: Record<string, unknown> = {}) => post('dispatch-inspector', {
    verificationId: 'land-1',
    inspectorName: 'Chidi Okafor',
    inspectorEmail: 'chidi@inspectors.ng',
    scheduledDate: '2026-10-02',
    notes: 'Meet the caretaker at the gate',
    ...over,
});

const record = (over: Record<string, unknown> = {}) => post('record-inspection', {
    verificationId: 'land-1',
    outcome: 'passed',
    findings: 'Boundaries match the survey plan.',
    ...over,
});

const approve = () => post('approve-land', { verificationId: 'land-1' });

const listing = () => store.get(LISTINGS, 'land-1') as Record<string, any>;
const toInspector = () => sent.filter((e) => e.to === 'chidi@inspectors.ng');

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    sent.length = 0;
    auditActions.length = 0;
    asAdmin();
    //   The row requireAdmin reads. `super_admin` holds
    //   farm_nation:verify_applications and land:verify_listings both.
    /*
     *   #936 ENROLLED, because from MFA_ADMIN_ENFORCE_FROM requireAdmin refuses an
     *   administrator without a second factor — and this suite is about land
     *   inspections, not about the MFA gate. An unenrolled fixture made nine
     *   tests here fail with 403 the minute that date passed, on a push, saying
     *   nothing about inspections. A compliant admin is also what production
     *   looks like from that date on.
     */
    store.seed(COLLECTIONS.USERS, ADMIN, {
        email: 'admin@e.com', roles: ['super_admin'], mfaEnabled: true,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#864 — the inspector is sent the job', () => {
    it('THE REPORTED GAP: the dispatch emails them', async () => {
        seedListing();

        const { status } = await dispatch();

        expect(status).toBe(200);
        // Was: zero. The screen promised this email and the route sent nothing.
        expect(toInspector()).toHaveLength(1);
    });

    it('AND IT CARRIES EVERY DOCUMENT', async () => {
        /*
         *   "with all the details submitted from the listing and all the
         *   documents". Authenticating these IS the job, so a message that
         *   names the land and withholds its papers sends somebody to look at a
         *   fence.
         */
        seedListing();

        await dispatch();

        const email = toInspector()[0].message;
        expect(email).toContain('https://files/cofo.pdf');
        expect(email).toContain('https://files/survey.pdf');
    });

    it('AND THE DETAILS THEY NEED TO FIND AND JUDGE THE LAND', async () => {
        seedListing();

        await dispatch();

        const email = toInspector()[0].message;
        for (const detail of ['Ugwuoba', 'Oji River', 'Enugu', '6.21', '7.15', 'Ngozi Eze']) {
            expect({ detail, present: email.includes(detail) })
                .toEqual({ detail, present: true });
        }
    });

    it('AND NOT THE SELLER\'S CONTACT DETAILS', async () => {
        /*
         *   The admin arranges access. An emailed address is a copy nobody can
         *   withdraw, and #148 is the record of what these documents and
         *   contacts leaking costs.
         */
        seedListing();

        await dispatch();

        expect(toInspector()[0].message).not.toContain('ngozi@example.com');
    });

    it('AND A DISPATCH WITH NO ADDRESS IS REFUSED, not silently unsent', async () => {
        /*
         *   The form collected only a name before this. Accepting a dispatch
         *   with no address would keep the screen's promise unkept for whoever
         *   leaves the field blank — which is the state the whole platform was
         *   in.
         */
        seedListing();

        const { status } = await dispatch({ inspectorEmail: undefined });

        expect(status).toBe(400);
        expect(listing().status).toBe('pending_verification');
    });

    it('AND THE SELLER IS STILL TOLD — #862 must not regress', async () => {
        seedListing();

        await dispatch();

        expect(sent.some((e) => e.to === 'ngozi@example.com')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#864 — and what they found is recorded', () => {
    it('THE REPORTED GAP: there is somewhere to file the report', async () => {
        seedListing();
        await dispatch();

        const { status } = await record();

        expect(status).toBe(200);
        expect(listing().inspectionReport).toMatchObject({
            outcome: 'passed',
            findings: 'Boundaries match the survey plan.',
        });
    });

    it('AND THE ADMIN IS THE ONE RECORDED AS FILING IT', async () => {
        /*
         *   An inspector cannot sign in, so `recordedBy` is never them. Keeping
         *   the two apart is what stops the audit trail claiming a login that
         *   cannot happen.
         */
        seedListing();
        await dispatch();

        await record();

        expect(listing().inspectionReport.recordedBy).toBe(ADMIN);
        expect(listing().inspectionReport.inspectorName).toBe('Chidi Okafor');
    });

    it('AND IT DOES NOT MOVE THE STATUS', async () => {
        //   A sixteenth status would have to be taught to the fifteen readers of
        //   LandListingStatus, and each one missed is a listing that vanishes
        //   from a screen.
        seedListing();
        await dispatch();

        await record();

        expect(listing().status).toBe('inspection_scheduled');
    });

    it('AND A REPORT ON A LISTING NOBODY WAS SENT TO IS REFUSED', async () => {
        /*
         *   Otherwise an admin files "passed" on land nobody has visited and
         *   walks it through the gate — which would make the gate ceremony
         *   rather than a control.
         */
        seedListing();

        const { status } = await record();

        expect(status).toBe(409);
        expect(listing().inspectionReport).toBeUndefined();
    });

    it('AND A FAILURE MUST SAY WHY', async () => {
        //   #690's rule: a refusal recorded without its reason leaves the person
        //   it is about nothing to act on — and this one reaches the seller.
        seedListing();
        await dispatch();

        const { status } = await record({ outcome: 'failed', findings: '   ' });

        expect(status).toBe(400);
        //   Falsy, not absent: the dispatch writes `inspectionReport: null` to
        //   clear any previous finding, so "nothing was recorded" is null here
        //   and undefined on a listing that was never dispatched.
        expect(listing().inspectionReport).toBeFalsy();
    });

    it('AND AN OUTCOME THAT IS NEITHER WORD IS REFUSED', async () => {
        //   A typo'd outcome reads as "no report" to the gate — fails safe, but
        //   silently, and the admin would believe they had filed one.
        seedListing();
        await dispatch();

        const { status } = await record({ outcome: 'pass' });

        expect(status).toBe(400);
    });

    it('AND THE SELLER IS TOLD, either way', async () => {
        seedListing();
        await dispatch();
        sent.length = 0;

        await record({ outcome: 'failed', findings: 'The fence encroaches on the next plot.' });

        const toSeller = sent.filter((e) => e.to === 'ngozi@example.com');
        expect(toSeller).toHaveLength(1);
        expect(toSeller[0].message).toContain('encroaches');
    });

    it('AND IT IS ITS OWN AUDIT ACTION, not folded into the dispatch', async () => {
        seedListing();
        await dispatch();
        auditActions.length = 0;

        await record();

        expect(auditActions).toContain('inspection_recorded');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#864 — and an approval needs one', () => {
    it('THE REPORTED GAP: approving uninspected land is refused', async () => {
        seedListing();

        const { status, body } = await approve();

        // Was: 200, and the parcel went on the public market.
        expect(status).toBe(409);
        expect(body.message).toMatch(/not been inspected/i);
        expect(listing().status).toBe('pending_verification');
    });

    it('AND A DISPATCH ALONE IS NOT ENOUGH', async () => {
        //   The distinction the old confirm dialog could not make: somebody was
        //   SENT is not somebody REPORTED.
        seedListing();
        await dispatch();

        const { status } = await approve();

        expect(status).toBe(409);
        expect(listing().status).toBe('inspection_scheduled');
    });

    it('AND A FAILED INSPECTION BLOCKS IT, with the reason', async () => {
        seedListing();
        await dispatch();
        await record({ outcome: 'failed', findings: 'The fence encroaches on the next plot.' });

        const { status, body } = await approve();

        expect(status).toBe(409);
        expect(body.message).toContain('encroaches');
    });

    it('AND A PASSED INSPECTION LETS IT THROUGH', async () => {
        seedListing();
        await dispatch();
        await record();

        const { status } = await approve();

        expect(status).toBe(200);
        expect(listing().status).toBe('verified');
    });

    it('AND A RE-DISPATCH CLEARS THE OLD FINDING', async () => {
        /*
         *   Otherwise re-inspecting leaves last month's "passed" sitting on the
         *   listing and the gate reads a report about a visit that has been
         *   superseded — worse than no gate, because it reads as one.
         */
        seedListing();
        await dispatch();
        await record();

        await dispatch({ scheduledDate: '2026-11-02' });

        expect(listing().inspectionReport).toBeFalsy();
        expect((await approve()).status).toBe(409);
    });

    it('AND A LISTING ALREADY ON SALE IS NOT BLOCKED', async () => {
        /*
         *   APPROVABLE_FROM_STATUSES deliberately admits the three purchasable
         *   spellings so `available` and `approved` converge on the canonical
         *   `verified`. That is a re-approval of land already approved, not a
         *   review — blocking it would stall listings that need no new
         *   inspection.
         */
        seedListing({ status: 'available' });

        const { status } = await approve();

        expect(status).toBe(200);
        expect(listing().status).toBe('verified');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#864 — at every door that writes an approval, not just the one', () => {
    /*
     *   THE HALF THAT MAKES THE GATE REAL. Six paths approve a land listing, and
     *   APPROVABLE_FROM_STATUSES exists precisely because each once hand-wrote
     *   its own rule and they disagreed — one of them could not approve a Farm
     *   Nation listing at all while another approved it happily.
     *
     *   Read from disk rather than exercised, because six behavioural setups
     *   would test the harness more than the rule; the behaviour above pins
     *   what the rule DOES, and this pins that every door asks it.
     */
    const { readFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const { stripComments } = require('@/lib/testing/strip-comments') as
        typeof import('@/lib/testing/strip-comments');

    const DOORS = [
        'src/app/api/admin/farm-nation/approve-land/route.ts',
        'src/app/actions/admin/_land.ts',
        'src/app/actions/farm-nation/_fn_admin.ts',
        'src/app/actions/admin-content.ts',
        'src/app/actions/land-actions.ts',
        'src/app/actions/land-listings.ts',
    ];

    const code = (rel: string) =>
        stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

    it('EVERY APPROVAL DOOR CONSULTS THE RULE', () => {
        const silent = DOORS.filter((d) => !code(d).includes('inspectionRefusal('));
        expect(silent).toEqual([]);
    });

    it('AND THE LIST IS THE ONE APPROVABLE_FROM_STATUSES NAMES', () => {
        /*
         *   A positive control on the list above. If a seventh approval path is
         *   added, it will import the shared status set — every existing one
         *   does — and this fails until it is either gated or listed.
         */
        const importers = DOORS.filter((d) => code(d).includes('APPROVABLE_FROM_STATUSES'));
        expect(importers).toEqual(DOORS);
    });

    it('AND NOBODY WRITES THE RULE OUT FOR THEMSELVES', () => {
        //   Five hand-written copies of the status set is what produced
        //   APPROVABLE_FROM_STATUSES. One copy of this rule, or it drifts the
        //   same way.
        const offenders = DOORS.filter((d) => /inspectionReport\?\.\s*outcome/.test(code(d)));
        expect(offenders).toEqual([]);
    });
});
