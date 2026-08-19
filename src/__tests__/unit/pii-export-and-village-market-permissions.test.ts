/**
 * @jest-environment node
 */

/**
 * Three permission gaps that all had the same shape: a capability with no name.
 *
 * #64 — ANY ADMIN COULD DOWNLOAD EVERY MEMBER'S CONTACT DETAILS
 * -------------------------------------------------------------
 * Three routes each build a CSV of names, emails, phone numbers and states:
 *
 *   /api/admin/export/users                every user on the platform
 *   /api/admin/export/cooperative-members  every cooperative member
 *   /api/admin/wave/reports/export         every WAVE applicant
 *
 * All three asked isAdmin(), which is true for EVERY admin role. An academy
 * admin, a moderator or a support account could download the contact details of
 * every member on the platform. canAccessAdminRoute already silos those people
 * by module at the route layer, so the two layers disagreed — the same
 * disagreement the admin pass fixed for 62 other writes.
 *
 * There was no permission to use. users:read is the closest and is held by all
 * ten roles, which is the problem restated rather than fixed: reading one
 * member's record to answer their support ticket and downloading everyone's
 * contact details are not the same act. So "users:export" is new, and follows
 * the naming super_admin's existing "audit:export" already set.
 *
 * Granted to super_admin and admin only. A module admin gaining it later is a
 * one-line change to a named permission — which is the entire point of moving
 * off isAdmin().
 *
 * #63 — THE VILLAGE MARKET HAD NO PERMISSION AT ALL
 * -------------------------------------------------
 * Four admin entry points in village-market.ts — creating an event, changing
 * its status, adding an external merchant, and listing events for the admin
 * screen — asked isAdmin(). Nothing in PERMISSION_MATRIX named this surface, so
 * there was nothing narrower to ask. "marketplace:manage_village_market" is new
 * and goes to super_admin, admin and marketplace_admin, whose module this is.
 *
 * marketplace_admin therefore gains a capability it should have had and loses
 * one it should never have had, in the same change.
 *
 * #62 — `admin` COULD NOT CREATE A USER
 * -------------------------------------
 * PERMISSION_MATRIX withheld "users:create" from `admin`, and the row's own
 * comment says what that role is denied: "no deletion, no impersonation, no
 * config rollback". Creation is not on that list, so the absence was an
 * oversight rather than a policy.
 *
 * It had a live cost. admin/_legacy.ts is the only caller — it onboards a
 * legacy member who exists in the business but not in the platform — and an
 * `admin` opening that screen was refused, while keeping users:update and
 * users:assign_roles, which are the wider powers. A role that can change
 * anyone's roles but cannot add a row is not a coherent boundary.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { hasAdminPermission, isAdmin } from '@/lib/admin-permissions';
import type { UserRole } from '@/lib/types/roles';

const ROOT = process.cwd();

const EXPORT_ROUTES = [
    'src/app/api/admin/export/users/route.ts',
    'src/app/api/admin/export/cooperative-members/route.ts',
    'src/app/api/admin/wave/reports/export/route.ts',
];
const VILLAGE = 'src/app/actions/village-market.ts';
const LEGACY = 'src/app/actions/admin/_legacy.ts';

function source(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

const r = (...roles: string[]) => roles as UserRole[];

/** Every admin role the matrix knows, so "narrower" can be measured. */
const ALL_ADMIN_ROLES = [
    'super_admin', 'admin', 'moderator', 'support', 'wave_admin',
    'cooperative_admin', 'marketplace_admin', 'export_admin',
    'academy_admin', 'farm_nation_admin',
];

