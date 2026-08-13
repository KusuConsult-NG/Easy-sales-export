/**
 * @jest-environment node
 */

/**
 * Two guards, from sweeping every prior fix for siblings rather than opening
 * the next file.
 *
 * Four of the last ten findings in this audit were siblings of something
 * already corrected — #123 (the export cart, after #113 fixed the marketplace
 * one), #124 (password reset, after #108 fixed password change), #125 (three
 * more credential writers), #137 (the slot reader whose own file warned that
 * "fixing one copy and leaving its siblings is how this class keeps
 * surviving"). So the sweep replaced the file-by-file pass.
 *
 * WHAT THE SWEEP FOUND, AND DID NOT
 * ---------------------------------
 * Read-adjust-write on a balance (#109, #110): no sites remain. Closed.
 *
 * Sensitive field before a caller spread: 154 literals spread caller data into
 * a write, and every one puts its security-critical keys AFTER the spread. Five
 * apparent violations were all false positives on inspection — a nested
 * `metadata: { ...data }` inside an audit call, two reads where `data` is
 * `doc.data()`, and a literal with no spread at all. Nothing to fix, so nothing
 * was changed.
 *
 * Narrow admin check: EIGHT sites, in land-actions.ts and loan-actions.ts.
 * Those were fixed.
 *
 * WHY THESE TWO TESTS
 * -------------------
 * The spread-ordering guard exists because marketplace/_escrow.ts already says
 * what is wrong with the status quo:
 *
 *     Fourteen sites in this codebase spread caller data into a write and every
 *     one of them is safe for exactly this reason. That is a property of field
 *     order in an object literal, which is a thin thing to rest on.
 *
 * It is right. A reorder during a refactor removes the guard silently and
 * nothing fails. There are 154 such sites now, not fourteen.
 *
 * The admin-role guard exists because the same narrow check has been fixed
 * three times — #115 (land verification), #122 (dispute assignee), #134
 * (notification readers) — and reappeared each time somewhere else.
 *
 * ON SEVERITY, STATED PLAINLY
 * ---------------------------
 * The admin one is a LOCKOUT, not a privilege hole. A super_admin without the
 * literal 'admin' role was refused: loan approval, loan rejection, loan stats,
 * land moderation. Nobody gains anything they should not have; the most
 * privileged account is simply unable to do its job. That is worth fixing and
 * is not worth calling a vulnerability.
 *
 * The fix deliberately does NOT switch to isAdmin(), which accepts moderator,
 * support and every module admin. Widening loan approval to a support agent
 * while fixing a lockout would be a bad trade made quietly — the same
 * reasoning as #115.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ACTIONS = join(process.cwd(), 'src/app/actions');

function actionFiles(dir: string = ACTIONS, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) actionFiles(full, acc);
        else if (entry.endsWith('.ts')) acc.push(full);
    }
    return acc;
}

/**
 * briefing.ts and briefing-admin.ts are out of scope by instruction — not to be
 * audited or changed — so they are exempt rather than silently failing this.
 */
const EXEMPT = ['briefing.ts', 'briefing-admin.ts'];

