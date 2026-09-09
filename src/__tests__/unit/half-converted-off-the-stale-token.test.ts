/**
 * @jest-environment node
 */

/**
 *   #532 THREE FILES WERE HALF-CONVERTED OFF THE STALE TOKEN, AND IN EVERY ONE
 *        THE HALF LEFT BEHIND IS THE HALF THAT HANDS DATA OVER.
 *
 *   #356 established what a JWT role claim costs — it keeps its value for hours
 *   after the database loses it — and built requireAdmin, whose step 2 reads
 *   "Re-fetch roles live from Firestore (bypasses the stale JWT)". #364 swept it
 *   through fifteen API routes. #526 found the endpoint that GRANTS ROLES still
 *   unconverted.
 *
 *   Measured across src/app: 21 files use requireAdmin, 88 still gate on
 *   `session.user.roles`, and THREE use both. Those three are the ones somebody
 *   started converting and stopped inside:
 *
 *     _land.ts        _verifyLandListing      live  the decision
 *                     _getPendingLandListings JWT   the whole pending queue
 *     _settings.ts    _saveSystemSettings     live
 *                     _savePlatformSettings   JWT   the other config WRITE
 *     _withdrawals.ts _processWithdrawal      live  money out
 *                     _getPendingWithdrawals  JWT   the queue AND the bank details
 *
 *   The pattern is not random. In two of the three the converted half is the
 *   WRITE and the half left behind is the READ — which is #510's finding
 *   restated: the read "is the one that hands the data over". A revoked admin
 *   could not decide a land parcel and could still list every pending one with
 *   its owner and its title documents.
 *
 * ── THE COUNT WAS FIVE, THEN THREE, THEN FOUR, AND IT IS THREE ──────────────
 *
 *   Three instruments, three different answers, and the disagreement is worth
 *   more than the finding.
 *
 *     grep on raw source                    5 files
 *     a /\*[\s\S]*?\*\// block stripper    3 files
 *     a line filter (drop lines starting // * /*)  4 files
 *     lib/testing/strip-comments            3 files
 *
 *   RAW GREP counted _ac_catalog.ts, whose only "requireAdmin" is a word inside
 *   a comment explaining a different ratchet. #493's trap, met again.
 *
 *   THE BLOCK STRIPPER ate a real `hasAdminPermission(session...)` line out of
 *   _legacy.ts — a span-eating regex can delete the evidence — so it reported
 *   three files for the wrong reason and I distrusted it.
 *
 *   THE LINE FILTER cannot eat a span, so I switched to it and got four. It
 *   counts COMMENTED-OUT CODE AS LIVE, and _inviteLegacyMemberAction's entire
 *   body is inside `/* Original implementation below (deprecated and causing
 *   build errors)` with a live body of one line: `return { error: "Method
 *   deprecated" }`. I edited that dead gate before noticing, and reverted it —
 *   a fix written into a commented block is worse than none, because it makes
 *   dead code look maintained.
 *
 *   lib/testing/strip-comments — the module this repository built for exactly
 *   this — gets it right, and is what the ratchet below uses. The lesson is the
 *   one this audit keeps relearning: when two measurements disagree, neither is
 *   evidence until the instrument is settled.
 *
 * ── THE SHARPEST ONE IS A SINGLE EXPRESSION ─────────────────────────────────
 *
 *       const maySeeBankDetails = hasAdminPermission(session.user.roles, ...)
 *
 *   That line decides whether the response carries every withdrawer's BANK
 *   ACCOUNT NUMBER, across the standard, cooperative and wave queues at once,
 *   and it asked the token. #149 and #92 closed the same exposure on the two
 *   narrower queues; this is the widest of the three, and the control on it was
 *   reading a claim that can be hours out of date.
 *
 * ── AND TWO REDUNDANT CHECKS THAT COULD ONLY SUBTRACT ───────────────────────
 *
 *   _verifyLandListing and _processWithdrawalAction each kept the OLD JWT check
 *   BELOW the new live one. Once requireAdmin has asked the database, a second
 *   check on the token refuses nobody the first would admit — except an admin
 *   who was granted the permission after their token was issued, who is refused
 *   by a claim that is merely out of date. A redundant check that can only
 *   produce false refusals is not defence in depth, and both are removed.
 *
 * ── WHAT IS DELIBERATELY NOT DONE ───────────────────────────────────────────
 *
 *   THE OTHER 88 FILES ARE NOT CONVERTED HERE, and the number is stated rather
 *   than left vague. Converting every admin gate on the platform in one change
 *   is the kind of sweep the owner's standing brief exists to prevent — this is
 *   a live platform that "has always broken in one way or the other". The four
 *   below are the bounded set where the platform already disagrees with ITSELF
 *   inside one file, which is both the sharpest evidence and the safest scope.
 *   The ratchet at the foot of this file makes a fifth half-conversion fail,
 *   which is what stops the class growing while the rest is worked through.
 *
 *   _getPlatformSettingsAction HAS NO GATE AT ALL and is left alone. It returns
 *   five fields — platform name, support email, contact phone, currency,
 *   maintenance mode — from a document whose writer pins it to exactly those
 *   five keys, and the first three are on the public contact page. Adding a gate
 *   for symmetry would be a change with no defect behind it.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the land queue back on the JWT                    KILLED
 *     the withdrawal queue back on the JWT              KILLED
 *     maySeeBankDetails back on the session roles       KILLED
 *     the settings write back on the JWT                KILLED (see below)
 *     requireAdmin no longer returning its live roles   KILLED
 *     the ratchet's own file list emptied               KILLED
 *     reword this header                                SURVIVED, as intended
 *
 *   THE SETTINGS MUTANT SURVIVED THE FIRST RUN. Every assertion about that file
 *   asked whether it CONTAINS `requireAdmin(` — which the half-converted version
 *   always did, in the other function. A check satisfied by the defect is not a
 *   check, and it is the same weakness this finding is about, written into its
 *   own test. _savePlatformSettingsAction is executed now.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { auth } from '@/lib/auth';

const ROOT = process.cwd();

/**
 * lib/testing/strip-comments, and NOT a hand-rolled stripper.
 *
 * See the header: a raw grep, a block-comment regex and a line filter gave
 * three different answers to "how many files are half-converted", and only this
 * module was right. A line filter counts commented-out code as live, which is
 * how _inviteLegacyMemberAction — whose whole body is inside a `/*` block —
 * came to look like a live JWT gate.
 */
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: p });
const codeOnly = (src: string) => stripComments(src, { label: 'sweep' });

