/**
 * @jest-environment node
 */

/**
 *   #374 SECURITY: ESCALATING A DISPUTE WAS GATED TIGHTER THAN RESOLVING ONE,
 *        AND THE SHARED GATE'S `permission` PARAMETER WAS USED BY TWO OF
 *        THIRTY CALL SITES.
 *
 *        lib/require-admin.ts takes an optional permission, and says so in its
 *        own docstring: "Pass a permission to require more than 'is an admin at
 *        all'". Measured across the repository, two call sites did. The other
 *        twenty-eight admitted every one of the ten admin roles.
 *
 *        ONE OF THOSE TWENTY-EIGHT IS NOT A JUDGEMENT CALL, BECAUSE ITS OWN
 *        FILE HAD ALREADY ANSWERED:
 *
 *        _escrow_disputes.ts. _resolveDisputeAction RELEASES OR REFUNDS
 *            ESCROW MONEY and said requireAdmin(). Sixty lines below,
 *            _escalateDisputeAction — which only flags a case for senior review
 *            — says requireAdmin("finance:resolve_disputes"). Two doors onto one
 *            workflow in one file, and the weaker gate was on the one that moves
 *            the money.
 *
 *            Only `admin` and `super_admin` hold finance:resolve_disputes, so it
 *            admitted EIGHT roles its own file refuses: moderator, support,
 *            wave_admin, cooperative_admin, marketplace_admin, export_admin,
 *            farm_nation_admin, academy_admin.
 *
 *            AND THE LIVE RESOLVER HAD ALREADY BEEN FIXED. actions/disputes.ts
 *            — the one the admin screen calls — asks for the permission and
 *            carries a note saying it was "deliberately NOT switched to
 *            isAdmin(), which also admits moderator". This is the second copy,
 *            and _escrow_disputes.ts's own header warns that "a copy nobody runs
 *            is a copy nobody notices drifting". It is re-exported through
 *            index.ts, so the weak gate is reachable over the wire whether or
 *            not a screen calls it. The recurring shape: N doors, and the fix
 *            landed on one.
 *
 *        AND ONE THAT LOOKED IDENTICAL AND WAS NOT. escalation-notes.ts reads a
 *        dispute's internal notes on a bare gate while its own writer demands
 *        the permission — the same asymmetry, in the same shape. This finding's
 *        first draft changed it too, and #356's ratchet failed: #356 had already
 *        decided that one deliberately, and recorded the reason —
 *
 *            "narrowing the read alone would show a moderator the dispute with a
 *             hole in it"
 *
 *        — which holds, because getDisputeByIdAction uses `isResolver` to decide
 *        HOW MUCH of a dispute to show rather than whether to show it. Reverted,
 *        and the reason is now in escalation-notes.ts itself so the next sweep
 *        reads it before acting. An asymmetry between two gates is EVIDENCE, not
 *        a verdict; establishing which of the two it is, is the work.
 *
 *        THE OTHER TWENTY-SEVEN ARE RECORDED, NOT CHANGED, and listed in
 *        lib/require-admin.ts. Narrowing a live gate can lock out a role that is
 *        doing that work today, and which roles actually operate each queue is
 *        not something this codebase records. The one above was safe precisely
 *        because its own file had already decided.
 *
 *        OWNER DECISION: assign a permission to each of the twenty-seven, or say
 *        that "any admin" is the intended rule for them.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { ALL_ADMIN_ROLES, rolesWithPermission, hasAdminPermission } from '@/lib/admin-permissions';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const GATE = 'src/lib/require-admin.ts';
const DISPUTES = 'src/app/actions/marketplace/_escrow_disputes.ts';
const NOTES = 'src/app/actions/escalation-notes.ts';
const LIVE = 'src/app/actions/disputes.ts';
const RESOLVE = 'finance:resolve_disputes';

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

const SRC = walk('src');

/**
 * Every call to the SHARED gate, with its argument.
 *
 * A CORRECTION TO MY OWN FIRST DRAFT, which matched `requireAdmin(` in any
 * file. actions/cms.ts declares its OWN local `requireAdmin(): Promise<{id} |
 * null>` — correctly built, failing closed on a read error — and five of its
 * calls were counted as bare uses of this module's gate. They never reach it.
 *
 * Resolved by IMPORT now, which is the same lesson as #370's importer sweep:
 * a name is not a reference.
 */
function importsGate(file: string): boolean {
    return /from\s+["']@\/lib\/require-admin["']/.test(source(file));
}

function callSites(): Array<{ file: string; arg: string }> {
    const out: Array<{ file: string; arg: string }> = [];
    for (const f of SRC) {
        if (f === GATE || !importsGate(f)) continue;
        for (const m of source(f).matchAll(/requireAdmin\(([^)]*)\)/g)) {
            out.push({ file: f, arg: m[1].trim() });
        }
    }
    return out;
}

