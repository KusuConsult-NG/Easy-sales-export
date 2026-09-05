/**
 * @jest-environment node
 */

/**
 *   #388 THE INVERSE OF #387: A CONTROL THAT RUNS AND PERSISTS NOTHING.
 *
 *        #387 swept for a screen RENDERING a field nothing writes. This is the
 *        same defect from the other end — a screen OFFERING an operation
 *        nothing performs. The audit has met it five times:
 *
 *          #105  the Farm Nation heart: useState, lost on navigation.
 *          #211  "Create Course" had never created a course.
 *          #322  two admin gender buttons that said nothing when refused.
 *          #337  the recovery button did not perform the recovery.
 *          #362  four admin controls that rendered, hovered and did nothing.
 *
 *        Each was found by hand. The sweep that produced this file ran two
 *        detectors over all 439 .tsx files:
 *
 *          A. a handler that reports SUCCESS but reaches no persistence — no
 *             fetch, no server action, no storage, no navigation, following
 *             local calls and imports across files and through the barrels;
 *          B. a <button> whose LABEL is a write verb and which has no handler
 *             at all.
 *
 *        A found three candidates and all three were honest local work: the
 *        SMS composer's GSM-7 auto-fix (it rewrites the message), the wallet
 *        receipt's PDF and JPEG downloads (they save a file), and checkout's
 *        "use my saved address" (it fills the form). Recorded because a sweep
 *        that reports "nothing" is indistinguishable from a sweep that cannot
 *        see, and those three are the proof it could.
 *
 *        B found three real ones, in two screens.
 *
 *   WHAT B FOUND
 *   ------------
 *   marketplace/seller/orders  a shipped order's card offered "Update
 *                              Tracking" and "Mark as Delivered". Neither had
 *                              an onClick, a type, or a form around it. The
 *                              SAME CARD's other status branch links through
 *                              to the order page correctly, so the pattern was
 *                              there to copy and had not been. Updating
 *                              tracking is real and lives on that page, so the
 *                              pair became one link to it.
 *
 *                              "Mark as Delivered" was deliberately not built:
 *                              see #389 below, and the note in the page.
 *
 *   export/windows/[id]        "Save for Later", beside a working "Invest
 *                              Now". Removed rather than wired — the reason is
 *                              in the page, and it is that nothing behind it
 *                              exists, unlike #105 where the store, the toggle
 *                              and the counter were all already there.
 *
 *   #389 SECURITY, WHICH FELL OUT OF TRIAGING B
 *   -------------------------------------------
 *   Before rebuilding "Mark as Delivered" the rule was to check where the live
 *   path puts that transition. It turned out the answer forbade building it:
 *   moving an order to "delivered" writes "delivered" onto its escrow rows,
 *   and api/cron/release-escrow pays the seller 24 hours after an escrow row
 *   reaches that status. The buyer is the one who confirms delivery
 *   (confirmOrderReceiptAction, gated on buyerId). updateOrderStatusAction
 *   accepted "delivered" from the seller as well — so a seller could start the
 *   clock on their own payout. Fixed in lib/order-status-authority.ts.
 *
 *   That is the #384 lesson applied forward: "which door is more featureful"
 *   is not the same question as "which door is allowed to run".
 *
 *   WHAT THIS RATCHET CAN AND CANNOT SEE
 *   ------------------------------------
 *   It implements detector B, which is text-shaped and therefore honest about
 *   its own limits: it sees a button with no handler. It does NOT see a button
 *   whose handler exists and does nothing useful — detector A's territory,
 *   which needs a cross-file call graph and is run as a sweep rather than
 *   pinned here, because a graph walk that goes subtly wrong reports code as
 *   broken when it merely could not follow it. That failure mode cost this
 *   audit three wrong answers in #387 and is not worth a standing test.
 *
 *   MUTATION-TESTED, WITH A CONTROL
 *   -------------------------------
 *   Against a green baseline, three mutants that should die and one that
 *   should not:
 *
 *     grant "delivered" back to every caller          KILLED
 *     put an inert write-labelled button back         KILLED
 *     make the refusal stop naming the buyer's door   KILLED
 *     reword the refusal, keeping both its facts      SURVIVED, as intended
 *
 *   The last is the control. Without one, a suite that fails on any edit at
 *   all is indistinguishable from a suite that tests behaviour.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    SELLER_SETTABLE_ORDER_STATUSES,
    ADMIN_ONLY_ORDER_STATUSES,
    SETTABLE_ORDER_STATUSES,
    canSetOrderStatus,
    orderStatusRefusal,
} from '@/lib/order-status-authority';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            walk(full, out);
        } else if (entry.endsWith('.tsx')) {
            out.push(full);
        }
    }
    return out;
}

const SCREENS = walk(SRC);

/**
 * A label that names a write.
 *
 * Only the FIRST word counts. "Cancel" as the dismiss half of a modal pair is
 * everywhere and is not a write, so it is absent; "Delete"/"Remove" are here
 * because in this product they are operations, not dismissals.
 */
