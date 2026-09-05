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

/** The whole body of one function, anchor to anchor — for claims that have to
 *  hold across a couple of hundred lines rather than inside a window. */
function fn(file: string, start: string, end: string): string {
    const s = source(file);
    const a = s.indexOf(start);
    const b = s.indexOf(end, a + 1);

    expect({ file, start, end, found: a > -1 && b > a }).toEqual({ file, start, end, found: true });
    return s.slice(a, b);
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
describe('#375 — every gate names its permission, and the exception is stated', () => {
    /**
     * #374 recorded twenty-seven gates admitting all ten admin roles and left
     * the choice open. #375 takes it: each now names the permission that
     * matches what the action does, chosen so the module admin who legitimately
     * runs a queue keeps running it.
     *
     * Pinned per file AND per permission, so neither a new bare gate nor a
     * silently retargeted one can pass.
     */
    const EXPECTED: Record<string, string[]> = {
        // Broadcast surfaces — these reach every member.
        'src/app/actions/admin-communications.ts': Array(3).fill('announcements:manage'),
        'src/app/actions/sms-broadcast.ts': Array(2).fill('announcements:manage'),
        'src/app/actions/in-app-broadcast.ts': Array(3).fill('announcements:manage'),
        'src/app/actions/diagnose-broadcast.ts': ['announcements:manage'],

        // Platform operations.
        'src/app/actions/maintenance.ts': Array(4).fill('config:update'),
        'src/app/api/admin/maintenance/hard-reset/route.ts': ['config:update'],

        // Money out, and the assignment of the case that moves it.
        'src/app/actions/admin/_withdrawals.ts': ['finance:process_withdrawals'],
        'src/app/actions/marketplace/_escrow_lifecycle.ts': ['finance:resolve_disputes'],
        'src/app/actions/marketplace/_escrow_disputes.ts': Array(2).fill('finance:resolve_disputes'),

        // Account creation.
        'src/app/actions/admin/_legacy.ts': ['users:create'],

        // #431's addition. The retired document viewer stated the admin rule by
        // hand — ["admin", "super_admin", "cooperative_manager", "superadmin"]
        // read off the JWT claim — which is the class #364 swept out of fifteen
        // API routes and #356 out of requireAdmin itself. This route was missed
        // by both, and it is fixed rather than left in that state because a
        // retirement behind a flag is one environment variable from being live.
        // `users:read` because what it serves is a member's own uploaded
        // identity document.
        'src/app/api/admin/documents/[docId]/route.ts': ['users:read'],
        // #381's pair: the money knobs — fees, order bounds, USD→NGN and the
        // WAVE commission. Read is separate from update because seeing what
        // the platform charges is not the same right as changing it.
        'src/app/actions/admin/_settings.ts': ['config:read', 'config:update'],

        // Module queues — the permission deliberately includes the module admin.
        'src/app/actions/export-aggregation.ts': ['export:approve_applications'],
        // #380's two: the booking queue and the confirm/cancel decision. Same
        // permission as the rest of the export queue, held by super_admin,
        // admin and export_admin.
        'src/app/actions/export-booking.ts': Array(2).fill('export:approve_applications'),
        'src/app/actions/admin/_land.ts': ['land:verify_listings'],

        // Reads. All ten roles hold these, so behaviour is unchanged — named so
        // the rule follows the matrix if it is ever narrowed.
        'src/app/actions/global-aggregation.ts': Array(5).fill('audit:read'),

        // Two different permissions in one file: the user list is a read, the
        // dispute assignment is dispute work.
        'src/app/actions/admin-users.ts': ['users:read', 'finance:resolve_disputes'],

        // The deliberate exception, plus its writer.
        'src/app/actions/escalation-notes.ts': ['finance:resolve_disputes'],

        /**
         * #203. cms.ts joined the shared gate. It had a hand-written
         * requireAdmin whose test was isAdmin(liveRoles) — a role-SHAPE test
         * that returns true for all TEN admin roles — so any of them could
         * publish an announcement or a banner to every visitor, while
         * AdminSidebar had already hidden /admin/cms from eight of them on
         * `announcements:manage` (#382). The nav said one thing and the server
         * accepted another.
         *
         * Four gates, one permission: create and deactivate, announcement and
         * banner. A banner is an announcement in another shape — same screen,
         * same audience, same component renders it site-wide — and there is no
         * `banners:manage` in the vocabulary to invent.
         */
        'src/app/actions/cms.ts': Array(4).fill('announcements:manage'),
    };

    it('EVERY GATE NAMES THE PERMISSION ITS ACTION NEEDS', () => {
        const actual: Record<string, string[]> = {};
        for (const c of callSites()) {
            if (c.arg === '') continue;
            (actual[c.file] ??= []).push(c.arg.replace(/"/g, ''));
        }

        expect(actual).toEqual(EXPECTED);
    });

    it('AND EXACTLY ONE BARE GATE REMAINS — the one #356 decided', () => {
        const bare = callSites().filter((c) => c.arg === '');

        expect(bare).toEqual([{ file: NOTES, arg: '' }]);
    });

    it('the narrowing ones really do narrow', () => {
        // Without this the sweep would pass for a set of permissions every role
        // holds. These four are the ones that take a queue from ten roles to two.
        for (const p of ['announcements:manage', 'config:update',
                         'finance:process_withdrawals', 'users:create']) {
            expect({ p, holders: [...rolesWithPermission(p as any)].sort() })
                .toEqual({ p, holders: ['admin', 'super_admin'] });
        }
    });

    it('and the module queues deliberately keep their module admin', () => {
        expect([...rolesWithPermission('export:approve_applications' as any)]).toContain('export_admin');
        expect([...rolesWithPermission('land:verify_listings' as any)]).toContain('farm_nation_admin');
    });

    it('the two read permissions are held by all ten, which is why they change nothing', () => {
        // Stated so "named" is not mistaken for "narrowed" on these two.
        expect([...rolesWithPermission('users:read' as any)]).toHaveLength(10);
        expect([...rolesWithPermission('audit:read' as any)]).toHaveLength(10);
    });

    it('THE GATE ITSELF STILL MAKES THE PERMISSION OPTIONAL', () => {
        // One caller legitimately omits it, so the parameter stays optional.
        expect(source(GATE)).toContain('requireAdmin(permission?: AdminPermission)');
    });

    it('and it is asked of the matrix, not of a role list', () => {
        expect(source(GATE)).toContain('hasAdminPermission(roles, permission)');
        expect(source(GATE)).toContain('isAdmin(roles)');
    });

    it('#203 — AND cms.ts IS AMONG THEM NOW; its local gate is gone', () => {
        /**
         * This assertion used to read "cms.ts IS NOT among them — it has its
         * own gate", recording #374's correction: the file declared a local
         * `requireAdmin(): Promise<{id} | null>` and never imported this
         * module, so matching the NAME had over-counted.
         *
         * #203 removed that local gate. lib/require-admin.ts already did
         * everything it did — live roles rather than the stale JWT, the
         * banned/suspended check, a fail-closed catch — and it asks
         * PERMISSION_MATRIX for a named permission, which the hand-written one
         * could not. The import is real now, so the count above is a real use.
         */
        const cms = 'src/app/actions/cms.ts';

        expect(importsGate(cms)).toBe(true);
        expect(source(cms)).not.toContain('async function requireAdmin(');
        expect(callSites().map((c) => c.file)).toContain(cms);
    });

    it('the sweep is not vacuous — it finds the call sites at all', () => {
        // 34 → 38: cms.ts's four writes joined the shared gate (#203).
        // 38 → 39: the retired document viewer's hand-written role list became
        // a real gate (#431).
        expect(callSites().length).toBe(39);
        expect(SRC.length).toBeGreaterThan(400);
    });

    it('and the decision is recorded where the parameter is defined', () => {
        expect(readFileSync(GATE, 'utf-8')).toContain('#375');
        expect(readFileSync(GATE, 'utf-8')).toContain('THE ONE REMAINING BARE GATE IS DELIBERATE');
    });

    it('measured on code, not on prose', () => {
        // The record in require-admin.ts names the permissions and the actions.
        // A raw-text sweep would count the tombstone as call sites.
        const raw = readFileSync(GATE, 'utf-8');

        expect(raw).toContain('_processWithdrawalAction');
        expect(source(GATE)).not.toContain('_processWithdrawalAction');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#375 — the escrow release records the admin who called it', () => {
    /**
     * The gate above was only half of this file's defect. `_releaseEscrowAction`
     * takes `adminId` as a PARAMETER and wrote it straight onto the disbursement
     * and into the financial audit trail:
     *
     *     patch: { releasedBy: adminId, ... }
     *     logAdminFinancialAction("escrow_released", adminId, ...)
     *
     * while requireAdmin() on the line above had already returned the signed-in
     * caller. So "who released this money" answered with whatever the caller
     * passed — #129 and #282's shape, on the money path, on the copy those two
     * fixes missed. Its own sibling in _escrow_disputes.ts already derives the
     * acting id from the session.
     */
    const LIFECYCLE = 'src/app/actions/marketplace/_escrow_lifecycle.ts';
    const BODY = () => fn(LIFECYCLE,
        'async function _releaseEscrowAction',
        'export const releaseEscrowAction');

    it('THE ACTING ADMIN COMES FROM THE SESSION, AND THE PARAMETER IS ONLY A FALLBACK', () => {
        const body = BODY();

        expect(body).toContain(
            'const actingAdminId = (adminCheck as { userId: string }).userId || adminId;');
        // Order is the whole claim: `adminId || session` would restore the
        // defect while still mentioning both, so it is asserted as absent.
        expect(body).not.toMatch(/adminId\s*\|\|\s*\(adminCheck/);
    });

    it('the released escrow row names the acting admin', () => {
        expect(BODY()).toContain('patch: { releasedBy: actingAdminId,');
    });

    it('AND SO DOES THE FINANCIAL AUDIT ROW', () => {
        // The row that exists to answer "who disbursed this". Anchored on the
        // action name and the argument together — `toContain('actingAdminId')`
        // would pass on any one of the three sites being right.
        expect(BODY()).toMatch(
            /logAdminFinancialAction\(\s*"escrow_released",\s*actingAdminId,/);
    });

    it('THE CALLER-SUPPLIED ID REACHES NO WRITE SITE AT ALL', () => {
        // Counted, not sampled. `adminId` used as a VALUE — excluding the
        // `adminId:` key in the signature and in the error logger's object —
        // must occur exactly once in the whole function: the fallback above.
        const uses = [...BODY().matchAll(/\badminId\b(?!\s*:)/g)];

        expect(uses.length).toBe(1);
    });

    it('the parameter is kept on purpose, and the reason is written down', () => {
        // Deleting it would silently shift `resolution` into its slot at any
        // call site built against the old positional shape, so it stays.
        const raw = readFileSync(LIFECYCLE, 'utf-8');

        expect(BODY()).toContain('adminId: string');
        expect(raw).toContain('#375');
        expect(raw).toContain('THE ESCROW RELEASE RECORDED WHICHEVER ADMIN THE CALLER NAMED');
    });

    it('and the sibling this fix was copied from still does it that way', () => {
        // The evidence that this was drift between two copies rather than a
        // design choice — _escrow_disputes.ts derives the acting id already.
        expect(source(DISPUTES)).toMatch(/actingAdminId\s*=\s*\(adminCheck/);
    });

    it('the slice is not vacuous — it really is the release function', () => {
        const body = BODY();

        expect(body).toContain('requireAdmin("finance:resolve_disputes")');
        expect(body.length).toBeGreaterThan(2000);
    });
});