/** The slice of a file between one anchor and the next, so a gate can be read
 *  against the function it actually guards. */
function block(file: string, anchor: string, len = 900): string {
    const s = source(file);
    const at = s.indexOf(anchor);

    expect({ file, anchor, found: at > -1 }).toEqual({ file, anchor, found: true });
    return s.slice(at, at + len);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#374 — resolving a dispute now needs the same permission as escalating one', () => {
    it('THE MONEY PATH ASKS FOR finance:resolve_disputes', () => {
        expect(block(DISPUTES, 'async function _resolveDisputeAction'))
            .toContain(`requireAdmin("${RESOLVE}")`);
    });

    it('and so does the escalate path it used to be weaker than', () => {
        expect(block(DISPUTES, 'async function _escalateDisputeAction'))
            .toContain(`requireAdmin("${RESOLVE}")`);
    });

    it('NEITHER IS A BARE requireAdmin() ANY MORE', () => {
        // The whole finding, as one assertion over the file: no call in it
        // settles for "is an admin at all".
        const bare = [...source(DISPUTES).matchAll(/requireAdmin\(\s*\)/g)];

        expect(bare.length).toBe(0);
    });

    it('the permission really excludes eight of the ten roles', () => {
        // Without this the fix would be a rename. Measured from the matrix, not
        // asserted from memory.
        // Through the module's PUBLIC api. PERMISSION_MATRIX is a private
        // `const`, not an export — my first draft imported it and got
        // `undefined`, which threw rather than failing usefully.
        const holders = rolesWithPermission(RESOLVE as any);

        expect([...ALL_ADMIN_ROLES].length).toBe(10);
        expect([...holders].sort()).toEqual(['admin', 'super_admin']);
        // And the same answer from the other direction, so this is about the
        // rule and not about one helper.
        expect(hasAdminPermission(['moderator'], RESOLVE as any)).toBe(false);
        expect(hasAdminPermission(['marketplace_admin'], RESOLVE as any)).toBe(false);
        expect(hasAdminPermission(['admin'], RESOLVE as any)).toBe(true);
    });

    it('and the LIVE resolver already demanded it, which is why this was drift', () => {
        // actions/disputes.ts is the one the admin screen calls. The fix landed
        // there and not here — N doors, one hardened.
        expect(source(LIVE)).toContain(`hasAdminPermission(callerRoles, "${RESOLVE}")`);
    });

    it('the unwired copy is still a registered server action, so the gate mattered', () => {
        // Reachability is the reason this is a defect rather than dead code.
        expect(source(DISPUTES)).toContain('export const resolveDisputeAction');
        // Anchored on the module specifier's closing quote: `toContain` cannot
        // tell _escrow_disputes from _escrow_disputesX, and mutant M10 walked
        // through the first draft of this line.
        expect(source('src/app/actions/marketplace/index.ts'))
            .toMatch(/_escrow_disputes["']/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#374 — the escalation-notes asymmetry is #356\'s decision, not a gap', () => {
    /**
     * A CORRECTION TO MY OWN FIRST DRAFT. The same sweep flagged
     * getEscalationNotesAction: it reads internal notes on a money dispute on a
     * bare requireAdmin(), while addEscalationNoteAction beside it demands the
     * permission. I changed it — and the #356 ratchet in
     * one-admin-test-not-six.test.ts failed, because #356 had already decided
     * this one deliberately and written down why:
     *
     *     "narrowing the read alone would show a moderator the dispute with a
     *      hole in it"
     *
     * That reason holds: getDisputeByIdAction uses `isResolver` to decide HOW
     * MUCH of a dispute to show, not whether to show it, so a moderator can
     * legitimately open the screen. The change is reverted.
     *
     * The lesson is the general one: an asymmetry between two gates is evidence,
     * not a verdict. In _escrow_disputes.ts it was a defect; here the same shape
     * is a decision. Checking which is which is the work.
     */
    it('THE READER IS DELIBERATELY LEFT ON A BARE GATE', () => {
        expect(block(NOTES, 'export async function getEscalationNotesAction'))
            .toContain('requireAdmin();');
    });

    it('and the writer beside it does demand the permission', () => {
        expect(block(NOTES, 'export async function addEscalationNoteAction'))
            .toContain(`requireAdmin("${RESOLVE}")`);
    });

    it('the reason is recorded where somebody sweeping will read it', () => {
        // So the next pass does not "fix" it again, as this one nearly did.
        const raw = readFileSync(NOTES, 'utf-8');

        expect(raw).toContain('#356');
        expect(raw).toContain('#374');
    });

    it('and #356\'s own ratchet still states it', () => {
        expect(source('src/__tests__/unit/one-admin-test-not-six.test.ts'))
            .toContain("await requireAdmin();");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#374 — RECORDED: the twenty-seven gates that still admit any admin', () => {
    /**
     * Pinned as a COUNT and a file list, so the number cannot drift in either
     * direction unnoticed: a new bare requireAdmin() fails here, and so does
     * hardening one without updating the record the owner is deciding from.
     */
    const RECORDED: Record<string, number> = {
        'src/app/actions/admin-communications.ts': 3,
        'src/app/actions/maintenance.ts': 4,
        'src/app/actions/in-app-broadcast.ts': 3,
        'src/app/actions/admin-users.ts': 2,
        'src/app/actions/escalation-notes.ts': 1,
        'src/app/actions/sms-broadcast.ts': 2,
        'src/app/actions/diagnose-broadcast.ts': 1,
        'src/app/actions/export-aggregation.ts': 1,
        'src/app/actions/global-aggregation.ts': 5,
        'src/app/actions/admin/_land.ts': 1,
        'src/app/actions/admin/_legacy.ts': 1,
        'src/app/actions/admin/_withdrawals.ts': 1,
        'src/app/actions/marketplace/_escrow_lifecycle.ts': 1,
        'src/app/api/admin/maintenance/hard-reset/route.ts': 1,
    };

    it('THE GATE ITSELF STILL MAKES THE PERMISSION OPTIONAL', () => {
        // If this ever becomes required, the whole finding is closed by the
        // type system and this describe block should go.
        expect(source(GATE)).toContain('requireAdmin(permission?: AdminPermission)');
    });

    it('and it is asked of the matrix, not of a role list', () => {
        expect(source(GATE)).toContain('hasAdminPermission(roles, permission)');
        expect(source(GATE)).toContain('isAdmin(roles)');
    });

    it('EXACTLY TWENTY-SEVEN CALL SITES STILL NAME NO PERMISSION', () => {
        const bare = callSites().filter((c) => c.arg === '');
        const byFile: Record<string, number> = {};
        for (const c of bare) byFile[c.file] = (byFile[c.file] ?? 0) + 1;

        expect(byFile).toEqual(RECORDED);
        expect(bare.length).toBe(27);
    });

    it('and three now name one — the one #374 fixed and the two that already did', () => {
        const named = callSites().filter((c) => c.arg !== '');

        expect(named.map((c) => c.file).sort()).toEqual([
            // The escalation-notes WRITER, which already named it before #374.
            'src/app/actions/escalation-notes.ts',
            // Both dispute paths: escalate already did, resolve now does.
            'src/app/actions/marketplace/_escrow_disputes.ts',
            'src/app/actions/marketplace/_escrow_disputes.ts',
        ]);
        expect([...new Set(named.map((c) => c.arg))]).toEqual([`"${RESOLVE}"`]);
    });

    it('AND cms.ts IS NOT AMONG THEM — it has its own gate', () => {
        /**
         * The correction, pinned. actions/cms.ts declares a local
         * `requireAdmin(): Promise<{id} | null>` and never imports this module,
         * so its five calls are not bare uses of the shared gate. My first
         * measurement counted them, because it matched the NAME rather than
         * resolving the import — and shipped a record that was five too long.
         *
         * The local gate is also correctly built, which is why this is a
         * miscount and not a second finding: it reads live roles and returns
         * null when the read fails, following #245's rule.
         */
        const cms = 'src/app/actions/cms.ts';

        expect(importsGate(cms)).toBe(false);
        expect(source(cms)).toContain('async function requireAdmin(): Promise<{ id: string } | null>');
        expect(source(cms)).toContain('return null;');
        expect(callSites().map((c) => c.file)).not.toContain(cms);
    });

    it('the sweep is not vacuous — it finds the call sites at all', () => {
        expect(callSites().length).toBe(30);
        expect(SRC.length).toBeGreaterThan(400);
    });

    it('and the record lives where the parameter is defined', () => {
        // So somebody reading the gate sees who is not using it.
        expect(readFileSync(GATE, 'utf-8')).toContain('#374');
        expect(readFileSync(GATE, 'utf-8')).toContain('OWNER DECISION');
    });

    it('measured on code, not on prose', () => {
        // The #374 note in require-admin.ts lists the thirty-one files by name
        // and quotes requireAdmin() itself. A raw-text sweep would count the
        // tombstone as call sites — the trap has fired twelve times here.
        const raw = readFileSync(GATE, 'utf-8');

        expect(raw).toContain('_processWithdrawalAction');
        expect(source(GATE)).not.toContain('_processWithdrawalAction');
    });
});
