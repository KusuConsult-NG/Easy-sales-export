/**
 * @jest-environment node
 */

/**
 * Forty-three admin writes asked "are you an admin?" when the answer they
 * needed was "an admin of WHAT?".
 *
 * THE DEFECT
 * ----------
 * admin-permissions.ts defines a permission matrix: ten admin roles, each
 * granted a specific list of permissions. Six of those roles are per-module —
 * cooperative_admin, academy_admin, wave_admin, marketplace_admin,
 * export_admin, farm_nation_admin — and the matrix gives each of them only its
 * own module's permissions plus "users:read" and "audit:read".
 *
 * hasAdminPermission() consults that matrix and is used at seventy-odd call
 * sites. isAdmin() does not: it returns true for ANY admin role. Forty-three
 * admin-only database writes were gated on isAdmin() alone, so the matrix was
 * written, maintained, and then not asked. Among them:
 *
 *   approveLoanAction, disburseLoanAction     an academy_admin could approve
 *                                             and disburse a cooperative loan
 *   approveWithdrawalAction                   ...and release the money
 *   _verifyLandListingAction                  a wave_admin could mark land
 *                                             VERIFIED
 *   _releaseEscrowFunds, _refundEscrowToBuyer an export_admin could release or
 *                                             refund a marketplace escrow
 *   _approveWaveApplicationAction             a marketplace_admin could admit
 *                                             somebody to WAVE
 *   getCleanBroadcastListAction               any of them could pull the
 *                                             platform's ~37,000-address
 *                                             mailing list
 *
 * All six module-admin roles are in ALL_USER_ROLES, so all six are grantable
 * and every one of those was reachable.
 *
 * SCOPE, STATED HONESTLY
 * ----------------------
 * PERMISSION_MATRIX also names `support` ("Read-only + basic user assistance")
 * and `moderator` ("Content moderation only"), and isAdmin() returns true for
 * both. "A read-only support user could approve a loan" is the dramatic
 * reading of this defect and it is NOT reachable: neither role is in the
 * UserRole union, in ALL_USER_ROLES, or in any UI list, and
 * bulk-user-operations.ts already closed the one path that could have granted
 * them. The cross-module escalation between the six module admins is the live
 * half, and it is the half worth fixing.
 *
 * THE FIX, AND ITS OWN HAZARD
 * ---------------------------
 * Each gate now names the permission its own write needs. Tightening an
 * authorization check has an obvious failure mode: pick a permission that the
 * plain `admin` role does not hold and you lock out the role that does nearly
 * all the work — a fix that reads as correct and takes the platform's own
 * administrators offline. `admin` lacks seven permissions that super_admin has
 * (users:create, users:delete, users:impersonate, content:delete,
 * finance:refund, config:rollback, cooperatives:manage_products), and none of
 * them may appear in one of these gates. That invariant is asserted below
 * against every permission string in every gate, so a later gate cannot
 * introduce the failure either.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
    canAccessAdminRoute,
    hasAdminPermission,
    isAdmin,
    permissionForContentType,
    CONTENT_TYPE_PERMISSION,
    type AdminPermission,
} from '@/lib/admin-permissions';
import { isAdmin as roleUtilsIsAdmin } from '@/lib/role-utils';
import { ALL_USER_ROLES, isUserRole } from '@/lib/types/roles';

// Server actions AND route handlers. Both are reachable over HTTP; a route is
// if anything the more exposed of the two, and thirteen of them carried the
// same coarse gate.
const GUARDED_TREES = ['src/app/actions', 'src/app/api'];

const MODULE_ADMINS = [
    'cooperative_admin',
    'academy_admin',
    'wave_admin',
    'marketplace_admin',
    'export_admin',
    'farm_nation_admin',
] as const;

// ---------------------------------------------------------------------------
// The structural scan
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.ts') && !full.includes('__tests__')) out.push(full);
    }
    return out;
}

/** Strip comments, so prose describing a guard is never mistaken for one. */
function strip(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/**
 * A database write, as opposed to a Set.add() or a Map.set() — the receiver has
 * to look like a Firestore ref, a transaction, a batch, or one of the money
 * primitives.
 */
const DB_WRITE = new RegExp(
    // `txn`/`tx` receivers matter: api/admin/cooperative/approve-member writes
    // through `txn.update(memberRef, ...)` and escaped the first version of
    // this scan entirely.
    String.raw`(?:db\.[^\n;]*|[A-Za-z0-9_]*[Rr]ef|transaction|txn|tx|batch|\)\s*)\.(?:update|set|add|delete)\s*\(`
    + String.raw`|\b(?:claimStatusTransition|claimStatusTransitionFromAny|versionedUpdate|claimVersionedUpdate`
    + String.raw`|debitJsonbBalance|debitJsonbBalanceWithFloor|compensateJsonbDebit|decrementManyOrFail`
    + String.raw`|claimPaymentOnce|claimSingleOpenLoanApplication)\s*\(`,
);

const MATRIX_GATE = /\b(?:hasAdminPermission|isSuperAdmin|requireAdminPermission)\s*\(/;

/**
 * `x !== session.user.id && !isAdmin(...)` is a DIFFERENT construct: the owner
 * may act, and staff may act on their behalf. isAdmin is the right predicate
 * there and those are not part of this finding.
 */
const OWNERSHIP = /user\.id\s*[!=]==|ownerId|sellerId|userId\s*[!=]==|isOwner|isParty|isActingAdmin/;

interface Gate { file: string; fn: string }

/**
 * Every function that writes to the database and refuses on `!isAdmin(...)`
 * with no ownership term beside it and no matrix check anywhere in the body.
 *
 * Per-FUNCTION, not per-file. A file-level scan lets one correctly-gated
 * sibling mask a broken one — which is exactly how the five hand-written status
 * sets and the cooperative contribution doors each hid for a pass.
 */
function gatesInSource(src: string, file: string): Gate[] {
    const found: Gate[] = [];
    const FN = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/gm;
    const heads = [...src.matchAll(FN)];

    for (let i = 0; i < heads.length; i++) {
        const start = heads[i].index!;
        const end = i + 1 < heads.length ? heads[i + 1].index! : src.length;
        const body = strip(src.slice(start, end));

        if (!DB_WRITE.test(body) || MATRIX_GATE.test(body)) continue;

        for (const line of body.split('\n')) {
            if (!/!\s*isAdmin\s*\(/.test(line) || OWNERSHIP.test(line)) continue;
            found.push({ file, fn: heads[i][1] });
            break;
        }
    }

    return found;
}

function soleIsAdminGates(): Gate[] {
    return GUARDED_TREES
        .flatMap((t) => walk(join(process.cwd(), t)))
        .flatMap((file) => gatesInSource(readFileSync(file, 'utf-8'), relative(process.cwd(), file)));
}

/** Every permission string named in a hasAdminPermission call under actions/. */
function permissionsUsedInGates(): { file: string; permission: string }[] {
    const used: { file: string; permission: string }[] = [];

    for (const file of GUARDED_TREES.flatMap((t) => walk(join(process.cwd(), t)))) {
        const src = strip(readFileSync(file, 'utf-8'));
        for (const m of src.matchAll(/hasAdminPermission\s*\([^,]+,\s*"([^"]+)"\s*\)/g)) {
            used.push({ file: relative(process.cwd(), file), permission: m[1] });
        }
    }

    return used;
}

// ---------------------------------------------------------------------------

describe('the matrix already had the answer nobody asked it', () => {
    it('every module admin is denied every other module', () => {
        // THE premise. Each pair is a write that was reachable.
        expect(hasAdminPermission(['academy_admin'], 'cooperatives:approve_loans')).toBe(false);
        expect(hasAdminPermission(['wave_admin'], 'land:verify_listings')).toBe(false);
        expect(hasAdminPermission(['export_admin'], 'finance:resolve_disputes')).toBe(false);
        expect(hasAdminPermission(['marketplace_admin'], 'wave:approve_applications')).toBe(false);
        expect(hasAdminPermission(['farm_nation_admin'], 'academy:issue_certificates')).toBe(false);
        expect(hasAdminPermission(['cooperative_admin'], 'export:approve_applications')).toBe(false);
    });

    it('while isAdmin admitted all six, which is why the old gate let them through', () => {
        // Vacuity guard. Without this the assertions above prove only that the
        // matrix is restrictive, not that the gate was permissive.
        for (const role of MODULE_ADMINS) {
            expect(isAdmin([role])).toBe(true);
        }
    });

    it('and each module admin keeps its OWN module', () => {
        // The fix must not lock a module admin out of its own work.
        expect(hasAdminPermission(['cooperative_admin'], 'cooperatives:approve_loans')).toBe(true);
        expect(hasAdminPermission(['wave_admin'], 'wave:manage_training')).toBe(true);
        expect(hasAdminPermission(['export_admin'], 'export:approve_applications')).toBe(true);
        expect(hasAdminPermission(['farm_nation_admin'], 'land:verify_listings')).toBe(true);
        expect(hasAdminPermission(['academy_admin'], 'academy:manage_courses')).toBe(true);
        expect(hasAdminPermission(['marketplace_admin'], 'marketplace:approve_sellers')).toBe(true);
    });

    it('all six being roles that can actually be granted', () => {
        // Vacuity guard on the whole finding: an escalation between two roles
        // nobody can hold is a note, not a defect.
        for (const role of MODULE_ADMINS) {
            expect(ALL_USER_ROLES as readonly string[]).toContain(role);
            expect(isUserRole(role)).toBe(true);
        }
    });
});

describe('the platform already siloed module admins — at one layer only', () => {
    /**
     * This is what makes the fix an alignment rather than an invention.
     *
     * canAccessAdminRoute implements strict silo isolation: a cooperative_admin
     * reaches /admin/cooperatives and nothing else, and BOTH the admin layout
     * and AdminSidebar consult it. So the platform's own answer to "may this
     * module admin act on another module?" was already NO.
     *
     * But a route guard is a navigation guard. Every export of a "use server"
     * module is an HTTP endpoint whose UI caller is irrelevant, so the silo
     * stopped at the sidebar and the actions behind it accepted any admin role.
     * The two layers disagreed, and the one that mattered was the permissive
     * one.
     */
    const MODULE_ROUTES: [string, string][] = [
        ['cooperative_admin', '/admin/cooperatives'],
        ['wave_admin', '/admin/wave'],
        ['marketplace_admin', '/admin/marketplace'],
        ['export_admin', '/admin/export'],
        ['farm_nation_admin', '/admin/farm-nation'],
        ['academy_admin', '/admin/academy'],
    ];

    it('each module admin reaches its own section', () => {
        for (const [role, route] of MODULE_ROUTES) {
            expect(canAccessAdminRoute([role], route)).toBe(true);
        }
    });

    it('and no other module admin reaches it', () => {
        // THE premise: the route layer already said no.
        for (const [role, route] of MODULE_ROUTES) {
            for (const [other] of MODULE_ROUTES) {
                if (other === role) continue;
                expect(canAccessAdminRoute([other], route)).toBe(false);
            }
        }
    });

    it('and both the layout and the sidebar enforce it', () => {
        // Vacuity guard: an unused rule is not a policy.
        expect(readFileSync(join(process.cwd(), 'src/app/admin/layout.tsx'), 'utf-8'))
            .toContain('canAccessAdminRoute');
        expect(readFileSync(join(process.cwd(), 'src/components/admin/AdminSidebar.tsx'), 'utf-8'))
            .toContain('canAccessAdminRoute(roles, item.href)');
    });

    it('so the permission gates now agree with the routes, rather than inventing a rule', () => {
        // The same pairs, asked of the matrix instead of the router. Both layers
        // must give the same answer — that is the whole point of the fix.
        const OWN: [string, AdminPermission][] = [
            ['cooperative_admin', 'cooperatives:approve_loans'],
            ['wave_admin', 'wave:manage_training'],
            ['marketplace_admin', 'marketplace:approve_sellers'],
            ['export_admin', 'export:approve_applications'],
            ['farm_nation_admin', 'farm_nation:verify_applications'],
            ['academy_admin', 'academy:manage_courses'],
        ];

        for (const [role, permission] of OWN) {
            expect(hasAdminPermission([role], permission)).toBe(true);

            for (const [other] of OWN) {
                if (other === role) continue;
                expect(hasAdminPermission([other], permission)).toBe(false);
            }
        }
    });
});

describe('the scope this finding does NOT have', () => {
    it('support and moderator are named in the matrix and cannot be granted', () => {
        // Stated so the record cannot later be read as claiming more than it
        // does. isAdmin admits them; nothing can put them on a user.
        expect(isAdmin(['support'])).toBe(true);
        expect(isAdmin(['moderator'])).toBe(true);

        expect(isUserRole('support')).toBe(false);
        expect(isUserRole('moderator')).toBe(false);
        expect(ALL_USER_ROLES as readonly string[]).not.toContain('support');
        expect(ALL_USER_ROLES as readonly string[]).not.toContain('moderator');
    });

    it('and the two isAdmin implementations differ ONLY on those two roles', () => {
        // There are two: admin-permissions.isAdmin (ten roles) and
        // role-utils.isAdmin, which session-guard re-exports (eight — it omits
        // support and moderator). Which one a file happens to import therefore
        // decided who could act, and admin/layout.tsx uses the eight-role one
        // while admin-content.ts used the ten-role one.
        //
        // On every role that can actually be held they agree, so this is a
        // latent inconsistency rather than a live hole. Pinned here so it stays
        // latent: if either list gains or loses a GRANTABLE role without the
        // other, this fails.
        for (const role of ALL_USER_ROLES) {
            expect(isAdmin([role])).toBe(roleUtilsIsAdmin([role]));
        }

        expect(isAdmin(['support'])).not.toBe(roleUtilsIsAdmin(['support' as never]));
        expect(isAdmin(['moderator'])).not.toBe(roleUtilsIsAdmin(['moderator' as never]));
    });
});

describe('the content-type map', () => {
    it('gives each of the six types the permission its own module owns', () => {
        // THE test for admin-content.ts, which switched over six collections in
        // four modules under one gate.
        expect(permissionForContentType('products')).toBe('content:approve');
        expect(permissionForContentType('land')).toBe('land:verify_listings');
        expect(permissionForContentType('export')).toBe('export:approve_applications');
        expect(permissionForContentType('courses')).toBe('academy:manage_courses');
        expect(permissionForContentType('certificates')).toBe('academy:issue_certificates');
        expect(permissionForContentType('resources')).toBe('academy:manage_courses');
    });

    it('and covers every type the action accepts, with none left over', () => {
        // If ContentType gains a seventh member, the map has to gain it too —
        // otherwise the action refuses a type it declares it handles.
        const declared = readFileSync(join(process.cwd(), 'src/app/actions/admin-content.ts'), 'utf-8')
            .match(/export type ContentType = ([^;]+);/)![1]
            .split('|')
            .map((s) => s.trim().replace(/"/g, ''));

        expect(new Set(declared)).toEqual(new Set(Object.keys(CONTENT_TYPE_PERMISSION)));
    });

    it('returns null for anything it does not know', () => {
        expect(permissionForContentType('wallets')).toBeNull();
        expect(permissionForContentType('')).toBeNull();
        // Not a prototype lookup: "constructor" must not resolve to a function.
        expect(permissionForContentType('constructor')).toBeNull();
        expect(permissionForContentType('toString')).toBeNull();
    });

    it('and the action refuses on null rather than falling back', () => {
        // An unknown content type is exactly where a new collection would slip
        // past the matrix, so the null case must deny.
        const src = strip(readFileSync(join(process.cwd(), 'src/app/actions/admin-content.ts'), 'utf-8'));
        // "Invalid content type" is the message the switch's own default case
        // already returned for an unknown type — one message for one condition,
        // rather than a second phrasing for the same refusal.
        const refusals = src.match(/if \(!requiredPermission\) \{\s*return \{ success: false as const, error: "Invalid content type", data: null \};/g) ?? [];

        expect(refusals.length).toBe(2);
        expect(src).not.toContain('isAdmin(callerRoles)');
    });
});

describe('no admin write is gated on "is some kind of admin" alone', () => {
    it('across every action in the codebase', () => {
        // THE test, and it is structural rather than a list of the forty-three,
        // so a forty-fourth added later cannot slip in behind them.
        //
        // BASELINE: EMPTY. Village-market was the honest remainder — its writes
        // create market events and add external merchants, and PERMISSION_MATRIX
        // had no village-market permission at all, not a narrower one, none, so
        // mapping them to a marketplace or content permission would have been
        // inventing a policy rather than applying the platform's own.
        //
        // The matrix now names the surface: "marketplace:manage_village_market",
        // held by super_admin, admin and marketplace_admin, whose module it is.
        // All four entry points ask for it, so this is a gate over every admin
        // write in the codebase rather than a ratchet over a remainder.
        const KNOWN = new Set<string>([]);

        const unexpected = soleIsAdminGates()
            .map((g) => `${g.file}::${g.fn}`)
            .filter((k) => !KNOWN.has(k));

        if (unexpected.length) {
            throw new Error(
                '\n\n⚠️  Admin write(s) gated on isAdmin() alone — every admin role '
                + 'passes, including five other modules\' admins:\n\n'
                + unexpected.map((k) => `  ${k}`).join('\n')
                + '\n\nGate it on the permission the write actually needs:\n'
                + '  hasAdminPermission(roles, "<module>:<action>")\n',
            );
        }

        expect(unexpected).toEqual([]);
    });

    it('and the scan really can find one, so [] means clean', () => {
        // The baseline used to BE the proof — the scanner reported three and
        // they were the three the note accounted for. With the baseline empty a
        // scanner that silently matched nothing would pass, so the proof moves
        // to a synthetic source that the detector must still report.
        // Unindented on purpose: the function-head regex is line-anchored,
        // exactly as it is against real source files.
        const planted = [
            'export async function _plantedAction() {',
            '    const session = (await requireSession()).session;',
            '    if (!isAdmin(session.user.roles)) {',
            '        return { success: false as const, error: "Unauthorized" };',
            '    }',
            '    await db.collection(COLLECTIONS.USERS).doc("someone").update({ x: 1 });',
            '    return { success: true as const };',
            '}',
        ].join('\n');

        expect(gatesInSource(planted, 'planted.ts').map((g) => g.fn)).toContain('_plantedAction');
    });

    it('and the fixed gates are the ones that used to be reported', () => {
        // Spot checks across five modules, so a scanner that silently stopped
        // matching cannot make the assertion above pass.
        const found = soleIsAdminGates().map((g) => g.fn);

        for (const fn of [
            'approveLoanAction',
            'disburseLoanAction',
            'approveWithdrawalAction',
            '_verifyLandListingAction',
            '_releaseEscrowFunds',
            '_refundEscrowToBuyer',
            '_approveWaveApplicationAction',
            '_upsertAcademyCourseAction',
            'getCleanBroadcastListAction',
            '_processWalletWithdrawalAction',
        ]) {
            expect(found).not.toContain(fn);
        }
    });
});

describe('the stale-session fallback asks the gate\'s own question', () => {
    /**
     * Thirteen guards across the cooperative admin surface have the shape:
     *
     *     if (!<gate>(roles)) {
     *         const liveRoles = (await db...get()).data()?.roles;   // re-read
     *         if (<fallback>(liveRoles)) { roles = liveRoles }
     *         else return Unauthorized;
     *     }
     *
     * It exists because a session token can carry roles granted before the
     * user's last sign-in. That is legitimate — but only while <fallback> asks
     * exactly what <gate> asked. Where the gate was tightened to a permission
     * and the fallback was left on isAdmin(), the retry became WIDER than the
     * check it retries: a caller the gate refused would be re-read and then
     * admitted, and the tightening bought nothing at all.
     *
     * That is not a hypothetical — narrowing the gates in this pass introduced
     * it in four places before this assertion caught them.
     */
    function fallbackMismatches(): string[] {
        const bad: string[] = [];
        const BLOCK = /if \(!(isAdmin\(roles\)|hasAdminPermission\(roles, "([a-z_]+:[a-z_]+)"\))\)[\s\S]{0,600}?if \((isAdmin\(liveRoles\)|hasAdminPermission\(liveRoles, "([a-z_]+:[a-z_]+)"\))\)/g;

        for (const file of GUARDED_TREES.flatMap((t) => walk(join(process.cwd(), t)))) {
            const src = strip(readFileSync(file, 'utf-8'));
            if (!src.includes('liveRoles')) continue;

            for (const m of src.matchAll(BLOCK)) {
                const gatePerm = m[2] ?? null;       // null => the gate is isAdmin
                const backPerm = m[4] ?? null;
                if (gatePerm === backPerm) continue; // same question, either form
                bad.push(`${relative(process.cwd(), file)}  gate ${m[1]}  fallback ${m[3]}`);
            }
        }

        return bad;
    }

    it('never falling back to a wider check than the one it retries', () => {
        // THE test.
        const bad = fallbackMismatches();

        if (bad.length) {
            throw new Error(
                '\n\n⚠️  Stale-session fallback(s) asking a WIDER question than the '
                + 'gate they fall back from — the retry admits callers the gate refused:\n\n'
                + bad.map((b) => `  ${b}`).join('\n')
                + '\n\nThe fallback must repeat the gate\'s own check against liveRoles.\n',
            );
        }

        expect(bad).toEqual([]);
    });

    it('and there really are fallbacks to check, so this is not vacuous', () => {
        // If the shape were refactored away this assertion would pass by
        // matching nothing.
        let files = 0;
        for (const file of GUARDED_TREES.flatMap((t) => walk(join(process.cwd(), t)))) {
            if (strip(readFileSync(file, 'utf-8')).includes('liveRoles')) files++;
        }

        expect(files).toBeGreaterThanOrEqual(6);
    });
});

describe('no gate locks out the role that does the work', () => {
    it('every permission named in a gate is one a plain admin holds', () => {
        // THE hazard of this fix, asserted rather than assumed. `admin` is the
        // role the platform's own administrators hold; gating an everyday write
        // on a super_admin-only permission takes them offline, and it would read
        // as a tightening done correctly.
        //
        // BASELINE — four gates that name a permission `admin` lacks. Three are
        // deliberate and PERMISSION_MATRIX says so in its own comment on the
        // `admin` role: "no deletion, no impersonation, no config rollback".
        // audit:export is deliberate too and audit-log-actions.ts documents why.
        //
        // "users:create" is GONE from this list — `admin` holds it now.
        //
        // It was the odd one out: _onboardLegacyMemberAction is live and
        // exported and refused a plain `admin`, who is precisely the role that
        // onboards a legacy member, while the matrix's own excuse-list for
        // `admin` — "no deletion, no impersonation, no config rollback" — never
        // mentioned creation. The tell was that the gate had grown a
        // re-read-the-roles-from-the-database fallback, which is what somebody
        // writes when a permission check refuses an admin and they assume the
        // session is stale. Recorded then rather than fixed, because granting a
        // permission widens access and that was the owner's call to make.
        const ADMIN_WITHHELD_BY_DESIGN = new Set([
            'users:delete',
            'users:impersonate',
            'audit:export',
        ]);

        const offending = permissionsUsedInGates()
            .filter(({ permission }) => !ADMIN_WITHHELD_BY_DESIGN.has(permission))
            .filter(({ permission }) => !hasAdminPermission(['admin'], permission as AdminPermission));

        if (offending.length) {
            throw new Error(
                '\n\n⚠️  Gate(s) naming a permission the plain `admin` role does NOT '
                + 'hold — this locks out the platform\'s administrators:\n\n'
                + offending.map((o) => `  ${o.file}  "${o.permission}"`).join('\n')
                + '\n\nEither pick a permission `admin` holds, or grant it in '
                + 'PERMISSION_MATRIX deliberately.\n',
            );
        }

        expect(offending).toEqual([]);
    });

    it('and the users:create lockout is gone, on the live action that had it', () => {
        // The inverse of what this used to assert. The gate is unchanged — it
        // still names users:create — and `admin` now passes it.
        expect(hasAdminPermission(['admin'], 'users:create')).toBe(true);
        expect(hasAdminPermission(['super_admin'], 'users:create')).toBe(true);

        const legacy = readFileSync(join(process.cwd(), 'src/app/actions/admin/_legacy.ts'), 'utf-8');
        expect(legacy).toContain('Unauthorized: Permission users:create required');
        // ...in a live, exported action, not in the deprecated block-commented
        // copy above it.
        expect(legacy).toContain('export async function onboardLegacyMemberAction');
    });

    it('and there really are permissions admin does not hold, so that is a real constraint', () => {
        // Vacuity guard: if `admin` held everything, the assertion above would
        // pass for any mapping at all.
        for (const withheld of [
            'users:delete',
            'users:impersonate',
            'content:delete',
            'finance:refund',
            'config:rollback',
            'cooperatives:manage_products',
        ] as const) {
            expect(hasAdminPermission(['admin'], withheld)).toBe(false);
            expect(hasAdminPermission(['super_admin'], withheld)).toBe(true);
        }
    });

    it('and super_admin passes every gate in the codebase', () => {
        for (const { permission } of permissionsUsedInGates()) {
            expect(hasAdminPermission(['super_admin'], permission as AdminPermission)).toBe(true);
        }
    });

    it('every permission named in a gate being a real one', () => {
        // A typo'd permission string denies everybody, silently and forever.
        // hasAdminPermission takes a typed argument, so tsc catches this in the
        // static call sites — but not in the dynamic one
        // (permissionForContentType) or in a string built at runtime.
        const known = new Set<string>();
        for (const role of [...ALL_USER_ROLES, 'moderator', 'support']) {
            for (const p of Object.values(CONTENT_TYPE_PERMISSION)) known.add(p);
            void role;
        }
        // Derive the full vocabulary from the matrix itself rather than
        // re-listing it: any permission granted to at least one role is real.
        const matrixSource = readFileSync(join(process.cwd(), 'src/lib/admin-permissions.ts'), 'utf-8');
        for (const m of matrixSource.matchAll(/^\s*\|\s*"([a-z_]+:[a-z_]+)"/gm)) known.add(m[1]);

        expect(known.size).toBeGreaterThan(20);

        const bogus = permissionsUsedInGates().filter(({ permission }) => !known.has(permission));
        expect(bogus).toEqual([]);
    });
});