describe('#64 — bulk PII export is its own permission', () => {
    it('super_admin and admin hold it', () => {
        expect(hasAdminPermission(r('super_admin'), 'users:export')).toBe(true);
        expect(hasAdminPermission(r('admin'), 'users:export')).toBe(true);
    });

    it('and nobody else does — THE test', () => {
        const holders = ALL_ADMIN_ROLES.filter((role) => hasAdminPermission(r(role), 'users:export'));
        expect(holders.sort()).toEqual(['admin', 'super_admin']);
    });

    it('specifically not support, moderator, or another module\'s admin', () => {
        // Named individually so the failure message says who got in.
        for (const role of ['support', 'moderator', 'academy_admin', 'wave_admin', 'marketplace_admin', 'export_admin']) {
            expect(hasAdminPermission(r(role), 'users:export')).toBe(false);
        }
    });

    it('while isAdmin() — the old gate — admits all of them', () => {
        // THE measure of what changed. Without this the assertions above prove
        // only that a permission exists, not that it is narrower than what it
        // replaced.
        const admitted = ALL_ADMIN_ROLES.filter((role) => isAdmin(r(role)));
        expect(admitted.length).toBeGreaterThan(2);
        expect(admitted).toContain('support');
        expect(admitted).toContain('academy_admin');
    });

    it('and users:read would have been no narrower', () => {
        // Why a new permission rather than the nearest existing one.
        for (const role of ALL_ADMIN_ROLES) {
            expect(hasAdminPermission(r(role), 'users:read')).toBe(true);
        }
    });

    it.each(EXPORT_ROUTES)('%s asks for it', (rel) => {
        const src = code(rel);
        expect(src).toContain('hasAdminPermission(session.user.roles, "users:export")');
        expect(src).not.toMatch(/isAdmin\s*\(/);
    });

    it('and all three really do export contact details, which is why', () => {
        // Vacuity guard: gating a route that exports nothing sensitive would be
        // ceremony.
        for (const rel of EXPORT_ROUTES) {
            const src = source(rel);
            expect(src).toContain('csvDocument');
            expect(src).toMatch(/phone/i);
        }
    });
});

describe('#63 — the Village Market has a permission now', () => {
    it('held by marketplace_admin, whose module it is', () => {
        expect(hasAdminPermission(r('marketplace_admin'), 'marketplace:manage_village_market')).toBe(true);
        expect(hasAdminPermission(r('admin'), 'marketplace:manage_village_market')).toBe(true);
        expect(hasAdminPermission(r('super_admin'), 'marketplace:manage_village_market')).toBe(true);
    });

    it('and not by other modules\' admins, nor support or moderator', () => {
        for (const role of ['support', 'moderator', 'academy_admin', 'wave_admin', 'cooperative_admin', 'export_admin', 'farm_nation_admin']) {
            expect(hasAdminPermission(r(role), 'marketplace:manage_village_market')).toBe(false);
        }
    });

    it('all four entry points ask for it', () => {
        // THE test. Counted, so narrowing three of four still fails.
        const src = code(VILLAGE);
        const gates = src.match(/hasAdminPermission\(sessionResult\.session\.user\.roles, "marketplace:manage_village_market"\)/g) ?? [];
        expect(gates.length).toBe(4);
        expect(src).not.toMatch(/isAdmin\s*\(/);
    });

    it('marketplace_admin gaining a capability in the same change it loses one', () => {
        // The trade, stated. It runs its own module's market; it no longer
        // downloads every member's contact details.
        expect(hasAdminPermission(r('marketplace_admin'), 'marketplace:manage_village_market')).toBe(true);
        expect(hasAdminPermission(r('marketplace_admin'), 'users:export')).toBe(false);
    });
});

describe('#62 — admin can create a user', () => {
    it('which is THE test', () => {
        expect(hasAdminPermission(r('admin'), 'users:create')).toBe(true);
    });

    it('and the caller that was refused is the legacy-member onboarding', () => {
        // Vacuity guard: the permission only mattered because something asks.
        //
        // The LIVE check is _onboardLegacyMemberAction's. The other occurrence
        // of this permission in the file sits inside a 120-line block comment —
        // _inviteLegacyMemberAction's original body, deprecated — so `code()`,
        // which strips block comments, is what distinguishes them.
        const legacy = code(LEGACY);
        expect(legacy).toContain('if (!hasAdminPermission(roles, "users:create")) {');
        expect(legacy).toContain('Unauthorized: Permission users:create required');
    });

    it('the deprecated sibling failing loudly rather than pretending to work', () => {
        // Noticed while locating the live caller. A function whose whole body
        // is commented out is the silent-no-op shape this audit removed
        // elsewhere; this one returns an error, so it is not that.
        expect(code(LEGACY)).toContain('return { error: "Method deprecated", success: false as const, data: null };');
    });

    it('the denials the row actually documents are still denied', () => {
        // The absence was an oversight, not a policy — so nothing else moves.
        // If this fails, the fix widened `admin` beyond what was intended.
        expect(hasAdminPermission(r('admin'), 'users:delete')).toBe(false);
        expect(hasAdminPermission(r('admin'), 'users:impersonate')).toBe(false);
        expect(hasAdminPermission(r('admin'), 'config:rollback')).toBe(false);
    });

    it('and the row still says so in words', () => {
        expect(source('src/lib/admin-permissions.ts'))
            .toContain('no deletion, no impersonation, no config rollback');
    });

    it('creation being narrower than powers admin already held', () => {
        // The incoherence that made the gap a defect rather than a choice.
        expect(hasAdminPermission(r('admin'), 'users:update')).toBe(true);
        expect(hasAdminPermission(r('admin'), 'users:assign_roles')).toBe(true);
    });
});

describe('the matrix stays internally consistent', () => {
    it('super_admin holds every permission the other roles do', () => {
        // A new permission granted to a module admin but forgotten on
        // super_admin is a lockout waiting to happen.
        const everyGranted = new Set<string>();
        for (const role of ALL_ADMIN_ROLES) {
            for (const p of ['users:export', 'marketplace:manage_village_market', 'users:create']) {
                if (hasAdminPermission(r(role), p as never)) everyGranted.add(p);
            }
        }
        for (const p of everyGranted) {
            expect(hasAdminPermission(r('super_admin'), p as never)).toBe(true);
        }
    });

    it('and a role with no admin role at all holds none of them', () => {
        for (const p of ['users:export', 'marketplace:manage_village_market', 'users:create']) {
            expect(hasAdminPermission(r('user'), p as never)).toBe(false);
            expect(hasAdminPermission([], p as never)).toBe(false);
        }
    });
});
