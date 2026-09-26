/**
 * @jest-environment node
 */

/**
 *   #951 FOUR FINDINGS HAD EACH CONVERTED "THE NEXT BOUNDED SET" OF ADMIN DOORS
 *   OFF THE STALE TOKEN, BY A CRITERION INVENTED AT THE TIME.
 *
 *   #356 established the cost — a JWT role claim "keeps its value for hours after
 *   the database loses it" — and requireAdmin exists to re-read live. Then #532
 *   took the files that disagreed with themselves, #748 the four doors money
 *   leaves by, #750 the two role-writing files whole, #932 the live bank balance
 *   and the member-email sender.
 *
 *   Every pick was sound. None of them said what the SEVENTY-SIXTH door should
 *   do, so the ledger was an undifferentiated count of 75 and the next person to
 *   look at it would have to invent a fifth criterion.
 *
 *   ── THE RULE ──────────────────────────────────────────────────────────────
 *
 *   A door must re-read the database when acting on stale authorisation produces
 *   an effect that REVOKING THE ADMIN CANNOT UNDO.
 *
 *   It is stated once, as data, in lib/stale-authorisation, and it explains three
 *   of the four earlier picks without having been fitted to them. The converse
 *   matters as much: where a later admin can simply undo the act, a database read
 *   on every request is a real cost paid against a small one — and this audit
 *   spent #283 through #289 removing exactly that cost.
 *
 *   #532's criterion is NOT subsumed and stays live in
 *   the-role-writers-asked-the-token: a file asking the database in one function
 *   and the token in another is wrong whichever side of this rule it falls on.
 *
 *   ── WHAT THIS CHANGE DID, AND WHAT IT LEFT ────────────────────────────────
 *
 *   Measured: of 75 doors, 40 held an irreversible permission. The bounded set
 *   taken here is the SEVEN loan API routes, and the evidence is the platform
 *   disagreeing with itself across a directory:
 *
 *       api/admin/cooperative/approve-loan     re-read the database since #748
 *       api/admin/cooperative/reject-loan      trusted the token
 *
 *   Same directory, same permission, deciding the same loan. And
 *   verify-guarantor — also on the token — is the step that makes a loan
 *   approvable at all, so a revoked admin could satisfy the precondition for the
 *   approval approve-loan now refuses them.
 *
 *   FOUR SERVER-ACTION FILES ARE DELIBERATELY LEFT: fifteen gates in four
 *   different shapes, one of them `data.userId !== session.user.id &&
 *   !hasAdminPermission(...)` — an owner-or-admin check where converting blindly
 *   would put a database read in front of every member viewing their own loan.
 *   That needs reading per site, which is what #532's note asked for and what the
 *   ledger below records rather than implies.
 *
 *   AND ONE MORE CORRECTION, KEPT BECAUSE THE TEST IS WHAT CAUGHT IT. My first
 *   exception list called api/certificates/[id] a read gated on a write
 *   permission. It exports only DELETE, and that DELETE destroys a certificate
 *   record — so the permission is right and the door is not an exception. What is
 *   unusual about it is its SHAPE: an owner-or-admin check where the admin branch
 *   is a fallback, and where a bare requireAdmin would refuse the owner. That is a
 *   third list, and the assertion I could not satisfy is the reason it exists.
 *
 *   MUTATION-TESTED — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';
import {
    IRREVERSIBLE_PERMISSIONS,
    REVERSIBLE_PERMISSIONS,
    CLASSIFICATION_EXCEPTIONS,
    OWNER_OR_ADMIN_SHAPE,
    mustRevalidateLive,
} from '@/lib/stale-authorisation';
import type { AdminPermission } from '@/lib/admin-permissions';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel, minRetainedRatio: 0 });

/** The seven loan API routes this finding converted. */
const CONVERTED = [
    'src/app/api/admin/cooperative/create-loan-product/route.ts',
    'src/app/api/admin/cooperative/delete-loan-product/route.ts',
    'src/app/api/admin/cooperative/loan-applications/route.ts',
    'src/app/api/admin/cooperative/loan-products/route.ts',
    'src/app/api/admin/cooperative/reject-loan/route.ts',
    'src/app/api/admin/cooperative/update-loan-product/route.ts',
    'src/app/api/admin/cooperative/verify-guarantor/route.ts',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#951 — the rule is total, which is what makes it a rule', () => {
    it('EVERY PERMISSION IN THE MATRIX IS CLASSIFIED, and nothing else is', () => {
        /*
         *   The property the whole file rests on. A rule with a hole in it is a
         *   default, and a default here decides the next door by accident: false
         *   would admit a new money permission to the token, true would put a
         *   database read on a new editorial queue.
         *
         *   Read off admin-permissions.ts rather than from a second hand-kept
         *   list, because a hand-kept copy of a vocabulary is the shape #948 was
         *   about — the scanner's own WRITE_METHODS, one file over.
         */
        const matrix = new Set(
            [...code('src/lib/admin-permissions.ts').matchAll(/"([a-z_]+:[a-z_]+)"/g)].map((m) => m[1]),
        );
        const classified = [...IRREVERSIBLE_PERMISSIONS, ...REVERSIBLE_PERMISSIONS];

        //   Control on the matcher: a pattern that found nothing would make the
        //   two comparisons below trivially true.
        expect(matrix.size).toBeGreaterThan(40);

        expect({
            unclassified: [...matrix].filter((p) => !classified.includes(p as AdminPermission)).sort(),
            invented: classified.filter((p) => !matrix.has(p)).sort(),
        }).toEqual({ unclassified: [], invented: [] });
    });

    it('AND NO PERMISSION IS ON BOTH SIDES', () => {
        //   Both lists are hand-written, so the overlap is the mistake to catch:
        //   mustRevalidateLive checks irreversible FIRST, so a duplicate would
        //   silently resolve to "must" and the reversible entry would read as a
        //   decision somebody made and it would not be one.
        const both = IRREVERSIBLE_PERMISSIONS.filter((p) => REVERSIBLE_PERMISSIONS.includes(p));

        expect(both).toEqual([]);
    });

    it('AND AN UNCLASSIFIED PERMISSION THROWS rather than defaulting', () => {
        expect(() => mustRevalidateLive('nonsense:invented' as AdminPermission))
            .toThrow(/is not classified/);
        //   And the message says what decision to make, not just that one is due.
        expect(() => mustRevalidateLive('nonsense:invented' as AdminPermission))
            .toThrow(/cannot undo/);
    });

    it('and it answers the four earlier findings the way they answered themselves', () => {
        /*
         *   The rule was not fitted to these; this is the check that it agrees
         *   with them anyway, which is the only evidence available that it is a
         *   principle rather than a description of one change.
         */
        for (const p of [
            'finance:process_withdrawals',   // #748, money out
            'finance:resolve_disputes',      // #748, escrow released
            'cooperatives:approve_loans',    // #748, a debt created
            'users:update',                  // #750, role writes live here
            'users:assign_roles',            // #750
            'finance:read',                  // #932, the live bank balance
            'announcements:manage',          // #932, emails to members
        ] as AdminPermission[]) {
            expect({ p, must: mustRevalidateLive(p) }).toEqual({ p, must: true });
        }
    });

    it('and the reversible side is not empty, which is the point of having one', () => {
        //   A rule that classified everything as "must" would be a sweep wearing
        //   a rule's clothes, and would undo #283–#289's read-depth work.
        for (const p of [
            'wave:manage_training',
            'academy:manage_courses',
            'land:verify_listings',
            'marketplace:suspend_sellers',
            'users:read',
        ] as AdminPermission[]) {
            expect({ p, must: mustRevalidateLive(p) }).toEqual({ p, must: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#951 — the loan doors no longer disagree with each other', () => {
    it('ALL SEVEN ASK requireAdmin, AND NONE STILL ASKS THE TOKEN', () => {
        for (const rel of CONVERTED) {
            const src = code(rel);

            expect({ rel, live: src.includes('await requireAdmin("cooperatives:approve_loans")') })
                .toEqual({ rel, live: true });
            expect({ rel, token: /hasAdminPermission\(\s*session/.test(src) })
                .toEqual({ rel, token: false });
        }
    });

    it('AND THE TWELFTH, WHICH #748 CONVERTED, STILL DOES — the pair is symmetric now', () => {
        //   The control that makes the assertion above mean something: if
        //   approve-loan had regressed to the token, seven siblings agreeing with
        //   each other would still pass while the pair disagreed again.
        const approve = code('src/app/api/admin/cooperative/approve-loan/route.ts');

        expect(approve).toContain('await requireAdmin("cooperatives:approve_loans")');
        expect(/hasAdminPermission\(\s*session/.test(approve)).toBe(false);
    });

    it('AND EACH REFUSAL STILL CARRIES A 403 AND THE GATE\'S OWN MESSAGE', () => {
        //   A conversion that changed the status code would break the admin
        //   screens' error handling, and one that dropped gate.error would replace
        //   requireAdmin's specific refusal — including its MFA sentence — with a
        //   generic one.
        for (const rel of CONVERTED) {
            const src = code(rel);

            expect({ rel, forbidden: src.includes('{ status: 403 }') }).toEqual({ rel, forbidden: true });
            expect({ rel, relays: src.includes('message: gate.error') }).toEqual({ rel, relays: true });
        }
    });

    it('and the permission was not quietly widened or narrowed on the way', () => {
        //   #375 chose `cooperatives:approve_loans` for these deliberately, and
        //   loan-products' own note records an earlier attempt to move it to
        //   `cooperatives:manage_products` that two ratchets caught. A conversion
        //   is not the place to revisit that.
        for (const rel of CONVERTED) {
            expect({ rel, perm: code(rel).includes('"cooperatives:approve_loans"') })
                .toEqual({ rel, perm: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#951 — the ledger, keyed on the rule instead of on a total', () => {
    /** Every door still deciding from the token, split by the rule. */
    function jwtOnlyDoors(): { must: string[]; may: string[] } {
        const irreversible = new Set<string>(IRREVERSIBLE_PERMISSIONS as readonly string[]);
        const must: string[] = [];
        const may: string[] = [];

        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) { if (entry !== '__tests__') walk(full); continue; }
                if (!/\.tsx?$/.test(entry)) continue;

                const src = stripComments(readFileSync(full, 'utf-8'), { label: 'sweep', minRetainedRatio: 0 });
                if (!/hasAdminPermission\(\s*session/.test(src) || /requireAdmin\(/.test(src)) continue;

                const perms = [...src.matchAll(/hasAdminPermission\(\s*session[^,]*,\s*"([^"]+)"/g)].map((m) => m[1]);
                (perms.some((p) => irreversible.has(p)) ? must : may).push(full.slice(ROOT.length + 1));
            }
        };
        walk(join(ROOT, 'src/app'));

        return { must: must.sort(), may: may.sort() };
    }

    it('THE LEDGER — how many doors the rule says must re-read and do not', () => {
        /*
         *   #951 75 -> 68 doors on the token, and the number that MATTERS is the
         *   34 the rule calls irreversible. That split is the whole value of
         *   having a rule: the old ledger was a single 75 with no order to work
         *   in, and four findings had each picked an order by hand.
         *
         *   40 of the original 75 were must-re-read. Seven were converted here;
         *   `users:delete` joining the irreversible set moved one file the other
         *   way, which is why 40 - 7 is 34 rather than 33. Recorded because a
         *   ledger that moved for two reasons and reported one is #948's finding.
         */
        const { must } = jwtOnlyDoors();

        expect(ledgerVerdict(must.length, 34)).toBe(LEDGER_HELD);
    });

    it('AND THE REVERSIBLE SIDE IS PINNED TOO, so it cannot grow quietly', () => {
        //   A door moved here by widening the reversible list would be a real
        //   loosening, and it would show up as this count rising rather than as
        //   the count above falling.
        const { may } = jwtOnlyDoors();

        expect(ledgerVerdict(may.length, 34)).toBe(LEDGER_HELD);
    });

    it('AND THE SEVEN CONVERTED ARE OFF BOTH LISTS, BY NAME', () => {
        const { must, may } = jwtOnlyDoors();

        for (const rel of CONVERTED) {
            expect({ rel, onLedger: must.includes(rel) || may.includes(rel) })
                .toEqual({ rel, onLedger: false });
        }
    });

    it('POSITIVE CONTROL: the four loan ACTION files are still on the must side', () => {
        /*
         *   A ledger over a sweep that matched nothing would also hold, and this
         *   control cannot rot the way #943's did: these four are named as
         *   DELIBERATELY LEFT, so the day they are converted the ledger drops and
         *   this test is edited in the same change that earns the edit.
         */
        const { must } = jwtOnlyDoors();

        for (const rel of [
            'src/app/actions/admin/_loans.ts',
            'src/app/actions/cooperative/_loans_decisions.ts',
            'src/app/actions/loan-actions.ts',
            'src/app/actions/loan-products.ts',
        ]) {
            expect({ rel, onMustList: must.includes(rel) }).toEqual({ rel, onMustList: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#951 — the exceptions are few, real, and say what retires them', () => {
    it('EACH ONE NAMES A FILE THAT EXISTS AND REALLY GATES ON THAT PERMISSION', () => {
        //   An exception list whose entries have drifted is worse than none: it
        //   reads as "somebody checked" when nobody has.
        for (const { file, permission } of CLASSIFICATION_EXCEPTIONS) {
            expect({ file, exists: existsSync(join(ROOT, file)) }).toEqual({ file, exists: true });
            expect({ file, gates: code(file).includes(`"${permission}"`) }).toEqual({ file, gates: true });
        }
    });

    it('AND EACH SAYS WHAT WOULD RETIRE IT', () => {
        for (const e of CLASSIFICATION_EXCEPTIONS) {
            expect({ file: e.file, reasoned: e.why.length > 60 }).toEqual({ file: e.file, reasoned: true });
        }
    });

    it('AND THE LIST IS TWO, pinned — an exception list is a liability', () => {
        expect(ledgerVerdict(CLASSIFICATION_EXCEPTIONS.length, 2)).toBe(LEDGER_HELD);
    });

    it('AND NEITHER OF THEM WRITES ANYTHING A REVOCATION COULD NOT REACH', () => {
        /*
         *   The mismatch itself, asserted rather than asserted ABOUT. Both gate on
         *   `academy:issue_certificates` and neither issues a certificate:
         *   qr/verify verifies a scan, download returns one row.
         *
         *   MY FIRST VERSION OF THIS TEST CLAIMED ALL THREE WERE GET HANDLERS AND
         *   FAILED. qr/verify is a POST, and the third entry —
         *   api/certificates/[id] — exports only DELETE and destroys a certificate
         *   record, so it is not an exception at all. It is on
         *   OWNER_OR_ADMIN_SHAPE below instead. The assertion I could not satisfy
         *   was the one worth writing.
         */
        for (const { file } of CLASSIFICATION_EXCEPTIONS) {
            const src = code(file);

            //   No destructive handler, and no write to the row it reads.
            expect({ file, destroys: /export async function (DELETE|PUT|PATCH)/.test(src) })
                .toEqual({ file, destroys: false });
            expect({ file, issues: /\.set\(|\.add\(|\.updateExisting\(/.test(src) })
                .toEqual({ file, issues: false });
        }
    });

    it('AND THE OWNER-OR-ADMIN SHAPE IS RECORDED SEPARATELY, because it is not an exception', () => {
        /*
         *   `data.userId !== session.user.id && !hasAdminPermission(...)` — the
         *   admin check is the FALLBACK for acting on somebody else's row. A bare
         *   `await requireAdmin(...)` there would refuse the owner outright and put
         *   a database read in front of every member acting on their own row.
         *
         *   So the permission classification stands and the CONVERSION is the
         *   per-site part. Listing them is what stops a later sweep treating them
         *   as ordinary.
         */
        expect(OWNER_OR_ADMIN_SHAPE.length).toBeGreaterThan(0);

        for (const { file, permission } of OWNER_OR_ADMIN_SHAPE) {
            expect({ file, exists: existsSync(join(ROOT, file)) }).toEqual({ file, exists: true });

            //   The shape is really there: an identity comparison guarding the
            //   permission check in the same condition.
            const src = code(file);
            expect({ file, shape: /!==\s*session\.user\.id\s*&&/.test(src) })
                .toEqual({ file, shape: true });
            expect({ file, perm: src.includes(`"${permission}"`) }).toEqual({ file, perm: true });
            //   And the permission it holds really is one the rule calls irreversible,
            //   or this list would be excusing a door the rule never asked about.
            expect({ file, must: mustRevalidateLive(permission) }).toEqual({ file, must: true });
        }
    });

    it('and the two lists do not overlap — a door is one or the other', () => {
        const exceptions = CLASSIFICATION_EXCEPTIONS.map((e) => e.file);
        const shaped = OWNER_OR_ADMIN_SHAPE.map((e) => e.file);

        expect(exceptions.filter((f) => shaped.includes(f))).toEqual([]);
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   `security:view_logs` dropped from both sets,     EVERY PERMISSION IN THE
 *     so the rule has a hole and mustRevalidateLive  MATRIX IS CLASSIFIED, and
 *     throws mid-sweep                               both halves of THE LEDGER
 *   `users:export` added to BOTH sets                NO PERMISSION IS ON BOTH
 *                                                    SIDES
 *   mustRevalidateLive returns false instead of      AN UNCLASSIFIED PERMISSION
 *     throwing on an unknown permission              THROWS
 *   `cooperatives:approve_loans` moved to the        it answers the four earlier
 *     reversible side — the loosening that would     findings, both halves of THE
 *     make this whole change a no-op                 LEDGER, the POSITIVE CONTROL,
 *                                                    and THE OWNER-OR-ADMIN SHAPE
 *   reject-loan reverted to the token                ALL SEVEN ASK requireAdmin,
 *                                                    EACH REFUSAL STILL CARRIES A
 *                                                    403, THE LEDGER, and THE
 *                                                    SEVEN … OFF BOTH LISTS
 *   verify-guarantor returns 401 instead of 403       EACH REFUSAL STILL CARRIES A
 *                                                    403 AND THE GATE'S OWN
 *                                                    MESSAGE
 *
 *   ALL SIX CAUGHT. The fourth is the one the suite exists for: moving one
 *   permission across the rule would turn a security change into a no-op while
 *   every file still read as converted, and five separate assertions refuse it.
 *
 *   AND THE SUITE CAUGHT ME ONCE, WHICH IS WORTH MORE THAN THE TABLE. I wrote
 *   "and all three are GET handlers" about the exception list. qr/verify is a
 *   POST, and api/certificates/[id] exports only DELETE and destroys a
 *   certificate record — so it was never an exception, it is an owner-or-admin
 *   SHAPE, and the rule was right about it all along. The assertion I could not
 *   satisfy is why OWNER_OR_ADMIN_SHAPE exists.
 */
