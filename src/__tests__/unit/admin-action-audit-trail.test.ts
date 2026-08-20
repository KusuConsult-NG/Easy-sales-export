/**
 * @jest-environment node
 */

/**
 * Who approved this loan? Who paid this out? The log could not say.
 *
 * The platform has a real audit system: an audit_logs collection, an admin page
 * that reads it, an export gated on "audit:export", a severity classifier, and
 * an AuditAction union of a hundred-odd named actions. 118 call sites write to
 * it.
 *
 * Thirty-seven permission-gated admin writes did not — and they were
 * disproportionately the ones that move money or cannot be undone:
 *
 *   approve-loan / reject-loan            money lent, and to whom
 *   create/update/delete-loan-product     the interest rate every borrower pays
 *   mark-withdrawal-completed             money recorded as gone
 *   _processWalletWithdrawalAction        the Paystack payout itself
 *   _releaseFarmNationEscrowAction        money released AND a property's
 *                                         ownership transferred, in one call
 *   land verify / reject / delete         what a buyer trusts, and a deletion
 *                                         after which nothing records the
 *                                         listing existed
 *
 * The striking part is that the AuditAction union already NAMES nearly all of
 * them — 'loan_approved', 'loan_rejected', 'loan_product_created',
 * 'withdrawal_approved', 'escrow_released', 'land_verified', 'land_deleted'.
 * The vocabulary was written for these operations and the operations never
 * called it. So this is a convention that was ninety-percent applied, not a
 * feature nobody built.
 *
 * WHY recordAdminAction AND NOT createAdminAuditLog
 * -------------------------------------------------
 * createAuditLog rethrows, and every existing call site awaits it inside the
 * same try block as the work. On a money path that is the worst possible
 * arrangement: the withdrawal is paid, the audit write fails, and the caller is
 * told the operation failed. An audit row is a record OF an operation, not a
 * part of it. recordAdminAction logs loudly and returns, so a logging failure
 * can never roll back or misreport something already irreversible.
 *
 * The 118 existing calls are deliberately left alone — changing them is a
 * behaviour change to working paths, separate from adding rows that were
 * missing entirely.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function strip(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.ts') && !full.includes('__tests__')) out.push(full);
    }
    return out;
}

const DB_WRITE = new RegExp(
    String.raw`(?:db\.[^\n;]*|[A-Za-z0-9_]*[Rr]ef|transaction|txn|tx|batch|\)\s*)\.(?:update|set|add|delete)\s*\(`
    + String.raw`|\b(?:claimStatusTransition|claimStatusTransitionFromAny|versionedUpdate|claimVersionedUpdate)\s*\(`,
);
/**
 * WHAT COUNTS AS AN ADMIN-GATED WRITE.
 *
 * This was `hasAdminPermission(` alone, and that left a hole this audit fell
 * into twice:
 *
 *   - disputes.ts gated three actions by naming two roles through hasRole().
 *     The ratchet could not see them, so _updateDisputeStatusAction moved escrow
 *     money and recorded nothing until #157 changed its gate — and the ratchet
 *     then failed immediately, which is how it was found.
 *
 *   - Four more files are gated on requireAdmin() and nothing else:
 *     sms-broadcast, in-app-broadcast, maintenance and admin-communications —
 *     eighteen writes between them, including "message every member matching
 *     this filter" and a bulk rewrite of payment and wallet timestamps. None
 *     recorded anything, and none was visible to this check.
 *
 * requireAdmin() is in the pattern now. A ratchet whose blind spot has already
 * hidden two real defects is not a ratchet.
 */
