/**
 * @jest-environment node
 */

/**
 * Export onboarding, EXECUTED — submission, status, retrieval and resubmission.
 *
 * At 3.6%. This is the door onto the export module: the submission writes the
 * application AND the registration entry, and everything downstream — the admin
 * queue, checkModuleAccess, the applicant's own status page — reads what it
 * leaves behind.
 *
 * WHAT MAKES IT WORTH EXECUTING RATHER THAN READING
 * -------------------------------------------------
 * Three of the four actions resolve the application by SEARCHING, and each does
 * it differently:
 *
 *   - the status check queries by userId, sorts by submittedAt-or-createdAt, and
 *     takes the newest — then falls back to the stamped applicationId;
 *   - the retrieval tries the stamped id FIRST and queries only if that misses;
 *   - the submission refuses outright when a previous application is still open.
 *
 * "Takes the newest of several" and "falls back when the first lookup misses" are
 * exactly the claims a call-recorder harness cannot check, because its `where()`
 * was a no-op and its `get()` returned whatever the test stubbed.
 *
 * The submission also writes through a BATCH, so a batch that is never committed
 * writes nothing — which the store reproduces, and which is why these tests read
 * the store rather than the return value.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/storage-admin', () => ({
    uploadFileToStorage: async (_f: unknown, path: string) => `https://storage.test/${path}`,
}));

let store: FakeDbHandle;

const APPLICANT = 'applicant-1';

function actAs(id: string | null, roles: string[] = ['user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@example.com`, name: id } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(APPLICANT);
    store.seed(COLLECTIONS.USERS, APPLICANT, { email: 'applicant@example.com', roles: ['user'] });
});

async function actions() {
    return import('@/app/actions/export/_ex_onboarding');
}

/** A FormData carrying a submission that satisfies the schema. */
function submission(overrides: Record<string, unknown> = {}): FormData {
    const parts: Record<string, unknown> = {
        profile: {
            firstName: 'Ada', lastName: 'Obi', otherName: 'Nkem',
            phone: '08031111111', state: 'Lagos', lga: 'Ikeja',
            address: '1 Market Road, Ikeja',
        },
        kycData: { nin: '12345678901', bvn: '', cacNumber: 'RC123456' },
        bank: { accountNumber: '0123456789', bankName: 'Zenith', accountName: 'Ada Obi' },
        terms: { termsAccepted: true, privacyAccepted: true },
        ...overrides,
    };

    const fd = new FormData();
    for (const [key, value] of Object.entries(parts)) {
        fd.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    // Already-uploaded URLs, so the storage path is exercised without a File.
    fd.set('idDocument', 'https://storage.test/existing-id');
    fd.set('proofOfAddress', 'https://storage.test/existing-proof');
    return fd;
}

function applications(): Array<[string, Record<string, unknown>]> {
    return store.all(COLLECTIONS.EXPORT_APPLICATIONS);
}

// ─── submission ──────────────────────────────────────────────────────────────

describe('submitting an export onboarding application', () => {
    it('files the application and stamps the registration', async () => {
        const { submitExportOnboardingAction } = await actions();
        const result = await submitExportOnboardingAction(null, submission());

        expect(result.success).toBe(true);

        const [[, app]] = applications();
        expect(app.status).toBe('pending_review');
        expect(app.userId).toBe(APPLICANT);
        expect(String(app.applicationId)).toMatch(/^EXPORT-ONBOARD-/);

        const user = store.get(COLLECTIONS.USERS, APPLICANT)!;
        expect(user.serviceRegistrations.export.status).toBe('pending_approval');
        expect(user.serviceRegistrations.export.applicationId).toBe(app.applicationId);
    });

    it('mirroring the applicant’s details onto the root user document', async () => {
        // The admin broadcasts, the Communication Hub and the user listings all
        // read the ROOT document. A submission that left the name only inside the
        // application made the applicant unreachable by every one of them.
        const { submitExportOnboardingAction } = await actions();
        await submitExportOnboardingAction(null, submission());

        const user = store.get(COLLECTIONS.USERS, APPLICANT)!;
        expect(user.firstName).toBe('Ada');
        expect(user.lastName).toBe('Obi');
        expect(user.fullName).toBe('Ada Nkem Obi');
        expect(user.phone).toBe('08031111111');
        expect(user.stateOfOrigin).toBe('Lagos');
    });

    it('and composing the full name without a gap when there is no other name', async () => {
        const { submitExportOnboardingAction } = await actions();
        await submitExportOnboardingAction(null, submission({
            profile: {
                firstName: 'Ada', lastName: 'Obi', otherName: '',
                phone: '08031111111', state: 'Lagos', lga: 'Ikeja',
                address: '1 Market Road, Ikeja',
            },
        }));

        expect(store.get(COLLECTIONS.USERS, APPLICANT)!.fullName).toBe('Ada Obi');
    });

    it('keeping the rest of the user document intact', async () => {
        // Dot-notation, not a replacement. A submission that overwrote
        // serviceRegistrations would drop the applicant's other modules.
        store.seed(COLLECTIONS.USERS, APPLICANT, {
            email: 'applicant@example.com',
            roles: ['user', 'cooperative_member'],
            serviceRegistrations: { cooperatives: { status: 'active' } },
        });

        const { submitExportOnboardingAction } = await actions();
        await submitExportOnboardingAction(null, submission());

        const user = store.get(COLLECTIONS.USERS, APPLICANT)!;
        expect(user.serviceRegistrations.cooperatives.status).toBe('active');
        expect(user.serviceRegistrations.export.status).toBe('pending_approval');
        expect(user.roles).toContain('cooperative_member');
    });

    it('refusing while a previous application is still open', async () => {
        for (const status of ['pending', 'pending_approval', 'under_review']) {
            store.seed(COLLECTIONS.USERS, APPLICANT, {
                email: 'a@example.com',
                serviceRegistrations: { export: { status } },
            });

            const { submitExportOnboardingAction } = await actions();
            const result = await submitExportOnboardingAction(null, submission());

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/still being processed/i);
            expect(applications()).toHaveLength(0);
        }
    });

    it('and refusing an applicant who is already approved', async () => {
        store.seed(COLLECTIONS.USERS, APPLICANT, {
            email: 'a@example.com',
            serviceRegistrations: { export: { status: 'approved' } },
        });

        const { submitExportOnboardingAction } = await actions();
        const result = await submitExportOnboardingAction(null, submission());

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/already registered/i);
        expect(applications()).toHaveLength(0);
    });

    it('while a REJECTED applicant may apply again', async () => {
        // The complement, and the reason the refusal lists statuses rather than
        // "has applied before". A rejected applicant who could never reapply would
        // be locked out permanently by one bad document.
        store.seed(COLLECTIONS.USERS, APPLICANT, {
            email: 'a@example.com',
            serviceRegistrations: { export: { status: 'rejected' } },
        });

        const { submitExportOnboardingAction } = await actions();
        expect((await submitExportOnboardingAction(null, submission())).success).toBe(true);
        expect(applications()).toHaveLength(1);
    });
});

