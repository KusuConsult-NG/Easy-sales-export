/**
 * @jest-environment node
 */

/**
 *   #396 AN IMPERSONATION TOKEN WITH A PRODUCER AND NO CONSUMER, IN A MODULE
 *        NO SCREEN CAN REACH.
 *
 *   HOW THIS WAS FOUND
 *   ------------------
 *   #395 turned on a measurement rather than an assumption: count the callers
 *   before deciding what a door is. Run across every exported *Action in src/,
 *   457 of them, that count returned 45 with no live caller anywhere. This is
 *   the one among them that is not merely unwired but wrong.
 *
 *   THE MEASUREMENT
 *   ---------------
 *   createImpersonationTokenAction writes a row to `impersonation_tokens` and
 *   returns its id as `{ token, expiresAt }`.
 *
 *        writers of that collection   1
 *        readers of that collection   0
 *
 *   Nothing exchanges the id for a session. So the action reported success and
 *   handed back a token that does nothing — success reported for an operation
 *   that did not happen, the class of #102 and #337.
 *
 *   THE FIELDS THAT LOOK LIKE THE SAFETY STORY ARE ENFORCED BY NOTHING
 *   ------------------------------------------------------------------
 *   The row carries `active: true`, `expiresAt` and `usedAt: null` — precisely
 *   the three a redeemer would check to make a token time-limited and
 *   single-use. Nothing reads them, and nothing ever writes `usedAt` a second
 *   time. That is the hazard rather than the dead code: the mint side looks
 *   finished (super_admin only, admin targets refused, a 20-character reason, a
 *   5–120 minute bound, a critical audit row), so somebody building the
 *   redemption half would reasonably assume expiry and single-use were already
 *   handled. They are not, and a redeemer that trusted the row would grant
 *   unlimited logins as the target user for ever.
 *
 *   AND THE SCAFFOLDING AROUND IT ASSERTS THE CAPABILITY EXISTS
 *   -----------------------------------------------------------
 *   PERMISSION_MATRIX grants "users:impersonate" to super_admin and documents
 *   that admin is denied it; audit-log.ts declares a 'user_impersonate' action
 *   type. Read together those say the platform can impersonate a user. It
 *   cannot. Same shape as #314's SessionGuard and #331's forensic checks.
 *
 *   WHAT WAS NOT RETIRED, AND WHY
 *   ------------------------------
 *   No production file imports bulk-user-operations.ts at all — every importer
 *   is a test, and /admin/users imports from "@/app/actions/admin" instead. So
 *   all six exports are unreachable. The other five are LEFT EXACTLY AS THEY
 *   ARE: they are correct, well-guarded implementations that do what they say,
 *   and being unwired is a gap in the product rather than a defect in the code.
 *   A flag in front of them would add friction and prevent nothing. #384's rule
 *   cuts both ways — retiring is only a fix when the thing retired is wrong.
 *
 *   The permission itself is KEPT for the same reason: it is the boundary
 *   includesPrivilegedRole() and role-escalation.test.ts defend, and that has to
 *   hold before a redemption path exists, not after.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the refusal is dropped from the action        KILLED
 *     the refusal moves below requireSession()      KILLED
 *     the flag accepts any truthy value             KILLED
 *     the refusal stops naming the missing half     KILLED
 *     reword the header prose                       SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    ADMIN_IMPERSONATION_ENV,
    ADMIN_IMPERSONATION_ENABLED_VALUE,
    ADMIN_IMPERSONATION_REFUSAL,
    isAdminImpersonationEnabled,
} from '@/lib/admin-impersonation';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === 'node_modules') continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

const FILES = walk(SRC);
const MODULE = join(SRC, 'app/actions/bulk-user-operations.ts');
const COLLECTIONS_FILE = join(SRC, 'lib/types/firestore.ts');

const isTest = (p: string) => p.includes('__tests__') || /\.test\.tsx?$/.test(p);

// ─────────────────────────────────────────────────────────────────────────────
describe('#396 — the measurement that decided it', () => {
    it('THE TOKEN COLLECTION HAS ONE WRITER AND NO READER', () => {
        // Every live file naming the collection, by either spelling.
        const users = FILES
            .filter((p) => !isTest(p))
            .filter((p) => /IMPERSONATION_TOKENS|impersonation_tokens/.test(code(p)))
            .map((p) => relative(ROOT, p))
            .sort();

        // Three files name it, and none of them reads it: the action that
        // mints, the constant's own declaration, and the refusal text in the
        // flag module — which names the collection precisely so a developer
        // meeting the refusal knows which one has no reader. So nothing can
        // redeem what the mint returns.
        expect(users).toEqual([
            'src/app/actions/bulk-user-operations.ts',
            'src/lib/admin-impersonation.ts',
            'src/lib/types/firestore.ts',
        ]);

        // And the scan can tell a used collection from an unused one: the same
        // file declares USERS, which is read all over the codebase.
        const usersCollection = FILES
            .filter((p) => !isTest(p) && p !== COLLECTIONS_FILE)
            .filter((p) => /COLLECTIONS\.USERS\b/.test(code(p)));
        expect(usersCollection.length).toBeGreaterThan(20);
    });

    it('and nothing ever burns the token — usedAt is written once and never again', () => {
        /**
         * `usedAt` is a generic field name: password-reset tokens and WhatsApp
         * invites both carry one, and both DO burn theirs. Scanning for the
         * bare name finds those and says nothing about this collection — so the
         * scan is restricted to files that touch impersonation_tokens, which is
         * where the claim actually lives.
         */
        const touchers = FILES
            .filter((p) => !isTest(p) && p !== join(SRC, 'lib/admin-impersonation.ts'))
            .filter((p) => /IMPERSONATION_TOKENS|impersonation_tokens/.test(code(p)))
            .filter((p) => /\busedAt\b/.test(code(p)))
            .map((p) => relative(ROOT, p));

        // Only the mint, and only to set it to null. There is no second write,
        // which is what "single-use" would require.
        expect(touchers).toEqual(['src/app/actions/bulk-user-operations.ts']);

        // One occurrence in the whole module, and it is the null at mint time.
        // A burn would be a second one, assigning a timestamp.
        const occurrences = code(MODULE).match(/\busedAt\b/g) ?? [];
        expect(occurrences).toHaveLength(1);
        expect(code(MODULE)).toContain('usedAt: null');

        /**
         * Control — the WhatsApp invite, which is the SAME SHAPE done whole:
         * lib/whatsapp-invites.ts mints with `usedAt: null`, and the route that
         * redeems the invite stamps it. That producer/consumer pair is exactly
         * what impersonation is missing, so its presence here proves the
         * assertion above says "this collection", not "no code ever burns".
         */
        expect(code(join(SRC, 'lib/whatsapp-invites.ts'))).toContain('usedAt: null');
        expect(code(join(SRC, 'app/api/whatsapp-invite/route.ts')))
            .toMatch(/usedAt: FieldValue\.serverTimestamp\(\)/);
    });

    it('and no production file imports the module at all', () => {
        const importers = FILES
            .filter((p) => p !== MODULE)
            .filter((p) => /from ["'][^"']*bulk-user-operations["']|import\(["'][^"']*bulk-user-operations["']\)/.test(code(p)))
            .map((p) => relative(ROOT, p));

        expect(importers.filter((p) => !isTest(p))).toEqual([]);
        // Positive control: the tests DO import it, so the pattern works.
        expect(importers.filter(isTest).length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#396 — retired at the door, kept behind a flag', () => {
    it('THE REFUSAL COMES BEFORE THE SESSION LOOKUP', () => {
        const source = code(MODULE);
        const start = source.indexOf('export async function createImpersonationTokenAction(');
        expect(start).toBeGreaterThan(-1);

        const head = source.slice(start, start + 700);
        const refusalAt = head.indexOf('isAdminImpersonationEnabled()');
        const sessionAt = head.indexOf('requireSession(');

        expect(refusalAt).toBeGreaterThan(-1);
        // Order is the claim: while the flag is off no caller reaches the
        // session lookup, the permission check, or the write.
        expect({ first: refusalAt < sessionAt }).toEqual({ first: true });
    });

    it('and the flag takes one exact word, not any truthy value', () => {
        const original = process.env[ADMIN_IMPERSONATION_ENV];
        try {
            for (const value of ['1', 'true', 'yes', 'ENABLED', 'enabled ', '']) {
                process.env[ADMIN_IMPERSONATION_ENV] = value;
                expect({ value, on: isAdminImpersonationEnabled() }).toEqual({ value, on: false });
            }
            delete process.env[ADMIN_IMPERSONATION_ENV];
            expect(isAdminImpersonationEnabled()).toBe(false);

            process.env[ADMIN_IMPERSONATION_ENV] = ADMIN_IMPERSONATION_ENABLED_VALUE;
            expect(isAdminImpersonationEnabled()).toBe(true);
        } finally {
            if (original === undefined) delete process.env[ADMIN_IMPERSONATION_ENV];
            else process.env[ADMIN_IMPERSONATION_ENV] = original;
        }
    });

    it('and the refusal names the half that is missing, not just "no"', () => {
        // A refusal that only says no sends the next developer looking. #322.
        // These four facts are what somebody arming the flag has to know.
        expect(ADMIN_IMPERSONATION_REFUSAL).toMatch(/redemption path/i);
        expect(ADMIN_IMPERSONATION_REFUSAL).toMatch(/impersonation_tokens/);
        expect(ADMIN_IMPERSONATION_REFUSAL).toMatch(/expiry and single-use/i);
        for (const field of ['active', 'expiresAt', 'usedAt']) {
            expect({ field, named: ADMIN_IMPERSONATION_REFUSAL.includes(field) })
                .toEqual({ field, named: true });
        }
    });

    it('and the implementation and its guards are KEPT, not deleted', () => {
        // The standing rule for this codebase: retire, never destroy. Every
        // guard role-escalation.test.ts asserts is still in the file, and still
        // exercised there with the flag armed.
        const source = code(MODULE);
        expect(source).toContain('IMPERSONATION_TOKENS');
        expect(source).toContain('users:impersonate');
        expect(source).toContain('Cannot impersonate admin users');
        expect(source).toMatch(/durationMinutes\s*<\s*5\s*\|\|\s*durationMinutes\s*>\s*120/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#396 — the five that were deliberately left alone', () => {
    it('THE OTHER EXPORTS ARE UNCHANGED AND UNGATED', () => {
        // Retiring is only a fix when the thing retired is wrong (#384). These
        // five do exactly what they say; they simply have no screen. Gating
        // them would add friction and prevent nothing, so this asserts they
        // were NOT swept up in the same change.
        const source = code(MODULE);
        for (const action of [
            'bulkSuspendUsersAction',
            'bulkActivateUsersAction',
            'bulkAssignRolesAction',
            'bulkDeleteUsersAction',
            'exportUserDataAction',
        ]) {
            const start = source.indexOf(`export async function ${action}(`);
            expect({ action, found: start > -1 }).toEqual({ action, found: true });

            const head = source.slice(start, start + 700);
            expect({ action, gated: head.includes('isAdminImpersonationEnabled') })
                .toEqual({ action, gated: false });
        }
    });
});
