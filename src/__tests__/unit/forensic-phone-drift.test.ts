/**
 * @jest-environment node
 */

/**
 *   #372 A THIRD FORENSIC CHECK THAT COULD NEVER FIND ANYTHING — AND WOULD HAVE
 *        BEEN WRONG TWICE OVER IF IT HAD.
 *
 *        #331 found two of the eight checks in actions/forensics.ts reporting
 *        "pass" for questions they were structurally incapable of asking. This
 *        is the third, and it fails in both of the ways this audit keeps
 *        recording — either of which alone makes its answer meaningless.
 *
 *        (a) IT READ A FIELD TWO OF THE THREE WRITERS NEVER WRITE.
 *
 *              api/marketplace/submit-verification/route.ts    phone
 *              actions/admin/_legacy.ts                        phone
 *              actions/marketplace/_mp_seller_verification.ts  phoneNumber
 *
 *            The check read `data.phoneNumber` alone, so for a row from either
 *            of the first two — every seller who submitted through the API
 *            route, and every legacy import — `verifiedPhone` was undefined,
 *            the guarding `if` skipped the row, and it was counted as no drift.
 *            The recurring shape: three doors, and the one being inspected is
 *            not the one anybody walks through.
 *
 *        (b) AND IT COMPARED RAW STRINGS. `userPhone !== verifiedPhone`, with
 *            no normalisation, on a platform where lib/phone.ts exists exactly
 *            because the same number is stored three ways. Its own header says
 *            "registerAction normalises before it writes... several OTHER
 *            writers put the raw value on the same field". So on the rows it
 *            DID read, a format difference alone would have been reported as
 *            contact drift — #80's defect, inverted.
 *
 *            The two faults compound: the rows it could read are the rows it
 *            would misjudge.
 *
 *        Both spellings are read now, on both sides, through normalisePhone,
 *        and a row with no comparable number on one side is counted as
 *        UNREADABLE rather than as agreement — reported as #331's
 *        "inconclusive" when nothing at all could be compared.
 *
 *        STILL NOBODY CALLS THIS FILE. runForensicScanAction has no caller in
 *        application code; only tests import it. That is #331's recorded owner
 *        decision and it is unchanged — the check is repaired because it is
 *        wrong and would ship wrong the moment a screen is built, not because
 *        an operator is reading a false green line today.
 *
 * These tests EXECUTE the scan against a seeded world, for #331's reason: what
 * the code intends tells you nothing about whether its query can match.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { normalisePhone } from '@/lib/phone';

const ADMIN = 'admin-1';
const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
            if (e.name === '__tests__') continue;
            walk(rel, out);
        } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
    }
    return out;
}

const FORENSICS = 'src/app/actions/forensics.ts';
const CHECK = 'Phone Data Drift (Profile vs Verified)';

function setSession(uid: string, roles: string[]) {
    (global as any).mockRequireSession.mockResolvedValue({
        session: { user: { id: uid, roles, email: 'a@b.c' } },
        response: null,
    });
}

/**
 * Seeds the two collections this check reads and nothing else; every other
 * query the scan makes answers empty, so the other seven checks stay inert.
 */
function setWorld(verifications: Array<{ id: string; data: any }>,
                  usersById: Record<string, any>) {
    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        const empty = { exists: false, empty: true, size: 0, docs: [], data: () => ({}) };

        if (idOrCollection === 'seller_verifications') {
            return Promise.resolve({
                exists: false,
                empty: verifications.length === 0,
                size: verifications.length,
                docs: verifications.map((v) => ({ id: v.id, data: () => v.data })),
                data: () => ({}),
            });
        }
        if (idOrCollection in usersById) {
            return Promise.resolve({ exists: true, data: () => usersById[idOrCollection] });
        }
        return Promise.resolve(empty);
    });

    (global as any).mockFirestoreTxGet.mockImplementation(() =>
        Promise.resolve({ exists: false, empty: true, size: 0, docs: [], data: () => ({}) }));
}

async function scan() {
    const { runForensicScanAction } = await import('@/app/actions/forensics');
    return runForensicScanAction();
}

function drift(result: any) {
    const results = result?.data?.results ?? result?.results ?? [];
    return results.find((r: any) => r.check === CHECK);
}