describe('an admin check that names admin also names super_admin', () => {
    it('finds action files to check (sanity)', () => {
        expect(actionFiles().length).toBeGreaterThan(20);
    });

    /**
     * The spellings a narrow admin check comes in.
     *
     * The first version matched only `roles.includes("admin")` and missed FOUR
     * live sites — reviews.ts twice and disputes.ts twice — all spelled
     * `hasRole(roles, "admin")`. Two of those were in the same file as the site
     * #122 had already fixed and written up.
     *
     * A ratchet that pins one spelling of a defect pins the spelling, not the
     * defect. Both forms are checked now, and a new helper with the same meaning
     * has to be added here.
     */
    const NARROW_ADMIN_CHECKS = [
        // roles.includes("admin")
        /roles\??\.\s*includes\(\s*['"]admin['"]\s*\)/,
        // hasRole(anything, "admin")
        /hasRole\([^)]*,\s*['"]admin['"]\s*\)/,
    ];

    it('has no condition testing for admin alone', () => {
        const offenders: string[] = [];

        for (const file of actionFiles()) {
            if (EXEMPT.some((e) => file.endsWith(e))) continue;
            const rel = file.slice(process.cwd().length + 1);

            readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
                if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
                if (line.includes('super_admin')) return;
                if (NARROW_ADMIN_CHECKS.some((pattern) => pattern.test(line))) {
                    offenders.push(`${rel}:${i + 1}`);
                }
            });
        }

        if (offenders.length > 0) {
            throw new Error(
                `\n\n${offenders.length} site(s) check for the 'admin' role without super_admin:\n\n` +
                offenders.map((o) => `  ${o}`).join('\n') +
                `\n\nA super_admin who does not also hold the literal 'admin' role is\n` +
                `refused — a lockout of the most privileged account, not a hole.\n` +
                `Fixed four times already: #115, #122, #134, and the four\n` +
                `hasRole() siblings this pattern list was widened to catch.\n\n` +
                `Add `+ '`|| roles?.includes("super_admin")`' + `. Do NOT switch to isAdmin(),\n` +
                `which also admits moderator, support and every module admin.\n`
            );
        }
        expect(offenders).toEqual([]);
    });
});

describe('a caller spread never precedes the field it could overwrite', () => {
    const SENSITIVE = [
        'status', 'userId', 'ownerId', 'sellerId', 'vendorId', 'buyerId',
        'isActive', 'roles', 'isVerified', 'paymentStatus', 'createdBy',
        'membershipStatus', 'balance',
    ];
    const CALLER_VARS = [
        'data', 'validated', 'validatedData', 'productData', 'dataToSave',
        'payload', 'params', 'input', 'verificationData', 'paymentData',
    ];

    /**
     * The INNERMOST object literal containing a given offset.
     *
     * The first version took the outermost literal starting at each brace, so
     * `createAdminAuditLog({ userId: x, metadata: { ...data } })` looked like
     * `userId` set before the spread — when they are in different literals
     * entirely. It reported five violations, every one of which was a false
     * positive on inspection. A guard that fails on correct code is worse than
     * no guard, so it walks outwards from the spread instead.
     */
    function innermostLiteral(src: string, at: number): { start: number; text: string } | null {
        // Walk back to the nearest unmatched '{'.
        let depth = 0;
        for (let i = at; i >= 0; i--) {
            if (src[i] === '}') depth++;
            else if (src[i] === '{') {
                if (depth === 0) {
                    // Found the opening brace; now find its match.
                    let d = 0;
                    for (let j = i; j < src.length; j++) {
                        if (src[j] === '{') d++;
                        else if (src[j] === '}') {
                            d--;
                            if (d === 0) return { start: i, text: src.slice(i, j + 1) };
                        }
                    }
                    return null;
                }
                depth--;
            }
        }
        return null;
    }

    it('holds across every action file', () => {
        const offenders: string[] = [];

        for (const file of actionFiles()) {
            if (EXEMPT.some((e) => file.endsWith(e))) continue;
            const src = readFileSync(file, 'utf-8');
            const rel = file.slice(process.cwd().length + 1);

            const spreadPattern = new RegExp(`\\.\\.\\.\\s*(${CALLER_VARS.join('|')})\\b`, 'g');
            for (const spread of src.matchAll(spreadPattern)) {
                const varName = spread[1];
                const at = spread.index ?? 0;

                // `data` is also the usual name for doc.data(); those are reads,
                // not caller input.
                const context = src.slice(Math.max(0, at - 1500), at);
                if (new RegExp(`\\b${varName}\\s*=\\s*[\\w.]*(doc|snap|Doc|Snap)\\w*\\.data\\(\\)`).test(context)) continue;

                const literal = innermostLiteral(src, at);
                if (!literal || literal.text.length > 4000) continue;

                const before = literal.text.slice(0, at - literal.start);
                for (const key of SENSITIVE) {
                    if (new RegExp(`(^|[{,\\s])${key}\\s*:`).test(before)) {
                        offenders.push(`${rel}:${src.slice(0, at).split('\n').length} — '${key}' before ...${varName}`);
                    }
                }
            }
        }

        if (offenders.length > 0) {
            throw new Error(
                `\n\n${offenders.length} literal(s) set a security-critical field BEFORE spreading\n` +
                `caller data over it:\n\n` +
                offenders.map((o) => `  ${o}`).join('\n') +
                `\n\nThe spread wins, so the caller decides the field. Move the field\n` +
                `after the spread.\n\n` +
                `marketplace/_escrow.ts already notes that every such site in this\n` +
                `codebase is safe only because of field order — "a thin thing to rest\n` +
                `on". This test is what makes it less thin.\n`
            );
        }
        expect(offenders).toEqual([]);
    });
});