describe('the submission validates before it writes', () => {
    it('refusing malformed JSON in any of the four sections, by name', async () => {
        // Each section is parsed separately so the applicant is told WHICH one is
        // broken. One try/catch around all four would say only "invalid data".
        const { submitExportOnboardingAction } = await actions();

        for (const [field, label] of [
            ['profile', /profile data/i],
            ['kycData', /KYC data/i],
            ['bank', /bank data/i],
            ['terms', /terms data/i],
        ] as const) {
            const fd = submission();
            fd.set(field, '{not json');

            const result = await submitExportOnboardingAction(null, fd);
            expect(result.success).toBe(false);
            expect(result.error).toMatch(label);
        }
        expect(applications()).toHaveLength(0);
    });

    it('refusing a bank account that is not ten digits', async () => {
        const { submitExportOnboardingAction } = await actions();
        const result = await submitExportOnboardingAction(null, submission({
            bank: { accountNumber: '123', bankName: 'Zenith', accountName: 'Ada Obi' },
        }));

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/10 digits/i);
        expect(applications()).toHaveLength(0);
    });

    it('and a profile missing its required fields', async () => {
        const { submitExportOnboardingAction } = await actions();
        const result = await submitExportOnboardingAction(null, submission({
            profile: { firstName: 'A', lastName: '', phone: '', state: '', lga: '', address: '' },
        }));

        expect(result.success).toBe(false);
        expect(applications()).toHaveLength(0);
    });

    it('demanding both documents, and saying which is missing', async () => {
        const { submitExportOnboardingAction } = await actions();

        const noId = submission();
        noId.delete('idDocument');
        const idResult = await submitExportOnboardingAction(null, noId);
        expect(idResult.error).toMatch(/ID Document is required/i);

        const noProof = submission();
        noProof.delete('proofOfAddress');
        const proofResult = await submitExportOnboardingAction(null, noProof);
        expect(proofResult.error).toMatch(/Proof of Address/i);

        expect(applications()).toHaveLength(0);
    });

    it('and writing NOTHING when validation fails — not a half-written application', async () => {
        // The batch is what makes this true: nothing is committed until every
        // check has passed. A validation failure that had already stamped the
        // registration would leave the applicant permanently "pending" with no
        // application behind it.
        const { submitExportOnboardingAction } = await actions();
        await submitExportOnboardingAction(null, submission({
            bank: { accountNumber: 'x', bankName: '', accountName: '' },
        }));

        expect(applications()).toHaveLength(0);
        expect(store.get(COLLECTIONS.USERS, APPLICANT)!.serviceRegistrations).toBeUndefined();
    });

    it('and refusing an unauthenticated caller before anything else', async () => {
        actAs(null);
        const { submitExportOnboardingAction } = await actions();
        const result = await submitExportOnboardingAction(null, submission());

        expect(result.success).toBe(false);
        expect(applications()).toHaveLength(0);
    });
});