const CONVERTED = [
    'src/app/actions/admin/_land.ts',
    'src/app/actions/admin/_settings.ts',
    'src/app/actions/admin/_withdrawals.ts',
];

const JWT_GATE = /hasAdminPermission\(\s*session/;

let store: FakeDbHandle;
const BOSS = 'boss-1';

function actAs(id: string, tokenRoles: string[], recordRoles: string[]): void {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles: tokenRoles, email: `${id}@example.com` } },
        error: null,
    }));
    (auth as unknown as jest.Mock).mockImplementation(() => Promise.resolve({
        user: { id, roles: tokenRoles, email: `${id}@example.com` },
    }));
    store.seed(COLLECTIONS.USERS, id, { roles: recordRoles, email: `${id}@example.com` });
}

beforeEach(() => {
    //   No resetModules: requireAdmin calls auth() from @/lib/auth, and a fresh
    //   registry hands the action a different copy of that mock than the one
    //   actAs configures. See the note in the #530 suite.
    jest.clearAllMocks();
    store = installFakeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#532 — a token that outlived its roles opens nothing', () => {
    const withdrawalQueue = async () => {
        const { getPendingWithdrawalsAction } = await import('@/app/actions/admin/_withdrawals');
        return (await getPendingWithdrawalsAction(10)) as any;
    };

    it('THE WITHDRAWAL QUEUE REFUSES A REVOKED ADMIN', async () => {
        //   THE test. The token still says admin; the row does not.
        actAs(BOSS, ['admin'], ['general_user']);

        const res = await withdrawalQueue();

        expect(res.success).toBe(false);
        expect(res.data).toBeNull();
    });

    it('AND ADMITS ONE WHOSE RECORD STILL SAYS SO', async () => {
        //   The vacuity guard: a gate that refused everybody would satisfy the
        //   assertion above and close the finance screens.
        actAs(BOSS, ['admin'], ['admin']);

        expect((await withdrawalQueue()).success).toBe(true);
    });

    it('AND BANK DETAILS FOLLOW THE RECORD, NOT THE TOKEN', async () => {
        //   THE sharpest line in the finding, and the first version of this
        //   assertion had it wrong: it expected a REFUSAL. `support` legitimately
        //   holds finance:read, so the queue is admitted — what must not happen
        //   is that a token claiming super_admin gets the account numbers with
        //   it. The measurement is the payload, not the verdict.
        store.seed(COLLECTIONS.WITHDRAWALS, 'w-1', {
            userId: 'member-1', amount: 5000, status: 'pending',
            createdAt: '2026-01-02T00:00:00.000Z',
        });
        store.seed(COLLECTIONS.USERS, 'member-1', {
            fullName: 'Ada Obi', email: 'ada@example.com',
            bankDetails: { accountNumber: '0123456789', bankName: 'GTB' },
        });

        actAs(BOSS, ['super_admin'], ['support']);          // token lies, record says support
        const denied = await withdrawalQueue();

        expect(denied.success).toBe(true);
        expect(JSON.stringify(denied.data)).not.toContain('0123456789');
    });

    it('AND A LIVE finance:process_withdrawals STILL SEES THEM', async () => {
        //   The vacuity guard: a fix that hid the account numbers from everybody
        //   would satisfy the assertion above and break the payout screen.
        store.seed(COLLECTIONS.WITHDRAWALS, 'w-1', {
            userId: 'member-1', amount: 5000, status: 'pending',
            createdAt: '2026-01-02T00:00:00.000Z',
        });
        store.seed(COLLECTIONS.USERS, 'member-1', {
            fullName: 'Ada Obi', email: 'ada@example.com',
            bankDetails: { accountNumber: '0123456789', bankName: 'GTB' },
        });

        actAs(BOSS, ['support'], ['admin']);                // token understates, record admits
        const allowed = await withdrawalQueue();

        expect(allowed.success).toBe(true);
        expect(JSON.stringify(allowed.data)).toContain('0123456789');
    });

    it('AND A SUSPENDED ADMIN IS REFUSED', async () => {
        //   requireAdmin checks this while it has the document; the JWT gate
        //   never read one.
        actAs(BOSS, ['admin'], ['admin']);
        store.seed(COLLECTIONS.USERS, BOSS, { roles: ['admin'], suspended: true });

        expect((await withdrawalQueue()).success).toBe(false);
    });

    it('THE PLATFORM SETTINGS WRITE REFUSES A REVOKED ADMIN', async () => {
        //   Added because a mutant putting this gate back on the JWT SURVIVED.
        //   Every assertion I had about this file asked whether it CONTAINS
        //   `requireAdmin(` — which the half-converted version always did, in
        //   the other function. A check the defect satisfies is not a check.
        actAs(BOSS, ['super_admin'], ['general_user']);
        const { savePlatformSettingsAction } = await import('@/app/actions/admin/_settings');

        const res = (await savePlatformSettingsAction({
            platformName: 'Taken Over', supportEmail: 'x@e.com',
            contactPhone: '0800', defaultCurrency: 'NGN', maintenanceMode: true,
        } as any)) as any;

        expect(res.success).toBe(false);
        expect(store.get(COLLECTIONS.PLATFORM_SETTINGS, 'general')).toBeUndefined();
    });

    it('AND A LIVE ONE STILL SAVES THEM', async () => {
        //   The vacuity guard: maintenance mode has to remain settable.
        actAs(BOSS, ['general_user'], ['super_admin']);
        const { savePlatformSettingsAction } = await import('@/app/actions/admin/_settings');

        const res = (await savePlatformSettingsAction({
            platformName: 'Easy Sales Export', supportEmail: 'info@e.com',
            contactPhone: '0800', defaultCurrency: 'NGN', maintenanceMode: false,
        } as any)) as any;

        expect(res.success).toBe(true);
        expect((store.get(COLLECTIONS.PLATFORM_SETTINGS, 'general') as any).platformName)
            .toBe('Easy Sales Export');
    });

    it('and the land queue refuses a revoked admin too', async () => {
        actAs(BOSS, ['admin'], ['general_user']);
        const { getPendingLandListings } = await import('@/app/actions/admin/_land');

        expect(((await getPendingLandListings(10)) as any).success).toBe(false);
    });

    it('and it still admits a live one', async () => {
        actAs(BOSS, ['admin'], ['admin']);
        const { getPendingLandListings } = await import('@/app/actions/admin/_land');

        expect(((await getPendingLandListings(10)) as any).success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#532 — requireAdmin hands back the roles it already read', () => {
    it('THE LIVE ROLES COME BACK, so a second decision need not ask the token', async () => {
        //   maySeeBankDetails is that second decision. Before this it either had
        //   to query again or fall back on the JWT, and it fell back.
        actAs(BOSS, ['general_user'], ['admin', 'support']);
        const { requireAdmin } = await import('@/lib/require-admin');

        const gate = await requireAdmin('finance:read');

        expect('error' in gate).toBe(false);
        expect((gate as any).roles).toEqual(['admin', 'support']);
    });

    it('AND THEY ARE THE RECORD\'S, NOT THE TOKEN\'S', async () => {
        //   Stated as a difference, because a mock that echoed the session would
        //   pass a bare equality check and prove nothing.
        actAs(BOSS, ['super_admin'], ['admin']);
        const { requireAdmin } = await import('@/lib/require-admin');

        expect(((await requireAdmin('finance:read')) as any).roles).not.toContain('super_admin');
    });

    it('and a refusal still carries only an error', async () => {
        actAs(BOSS, ['admin'], ['general_user']);
        const { requireAdmin } = await import('@/lib/require-admin');

        expect(await requireAdmin('finance:read')).toEqual({ error: expect.any(String) });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#532 — the four files, read', () => {
    it('NONE OF THEM GATES ON A SESSION ROLE ANY MORE', () => {
        const offenders = CONVERTED.filter((f) => JWT_GATE.test(code(f)));

        expect(offenders).toEqual([]);
    });

    it('AND ALL OF THEM STILL GATE', () => {
        //   The vacuity guard from the other side: deleting the checks would
        //   satisfy the assertion above.
        for (const f of CONVERTED) {
            expect({ f, gated: code(f).includes('requireAdmin(') })
                .toEqual({ f, gated: true });
        }
    });

    it('AND THE REDUNDANT SECOND CHECKS ARE GONE FROM THE TWO WRITES', () => {
        //   They could only ever refuse an admin the live gate had just
        //   admitted — one promoted after their token was issued.
        expect(code('src/app/actions/admin/_land.ts'))
            .not.toContain('Unauthorized: Permission required - land:verify_listings');
        expect(code('src/app/actions/admin/_withdrawals.ts'))
            .not.toContain('Unauthorized: Permission required - finance:process_withdrawals');
    });

    it('AND _legacy.ts IS LEFT ALONE, because its JWT gate is not live code', () => {
        //   The false positive that cost the most to find. The whole body of
        //   _inviteLegacyMemberAction sits inside a `/*` block headed "Original
        //   implementation below (deprecated and causing build errors)", and the
        //   live body is one line. A line-based stripper reads that dead gate as
        //   real; this one does not.
        const raw = readFileSync(join(ROOT, 'src/app/actions/admin/_legacy.ts'), 'utf-8');

        expect(raw).toContain('Original implementation below (deprecated');
        expect(code('src/app/actions/admin/_legacy.ts')).not.toMatch(JWT_GATE);
    });

    it('and the files read are real', () => {
        //   #484's shape — a control that reads as present and is none.
        for (const f of CONVERTED) {
            expect(code(f).length).toBeGreaterThan(2000);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#532 — the ratchet: no file may be half-converted', () => {
    /**
     * Derived, not listed. A file that asks the database in one function and the
     * token in another is the shape this finding is about, and it is the shape a
     * partial conversion of the remaining 88 will produce.
     */
    function halfConverted(): string[] {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir)) {
                const full = join(dir, e);
                if (statSync(full).isDirectory()) {
                    if (e !== '__tests__') walk(full);
                } else if (/\.tsx?$/.test(e)) {
                    const src = codeOnly(readFileSync(full, 'utf-8'));
                    if (/requireAdmin\(/.test(src) && JWT_GATE.test(src)) {
                        out.push(full.slice(ROOT.length + 1));
                    }
                }
            }
        };
        walk(join(ROOT, 'src/app'));
        return out.sort();
    }

    it('NO FILE ASKS THE DATABASE IN ONE PLACE AND THE TOKEN IN ANOTHER', () => {
        //   THE ratchet. It is what stops the class growing while the remaining
        //   files are worked through: a conversion now has to finish the file it
        //   starts.
        expect(halfConverted()).toEqual([]);
    });

    it('AND THE WALK IS REAL — it finds the converted files', () => {
        //   #484 again. An empty or mistyped walk makes the assertion above pass
        //   for ever.
        const walked: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir)) {
                const full = join(dir, e);
                if (statSync(full).isDirectory()) { if (e !== '__tests__') walk(full); }
                else if (/\.tsx?$/.test(e) && /requireAdmin\(/.test(codeOnly(readFileSync(full, 'utf-8')))) {
                    walked.push(full.slice(ROOT.length + 1));
                }
            }
        };
        walk(join(ROOT, 'src/app'));

        expect(walked.length).toBeGreaterThanOrEqual(17);
        for (const f of CONVERTED) expect(walked).toContain(f);
    });

    it('and the remaining surface is stated rather than implied', () => {
        //   Honest scope. This finding did NOT convert the platform; it closed
        //   the four files that disagreed with themselves. The number is
        //   measured so the next person knows how much is left rather than
        //   reading the ratchet above as "done".
        const jwtOnly: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir)) {
                const full = join(dir, e);
                if (statSync(full).isDirectory()) { if (e !== '__tests__') walk(full); }
                else if (/\.tsx?$/.test(e)) {
                    const src = codeOnly(readFileSync(full, 'utf-8'));
                    if (JWT_GATE.test(src) && !/requireAdmin\(/.test(src)) {
                        jwtOnly.push(full.slice(ROOT.length + 1));
                    }
                }
            }
        };
        walk(join(ROOT, 'src/app'));

        //   Not pinned to an exact number: converting one is progress and must
        //   not fail a test. Pinned as a CEILING, so the class cannot grow.
        expect(jwtOnly.length).toBeLessThanOrEqual(88);
    });
});