const PERMISSION_GATED = /hasAdminPermission\s*\(|requireAdmin\s*\(/;
/**
 * Every helper in lib/audit-log.ts that writes a row, not just four of them.
 *
 * logAdminAction and logAdminFinancialAction were missing. Widening
 * PERMISSION_GATED immediately reported marketplace/_escrow_lifecycle.ts's
 * _releaseEscrowAction as unrecorded — and it records through
 * logAdminFinancialAction, which is what a money path SHOULD use. A gate that
 * cries wolf about correct code gets switched off, so the list is now the
 * module's actual exports.
 */
const AUDITS = /createAdminAuditLog|createAuditLog|logAuditAction|recordAdminAction|logAdminAction|logAdminFinancialAction|logFinancialAction|AUDIT_LOGS/;

/**
 * Every permission-gated admin write that records nothing.
 *
 * Per-FUNCTION, so one audited sibling cannot vouch for an unaudited one.
 * All four audit helpers count — bulk-user-operations.ts uses logAuditAction
 * rather than createAdminAuditLog, and an earlier version of this scan reported
 * bulkDeleteUsersAction and createImpersonationTokenAction as unrecorded when
 * both write a row through the other helper.
 */
function unauditedInSource(src: string, file: string): string[] {
    const found: string[] = [];
    const FN = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/gm;
    const heads = [...src.matchAll(FN)];
    const spans: [string, number, number][] = heads.length
        ? heads.map((m, i) => [m[1], m.index!, i + 1 < heads.length ? heads[i + 1].index! : src.length])
        : [['<module>', 0, src.length]];

    for (const [name, a, b] of spans) {
        const body = strip(src.slice(a, b));
        if (!DB_WRITE.test(body) || !PERMISSION_GATED.test(body)) continue;
        if (AUDITS.test(body)) continue;
        found.push(`${file}::${name}`);
    }

    return found;
}

function unauditedAdminWrites(): string[] {
    const found: string[] = [];

    for (const root of ['src/app/actions', 'src/app/api/admin']) {
        for (const file of walk(join(process.cwd(), root))) {
            found.push(...unauditedInSource(readFileSync(file, 'utf-8'), relative(process.cwd(), file)));
        }
    }

    return found.sort();
}

/**
 * BASELINE — EMPTY.
 *
 * Every permission-gated admin write in src/app/actions and src/app/api/admin
 * now records a row. This is a gate over the whole admin surface rather than a
 * ratchet over a remainder, and adding an entry back requires saying why here.
 *
 * The last twenty-nine were content moderation, catalogue edits, maintenance
 * sweeps and the village-market surface — which only became visible to this
 * scan once its writes were permission-gated, since an isAdmin()-only write is
 * not "permission-gated" by PERMISSION_GATED's definition. Fixing one finding
 * enlarged another, which is the honest order to discover them in.
 *
 * Two were not quite what they looked like and are recorded anyway:
 *
 *   broadcast/send      already wrote its own log document with recipient
 *                       counts and a done/partial/failed status. It was
 *                       recorded, just not in audit_logs, so an owner filtering
 *                       the audit trail could not see it. It writes both now.
 *   getCleanBroadcastListAction
 *                       a READ the scan catches because it writes an audit_logs
 *                       row in its own catch block. It hands back ~37,000 email
 *                       addresses, so it records a 'data_access' row — the one
 *                       entry here that is deliberately not a write.
 */
const KNOWN_UNAUDITED: string[] = [];

describe('the audit trail', () => {
    it('records every admin write that was added to it, and gains no new gaps', () => {
        // THE test.
        const actual = unauditedAdminWrites();
        const added = actual.filter((k) => !KNOWN_UNAUDITED.includes(k));

        if (added.length) {
            throw new Error(
                '\n\n⚠️  Permission-gated admin write(s) that record nothing:\n\n'
                + added.map((k) => `  ${k}`).join('\n')
                + '\n\nCall recordAdminAction with the AuditAction that names it. If the\n'
                + 'action genuinely needs no record, add it to KNOWN_UNAUDITED with a reason.\n',
            );
        }

        expect(added).toEqual([]);
    });

    it('and the baseline is not stale — nothing on it has been fixed without being removed', () => {
        const actual = unauditedAdminWrites();
        const fixed = KNOWN_UNAUDITED.filter((k) => !actual.includes(k));

        expect(fixed).toEqual([]);
    });

    it('and the scan really finds things, so [] means clean', () => {
        // The baseline used to be the proof. With it empty, a scanner that
        // silently matched nothing would pass every assertion above, so the
        // proof moves to a synthetic source the detector must still report.
        //
        // Unindented: the function-head regex is line-anchored, exactly as it
        // is against real source files.
        const planted = [
            'export async function _plantedAction() {',
            '    const session = (await requireSession()).session;',
            '    if (!hasAdminPermission(session.user.roles, "users:update")) {',
            '        return { success: false as const, error: "Unauthorized" };',
            '    }',
            '    await db.collection(COLLECTIONS.USERS).doc("someone").update({ x: 1 });',
            '    return { success: true as const };',
            '}',
        ].join('\n');

        expect(unauditedInSource(planted, 'planted.ts')).toEqual(['planted.ts::_plantedAction']);

        // ...and the same function WITH a record is not reported.
        const audited = planted.replace(
            '    return { success: true as const };',
            '    await recordAdminAction({ action: \'user_update\', userId: session.user.id });\n'
            + '    return { success: true as const };',
        );
        expect(unauditedInSource(audited, 'planted.ts')).toEqual([]);
    });

    it('counting all four audit helpers, not just one', () => {
        // An earlier version of this scan knew only createAdminAuditLog and
        // reported bulkDeleteUsersAction and createImpersonationTokenAction as
        // unrecorded. Both write a row through logAuditAction.
        const bulk = strip(source('src/app/actions/bulk-user-operations.ts'));

        expect(bulk).toContain('logAuditAction(');
        expect(unauditedAdminWrites().some((k) => k.includes('bulk-user-operations'))).toBe(false);
    });
});

describe('the money paths now say who did it', () => {
    const CASES: [string, string, string][] = [
        ['src/app/api/admin/cooperative/approve-loan/route.ts', 'loan_approved', 'loan_application'],
        ['src/app/api/admin/cooperative/reject-loan/route.ts', 'loan_rejected', 'loan_application'],
        ['src/app/api/admin/cooperative/create-loan-product/route.ts', 'loan_product_created', 'loan_product'],
        ['src/app/api/admin/cooperative/update-loan-product/route.ts', 'loan_product_updated', 'loan_product'],
        ['src/app/api/admin/cooperative/delete-loan-product/route.ts', 'loan_product_deleted', 'loan_product'],
        ['src/app/api/admin/cooperative/mark-withdrawal-completed/route.ts', 'withdrawal_made', 'cooperative_withdrawal'],
        ['src/app/actions/farm-nation-admin/_fna_finance.ts', 'escrow_released', 'farm_nation_transaction'],
    ];

    it.each(CASES)('%s records %s', (rel, action, targetType) => {
        const src = strip(source(rel));

        expect(src).toContain('recordAdminAction({');
        expect(src).toContain(`action: "${action}",`);
        expect(src).toContain(`targetType: "${targetType}",`);
    });

    it('the wallet payout records both decisions', () => {
        // One record, both branches: approving and rejecting are each a decision
        // an admin made about somebody's money.
        const wallet = strip(source('src/app/actions/wallet.ts'));

        expect(wallet).toContain('action: action === "approve" ? "withdrawal_approved" : "withdrawal_rejected",');
        expect(wallet).toContain('targetType: "wallet_withdrawal",');
    });

    it('and the land lifecycle records all three', () => {
        const land = strip(source('src/app/actions/land-listings.ts'));

        for (const action of ['land_verified', 'land_rejected', 'land_deleted']) {
            expect(land).toContain(`action: "${action}",`);
        }
    });

    it('each naming an action the audit vocabulary already declared', () => {
        // Vacuity guard, and the heart of the finding: none of these names are
        // invented here. The union was written for these operations.
        const auditLog = source('src/lib/audit-log.ts');
        const union = auditLog.slice(auditLog.indexOf('export type AuditAction'), auditLog.indexOf('export interface AuditLogEntry'));

        for (const action of [
            'loan_approved', 'loan_rejected',
            'loan_product_created', 'loan_product_updated', 'loan_product_deleted',
            'withdrawal_made', 'withdrawal_approved', 'withdrawal_rejected',
            'escrow_released',
            'land_verified', 'land_rejected', 'land_deleted',
        ]) {
            expect(union).toContain(`'${action}'`);
        }
    });
});

describe('recording must not be able to break the thing it records', () => {
    const auditLog = source('src/lib/audit-log.ts');

    it('recordAdminAction swallows a failure and shouts about it', () => {
        // THE reason a second helper exists. Assert the BEHAVIOUR, not the
        // comment: mutation testing showed that pinning the message alone let a
        // `throw error;` be added back to the catch block undetected.
        expect(auditLog).toContain('export async function recordAdminAction(');

        const body = auditLog.slice(
            auditLog.indexOf('export async function recordAdminAction('),
            auditLog.indexOf('// Backward compatibility exports'),
        );

        expect(body).toContain('THE OPERATION ITSELF SUCCEEDED and is not recorded.');
        expect(body).not.toMatch(/\bthrow\b/);
        expect(body).toContain('} catch (error) {');
    });

    it('while createAuditLog, which every older call site uses, rethrows', () => {
        // Vacuity guard: if createAuditLog were already safe, recordAdminAction
        // would be pointless indirection.
        const create = auditLog.slice(
            auditLog.indexOf('export async function createAuditLog'),
            auditLog.indexOf('export async function getAuditLogs'),
        );

        expect(create).toContain('throw error;');
    });

    it('and every new call site uses the safe one', () => {
        // The money paths are exactly where a rethrow would do damage.
        for (const rel of [
            'src/app/actions/wallet.ts',
            'src/app/actions/land-listings.ts',
            'src/app/actions/farm-nation-admin/_fna_finance.ts',
            'src/app/api/admin/cooperative/approve-loan/route.ts',
            'src/app/api/admin/cooperative/mark-withdrawal-completed/route.ts',
        ]) {
            expect(source(rel)).toContain('import { recordAdminAction } from "@/lib/audit-log";');
        }
    });
});