const WRITE_VERB = /^(save|submit|create|update|remove|delete|send|approve|reject|confirm|pay|withdraw|apply|enrol|enroll|publish|upload|verify|activate|deactivate|suspend|disburse|record|issue|assign|revoke|grant|renew|transfer|refund|release|book|register|request|resend|process|mark)\b/i;

/** The end of a JSX opening tag, skipping over any {…} expression inside it. */
function openingTagEnd(src: string, from: number): number {
    let depth = 0;
    for (let i = from; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        else if (ch === '>' && depth === 0) return i;
    }
    return src.length - 1;
}

interface InertControl { file: string; line: number; label: string }

/**
 * Buttons that name a write and carry no way to perform one.
 *
 * A button is EXCUSED when any of these is true, and each exclusion is a real
 * shape in this codebase rather than a concession to make the number zero:
 *
 *   onClick={…}       it has a handler; whether the handler does anything is
 *                     detector A's question, not this one
 *   type="submit"     the enclosing <form onSubmit={…}> is the handler — 10 of
 *                     the 13 "no handler" hits in the original sweep were this
 *   disabled          a control that is off is not a control that lies; the
 *                     cooperative loan approve button is deliberately disabled
 *                     until a guarantor is verified, and says so in its title
 */
function inertWriteControls(path: string): InertControl[] {
    const src = stripComments(readFileSync(path, 'utf-8'), { label: relative(ROOT, path) });
    const found: InertControl[] = [];

    for (const m of src.matchAll(/<button\b/g)) {
        const tagEnd = openingTagEnd(src, m.index! + 7);
        const tag = src.slice(m.index!, tagEnd + 1);
        if (/\bonClick\s*=/.test(tag)) continue;
        if (/\btype\s*=\s*["']submit["']/.test(tag)) continue;
        if (/\bdisabled\b/.test(tag)) continue;

        const close = src.indexOf('</button>', tagEnd);
        if (close === -1) continue;
        const label = src
            .slice(tagEnd + 1, close)
            .replace(/<[^>]*>/g, ' ')       // nested icons and spans
            .replace(/\{[^{}]*\}/g, ' ')    // interpolations
            .replace(/\s+/g, ' ')
            .trim();

        if (!WRITE_VERB.test(label)) continue;
        found.push({
            file: relative(ROOT, path),
            line: src.slice(0, m.index!).split('\n').length,
            label,
        });
    }
    return found;
}

/** The detector, run against a snippet rather than a file on disk. */
function inertInSnippet(source: string): InertControl[] {
    const src = stripComments(source, { label: 'snippet' });
    const found: InertControl[] = [];
    for (const m of src.matchAll(/<button\b/g)) {
        const tagEnd = openingTagEnd(src, m.index! + 7);
        const tag = src.slice(m.index!, tagEnd + 1);
        if (/\bonClick\s*=/.test(tag)) continue;
        if (/\btype\s*=\s*["']submit["']/.test(tag)) continue;
        if (/\bdisabled\b/.test(tag)) continue;
        const close = src.indexOf('</button>', tagEnd);
        if (close === -1) continue;
        const label = src.slice(tagEnd + 1, close)
            .replace(/<[^>]*>/g, ' ').replace(/\{[^{}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
        if (!WRITE_VERB.test(label)) continue;
        found.push({ file: 'snippet', line: 0, label });
    }
    return found;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#388 — the detector works before it is trusted', () => {
    it('THERE ARE SCREENS TO SCAN', () => {
        // The finding below is an empty list, which is also what a scan of
        // nothing produces.
        expect(SCREENS.length).toBeGreaterThan(300);
    });

    it('CONTROL: it catches a write-labelled button with no handler', () => {
        const hits = inertInSnippet(`<button className="x">Mark as Delivered</button>`);
        expect(hits.map((h) => h.label)).toEqual(['Mark as Delivered']);
    });

    it('CONTROL: it catches one wrapped around an icon, the way this codebase writes them', () => {
        const hits = inertInSnippet(
            `<button className="x"><Save className="w-4 h-4" /> Save Changes</button>`,
        );
        expect(hits).toHaveLength(1);
        expect(hits[0].label).toContain('Save Changes');
    });

    it('and it excuses a handler, a submit button, and a disabled one', () => {
        expect(inertInSnippet(`<button onClick={go}>Save</button>`)).toEqual([]);
        expect(inertInSnippet(`<button type="submit">Publish</button>`)).toEqual([]);
        expect(inertInSnippet(`<button disabled title="verify first">Approve Loan</button>`)).toEqual([]);
    });

    it('and a label that is not a write verb is not its business', () => {
        expect(inertInSnippet(`<button className="x">View Details</button>`)).toEqual([]);
        expect(inertInSnippet(`<button className="x">Cancel</button>`)).toEqual([]);
    });

    it('and a comment quoting a dead button does not count as one', () => {
        // The tombstone trap: the two screens repaired under #388 both explain
        // in a comment what used to stand there, naming the old captions. A
        // detector reading raw text would rediscover its own write-up.
        const hits = inertInSnippet(
            `{/* A button captioned "Mark as Delivered" stood here and did nothing. */}\n<div />`,
        );
        expect(hits).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#388 — no screen offers a write it cannot perform', () => {
    it('EVERY WRITE-LABELLED BUTTON HAS A HANDLER, A FORM, OR IS DISABLED', () => {
        const inert = SCREENS.flatMap(inertWriteControls);
        expect(inert).toEqual([]);
    });

    it('and the seller order list sends a shipped order to the page that can change it', () => {
        const page = stripComments(
            readFileSync(join(SRC, 'app/marketplace/seller/orders/page.tsx'), 'utf-8'),
            { label: 'seller orders list' },
        );
        // The card links through rather than pretending to act. Asserted on the
        // href because the caption is copy and may be reworded.
        const links = [...page.matchAll(/href=\{`\/marketplace\/seller\/orders\/\$\{order\.id\}`\}/g)];
        expect(links.length).toBeGreaterThanOrEqual(2);
    });

    it('and it does NOT offer the seller a delivery confirmation', () => {
        const page = stripComments(
            readFileSync(join(SRC, 'app/marketplace/seller/orders/page.tsx'), 'utf-8'),
            { label: 'seller orders list' },
        );
        const detail = stripComments(
            readFileSync(join(SRC, 'app/marketplace/seller/orders/[id]/page.tsx'), 'utf-8'),
            { label: 'seller order detail' },
        );
        // Neither seller screen may SET "delivered" — that is the buyer's, per
        // #389. Reading it is fine and both screens do: the detail page has a
        // badge for a delivered order and a completion panel that renders on
        // it. So this is anchored on the two ways a screen could ask for the
        // transition, not on the word appearing.
        for (const src of [page, detail]) {
            expect(/handleStatusUpdate\s*\(\s*["']delivered["']/.test(src)).toBe(false);
            expect(/updateOrderStatusAction\s*\([^)]*["']delivered["']/.test(src)).toBe(false);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#389 — "delivered" starts a payout, so a seller may not set it', () => {
    it('THE SELLER MAY NOT SET IT AND AN ADMIN MAY', () => {
        expect(canSetOrderStatus('delivered', { isAdmin: false })).toBe(false);
        expect(canSetOrderStatus('delivered', { isAdmin: true })).toBe(true);
    });

    it('and the seller keeps every fulfilment state that is genuinely theirs', () => {
        for (const status of SELLER_SETTABLE_ORDER_STATUSES) {
            expect(canSetOrderStatus(status, { isAdmin: false })).toBe(true);
            expect(canSetOrderStatus(status, { isAdmin: true })).toBe(true);
        }
        expect([...SELLER_SETTABLE_ORDER_STATUSES]).toEqual(['processing', 'shipped', 'cancelled']);
    });

    it('and nothing else is settable through this door, by anybody', () => {
        for (const status of ['completed', 'disputed', 'refunded', 'payment_received', 'pending_payment', '']) {
            expect(canSetOrderStatus(status, { isAdmin: true })).toBe(false);
            expect(canSetOrderStatus(status, { isAdmin: false })).toBe(false);
        }
        expect([...SETTABLE_ORDER_STATUSES].sort()).toEqual(
            ['cancelled', 'delivered', 'processing', 'shipped'],
        );
        expect([...ADMIN_ONLY_ORDER_STATUSES]).toEqual(['delivered']);
    });

    it('and the refusal tells the seller which door IS open', () => {
        // #322: a refusal that only says "no" reads as a broken button.
        const refusal = orderStatusRefusal('delivered', { isAdmin: false });
        expect(refusal).toMatch(/buyer/i);
        expect(refusal).toMatch(/shipped/i);
        // An admin reaching for something genuinely unsupported gets the plain
        // message, not the seller's explanation.
        expect(orderStatusRefusal('completed', { isAdmin: true })).not.toMatch(/buyer/i);
    });

    it('and the ACTION applies the shared rule instead of restating a list', () => {
        const action = stripComments(
            readFileSync(join(SRC, 'app/actions/order-management.ts'), 'utf-8'),
            { label: 'order-management' },
        );
        expect(action).toContain('canSetOrderStatus(newStatus');
        // The flat four-entry list that granted a seller "delivered" is gone.
        // Matched structurally rather than by quoting the old literal, so the
        // header above cannot satisfy this test on its own.
        const flatList = /allowedStatuses\s*:\s*OrderStatus\[\]\s*=/;
        expect(flatList.test(action)).toBe(false);
    });

    it('and the rule module stays pure, so a suite that mocks the database cannot break it', () => {
        const rule = readFileSync(join(SRC, 'lib/order-status-authority.ts'), 'utf-8');
        // #381's lesson. A value import here would drag the Supabase adapter
        // into every consumer, including the browser.
        const valueImports = [...rule.matchAll(/^import\s+(?!type\b)[^;]+from/gm)];
        expect(valueImports).toEqual([]);
    });
});
