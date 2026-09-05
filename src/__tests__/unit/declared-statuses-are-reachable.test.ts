/**
 * @jest-environment node
 */

/**
 *   #420 A FILTER THAT COULD NEVER MATCH A ROW — AND THE RATCHET FOR THE SHAPE
 *   THAT FOUND #419.
 *
 *   #419 came from noticing that a declared status ("matured") was written by
 *   nothing, and that a member screen had a whole section keyed on it. That is a
 *   CLASS, not an incident, so this file does two things: it fixes the other
 *   live instance, and it makes the class checkable.
 *
 *   #420 ITSELF. Four type unions declare `"closed"` as a dispute status.
 *   Nothing writes it — resolution writes `"resolved"`, in both resolvers, and
 *   there is no other transition. Three screens offered it as a choice:
 *
 *     admin/disputes                    <option value="closed">
 *     admin/marketplace/disputes        <option value="closed">
 *     dashboard/disputes                a member-facing "Closed" TAB
 *
 *   The member-facing one is the one that matters. A buyer or seller with a
 *   settled dispute clicks "Closed", sees nothing, and reads it as "I have no
 *   closed disputes" — when the tab could never show anything and their dispute
 *   is under "Resolved". #307/#408's family reached from the other end: the
 *   FILTER is impossible rather than the read failing.
 *
 *   NOTHING IS DELETED AND NOTHING BECOMES UNREACHABLE. `"closed"` stays in the
 *   vocabulary and stays MATCHED — the settled filter now asks for the set, so a
 *   row stored as closed (legacy, imported, or written by something added later)
 *   is still found. What goes is the separate choice that could only answer
 *   "none". The guards in the resolver that refuse an already-`closed` dispute
 *   stay: a defensive clause is not the same as an impossible filter.
 *
 *   THE RATCHET. The second half of this file walks every declared status union
 *   in src and asserts each member is either written somewhere or listed below
 *   with a reason. That check, had it existed, would have failed on "matured"
 *   before #419 was ever created — a member's savings locked with no release.
 *
 *   THE ALLOWLIST IS THE POINT, NOT AN ESCAPE HATCH. Each entry says why the
 *   value exists unwritten, so adding one is a decision somebody makes on
 *   purpose rather than a scan someone silences.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the settled filter matches "resolved" alone   KILLED
 *     a screen offers the impossible choice again   KILLED
 *     the action filters on one literal again       KILLED
 *     an unwritten status is added to a union       KILLED (the ratchet)
 *     reword the header prose                       SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    DISPUTE_STATUSES,
    DISPUTE_TERMINAL_STATUSES,
    DISPUTE_OPEN_STATUSES,
    isDisputeSettled,
    disputeStatusesForFilter,
} from '@/lib/dispute-status';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === '__tests__' || name === 'node_modules') continue;
            out.push(...walk(full));
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && !/\.d\.ts$/.test(name)) {
            out.push(full);
        }
    }
    return out;
}

const DISPUTE_SCREENS = [
    'src/app/admin/disputes/page.tsx',
    'src/app/admin/marketplace/disputes/page.tsx',
    'src/app/dashboard/disputes/page.tsx',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#420 — the settled filter matches both spellings', () => {
    it('ASKING FOR RESOLVED ASKS FOR THE WHOLE SETTLED SET', () => {
        expect(disputeStatusesForFilter('resolved')).toEqual(['resolved', 'closed']);
    });

    it('and every other choice matches itself', () => {
        expect(disputeStatusesForFilter('open')).toEqual(['open']);
        expect(disputeStatusesForFilter('under_review')).toEqual(['under_review']);
    });

    it('and the vocabulary still contains "closed" — nothing was deleted', () => {
        expect(DISPUTE_STATUSES).toContain('closed');
        expect(DISPUTE_TERMINAL_STATUSES).toEqual(['resolved', 'closed']);
        expect(DISPUTE_OPEN_STATUSES).toEqual(['open', 'under_review']);
        expect(isDisputeSettled('closed')).toBe(true);
        expect(isDisputeSettled('resolved')).toBe(true);
        expect(isDisputeSettled('open')).toBe(false);
        expect(isDisputeSettled(undefined)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#420 — no screen offers a choice that cannot match', () => {
    it('THE IMPOSSIBLE OPTION IS GONE FROM ALL THREE', () => {
        for (const path of DISPUTE_SCREENS) {
            const src = code(path);
            expect({ path, offers: /value="closed"|key: "closed"/.test(src) })
                .toEqual({ path, offers: false });
            // …and each still offers the settled one.
            expect({ path, settled: /value="resolved"|key: "resolved"/.test(src) })
                .toEqual({ path, settled: true });
        }
    });

    it('and the member screen filters through the shared rule, not an equality', () => {
        const src = code('src/app/dashboard/disputes/page.tsx');
        expect(src).toMatch(/disputeStatusesForFilter\(filterStatus\)\.includes\(d\.status\)/);
        expect(src).not.toMatch(/d\.status === filterStatus/);
    });

    it('and the admin query asks for the SET rather than one literal', () => {
        const src = code('src/app/actions/disputes.ts');
        expect(src).toMatch(/\.where\("status", "in", disputeStatusesForFilter\(options\.status\)\)/);
        expect(src).not.toMatch(/\.where\("status", "==", options\.status\)/);
    });

    it('and the resolver STILL refuses an already-closed dispute — a guard, not a filter', () => {
        const src = code('src/app/actions/disputes.ts');
        expect(src).toMatch(/status === "resolved" \|\| \w+\.status === "closed"/);
    });

    it('and the premise holds: resolution writes "resolved", nothing writes "closed"', () => {
        const all = walk(join(ROOT, 'src')).map((f) => code(relative(ROOT, f)));
        const writesClosed = all.filter((s) =>
            /status:\s*"closed"/.test(s) || /"status":\s*"closed"/.test(s) || /to:\s*"closed"/.test(s));
        expect(writesClosed.length).toBe(0);

        const resolvers = code('src/app/actions/disputes.ts') + code('src/app/actions/marketplace/_escrow_disputes.ts');
        expect(resolvers).toMatch(/status: "resolved"/);
        expect(resolvers).toMatch(/to: "resolved"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#420 — the ratchet: a declared status must be reachable', () => {
    /**
     * Values declared in a status union that NOTHING writes, each with the
     * reason it is allowed to stay. This list is the decision record; a value
     * arriving here should be a choice, not a way to quiet the scan.
     */
    const KNOWN_UNWRITTEN: Record<string, string> = {
        // #420 — kept in the vocabulary, matched by the settled filter, and
        // guarded against in the resolver. No screen offers it alone.
        closed: 'dispute/aggregation terminal state, matched by DISPUTE_TERMINAL_STATUSES',
        // Recorded in lib/product-status.ts: declared, no writer, and the buyer
        // page computes out-of-stock client-side for flash-sale rows. Left in
        // the union because a stored document could carry it, and made a
        // deliberate open product question rather than a silent gap.
        out_of_stock: 'product-status.ts records this explicitly as an open product question',
        draft: 'ProductSchema default; no writer sets it — recorded in product-status.ts',
        // Declared in one type union, written by nothing and READ by nothing.
        // Harmless: no screen keys a section on it, which is what made "matured"
        // (#419) different.
        dropped: 'course enrolment state declared in types/index.ts, neither written nor read',
        free: 'paymentStatus member in types/index.ts, neither written nor read',

        /**
         * INERT VOCABULARY. Each of these appears in the whole of src ONLY as a
         * member of a type union — never written, never read, never compared.
         * Checked one by one, unfiltered. They are declarations of states the
         * product does not have yet, and they are harmless in a way "matured"
         * (#419) and "closed" (#420) were not: no screen keys a section or a
         * filter on them, so nothing renders empty because of them.
         *
         * They stay declared. What the assertion below enforces is the line
         * that matters — that none of them is ever OFFERED as a choice.
         */
        awaiting_evidence: 'dispute state declared in types/index.ts; no writer, no reader, no filter',
        investigating: 'dispute state declared in types/index.ts; no writer, no reader, no filter',
        in_progress: 'declared in two unions in types/index.ts; no writer, no reader, no filter',
        reserved: 'land listing state declared in types/index.ts; no writer, no reader, no filter',
        documents_submitted: 'declared in prd-interfaces.ts; no writer, no reader, no filter',
        pending_sync: 'declared in types/wave.ts; no writer, no reader, no filter',
        synced: 'declared in types/wave.ts; no writer, no reader, no filter',
        scheduled: 'live-class state declared in academy-actions.ts; no writer, no reader, no filter',
    };

    it('EVERY MEMBER OF EVERY DECLARED STATUS UNION IS WRITTEN, OR LISTED WITH A REASON', () => {
        const files = walk(join(ROOT, 'src'));
        /**
         *   THE UNION DECLARATIONS ARE REMOVED BEFORE ANYTHING IS COUNTED AS
         *   WRITTEN, AND THAT IS THE WHOLE CHECK.
         *
         *   `status: "a" | "b" | "c";` matches the `status:` pattern below, and
         *   the literals that follow it are its OWN members — so every union
         *   declared without a `?` marked itself reachable and the scan could
         *   never flag anything in one. The mutation that adds an unwritten
         *   member to a union survived the first draft of this test for exactly
         *   that reason, and that is what mutation testing is for.
         */
        const raw = files.map((f) => code(relative(ROOT, f))).join('\n');
        const blob = raw.replace(/\b\w*[Ss]tatus\w*\??\s*:\s*(?:"[a-z_]+"\s*\|\s*)+"[a-z_]+"/g, '');

        // Every shape this codebase writes a status with.
        const written = new Set<string>();
        for (const m of blob.matchAll(/(?:\w*[Ss]tatus)"?\s*:/g)) {
            for (const v of blob.slice(m.index! + m[0].length, m.index! + m[0].length + 140).matchAll(/["']([a-z_]{2,30})["']/g)) {
                written.add(v[1]);
            }
        }
        for (const m of blob.matchAll(/\bto:\s*/g)) {
            for (const v of blob.slice(m.index! + m[0].length, m.index! + m[0].length + 40).matchAll(/["']([a-z_]{2,30})["']/g)) {
                written.add(v[1]);
            }
        }
        for (const m of blob.matchAll(/=\s*\[([^\]]{0,600})\]\s*(?:as const)?;/g)) {
            for (const v of m[1].matchAll(/["']([a-z_]{2,30})["']/g)) written.add(v[1]);
        }
        /**
         * ASSIGNMENT through a status-named variable or a COMPUTED key. The
         * first draft of this scan missed
         *
         *     updatePayload[statusField] = newVerificationStatus ? 'verified' : 'unverified'
         *
         * in admin/_users.ts and reported "unverified" as unreachable — a false
         * positive from the ratchet's own instrument, caught by running it.
         * Audit the instrument before believing the measurement.
         */
        for (const m of blob.matchAll(/\w*[Ss]tatus\w*\s*\]?\s*=\s*/g)) {
            for (const v of blob.slice(m.index! + m[0].length, m.index! + m[0].length + 120).matchAll(/["']([a-z_]{2,30})["']/g)) {
                written.add(v[1]);
            }
        }

        const orphans = new Map<string, string>();
        for (const file of files) {
            const src = code(relative(ROOT, file));
            for (const m of src.matchAll(/\b(\w*[Ss]tatus)\??\s*:\s*((?:"[a-z_]+"\s*\|\s*)+"[a-z_]+")\s*;/g)) {
                for (const v of [...m[2].matchAll(/"([a-z_]+)"/g)].map((x) => x[1])) {
                    if (v === 'all' || written.has(v) || v in KNOWN_UNWRITTEN) continue;
                    orphans.set(v, `${relative(ROOT, file)} :: ${m[1]}`);
                }
            }
        }

        expect({ orphans: Object.fromEntries(orphans) }).toEqual({ orphans: {} });
    });

    it('AND NOTHING UNWRITTEN IS OFFERED AS A CHOICE — the harm, not the declaration', () => {
        /**
         * The line that separates #419 and #420 from harmless dead vocabulary.
         * A value nothing writes is a curiosity; a value nothing writes that a
         * screen OFFERS is an empty list the user reads as an answer. This is
         * the check that would have caught the "Closed" tab.
         *
         * Scoped to filter choices — a <option value> or a tab key — because
         * that is what produces the impossible empty list. A badge that never
         * renders is cosmetic, and product-status.ts already records the one
         * such case as an open product question.
         */
        /**
         * Values that ALSO belong to a different, live vocabulary. The scan
         * matches a bare string, so a name shared between two fields collides:
         * "free" is an inert `paymentStatus` member AND a live academy course
         * TIER, and the academy filter offers the tier. Named here rather than
         * loosening the check, so the collision is a recorded fact instead of a
         * silent hole.
         */
        const OFFERED_IN_ANOTHER_VOCABULARY: Record<string, string> = {
            free: 'also the academy course tier (course.tier); the /academy/courses filter offers the TIER',
        };

        const screens = walk(join(ROOT, 'src/app')).filter((f) => f.endsWith('.tsx'));
        const offered: Array<{ value: string; screen: string }> = [];
        for (const file of screens) {
            const src = code(relative(ROOT, file));
            for (const value of Object.keys(KNOWN_UNWRITTEN)) {
                if (value in OFFERED_IN_ANOTHER_VOCABULARY) continue;
                const asOption = new RegExp(`<option[^>]*value="${value}"`).test(src);
                const asTabKey = new RegExp(`key:\\s*"${value}"`).test(src);
                if (asOption || asTabKey) offered.push({ value, screen: relative(ROOT, file) });
            }
        }
        expect({ offered }).toEqual({ offered: [] });
    });

    it('and the allowlist itself stays honest — every entry carries a reason', () => {
        for (const [value, reason] of Object.entries(KNOWN_UNWRITTEN)) {
            expect({ value, hasReason: reason.length > 20 }).toEqual({ value, hasReason: true });
        }
    });

    it('and "matured" is NOT on it, because #419 made it reachable', () => {
        // The value that started this. It is derived and returned by
        // fixedSavingsPlanStatus now, so it must pass the scan on its own.
        expect(KNOWN_UNWRITTEN).not.toHaveProperty('matured');
        expect(code('src/lib/cooperative-savings.ts')).toMatch(/\? "matured" : "active"/);
    });
});