beforeEach(() => {
    jest.clearAllMocks();
    setSession(ADMIN, ['admin']);
    (global as any).adminAuthListUsers?.mockReset?.();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#372 — the check can now read the rows the live writer produces', () => {
    it('FINDS DRIFT ON A ROW WRITTEN AS `phone` — the API route\'s spelling', async () => {
        // The whole defect in one case. Before the fix `data.phoneNumber` was
        // undefined here, the row was skipped, and the check said "pass".
        setWorld(
            [{ id: 'v1', data: { userId: 'u1', status: 'approved', phone: '08011111111' } }],
            { u1: { phone: '08022222222' } },
        );

        const r = drift(await scan());

        expect(r.status).toBe('warning');
        expect(r.affectedIds).toEqual(['u1']);
    });

    it('and on a row written as `phoneNumber` — the server action\'s spelling', async () => {
        setWorld(
            [{ id: 'v1', data: { userId: 'u1', status: 'approved', phoneNumber: '08011111111' } }],
            { u1: { phone: '08022222222' } },
        );

        const r = drift(await scan());

        expect(r.status).toBe('warning');
        expect(r.affectedIds).toEqual(['u1']);
    });

    it('AND DOES NOT REPORT DRIFT FOR A FORMAT DIFFERENCE', async () => {
        // The other half. `08012345678` and `+2348012345678` are one number;
        // a raw !== would have called every such pair contact drift.
        setWorld(
            [{ id: 'v1', data: { userId: 'u1', status: 'approved', phone: '08012345678' } }],
            { u1: { phone: '+2348012345678' } },
        );

        const r = drift(await scan());

        expect(r.affectedIds).toEqual([]);
        expect(r.status).toBe('pass');
    });

    it('the two spellings really are one number, by the shared normaliser', () => {
        /**
         * Stated directly so the case above is not passing for some other
         * reason.
         *
         * AN EQUIVALENT MUTANT, RECORDED. Deleting normalisePhone's 0-prefix
         * fold (`if (p.startsWith('0')) p = '234' + p.slice(1)`) changes
         * nothing for any input here: its third branch, `'+234' + last ten
         * digits`, already produces the same answer. Recorded rather than
         * contrived away — the same disposition as #367's M16 and #368's M14.
         * M4 and M5 already prove this check depends on normalisation
         * happening at all, which is the claim that matters.
         */
        expect(normalisePhone('08012345678')).toBe(normalisePhone('+2348012345678'));
        expect(normalisePhone('08012345678')).not.toBe(normalisePhone('08099999999'));
    });

    it('and the user side is read under its spellings too', async () => {
        // #371: `phoneNumber` is on the user row beside `phone` whenever the
        // write went through atomicUpdateUser, and `kyc.phoneNumber` beside
        // both once saveKYCProfileAction has run.
        setWorld(
            [{ id: 'v1', data: { userId: 'u1', status: 'approved', phone: '08011111111' } }],
            { u1: { kyc: { phoneNumber: '08011111111' } } },
        );

        const r = drift(await scan());

        expect(r.affectedIds).toEqual([]);
        expect(r.details).toContain('1 comparable');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#372 — "I could not look" no longer reads as "I looked and found nothing"', () => {
    it('A ROW WITH NO USABLE NUMBER IS INCONCLUSIVE, NOT A PASS', async () => {
        // The old behaviour for EVERY api-route row: skipped, then counted as
        // agreement and reported green.
        setWorld(
            [{ id: 'v1', data: { userId: 'u1', status: 'approved' } }],
            { u1: { email: 'a@b.c' } },
        );

        const r = drift(await scan());

        expect(r.status).toBe('inconclusive');
        expect(r.affectedIds).toEqual([]);
    });

    it('and the count of unreadable rows is reported, not hidden', async () => {
        setWorld(
            [
                { id: 'v1', data: { userId: 'u1', status: 'approved', phone: '08011111111' } },
                { id: 'v2', data: { userId: 'u2', status: 'approved' } },
                { id: 'v3', data: { status: 'approved', phone: '08033333333' } },
            ],
            { u1: { phone: '08011111111' }, u2: { email: 'x@y.z' } },
        );

        const r = drift(await scan());

        expect(r.details).toContain('1 comparable');
        expect(r.details).toContain('2 with no usable number');
        expect(r.status).toBe('pass');
    });

    it('an empty collection is a pass, not an inconclusive', async () => {
        // Nothing to look at is genuinely no finding; the distinction only
        // matters when there ARE rows and none could be compared.
        setWorld([], {});

        const r = drift(await scan());

        expect(r.status).toBe('pass');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#372 — the reader covers what the writers actually write', () => {
    /**
     * The measurement that produced the finding, kept as a ratchet: a fifth
     * creator arriving with a fifth spelling should fail here rather than
     * quietly shrink the check's reach again.
     *
     * A CORRECTION TO MY OWN FIRST DRAFT, which said three creators. There are
     * four. My first grep matched only the two that write the row inline; the
     * other two build a ref first (`const verificationRef = …doc(id)`) and pass
     * it to `transaction.set(ref, data)` further down, so a fixed-width window
     * after the collection name missed them. The resolving sweep below is what
     * the claim now rests on.
     */
    const CREATORS = [
        'src/app/api/marketplace/submit-verification/route.ts',
        'src/app/actions/marketplace/_mp_onboarding.ts',
        'src/app/actions/admin/_legacy.ts',
        'src/app/actions/marketplace/_mp_seller_verification.ts',
    ];

    /** Files that CREATE a seller_verifications document, ref indirection included. */
    function creators(): string[] {
        const SV = String.raw`COLLECTIONS\.SELLER_VERIFICATIONS`;
        const out: string[] = [];

        for (const f of walk('src')) {
            const s = source(f);
            if (!s.includes('SELLER_VERIFICATIONS')) continue;

            let creates = new RegExp(SV + String.raw`\)\s*\.doc\([^)]*\)\s*\.set\(`).test(s)
                || new RegExp(String.raw`\w+\.set\(\s*db\.collection\(` + SV + String.raw`\)`).test(s);

            if (!creates) {
                for (const m of s.matchAll(
                    new RegExp(String.raw`(?:const|let)\s+(\w+)\s*=\s*db\.collection\(` + SV + String.raw`\)\s*\.doc\(`, 'g'))) {
                    if (new RegExp(String.raw`\.set\(\s*` + m[1] + String.raw`\b`).test(s)) { creates = true; break; }
                }
            }
            if (creates) out.push(f);
        }
        return out;
    }

    it('FOUR PLACES CREATE A SELLER VERIFICATION ROW', () => {
        // user.ts also matches — it is #300's erasure MARKER, merged onto an
        // existing row, not a creation. Named rather than filtered silently.
        const found = creators().filter((f) => f !== 'src/app/actions/user.ts');

        expect(found.sort()).toEqual([...CREATORS].sort());
    });

    /**
     * The row literal each creator writes, sliced out by its own anchor.
     *
     * Sliced rather than searched whole-file, because both onboarding files
     * ALSO write `phone:` onto the USER document a few lines later. Mutant M17
     * renamed the verification field and survived on that second, unrelated
     * line — the assertion has to look at the object being created.
     */
    function verificationLiteral(file: string, anchor: string): string {
        const s = source(file);
        const at = s.indexOf(anchor);

        expect({ file, anchored: at > -1 }).toEqual({ file, anchored: true });
        return s.slice(at, at + 900);
    }

    it('THEY DISAGREE ABOUT THE PHONE FIELD, WHICH IS THE FINDING', () => {
        // Three write `phone`, one writes `phoneNumber` — and that one carries
        // a comment saying the form sends `phone`. Facts about the data, not
        // about anybody's intention.
        // Anchored on the WRITE, not on the collection name: that route reads
        // the same collection earlier to refuse a duplicate submission, and a
        // bare `SELLER_VERIFICATIONS` anchor landed on the read.
        const api = verificationLiteral(
            'src/app/api/marketplace/submit-verification/route.ts',
            'SELLER_VERIFICATIONS).doc(userId).set({');
        const onb = verificationLiteral(
            'src/app/actions/marketplace/_mp_onboarding.ts', 'const verificationData = {');
        const legacy = verificationLiteral(
            'src/app/actions/admin/_legacy.ts', 'SELLER_VERIFICATIONS).doc(`legacy_');
        // A CODE anchor, not the "DISEASE 6 FIX" comment above the literal:
        // source() strips comments, so that anchor found nothing and the slice
        // was empty — which is how my first draft of this test failed, and how
        // the mutation run that followed it reported a false 100%.
        const action = verificationLiteral(
            'src/app/actions/marketplace/_mp_seller_verification.ts',
            'const verificationId = `seller_${userId}_${Date.now()}`;');

        expect(api).toMatch(/\n\s*phone,/);
        expect(onb).toMatch(/\n\s*phone:\s*formData\.get\("phone"\),/);
        expect(legacy).toMatch(/\n\s*phone:\s*data\.phone,/);

        expect(action).toMatch(/\n\s*phoneNumber:\s*\(formData\.get/);
        expect(action).not.toMatch(/\n\s*phone:\s/);
    });

    it('and the check reads BOTH spellings, through the normaliser', () => {
        const src = source(FORENSICS);
        const start = src.indexOf('Phone Data Drift');
        const block = src.slice(Math.max(0, start - 1400), start);

        expect(start).toBeGreaterThan(-1);
        expect(block).toContain('normalisePhone(data.phoneNumber ?? data.phone)');
        expect(block).toMatch(/normalisePhone\(u\?\.phone \?\? u\?\.phoneNumber/);
    });

    it('the unnormalised read that ignored format is gone', () => {
        // The precise line the defect lived on. The `!==` itself stays and is
        // correct — what was wrong was comparing values nothing had normalised,
        // which is why this anchors on the READ and not on the comparison.
        expect(source(FORENSICS)).not.toContain('const userPhone = userDoc.data()?.phone;');
        expect(source(FORENSICS)).toContain('userPhone !== verifiedPhone');
    });

    it('and it is measured on code, not on prose', () => {
        // The #372 note quotes the four creators by path. A raw-text sweep
        // would read that tombstone as a reference — the trap has fired twelve
        // times in this audit.
        const raw = readFileSync(FORENSICS, 'utf-8');

        expect(raw).toContain('api/marketplace/submit-verification/route.ts');
        expect(source(FORENSICS)).not.toContain('api/marketplace/submit-verification/route.ts');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#266 — the scan now HAS a way in', () => {
    it('runForensicScanAction is called by exactly one screen', () => {
        //   #266 WAS "RECORDED: the scan still has no way in", asserting that
        //        `callers` was empty and that the file said NOBODY CALLS THIS
        //        FILE. #331 left "build the screen or drop it" open; it is
        //        decided, and the screen is built.
        //
        //        The claim is still MEASURED rather than trusted, and it is
        //        still the raw text that carries the file's own prose — the
        //        tombstone trap pointed the other way, which is exactly how the
        //        first draft of this test failed.
        expect(source(FORENSICS)).toContain('export async function runForensicScanAction');
        expect(readFileSync(FORENSICS, 'utf-8')).toContain('NOBODY CALLED THIS FILE — UNTIL #266');

        const callers = walk('src').filter((f) =>
            f !== FORENSICS && /\brunForensicScanAction\s*\(/.test(source(f)));

        expect(callers).toEqual(['src/app/admin/forensics/page.tsx']);
    });

    it('and that screen is reachable from the rendered admin nav', () => {
        // #362's shape is what this whole finding was. A screen nothing links
        // to is the same defect one layer up, so the link is pinned in the nav
        // table the admin layout actually renders.
        const sidebar = source('src/components/admin/AdminSidebar.tsx');

        expect(sidebar).toContain('href: "/admin/forensics"');
        expect(sidebar).toContain('platformOnly: true');
    });

    it('and the nav asks the SAME predicate the action does', () => {
        // Not a route-prefix rule that agrees today. The action gates on
        // isPlatformAdmin and no permission-matrix entry means that, so the nav
        // calls the same function rather than restating the audience — #382.
        const sidebar = source('src/components/admin/AdminSidebar.tsx');

        expect(sidebar).toMatch(/item\.platformOnly[\s\S]{0,200}isPlatformAdmin\(roles\)/);
        expect(sidebar).toContain('isPlatformAdmin');
        expect(source(FORENSICS)).toContain('isPlatformAdmin(session?.user?.roles)');
    });

    it('and the file records this as its third false pass', () => {
        expect(readFileSync(FORENSICS, 'utf-8')).toContain('#372');
    });
});
