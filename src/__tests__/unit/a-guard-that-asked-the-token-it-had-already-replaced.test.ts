/**
 * @jest-environment node
 */

/**
 *   #749 THE LEGACY-IMPORT ESCALATION GUARD DECIDED ON THE TOKEN, AND THE LIVE
 *        ANSWER WAS ALREADY SITTING IN THE VARIABLE ABOVE IT.
 *
 *   `onboardLegacyMemberAction` is the one live door for adding a legacy member
 *   — ImportLegacyModal, mounted on the cooperative, export and farm-nation
 *   admin screens. It opens with
 *
 *       const adminCheck = await requireAdmin("users:create");
 *
 *   which reads roles FROM THE DATABASE and returns them. Three lines later it
 *   threw them away:
 *
 *       let roles = session.user.roles;                    // the TOKEN
 *       if (!hasAdminPermission(roles, "users:create")) {
 *           …look the roles up live and use those instead…
 *       }
 *
 *   A ONE-DIRECTIONAL REFRESH. It could turn a stale "no" into a live "yes" and
 *   never a stale "yes" into a live "no", so for any caller whose token still
 *   carried the permission the database was never consulted at all.
 *
 * ── AND `roles` FEEDS EXACTLY ONE DECISION ──────────────────────────────────
 *
 *       if (includesPrivilegedRole(data.roles) && !isSuperAdmin(roles)) {
 *           return { error: "Only a super admin can onboard a member with admin roles" };
 *
 *   #356 established that a JWT role claim "keeps its value for hours after the
 *   database loses it". A super_admin demoted to admin still holds
 *   `users:create`, so requireAdmin admits them legitimately — and the token
 *   then told this guard they were still super_admin.
 *
 *   `LegacyOnboardingSchema.roles` is `z.array(UserRoleSchema)` over
 *   ALL_USER_ROLES, which includes "admin" and "super_admin". So within their
 *   token's remaining life a demoted super_admin could mint a NEW super_admin
 *   account — one that outlives the token entirely. A temporary stale claim
 *   becomes a permanent escalation, onto a separate identity, which the guard's
 *   own note calls "harder to notice".
 *
 *   The screen only ever sends module roles. This is a `"use server"` export,
 *   reachable with any payload — which is why the guard exists at all, and the
 *   same reasoning #345 and #745 applied to the neighbouring fields.
 *
 * ── THE GUARD'S SCOPE WAS ALREADY RIGHT; ITS SOURCE WAS NOT ─────────────────
 *
 *   Worth saying, because it is what made this hard to see: `PRIVILEGED_ROLES`
 *   is COMPUTED — "a role is privileged if it can do anything a plain admin
 *   cannot" — so the guard covers every module-admin role without a
 *   hand-written list. Everything about it was considered except where the
 *   actor's roles came from.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. The table
 *   was written BEFORE the sweep ran, which is the wrong order and is recorded
 *   rather than tidied away.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { includesPrivilegedRole, isSuperAdmin, hasAdminPermission } from '@/lib/admin-permissions';
import { ALL_USER_ROLES } from '@/lib/types/roles';

const ROOT = process.cwd();
const LEGACY = 'src/app/actions/admin/_legacy.ts';
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#749 — the escalation window this closes', () => {
    it('A DEMOTED SUPER ADMIN STILL HOLDS users:create, SO THE GATE ADMITS THEM', () => {
        /*
         *   The step that makes the rest reachable. If a demotion also removed
         *   `users:create`, requireAdmin would refuse and the stale token would
         *   never reach the guard.
         */
        expect(hasAdminPermission(['admin'], 'users:create')).toBe(true);
        expect(hasAdminPermission(['super_admin'], 'users:create')).toBe(true);
    });

    it('AND THE TOKEN WOULD HAVE SAID super_admin WHILE THE DATABASE SAID admin', () => {
        //   The two answers, side by side. The guard consulted the first.
        expect(isSuperAdmin(['super_admin'])).toBe(true);   // the stale token
        expect(isSuperAdmin(['admin'])).toBe(false);        // the live record
    });

    it('AND THE SCHEMA REALLY ACCEPTS THE ROLES THE GUARD EXISTS TO STOP', () => {
        /*
         *   Read from the source of truth rather than assumed. If
         *   ALL_USER_ROLES stopped carrying the privileged names, the guard
         *   would be defending against something unrepresentable and this
         *   finding's premise would be gone.
         */
        expect([...ALL_USER_ROLES]).toContain('admin');
        expect([...ALL_USER_ROLES]).toContain('super_admin');
        expect(includesPrivilegedRole(['super_admin'])).toBe(true);
    });

    it('AND AN ORDINARY MEMBER ROLE IS NOT PRIVILEGED — the direction that must not move', () => {
        //   Vacuity guard: a rule that called everything privileged would make
        //   every legacy import super_admin-only and break the screen.
        expect(includesPrivilegedRole(['cooperative_member', 'general_user'])).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#749 — the action decides on the live roles', () => {
    it('IT TAKES THEM FROM THE GATE THAT READ THE DATABASE', () => {
        expect(code(LEGACY)).toContain('const roles = adminCheck.roles;');
    });

    it('AND NO LONGER READS THE TOKEN FOR THEM — the defect', () => {
        const src = code(LEGACY);

        expect(src).not.toContain('let roles = session.user.roles;');
        //   Nor the one-directional fallback that followed it.
        expect(src).not.toContain('const liveRoles = liveUserDoc.data()?.roles;');
    });

    it('AND THE GATE IS ASKED BEFORE THE ROLES ARE TAKEN FROM IT', () => {
        /*
         *   Ordering, not just presence: reading `adminCheck.roles` before the
         *   `"error" in adminCheck` narrowing would not compile, but reading it
         *   before the CALL would be a different function entirely.
         */
        const src = code(LEGACY);
        const gateAt = src.indexOf('await requireAdmin("users:create")');
        const takeAt = src.indexOf('const roles = adminCheck.roles;');

        expect(gateAt).toBeGreaterThan(-1);
        expect(takeAt).toBeGreaterThan(gateAt);
    });

    it('AND THE ESCALATION GUARD IS STILL THERE, READING THAT VARIABLE', () => {
        //   The repair is worthless if the guard it feeds went away with the
        //   token check.
        expect(code(LEGACY))
            .toContain('if (includesPrivilegedRole(data.roles) && !isSuperAdmin(roles)) {');
    });

    it('AND THE DEAD IMPORT WENT WITH THE CHECK', () => {
        /*
         *   `hasAdminPermission`'s only remaining mentions are inside
         *   _inviteLegacyMemberAction's deprecated block comment. Lint does not
         *   flag an unused import here, so it would have sat at the top of the
         *   file telling a reader this action still consults the JWT.
         */
        expect(code(LEGACY)).not.toContain('hasAdminPermission');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#749 — and the door itself is the one it looks like', () => {
    it('THE LIVE ONE IS THE EXPORTED ONBOARDING ACTION', () => {
        const src = code(LEGACY);
        expect(src).toContain('export async function onboardLegacyMemberAction');
    });

    it('AND ITS DEPRECATED SIBLING IS GENUINELY DEAD', () => {
        /*
         *   _inviteLegacyMemberAction's whole body sits inside a `/*` block and
         *   the live body is one line. It still reads `session.user.roles`
         *   twice — in the comment — which is exactly the trap #532 recorded
         *   when it edited a gate that was never running.
         */
        const raw = readFileSync(join(ROOT, LEGACY), 'utf-8');
        const stripped = code(LEGACY);

        expect(raw).toContain('hasAdminPermission(session.user.roles, "users:create")');
        expect(stripped).not.toContain('hasAdminPermission(session.user.roles, "users:create")');
        expect(stripped).toContain('Method deprecated');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by full path, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *     MUTANT                                                        RESULT
 *     the roles go back to the token                                 KILLED
 *     the escalation guard is removed                                KILLED
 *     the guard reads data.roles instead of the actor's              KILLED
 *     isSuperAdmin stops recognising super_admin                     KILLED
 *     includesPrivilegedRole calls nothing privileged                KILLED
 *     includesPrivilegedRole calls everything privileged             KILLED
 *     the dead import is put back                                    KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
