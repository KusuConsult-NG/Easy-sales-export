/**
 * @jest-environment node
 */

/**
 * The sweep that asks a different question, and what it found.
 *
 * The other three scanners each ask one thing of one function: is there a guard,
 * is ownership decided, is the guard real. This asks whether an endpoint differs
 * from its SIBLINGS in the same business module — which is a question no
 * per-function rule can pose.
 *
 * That framing has now found two things a directory-shaped pass missed:
 *
 *   autoEnrollPaidUser        sat in the unguarded baseline among catalogue
 *                             reads and read like one of them. Beside
 *                             getCoursesAction under "academy", "auto-enrol"
 *                             stopped looking like a query. (Earlier pass.)
 *
 *   _syncShipmentWithCarrier  every other WAVE endpoint requires a session.
 *                             This one took an id and required nothing — while
 *                             calling the logistics provider on each invocation
 *                             and writing the result onto the shipment.
 *
 * WHAT THE FIRST RUN GOT WRONG
 * ----------------------------
 * It reported 326 of 721 entry points, and the first things it named were
 * correct code. Two corrections, both encoded in the scanner:
 *
 *   Delegating wrappers. `export async function foo(...args) { return
 *   withFlexibleSafeAction("foo", _foo)(...args) }` holds no guard itself. Three
 *   wave/_admin functions were reported unguarded on that basis; all three were
 *   wrappers around guarded implementations.
 *
 *   Guards behind a helper. my-data.ts routes everything through a one-line
 *   currentUserId() calling requireSession, so all sixteen of its functions
 *   looked unguarded — including deleteMyNotification, which is careful:
 *   session, ownership check, and "not found" rather than "unauthorized" on a
 *   cross-user id.
 *
 * After both, 71 of 649. A sweep that names correct code teaches people to
 * ignore it.
 *
 * TRIAGE OF THE REMAINING LEADS
 * -----------------------------
 * Read module by module. What was NOT a defect, and why, because that reasoning
 * is the expensive part:
 *
 *   confirmWalletFundingAction   money, no session — and correct. The Paystack
 *                                reference IS the credential, the amount and the
 *                                user come from Paystack rather than the caller,
 *                                the charged amount is checked against the
 *                                metadata, and creditWalletOnce makes replay a
 *                                no-op that credits the rightful owner.
 *
 *   _recalculateProductRating    not exported. An internal helper.
 *
 *   auth / password-reset        pre-auth flows. A login that required a session
 *                                would be a strange thing.
 *
 *   _submitLandInquiryAction     public by design and documented in the auth
 *                                baseline; it no longer trusts the caller for
 *                                the listing owner.
 *
 *   cooperative money endpoints  flagged as MONEY without a role check, which is
 *                                right: a member making their own contribution
 *                                is controlled by ownership, not by a role.
 *
 * This file pins the scanner's behaviour, not the live count. The count moves
 * with every commit, and a test that asserts it would be noise — the same
 * reasoning ownership-scan.test.ts gives for not gating CI on its leads.
 */

import { describe, it, expect } from '@jest/globals';
import { sweepByModule, isLead } from '@/lib/testing/module-sweep';

describe('the sweep produces a usable module map', () => {
    const groups = sweepByModule();

    it('finds entry points across many modules (sanity)', () => {
        // Without this the assertions below can pass against an empty sweep —
        // the vacuity failure every scanner in this suite has hit at least once.
        expect(groups.length).toBeGreaterThanOrEqual(8);
        expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBeGreaterThan(300);
    });

    it('separates the business modules it claims to', () => {
        const names = groups.map((g) => g.module);

        for (const expected of ['wave', 'cooperative', 'marketplace', 'academy', 'money', 'identity']) {
            expect(names).toContain(expected);
        }
    });

    it('leaves most entry points unflagged', () => {
        // The point of the two corrections. If the lead rate climbs back toward
        // half the codebase the sweep is noise again, whatever it is finding.
        const all = groups.flatMap((g) => g.entries);
        const leads = all.filter(isLead);

        expect(leads.length / all.length).toBeLessThan(0.25);
    });
});

describe('the corrections that stopped it reporting correct code', () => {
    const entries = sweepByModule().flatMap((g) => g.entries);
    const byName = (name: string) => entries.find((e) => e.name === name);

    it('does not report a delegating wrapper as unguarded', () => {
        // wave/_admin.ts exports these as thin wrappers around guarded
        // implementations. The first run named all three.
        for (const name of ['updateTrainingEventAction', 'startWaveLiveSessionAction', 'endWaveLiveSessionAction']) {
            const entry = byName(name);
            // Either skipped as a wrapper, or present and not flagged unguarded.
            expect(entry?.flags ?? []).not.toContain('NO-SESSION');
        }
    });

    it('sees a guard reached through a local helper', () => {
        // my-data.ts calls requireSession inside currentUserId(). All sixteen of
        // its functions were reported unguarded before this.
        const entry = byName('deleteMyNotification');

        expect(entry).toBeDefined();
        expect(entry!.guarded).toBe(true);
        expect(entry!.flags).not.toContain('NO-SESSION');
    });

    it('does not treat a webhook as unguarded for having no session', () => {
        // Callbacks authenticate by signature. Flagged as their own category so
        // they do not drown the list.
        const webhookEntries = entries.filter((e) => e.file.includes('/api/webhooks/'));

        expect(webhookEntries.length).toBeGreaterThan(0);
        for (const e of webhookEntries) {
            expect(e.flags).not.toContain('NO-SESSION');
        }
    });
});

describe('what the sweep found, now closed', () => {
    const entries = sweepByModule().flatMap((g) => g.entries);

    it('the WAVE shipment sync now requires a session', () => {
        // THE find. Every other WAVE endpoint required one; this took an id and
        // required nothing, while calling the carrier API and writing the
        // result.
        const entry = entries.find((e) => e.name === '_syncShipmentWithCarrierAction');

        expect(entry).toBeDefined();
        expect(entry!.guarded).toBe(true);
        expect(entry!.flags).not.toContain('NO-SESSION');
    });

    it('no WAVE endpoint writes without a session', () => {
        // The property that made the outlier visible, asserted so it holds.
        const wave = sweepByModule().find((g) => g.module === 'wave')!;
        const unguardedWriters = wave.entries
            .filter((e) => e.writes && e.flags.includes('NO-SESSION'))
            .map((e) => `${e.file}::${e.name}`);

        expect(unguardedWriters).toEqual([]);
    });
});
