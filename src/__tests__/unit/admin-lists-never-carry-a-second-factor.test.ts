/**
 * @jest-environment node
 */

/**
 *   #341 THE ACADEMY APPLICATION LIST SPREAD THE RAW USER DOCUMENT, SECOND
 *        FACTOR AND ALL.
 *
 *        Both branches of getStandardAcademyApplicationsAction built their row
 *        as:
 *
 *            const mergedData = { ...uData, ...app, ... };
 *            ...
 *            const bankDetails = maySeeBankDetails ? (...) : undefined;
 *            return { ..., data: mergedData, ... };
 *
 *        `uData` is the whole USERS document. `...app` overrides the keys the
 *        two share; every key only the user document has survives the merge:
 *
 *            bvn, nin, documents, nextOfKin, verificationProfile,
 *            bankDetails, bankAccountNumber, bankAccountName, bankCode,
 *            totpSecret, mfaRecoveryCodes
 *
 *        So `maySeeBankDetails`, computed three lines above, gated a
 *        `bankDetails` key that a caller who failed the gate received anyway —
 *        one level along, in the same returned object. lib/admin-pii.ts's own
 *        header names this failure: "the same values sit nested and survive any
 *        field-by-field gate applied above them."
 *
 *        THIS FILE WAS LOOKED AT EARLIER IN THE SAME SWEEP AND PASSED. The gate
 *        was present, on the right permission, with a comment explaining it —
 *        and reading the gate is not reading what the spread beneath it
 *        carries. That is the whole reason this test executes the action rather
 *        than grepping for `hasAdminPermission`.
 *
 *        AND IT IS RENDERED. The screen keeps the object as `_raw: d` and hands
 *        it to DynamicDetailModal, which prints every key not on a fixed
 *        exclude list — a list that names bvnVerified and bvnStatus and not
 *        `bvn`.
 *
 *        TWO CLASSES OF KEY, TWO RULES.
 *
 *        A BVN is information about a person, and an admin approving their
 *        application has a reason to see it — so it follows the gate the file
 *        already computed. A TOTP secret is the thing that PROVES they are that
 *        person. No admin permission is a reason to hold it, so SECRET_KEYS is
 *        stripped from BOTH branches: stripSecrets for the caller who may see
 *        the record, stripPii (which includes the secrets) for the caller who
 *        may not.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { stripPii, stripSecrets, SECRET_KEYS, PII_KEYS } from '@/lib/admin-pii';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));
jest.mock('next/cache', () => ({
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

declare const global: any;

const TOTP = 'JBSWY3DPEHPK3PXP-encrypted';
const RECOVERY = ['aaaa-bbbb', 'cccc-dddd'];
const BVN = '22222222222';
const ACCOUNT = '0123456789';

let store: FakeDbHandle;

function actAs(roles: string[]) {
    global.mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 'admin1', roles, email: 'a@x.com' } },
        error: null,
    }));
}

function seed() {
    store.seed(COLLECTIONS.USERS, 'u1', {
        firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com', phone: '08011111111',
        gender: 'female', dateOfBirth: '1990-01-01', occupation: 'Farmer',
        // The keys only the user document has — the ones that survive `...app`.
        bvn: BVN,
        nin: '11111111111',
        bankDetails: { bankName: 'GTB', accountNumber: ACCOUNT, accountName: 'Ada Obi' },
        nextOfKin: { name: 'Ngozi', phone: '08022222222' },
        documents: { idCard: 'https://cdn.test/id.jpg' },
        totpSecret: TOTP,
        mfaRecoveryCodes: RECOVERY,
        serviceRegistrations: { academy: { status: 'active', plan: 'elite' } },
    });
    store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a1', {
        userId: 'u1',
        status: 'pending',
        plan: 'registration',
        submittedAt: '2026-01-01T00:00:00.000Z',
        personalInfo: { fullName: 'Ada Obi', email: 'ada@example.com' },
    });
}

async function list(roles: string[]) {
    actAs(roles);
    seed();
    const { getStandardAcademyApplicationsAction } =
        await import('@/app/actions/academy/_ac_admin_applications');
    return (await getStandardAcademyApplicationsAction({})) as any;
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

// ─────────────────────────────────────────────────────────────────────────────
describe('#341 — the second factor never leaves, for anybody', () => {
    it('NOT FOR AN ADMIN WHO MAY APPROVE THE APPLICATION', async () => {
        // THE test. super_admin holds academy:approve_applications and passes
        // every gate in the file — and still does not get the TOTP secret.
        const res = await list(['super_admin']);
        expect(res.success).toBe(true);

        const row = res.data[0];
        expect(row.data.totpSecret).toBeUndefined();
        expect(row.data.mfaRecoveryCodes).toBeUndefined();
        expect(JSON.stringify(res)).not.toContain(TOTP);
        expect(JSON.stringify(res)).not.toContain('aaaa-bbbb');
    });

    it('nor for a support user, who gets nothing else either', async () => {
        const res = await list(['support']);
        const row = res.data[0];

        expect(row.data.totpSecret).toBeUndefined();
        expect(row.data.mfaRecoveryCodes).toBeUndefined();
        expect(JSON.stringify(res)).not.toContain(TOTP);
    });

    it('and the approving admin STILL SEES WHAT THEY ARE APPROVING', async () => {
        // The counterpart guard. This is a strip of the credentials, not a
        // lockout: an academy_admin deciding on the application needs the
        // record, and the module gates the bank block on that same permission.
        const res = await list(['academy_admin']);
        const row = res.data[0];

        expect(row.data.bvn).toBe(BVN);
        expect(row.data.bankDetails.accountNumber).toBe(ACCOUNT);
        expect(row.user.bankDetails.accountNumber).toBe(ACCOUNT);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#341 — and the gate three lines up now covers the spread beneath it', () => {
    it('A SUPPORT USER GETS NO BVN, NIN, NEXT OF KIN OR ID DOCUMENTS', async () => {
        const res = await list(['support']);
        const row = res.data[0];

        expect(row.data.bvn).toBeUndefined();
        expect(row.data.nin).toBeUndefined();
        expect(row.data.nextOfKin).toBeUndefined();
        expect(row.data.documents).toBeUndefined();
        expect(row.data.bankDetails).toBeUndefined();
        expect(JSON.stringify(res)).not.toContain(BVN);
        expect(JSON.stringify(res)).not.toContain(ACCOUNT);
    });

    it('but the list still works — that is what the screen is for', async () => {
        // Vacuity guard: a strip that emptied the row would pass every
        // assertion above and break the queue.
        const res = await list(['support']);
        const row = res.data[0];

        expect(res.data).toHaveLength(1);
        expect(row.user.name).toBe('Ada Obi');
        expect(row.status).toBe('pending');
        expect(row.data.gender).toBe('female');
        expect(row.data.occupation).toBe('Farmer');
        expect(row.data.dateOfBirth).toBe('1990-01-01');
    });

    it('the fields the screen reads by name survive BOTH branches', async () => {
        // src/app/admin/academy/applications/page.tsx reads these off `data`.
        const READS = ['gender', 'dateOfBirth', 'occupation', 'stateOfOrigin',
            'lga', 'residentialAddress', 'phone', 'plan'];

        for (const roles of [['support'], ['academy_admin']]) {
            store = installFakeDb();
            const row = (await list(roles)).data[0];
            for (const key of READS) {
                expect(Object.prototype.hasOwnProperty.call(row.data, key)).toBe(true);
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#341 — the shared definitions', () => {
    it('SECRET_KEYS names the second factor and its recovery codes', () => {
        expect(SECRET_KEYS).toContain('totpSecret');
        expect(SECRET_KEYS).toContain('mfaRecoveryCodes');
    });

    it('and they really are what the MFA routes read', () => {
        // The claim, pinned. If MFA moves to a different field this fails.
        const setup = source('src/app/api/auth/mfa/setup/route.ts');
        const verify = source('src/app/api/auth/mfa/verify/route.ts');

        expect(setup).toContain('totpSecret: encryptedSecret');
        expect(verify).toContain('userData.totpSecret');
    });

    it('stripSecrets removes ONLY the credentials, at any depth', () => {
        const out = stripSecrets({
            bvn: BVN, totpSecret: TOTP, mfaRecoveryCodes: RECOVERY,
            nested: { totpSecret: TOTP, keep: 1 },
        }) as Record<string, any>;

        expect(out.bvn).toBe(BVN);            // NOT a secret — this is the point
        expect(out.totpSecret).toBeUndefined();
        expect(out.mfaRecoveryCodes).toBeUndefined();
        expect(out.nested.totpSecret).toBeUndefined();
        expect(out.nested.keep).toBe(1);
    });

    it('stripPii removes the credentials TOO — a secret is not less than PII', () => {
        const out = stripPii({ bvn: BVN, totpSecret: TOTP }) as Record<string, any>;

        expect(out.bvn).toBeUndefined();
        expect(out.totpSecret).toBeUndefined();
    });

    it('the two lists are disjoint, so neither is a rename of the other', () => {
        for (const key of SECRET_KEYS) {
            expect(PII_KEYS).not.toContain(key);
        }
        expect(PII_KEYS.length).toBeGreaterThan(5);   // vacuity guard
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#341 — no other response spreads a raw USER document ungated', () => {
    it('the ratchet: every `...uData` / `...userData` in a response is accounted for', () => {
        // The scan that found this one. A new file spreading the user document
        // into a payload has to be triaged into this list deliberately.
        const KNOWN: Record<string, string> = {
            // Gated: stripSecrets / stripPii on both of its branches.
            'src/app/actions/academy/_ac_admin_applications.ts': 'stripPii(mergedData)',
            // A WRITE, not a response — it migrates a user row to a new id.
            'src/app/actions/admin/_legacy.ts': '',
            // Destructures the sensitive keys out behind maySeeBankDetails,
            // which is a different mechanism with the same effect (#338).
            'src/app/actions/farm-nation-admin/_fna_registrants.ts': 'maySeeBankDetails',
        };

        const { execSync } = require('child_process');
        const hits: string[] = execSync(
            "grep -rlE '\\.\\.\\.(userData|uData)\\b' --include=*.ts src/app/actions src/app/api || true",
            { encoding: 'utf-8' },
        ).split('\n').filter(Boolean);

        expect(hits.length).toBeGreaterThan(0);           // vacuity guard
        expect(hits.sort()).toEqual(Object.keys(KNOWN).sort());

        for (const [file, marker] of Object.entries(KNOWN)) {
            if (marker) expect(source(file)).toContain(marker);
        }
    });
});
