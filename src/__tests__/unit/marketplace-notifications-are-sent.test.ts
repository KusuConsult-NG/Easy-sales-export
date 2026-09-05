/**
 * @jest-environment node
 */

/**
 *   #391 FOUR NOTIFICATION HELPERS WERE WRITTEN, EXPORTED, AND NEVER CALLED.
 *
 *        lib/marketplace-notifications.ts defines eight helpers for the events
 *        a buyer, a seller or an admin should hear about. Counting callers
 *        across all of src/, four had none:
 *
 *          notifyOrderShipped     GAP — wired
 *          notifyOrderDelivered   GAP — wired
 *          notifyBadgeUpdated     GAP — wired
 *          notifyEscrowReleased   NOT a gap — see below
 *
 *   WHAT THE THREE GAPS COST
 *   ------------------------
 *   SHIPPED. updateOrderStatusAction is the only door that sets it, and it
 *   sent nothing at all — no in-app notification, no SMS, no push. A buyer's
 *   order shipped, the logistics provider minted a tracking number for it
 *   three lines earlier in the same function, and the buyer was told neither.
 *
 *   DELIVERED. Reaching that status starts the clock on the seller's payout
 *   (#389, #390), and the buyer's window to dispute runs against it. Neither
 *   party was told it had started. Both halves of the transition were silent:
 *   the buyer's own confirmOrderReceiptAction and the admin path.
 *
 *   BADGE. What toggleVerifiedBadgeAction actually did was send an EMAIL, on
 *   GRANT only, and only when RESEND_API_KEY is set and the verification row
 *   happens to carry an address — then report "Verified Badge granted and
 *   seller notified" whether or not anything had been sent. A REVOKED badge
 *   told the seller nothing on any channel, while their listings lost the mark
 *   buyers judge them by. The in-app notification needs no mail provider.
 *
 *   THE FOURTH IS NOT A GAP, AND SAYING SO IS THE POINT
 *   ---------------------------------------------------
 *   notifyEscrowReleased has no caller because the event is already announced
 *   twice by both live release paths — releaseEscrowFunds writes to both
 *   parties and follows with SMS and push, and the cron does the same. Wiring
 *   it would put two rows in each notification centre for one event. "No
 *   caller" is a question, not a finding, and this audit has twice reversed
 *   itself (#370→#377, #384→#386) by answering it too fast.
 *
 *   AND FOUR DISCARDED ADMIN QUERIES
 *   --------------------------------
 *   Four helpers opened with `const adminIds = await _getAdminUserIds()` whose
 *   only consumer is a _fanOut that is commented out. Each call ran two
 *   array-contains queries over the whole users collection and threw the
 *   answer away — on notifyOrderPlaced, that is per order placed.
 *
 *   WHAT THIS RATCHET DOES
 *   ----------------------
 *   It counts callers, the way the sweep did, and fails when an exported
 *   notification helper has none — unless it is named in DELIBERATELY_UNUSED
 *   with a reason. That list is the honest part: the alternative is a test
 *   that quietly permits any dead helper, or one that forbids the correct
 *   case above.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const HELPERS = join(SRC, 'lib', 'marketplace-notifications.ts');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

const FILES = walk(SRC);
const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

/** Every `export async function notifyX` in the helpers module. */
const EXPORTED = [...code(HELPERS).matchAll(/export\s+async\s+function\s+(notify\w+)/g)]
    .map((m) => m[1]);

/**
 * Helpers that are SUPPOSED to have no caller, and why.
 *
 * An entry here is a claim about the codebase, not a suppression: the reason
 * has to hold, and the test below checks the event really is announced some
 * other way rather than taking the sentence on trust.
 */
const DELIBERATELY_UNUSED: Record<string, string> = {
    notifyEscrowReleased:
        'both live release paths already notify inline — releaseEscrowFunds '
        + '(in-app + SMS + push) and the auto-release cron. Calling this too '
        + 'would double-notify.',
};

/** Files that call `name(`, ignoring the module that defines it. */
function callersOf(name: string): string[] {
    const call = new RegExp(`\\b${name}\\s*\\(`);
    return FILES
        .filter((p) => p !== HELPERS && call.test(code(p)))
        .map((p) => relative(ROOT, p));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#391 — the sweep can see', () => {
    it('THERE ARE HELPERS AND FILES TO COUNT CALLERS IN', () => {
        // Eight in this module. (lib/admin-notifications.ts carries a ninth,
        // notifyAdmins, which has two callers and is out of this file's scope.)
        expect(EXPORTED.length).toBeGreaterThanOrEqual(8);
        expect(FILES.length).toBeGreaterThan(500);
    });

    it('and a helper with callers is distinguishable from one without', () => {
        // The positive control: this one has always been wired, from the order
        // creation path. If callersOf returns nothing for it the counter is
        // broken and every assertion below is vacuous.
        expect(callersOf('notifyOrderPlaced').length).toBeGreaterThan(0);
        expect(callersOf('notifyThisDoesNotExist')).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#391 — every notification helper is either called or explained', () => {
    it('NO MARKETPLACE NOTIFICATION IS BUILT AND NEVER SENT', () => {
        const orphans = EXPORTED
            .filter((name) => !(name in DELIBERATELY_UNUSED))
            .filter((name) => callersOf(name).length === 0);

        expect(orphans).toEqual([]);
    });

    it('and the three that were wired are called from the paths that cause them', () => {
        expect(callersOf('notifyOrderShipped')).toContain('src/app/actions/order-management.ts');
        // Delivered has TWO halves and both were silent. A fix that reached one
        // of a pair is the shape this audit keeps finding.
        expect(callersOf('notifyOrderDelivered')).toEqual(
            expect.arrayContaining([
                'src/app/actions/order-management.ts',
                'src/app/actions/marketplace/_buyer.ts',
            ]),
        );
        expect(callersOf('notifyBadgeUpdated')).toContain('src/app/actions/admin/_marketplace.ts');
    });

    it('and the one deliberately left unwired really is announced elsewhere', () => {
        // The DELIBERATELY_UNUSED reason, checked rather than believed.
        const escrowActions = code(join(SRC, 'app/actions/marketplace/_escrow_actions.ts'));
        const cron = code(join(SRC, 'app/api/cron/release-escrow/route.ts'));
        expect(escrowActions).toContain('createNotificationAction');
        expect(cron).toContain('createNotificationAction');
        expect(callersOf('notifyEscrowReleased')).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#391 — no helper pays for a query it discards', () => {
    it('EVERY _getAdminUserIds CALL HAS A CONSUMER', () => {
        const src = code(HELPERS);
        // Four helpers opened with this and the only reader was a commented-out
        // fan-out. Counted on the stripped source, so the commented blocks and
        // the notes explaining them cannot satisfy it.
        const fetches = [...src.matchAll(/_getAdminUserIds\s*\(\s*\)/g)].length;
        const fanOuts = [...src.matchAll(/_fanOut\s*\(/g)].length;

        // One occurrence is the function's own definition. Any further call
        // must be matched by a live _fanOut that consumes it.
        expect(fetches - 1).toBeLessThanOrEqual(fanOuts - 1);
    });
});
