/**
 * @jest-environment node
 */

/**
 *   #440 THE SCREEN AN OPERATOR OPENS WHEN THEY SUSPECT THE PLATFORM IS BROKEN
 *   COULD NOT REPORT ILL HEALTH.
 *
 *   FOUND BY PULLING ON /admin/system-health/diagnostics, whose action was, in
 *   full:
 *
 *       const stats = { totalUsers: 0, corruptedUsers: 0, legacyVerified: 0,
 *           missingNames: 0, desyncedRegistrations: 0, orphanedApplications: 0 };
 *       const services = { redis: true, paystack: true, resend: true,
 *           firestore: true };
 *
 *   Four constants and six zeros, rendered as four green "Healthy" cards and
 *   six clean counts under "Real-time data integrity audit and service status
 *   monitoring". Its own comment admitted it: "in production these would be
 *   real counts".
 *
 *   THE SCREEN'S FOOTER WAS WORSE, BECAUSE IT WAS SPECIFIC:
 *
 *       Environment       "Production (Vercel)"   — this deploys on Railway,
 *                                                   and it said Production
 *                                                   in every environment
 *       Audit Level       "High Assurance
 *                          (Sample 100)"          — nothing sampled anything
 *       Security Status   ● "Active Enforcement"  — a pulsing green light
 *                                                   wired to nothing
 *
 *   AND THE REAL ONE WAS ONE DIRECTORY UP. /admin/system-health renders
 *   `runSystemHealthDiagnostic`, which scans user profiles, probes Redis and
 *   counts orphaned WAVE applications. Both carry THE SAME FIELD NAMES, so the
 *   fake was a copy of the real report's shape with the work removed.
 *
 *   MY FIRST PASS AT THE REPAIR WAS WRONG AND I THREW IT AWAY. I wrote fresh
 *   probes into the diagnostics action — which would have been a THIRD
 *   statement of "is the platform healthy", the exact mistake this audit has
 *   found nine times (#425, #426, #429–#434, #438, #439). It delegates instead.
 *
 *   TWO MORE ALWAYS-TRUE VALUES WERE INSIDE THE REAL ONE:
 *
 *     const firestoreStatus = !!db;   `db` is the imported adapter MODULE. It is
 *                                     truthy from the moment the file loads, so
 *                                     "Database: Active" was green even while
 *                                     every query on the page was failing.
 *     const desyncedRegs = 0;         declared zero, never computed, reported as
 *                                     "0 desynced registrations" — a clean bill
 *                                     of health issued without looking.
 *
 *   The first is a bounded one-row read now. The second is REMOVED rather than
 *   invented: defining "desynced" would be a new integrity rule, and
 *   /admin/forensics is where this codebase applies those (#266, #331).
 *
 *   AND THE GATE. The real diagnostic asked `isAdmin(...)` — true for any of the
 *   ten admin roles — while returning `issues[].email`, one row per anomalous
 *   member with their address. It names "audit:read" now, the permission #438
 *   gave /api/admin/verify-integrity, which asks the same question.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     firestore status goes back to !!db                    KILLED
 *     the diagnostics action returns constants again        KILLED
 *     the gate goes back to isAdmin                         KILLED
 *     an invented fact returns to the screen                KILLED
 *     reword the header prose                               SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const HEALTH = 'src/app/actions/health.ts';
const DIAGNOSTICS = 'src/app/actions/admin/_diagnostics.ts';
const PARENT_SCREEN = 'src/app/admin/system-health/page.tsx';
const CHILD_SCREEN = 'src/app/admin/system-health/diagnostics/page.tsx';

let store: FakeDbHandle;

function actAs(id: string, roles: string[]): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@example.com`, name: id } },
        error: null,
    }));
}

async function runDiagnostic() {
    const { runSystemHealthDiagnostic } = await import('@/app/actions/health');
    return runSystemHealthDiagnostic(50);
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('admin-1', ['super_admin']);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#440 — the database card reports what the database did', () => {
    it('IS TRUE WHEN A READ SUCCEEDS', async () => {
        store.seed(COLLECTIONS.USERS, 'u1', { email: 'a@example.com', roles: ['user'] });

        const result: any = await runDiagnostic();
        expect(result.success).toBe(true);
        expect(result.data.services.firestore).toBe(true);
    });

    it('and the report still comes back when the collection is empty', async () => {
        // An empty database is not an unhealthy one. The probe asks "did it
        // answer", not "did it return rows".
        const result: any = await runDiagnostic();
        expect(result.success).toBe(true);
        expect(result.data.services.firestore).toBe(true);
        expect(result.data.totalScanned).toBe(0);
    });

    it('AND THE PRODUCER IS A READ, NOT A TRUTHINESS TEST ON THE MODULE', () => {
        // The defect, in the exact shape it had. `!!db` on the imported adapter
        // is true from the moment the file loads, so no failure could ever
        // reach the screen — a unit test with a working fake database cannot
        // distinguish that from a real probe, which is why this is asserted at
        // the source.
        const src = code(HEALTH);
        expect(src).not.toMatch(/const firestoreStatus = !!db;/);
        expect(src).toMatch(/await db\.collection\(COLLECTIONS\.USERS\)\.limit\(1\)\.get\(\)/);
        // And the catch must record the failure rather than swallow it (#313).
        expect(src).toMatch(/databaseStatus = false/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#440 — the gate names a permission', () => {
    it('REFUSES A ROLE THAT DOES NOT HOLD audit:read', async () => {
        // The report carries issues[].email — one row per anomalous member,
        // with their address.
        actAs('nobody-1', ['user']);
        const result: any = await runDiagnostic();
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/audit:read/);
    });

    it('and admits a role that does', async () => {
        actAs('admin-1', ['admin']);
        const result: any = await runDiagnostic();
        expect(result.success).toBe(true);
    });

    it('and it is NOT isAdmin() alone any more', () => {
        const src = code(HEALTH);
        expect(src).toMatch(/hasAdminPermission\(session\.user\.roles, "audit:read"\)/);
        expect(src).not.toMatch(/isAdmin\(session\.user\.roles\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#440 — a field nobody computes is not reported', () => {
    it('desyncedRegistrations IS GONE FROM THE PRODUCER, THE TYPE AND BOTH SCREENS', () => {
        // `const desyncedRegs = 0;` produced it. Removing the producer and
        // leaving the field would only move the lie.
        for (const rel of [HEALTH, PARENT_SCREEN, CHILD_SCREEN]) {
            expect({ rel, mentions: /desyncedReg/i.test(code(rel)) })
                .toEqual({ rel, mentions: false });
        }
    });

    it('and the report really does not carry it', async () => {
        const result: any = await runDiagnostic();
        expect(Object.keys(result.data.stats).sort()).toEqual(['corruptedUsers', 'orphanedApplications']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#440 — one implementation, not two', () => {
    it('THE DIAGNOSTICS ACTION HOLDS NO SERVICE OR STAT CONSTANTS', () => {
        const src = code(DIAGNOSTICS);
        // The exact shape of the defect: a services map of literals.
        expect(src).not.toMatch(/redis:\s*true/);
        expect(src).not.toMatch(/paystack:\s*true/);
        expect(src).not.toMatch(/firestore:\s*true/);
        expect(src).not.toMatch(/corruptedUsers:\s*0/);
    });

    it('and it delegates to the one that does the work', () => {
        expect(code(DIAGNOSTICS)).toMatch(/runSystemHealthDiagnostic\(\)/);
    });

    it('and it STILL CARRIES A DOOR OF ITS OWN in front of the delegation', () => {
        // Three existing ratchets failed on my first version of the delegating
        // file — action-auth-per-function, action-security-audit and
        // admin-barrel-parity all read per file, and all three said the same
        // true thing: it reached no authorisation guard. The delegate does
        // check, so nothing was open; but a wrapper whose only protection lives
        // behind a call it does not control is the shape they exist to refuse,
        // and an exemption would have spent a real control to keep a
        // convenience.
        const src = code(DIAGNOSTICS);
        expect(src).toMatch(/await requireSession\(\)/);
        expect(src).toMatch(/if \(!sessionResult\.session\)/);
    });

    it('and it does not re-probe anything itself — that would be a THIRD copy', () => {
        // My own first pass at this repair wrote fresh probes here. Two
        // statements of "is the platform healthy" is the defect; three is not
        // an improvement.
        const src = code(DIAGNOSTICS);
        expect(src).not.toMatch(/getRedisClientStatus/);
        expect(src).not.toMatch(/process\.env\.PAYSTACK_SECRET_KEY/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#440 — the screens state no fact they do not have', () => {
    /**
     * Each of these was rendered as a confident, specific claim, and each was
     * false. They are listed by the string that appeared on screen so a
     * reintroduction fails here.
     */
    const INVENTED = [
        'Production (Vercel)',
        'High Assurance',
        'Sample 100',
        'Active Enforcement',
        'No critical integrity issues detected',
    ];

    it('NONE OF THE INVENTED FACTS IS ON EITHER SCREEN', () => {
        const found: string[] = [];
        for (const rel of [PARENT_SCREEN, CHILD_SCREEN]) {
            const src = readFileSync(join(ROOT, rel), 'utf-8');
            for (const claim of INVENTED) {
                // Skip the header comments, which quote them as the finding.
                if (stripComments(src, { label: rel }).includes(claim)) found.push(`${rel}: ${claim}`);
            }
        }
        expect({ found }).toEqual({ found: [] });
    });

    it('and a service whose key is only CONFIGURED says so', () => {
        // Paystack and Resend are `!!process.env.X` — a true statement about
        // configuration, not about reachability. Showing the same green tick
        // for both is how one gets read as the other.
        const src = code(CHILD_SCREEN);
        expect(src).toMatch(/reachability not checked/i);
        expect(src).toMatch(/probed=\{false\}/);
    });

    it('and a failed run is shown as a failure, not as a clean bill of health', () => {
        // #313. This is the screen where that matters most.
        const src = code(CHILD_SCREEN);
        expect(src).toMatch(/The check did not run/);
        expect(src).toMatch(/setError\(/);
    });

    it('VACUITY GUARD: the screens are really being read', () => {
        // Without this, a path typo would pass every assertion above.
        expect(code(CHILD_SCREEN).length).toBeGreaterThan(2000);
        expect(code(PARENT_SCREEN).length).toBeGreaterThan(2000);
    });
});
