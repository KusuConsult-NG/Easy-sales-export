/**
 *   #616 AN ADMINISTRATOR COULD TELL A BUYER THEY HAD BEEN REFUNDED WHILE NO
 *        MONEY MOVED.
 *
 *   Both export stock-reservation paths mark an order `paymentStatus:
 *   "paid_awaiting_refund"`, `status: "cancelled_out_of_stock"` when the
 *   reservation fails after the payment is already claimed. The buyer paid and
 *   got nothing, and the row says so.
 *
 *   cron/reconcile-fulfilment finds every one of them and reports the total. It
 *   is explicit about stopping there — "moving money back out belongs behind a
 *   human" — which is the right call.
 *
 *   BEHIND A HUMAN, AND BEHIND NOTHING ELSE. There was no action that issued the
 *   refund. The only thing an administrator could do was call
 *   `updateAdminExportOrderStatusAction(orderId, "refunded")`, which:
 *
 *     wrote the word "refunded" onto the order,
 *     NOTIFIED THE BUYER — "Export order refunded",
 *     moved no money at all,
 *     and left `paymentStatus: "paid_awaiting_refund"` exactly where it was.
 *
 *   Three things then disagreed at once: the order said refunded, the payment
 *   status said the money was still owed, and the buyer had been told they had
 *   it back. Of those, telling the buyer is the one that cannot be taken back —
 *   and the reconciler would keep reporting the debt for ever, correctly, while
 *   the customer believed it settled.
 *
 * ── SO ONE DOOR CLOSES AND ANOTHER OPENS ────────────────────────────────────
 *
 *   The action that cannot refund now REFUSES to say it did, and names the one
 *   that can. The new one credits the buyer through `creditWalletOnce` — the
 *   same mechanism `_refundEscrowToBuyer` already uses, with `status: "refund"`
 *   so platform_revenue_totals() does not count money going back to a buyer as
 *   income — and only then moves the status.
 *
 *   That ordering is deliberate. A crash between them leaves the order still
 *   marked as owing, which the reconciler reports and this action is idempotent
 *   against. The other order would mark the debt settled before settling it,
 *   which is the defect this commit is about, rebuilt.
 *
 * ── WHAT IT REFUSES ─────────────────────────────────────────────────────────
 *
 *   An order that is not awaiting a refund, so this is not a general "pay this
 *   buyer" button. An order with no readable amount, rather than crediting NaN
 *   or guessing at zero — #606's rule, on money going out. And `finance:refund`
 *   rather than "is some kind of admin", because returning money is the
 *   permission this is named for.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function bodyOf(src: string, fn: string): string {
    const start = src.indexOf(`async function ${fn}`);
    if (start === -1) throw new Error(`no ${fn}`);
    const after = src.slice(start + 10);
    const next = after.search(/\n(export )?async function /);
    return src.slice(start, next === -1 ? undefined : start + 10 + next);
}

const exportAdmin = () => read('src/app/actions/export-admin.ts');

describe('#616 — the action that cannot refund no longer says it did', () => {
    it('"refunded" IS NOT AN ALLOWED STATUS ON THE LABEL-ONLY ACTION', () => {
        const body = bodyOf(exportAdmin(), 'updateAdminExportOrderStatusAction');
        expect(body).toMatch(/const ALLOWED_ORDER_STATUSES = \[[\s\S]*?\];/);
        const list = /const ALLOWED_ORDER_STATUSES = \[([\s\S]*?)\];/.exec(body)![1];
        expect(list).not.toContain('refunded');
        //   And the ones it legitimately writes are still there, or this would be
        //   a fix that broke every other status change.
        for (const kept of ['pending_payment', 'processing', 'shipped', 'delivered',
            'completed', 'cancelled', 'cancelled_out_of_stock']) {
            expect(list).toContain(kept);
        }
    });

    it('AND IT REFUSES THE WORD WITH A REASON, RATHER THAN A GENERIC "UNKNOWN STATUS"', () => {
        //   An admin who tries this is doing something reasonable — the order IS
        //   owed a refund. Telling them "unknown status" would be true and
        //   useless; they need to know where the refund actually happens.
        const body = bodyOf(exportAdmin(), 'updateAdminExportOrderStatusAction');
        expect(body).toMatch(/if \(status === "refunded"\)/);
        expect(body).toContain('it only records a status');
        expect(body).toContain("returns the money to the buyer's wallet");
    });
});

describe('#616 — and the action that can refund does it for real', () => {
    const body = () => bodyOf(exportAdmin(), '_refundExportOrderToWalletAction');

    it('MOVES MONEY THROUGH THE SAME MECHANISM THE ESCROW REFUND USES', () => {
        expect(body()).toContain('creditWalletOnce(');
        //   Idempotent by reference, so a second attempt credits nothing.
        expect(body()).toContain('`export-refund:${orderId}`');
    });

    it('AND RECORDS IT AS A REFUND, NOT AS INCOME', () => {
        //   platform_revenue_totals() sums rows whose status is "completed".
        //   Money going back to a buyer counted as revenue would overstate every
        //   figure the platform reports about itself.
        expect(body()).toMatch(/status: "refund"/);
    });

    it('AND MOVES THE STATUS ONLY AFTER THE MONEY', () => {
        const b = body();
        expect(b.indexOf('creditWalletOnce(')).toBeLessThan(b.indexOf('paymentStatus: "refunded"'));
        //   updateExisting, so a row deleted in between is not counted as done.
        expect(b).toContain('updateExisting(');
    });

    it('AND REFUSES AN ORDER THAT IS NOT AWAITING ONE', () => {
        //   What stops this being a general "pay this buyer" button.
        expect(body()).toMatch(/order\.paymentStatus !== "paid_awaiting_refund"/);
        expect(body()).toContain('already been refunded');
    });

    it('AND REFUSES AN AMOUNT THAT IS NOT A NUMBER', () => {
        //   #606, on money going OUT. `amount <= 0` would let NaN through and
        //   credit NaN into a wallet balance, which is unrecoverable.
        expect(body()).toContain('isPositiveAmount(amount)');
        expect(body()).toContain('no readable amount to refund');
    });

    it('AND ASKS FOR THE SAME AUTHORITY THE ESCROW REFUND ASKS FOR', () => {
        /*
         *   #616 ASKED `finance:resolve_disputes` HERE AND SAID WHY: the
         *   obvious choice, `finance:refund`, was granted to super_admin alone
         *   and gated nothing anywhere, so using it would have locked every
         *   ordinary administrator out of the only door that returns this money.
         *   Matching _refundEscrowToBuyer mattered more — two refunds requiring
         *   different authorities is the "which answer you get depends on which
         *   screen" defect this audit keeps finding.
         *
         *   #623 FIXED THE DECLARATION INSTEAD OF WORKING AROUND IT. admin holds
         *   `finance:refund` now and BOTH refund doors ask for it, so the pairing
         *   this test exists to protect is intact and the permission is the one
         *   named for the act. Same two roles pass as passed before.
         */
        expect(body()).toContain('"finance:refund"');
        expect(body()).not.toContain('isAdmin(session.user.roles)');

        const escrow = read('src/app/actions/marketplace/_escrow_actions.ts');
        expect(escrow).toContain('"finance:refund"');

        //   And the pairing is asserted behaviourally, not only as two strings:
        //   whoever can refund one way can refund the other.
        const { hasAdminPermission } = require('@/lib/admin-permissions');
        for (const role of ['admin', 'super_admin']) {
            expect(hasAdminPermission([role], 'finance:refund')).toBe(true);
        }
        for (const role of ['moderator', 'support', 'export_admin', 'marketplace_admin']) {
            expect(hasAdminPermission([role], 'finance:refund')).toBe(false);
        }
    });

    it('AND A FAILED NOTIFICATION DOES NOT UNDO A COMPLETED REFUND', () => {
        //   The money moved. Reporting failure here would invite a retry, and
        //   only the idempotency reference would stand between that and a second
        //   credit — which is too much weight for one line to carry.
        expect(body()).toMatch(/catch \(notifyError\)[\s\S]*?logger\.error/);
    });
});