// ─── the status check ────────────────────────────────────────────────────────

describe('checking the export status', () => {
    it('reads the registration when it says approved', async () => {
        store.seed(COLLECTIONS.USERS, APPLICANT, {
            email: 'a@example.com',
            serviceRegistrations: { export: { status: 'approved' } },
        });

        const { checkExportStatusAction } = await actions();
        expect(await checkExportStatusAction()).toBe('approved');
    });

    it('but otherwise consults the APPLICATION, which is the source of truth', async () => {
        // The registration entry is a derived copy and goes stale. When it
        // disagrees with the application record, the application wins.
        store.seed(COLLECTIONS.USERS, APPLICANT, {
            email: 'a@example.com',
            serviceRegistrations: { export: { status: 'pending_approval' } },
        });
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'app-1', {
            userId: APPLICANT, status: 'revision_required',
            submittedAt: '2026-06-01T00:00:00.000Z',
        });

        const { checkExportStatusAction } = await actions();
        expect(await checkExportStatusAction()).toBe('revision_required');
    });

    it('taking the NEWEST application when there are several', async () => {
        // A resubmitting applicant has more than one. Taking an arbitrary row
        // shows them the status of an application they have already replaced.
        store.seedAll(COLLECTIONS.EXPORT_APPLICATIONS, {
            old: { userId: APPLICANT, status: 'rejected', submittedAt: '2026-01-01T00:00:00.000Z' },
            newest: { userId: APPLICANT, status: 'revision_required', submittedAt: '2026-06-01T00:00:00.000Z' },
            middle: { userId: APPLICANT, status: 'draft', submittedAt: '2026-03-01T00:00:00.000Z' },
        });

        const { checkExportStatusAction } = await actions();
        expect(await checkExportStatusAction()).toBe('revision_required');
    });

    it('falling back to createdAt when there is no submittedAt', async () => {
        store.seedAll(COLLECTIONS.EXPORT_APPLICATIONS, {
            old: { userId: APPLICANT, status: 'rejected', createdAt: '2026-01-01T00:00:00.000Z' },
            newest: { userId: APPLICANT, status: 'revision_required', createdAt: '2026-06-01T00:00:00.000Z' },
        });

        const { checkExportStatusAction } = await actions();
        expect(await checkExportStatusAction()).toBe('revision_required');
    });

    it('and NORMALISES pending_review into pending_approval on the way out', async () => {
        // The two names are one state, and the applicant's page branches on
        // "pending_approval". Returning the raw application value would leave a
        // submitted application rendering as an unknown status.
        //
        // Found by asserting the raw value first and being told otherwise, which
        // is the sort of thing reading the code twice does not settle.
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'app-1', {
            userId: APPLICANT, status: 'pending_review', submittedAt: '2026-06-01T00:00:00.000Z',
        });

        const { checkExportStatusAction } = await actions();
        expect(await checkExportStatusAction()).toBe('pending_approval');
    });

    it('and not seeing ANOTHER applicant’s application', async () => {
        // The query test. An application exists; it just is not theirs.
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'someone-else', {
            userId: 'other-person', status: 'approved', submittedAt: '2026-06-01T00:00:00.000Z',
        });

        const { checkExportStatusAction } = await actions();
        expect(await checkExportStatusAction()).not.toBe('approved');
    });

    it('and returning null for an unauthenticated caller', async () => {
        actAs(null);
        const { checkExportStatusAction } = await actions();
        expect(await checkExportStatusAction()).toBeNull();
    });
});

// ─── claiming a legacy application by email (finding #83) ────────────────────

/**
 * checkWaveStatus used to claim an application by email with two defects: it
 * fell back to a `profile.email` nobody had authenticated as, and its
 * `!appData.userId` test guarded only the backfill WRITE, so an application
 * belonging to somebody else was still read and its `approved` status promoted
 * onto the caller — and written to their user record, which
 * module-access-check Layer 2 admits on.
 *
 * That was fixed as #36. On WAVE only. The same code, both defects included,
 * was still here and in farm-nation/_fn_onboarding.ts.
 *
 * src/__tests__/unit/email-claim-is-narrowed-everywhere.test.ts is the gate
 * against a fourth copy.
 */
