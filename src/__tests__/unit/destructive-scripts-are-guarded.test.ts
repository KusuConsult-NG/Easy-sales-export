/**
 * @jest-environment node
 */

/**
 *   #304 THE ONLY GUARD ON THE MOST DESTRUCTIVE FILE IN THE REPOSITORY CHECKED
 *        A SYSTEM THAT FILE DOES NOT TOUCH.
 *
 *        src/scripts/cleanup-firebase.ts deletes every auth user and empties
 *        every collection. Its safety check was:
 *
 *            const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
 *            if (projectId?.includes('prod') || projectId?.includes('production')) {
 *                console.error('❌ BLOCKED: This appears to be a production project!');
 *                process.exit(1);
 *            }
 *
 *        Every delete in that file goes through `supabaseDb`. Firebase is not
 *        this platform's datastore — the script's own import says so. So the
 *        guard inspected the name of a project that is no longer used, and the
 *        deletes ran against whatever Supabase the environment pointed at.
 *
 *        It failed three ways at once:
 *
 *          WRONG SYSTEM    the Supabase URL was never consulted.
 *          UNSET IS FALSY  with the Firebase variable absent — which it is —
 *                          `undefined?.includes('prod')` is undefined, so the
 *                          block never fired. The check passed by being
 *                          unanswerable. That is this audit's "a check that
 *                          reports success without checking", on the one file
 *                          where it costs everything.
 *          NAME MATCHING   even aimed correctly, whether a name contains the
 *                          letters p-r-o-d is not a test of whether a database
 *                          holds real members' money.
 *
 *        And the confirmation prompt compounded it: "Type the project ID to
 *        confirm" compared the typed string against that same unset variable,
 *        so the operator was asked to confirm a target the script would not
 *        touch.
 *
 * WHY THE SEED SCRIPT IS TESTED HERE TOO
 * --------------------------------------
 * scripts/seed-local.ts already had the right guard — the owner's own
 * SEED_ALLOW_REMOTE convention — and NOTHING pinned it. The two scripts are the
 * only files that can reach a whole database at once, so they are checked
 * together and in the same terms: consult the connection you actually write
 * through, refuse a non-local host, and require an override whose VALUE states
 * what it does.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

function code(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'));
}

const CLEANUP = 'src/scripts/cleanup-firebase.ts';
const SEED = 'scripts/seed-local.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#304 — the cleanup script guards the database it actually deletes', () => {
    const src = code(CLEANUP);

    it('IT NO LONGER DECIDES ANYTHING FROM THE FIREBASE PROJECT NAME', () => {
        expect(src).not.toMatch(/NEXT_PUBLIC_FIREBASE_PROJECT_ID/);
        expect(src).not.toMatch(/includes\('prod'\)/);
    });

    it('it reads the SUPABASE url — the connection every delete goes through', () => {
        expect(src).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
        // The one it deletes through.
        expect(src).toMatch(/supabaseDb as db/);
    });

    it('AND REFUSES WHEN THAT URL IS ABSENT, rather than proceeding', () => {
        // The old guard's fatal property: an unanswerable check passed. An
        // unknown target must stop the script, not wave it through.
        expect(src).toMatch(/if \(!supabaseUrl\)/);
        expect(src).toMatch(/process\.exit\(1\)/);
    });

    it('it refuses a host that is not local', () => {
        expect(src).toMatch(/targetHost === 'localhost'/);
        expect(src).toMatch(/'127\.0\.0\.1'/);
        expect(src).toMatch(/if \(!targetIsLocal/);
    });

    it('and the override has to SAY what it does', () => {
        // A bare CLEANUP=1 is something somebody sets by accident.
        expect(src).toMatch(/CLEANUP_ALLOW_REMOTE !== 'yes-destroy-a-remote-database'/);
    });

    it('THE CONFIRMATION PROMPT NAMES THE REAL TARGET', () => {
        // It asked for the Firebase project id and compared against a variable
        // that is normally unset.
        expect(src).toMatch(/confirm2 !== targetHost/);
        expect(src).not.toMatch(/confirm2 !== projectId/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#304 — the seed script keeps the guard it already had', () => {
    const src = code(SEED);

    it('refuses a non-local host without the stated override', () => {
        expect(src).toMatch(/SEED_ALLOW_REMOTE !== 'yes-seed-a-remote-database'/);
        expect(src).toMatch(/host === 'localhost'/);
    });

    it('and refuses outright when the connection is unknown', () => {
        expect(src).toMatch(/if \(!url \|\| !serviceKey\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#304 — one convention, not two', () => {
    /**
     * Stated as a property so a third whole-database script cannot arrive with
     * a fourth idea of what "safe" means. Both files derive a hostname from the
     * URL they write through and compare it against the same three local
     * spellings.
     */
    it.each([[CLEANUP], [SEED]])('%s derives its target from the URL it writes through', (path) => {
        const src = code(path);

        expect(src).toMatch(/new URL\(\w+\)\.hostname/);
        for (const local of ["'localhost'", "'127.0.0.1'", "'0.0.0.0'"]) {
            expect({ path, local, present: src.includes(local) })
                .toEqual({ path, local, present: true });
        }
    });

    it('and both overrides are long, explicit phrases rather than flags', () => {
        for (const path of [CLEANUP, SEED]) {
            const overrides = code(path).match(/'yes-[a-z-]+'/g) ?? [];
            expect({ path, count: overrides.length }).toEqual({ path, count: 1 });
            expect((overrides[0] ?? '').length).toBeGreaterThan(20);
        }
    });
});