describe('#616 — the audit trail says what actually happened', () => {
    it('IT IS ITS OWN ACTION, NOT ESCROW\'S BORROWED', () => {
        //   #612: an audit entry recording the wrong operation is worse than
        //   none, because it is believed. These two are refunded by different
        //   mechanisms for different reasons.
        const audit = read('src/lib/audit-log.ts');
        expect(audit).toContain("| 'export_order_refunded'");
        expect(bodyOf(exportAdmin(), '_refundExportOrderToWalletAction'))
            .toContain('action: "export_order_refunded"');
    });

    it('AND IT IS CRITICAL, LIKE EVERY OTHER WAY MONEY LEAVES', () => {
        const audit = read('src/lib/audit-log.ts');
        const critical = /const criticalActions: AuditAction\[\] = \[([\s\S]*?)\];/.exec(audit)![1];
        expect(critical).toContain('export_order_refunded');
        expect(critical).toContain('escrow_refunded');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     put "refunded" back on the label-only whitelist                 KILLED
 *     delete the refusal that explains where refunds happen           KILLED
 *     credit with status "completed" (counted as revenue)             KILLED
 *     move the status BEFORE the money                                KILLED
 *     refund an order that is not awaiting one                        KILLED
 *     `isPositiveAmount(amount)` → `amount < 0` (NaN passes)          KILLED
 *     borrow escrow_refunded for the audit entry                      KILLED
 *     drop export_order_refunded from the critical list               KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 *   No mutant survived. The ordering one is the load-bearing case: marking the
 *   debt settled before settling it is precisely the defect this commit is
 *   about, and a fix that reintroduced it while looking correct is the most
 *   likely way this would regress.
 */