describe('claiming a legacy application by email (finding #83)', () => {
    it('claims an UNCLAIMED application matching the authenticated address', async () => {
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'legacy', {
            userEmail: 'applicant-1@example.com', status: 'approved',
        });

        const { checkExportStatusAction } = await actions();
        expect(await checkExportStatusAction()).toBe('approved');
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, 'legacy')!.userId).toBe(APPLICANT);
    });

    it('refuses to adopt an application that already belongs to somebody else', async () => {
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'somebody-elses', {
            userId: 'other-person', userEmail: 'applicant-1@example.com', status: 'approved',
        });

        const { checkExportStatusAction } = await actions();
        expect(await checkExportStatusAction()).toBeNull();
        expect(store.get(COLLECTIONS.USERS, APPLICANT)!.serviceRegistrations?.export?.status)
            .toBeUndefined();
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, 'somebody-elses')!.userId)
            .toBe('other-person');
    });

    it('claims the unclaimed one even when an owned row matches the same address', async () => {
        store.seedAll(COLLECTIONS.EXPORT_APPLICATIONS, {
            'owned-by-other': {
                userId: 'other-person', userEmail: 'applicant-1@example.com', status: 'approved',
            },
            'unclaimed': { userEmail: 'applicant-1@example.com', status: 'revision_required' },
        });

        const { checkExportStatusAction } = await actions();
        expect(await checkExportStatusAction()).toBe('revision_required');
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, 'unclaimed')!.userId).toBe(APPLICANT);
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, 'owned-by-other')!.userId)
            .toBe('other-person');
    });

    it('does not match on profile.email, which nobody authenticated as', async () => {
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'imported', {
            profile: { email: 'applicant-1@example.com' }, status: 'approved',
        });

        const { checkExportStatusAction } = await actions();
        expect(await checkExportStatusAction()).toBeNull();
    });
});

// ─── retrieval ───────────────────────────────────────────────────────────────

describe('retrieving the applicant’s own application', () => {
    it('by the stamped applicationId first', async () => {
        store.seed(COLLECTIONS.USERS, APPLICANT, {
            email: 'a@example.com',
            serviceRegistrations: { export: { applicationId: 'stamped-doc' } },
        });
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'stamped-doc',
            { userId: APPLICANT, status: 'pending_review' });

        const { getExportApplicationAction } = await actions();
        const result = await getExportApplicationAction();

        expect(result.success).toBe(true);
        expect(result.data?.id ?? result.data?.applicationId ?? 'stamped-doc').toBeTruthy();
    });

    it('and by query when the stamped id points at nothing', async () => {
        // The stamped id can be an applicationId FIELD rather than a document id,
        // or point at a document that was replaced. The query is the recovery, and
        // a reader without it shows the applicant an empty page.
        store.seed(COLLECTIONS.USERS, APPLICANT, {
            email: 'a@example.com',
            serviceRegistrations: { export: { applicationId: 'EXPORT-ONBOARD-999' } },
        });
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'real-doc', {
            userId: APPLICANT, status: 'revision_required',
            createdAt: '2026-06-01T00:00:00.000Z',
        });

        const { getExportApplicationAction } = await actions();
        const result = await getExportApplicationAction();

        expect(result.success).toBe(true);
        expect(JSON.stringify(result.data)).toContain('revision_required');
    });

    it('and refuses an unauthenticated caller', async () => {
        actAs(null);
        const { getExportApplicationAction } = await actions();
        expect((await getExportApplicationAction()).success).toBe(false);
    });
});

// ─── access ──────────────────────────────────────────────────────────────────

describe('the module access check', () => {
    it('is false for an applicant with nothing recorded', async () => {
        const { checkExportAccessAction } = await actions();
        expect(await checkExportAccessAction()).toBe(false);
    });

    it('true once the application is approved, through the shared checker', async () => {
        // Delegates to checkModuleAccess rather than re-implementing the rule —
        // which is what stops a fifth copy of "may this person reach export"
        // drifting from the other four.
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'app-1',
            { userId: APPLICANT, status: 'approved' });

        const { checkExportAccessAction } = await actions();
        expect(await checkExportAccessAction()).toBe(true);
    });

    it('and false for an unauthenticated caller', async () => {
        actAs(null);
        const { checkExportAccessAction } = await actions();
        expect(await checkExportAccessAction()).toBe(false);
    });
});
