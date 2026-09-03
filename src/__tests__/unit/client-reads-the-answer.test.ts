/**
 * @jest-environment node
 */

/**
 * THE BROWSER LAYER, SWEPT INSTEAD OF READ FILE BY FILE.
 *
 * Five of the last six findings were one pattern:
 *
 *   #284  the bank check was simulated and the resolved name invented
 *   #287  a refused loan application rendered nothing at all
 *   #288  the refusal was composed, thrown, and replaced by "Failed"
 *   #290  the import announced an email nobody sent, and dropped the PIN
 *   #292  the uploader discarded the real public_id and made one up
 *
 * In every case the server produced a correct, specific answer and the screen
 * either ignored it or asserted something it could not know. Reading 104
 * uncovered components one at a time was going to take a hundred more passes
 * and would still miss the ones I did not get to, so the pattern is DERIVED
 * here instead, over every .tsx in the repository.
 *
 * WHAT THE COUNTS ARE, AND ARE NOT
 * --------------------------------
 * These are CANDIDATES, not confirmed defects. A list screen that ignores
 * `result.error` shows an empty table instead of an error — bad, but not the
 * same as #290. The numbers are pinned at what was measured so a NEW one fails
 * the build; they are not a claim that the existing ones are all fine.
 *
 * What the sweep found on its first run, and what came of it:
 *
 *   D3  7 hits →  #294, the admin bulk verify (below). Two were logout, two
 *                 were mark-as-read; those are genuinely fire-and-forget.
 *   D6  1 hit  →  #293, a payment reference invented with Math.random() and
 *                 shown to a member as bank-transfer narration.
 *   D7  4 hits →  three are a "fake_product" DISPUTE REASON, which is a real
 *                 category and not a placeholder. One is a stale
 *                 "Simplified for now" comment in LoanWizard.
 *   D8 10 hits →  read individually; the ones on the rejected-application
 *                 pages are true (rejection does email), and
 *                 ImportLegacyModal's hit is #290's own fix saying "no email
 *                 was sent".
 *   D1/D2/D4/D5  a backlog of 225 sites where a result, a response status or
 *                 an exception is dropped. Pinned, not triaged — that is the
 *                 next sweep, and the honest position is that they have not
 *                 been looked at one by one.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (!full.includes('__tests__')) walk(full, out);
        } else if (full.endsWith('.tsx')) {
            out.push(full);
        }
    }
    return out;
}

/** Lines with block comments removed and `//` lines dropped, numbers kept. */
function codeLines(text: string): Array<[number, string]> {
    const out: Array<[number, string]> = [];
    let inBlock = false;

    text.split('\n').forEach((raw, i) => {
        let s = raw;
        const t = s.trim();

        if (inBlock) {
            if (s.includes('*/')) {
                inBlock = false;
                s = s.slice(s.indexOf('*/') + 2);
            } else {
                return;
            }
        }
        if (t.startsWith('//')) return;

        const open = s.indexOf('/*');
        if (open > -1 && !s.slice(open + 2).includes('*/')) {
            s = s.slice(0, open);
            inBlock = true;
        }
        out.push([i + 1, s]);
    });

    return out;
}

const CALL = /(?:const|let|var)\s+(\w+)(?::\s*[^=]+)?\s*=\s*await\s+([A-Za-z_$][\w.]*)\s*\(/;
const BARE_AWAIT = /^\s*await\s+([A-Za-z_$][\w.]*Action)\s*\(/;
const FETCH_RES = /(?:const|let)\s+(\w+)\s*=\s*await\s+fetch\s*\(/;
const CLAIM = /(has been sent|have been sent|was sent|we have emailed|will receive an email|email has been|link has been sent|successfully (?:sent|emailed|notified)|check your (?:email|inbox))/i;

function esc(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Hit { file: string; line: number; what: string }

function sweep(): Record<string, Hit[]> {
    const hits: Record<string, Hit[]> = {
        D1: [], D2: [], D3: [], D4: [], D5: [], D6: [], D7: [], D8: [],
    };

    for (const full of walk(ROOT).sort()) {
        const rel = full.slice(process.cwd().length + 1);
        const text = readFileSync(full, 'utf-8');
        const lines = codeLines(text);
        const joined = lines.map(([, l]) => l).join('\n');

        lines.forEach(([lineno, line], idx) => {
            const block = lines.slice(idx, idx + 40).map(([, l]) => l).join('\n');

            const m = CALL.exec(line);
            if (m) {
                const [, v, callee] = m;
                const isAction = callee.endsWith('Action') || callee.startsWith('submit') || callee.endsWith('Mutation');
                if (isAction) {
                    const ok = new RegExp(`\\b${esc(v)}(?:\\?)?\\.success`).test(block);
                    const err = new RegExp(`\\b${esc(v)}(?:\\?)?\\.(error|message)`).test(block);
                    if (ok && !err) hits.D1.push({ file: rel, line: lineno, what: `${v} = ${callee}(…)` });
                    else if (!ok && !err) hits.D2.push({ file: rel, line: lineno, what: `${v} = ${callee}(…)` });
                }
            }

            const b = BARE_AWAIT.exec(line);
            if (b) hits.D3.push({ file: rel, line: lineno, what: b[1] });

            const f = FETCH_RES.exec(line);
            if (f) {
                const v = f[1];
                const checked = new RegExp(`\\b${esc(v)}(?:\\?)?\\.ok\\b`).test(block)
                    || new RegExp(`\\b${esc(v)}\\.status\\b`).test(block);
                if (!checked) hits.D4.push({ file: rel, line: lineno, what: `${v} = fetch(…)` });
            }

            if (/crypto\.randomUUID\(\)|Math\.random\(\)/.test(line) && /\b(id|path|ref|reference|code|token|key)\b/i.test(line)) {
                hits.D6.push({ file: rel, line: lineno, what: line.trim().slice(0, 80) });
            }
            if (/SIMULAT|DUMMY|FAKE_|TODO_?REPLACE|demo\/testing/i.test(line) && !/placeholder=/.test(line)) {
                hits.D7.push({ file: rel, line: lineno, what: line.trim().slice(0, 80) });
            }
            if (CLAIM.test(line)) {
                hits.D8.push({ file: rel, line: lineno, what: line.trim().slice(0, 80) });
            }
        });

        for (const cm of joined.matchAll(/catch\s*(?:\([^)]*\))?\s*\{([^{}]*)\}/g)) {
            const body = (cm[1] ?? '').trim();
            const swallows = body === '' || /^(console\.(error|warn|log)\([^;]*\);?\s*)+$/.test(body);
            if (swallows) {
                const lineno = joined.slice(0, cm.index).split('\n').length;
                hits.D5.push({ file: rel, line: lineno, what: body.slice(0, 50) || '<empty>' });
            }
        }
    }

    return hits;
}

const HITS = sweep();
const n = (k: string) => HITS[k].length;

// ─────────────────────────────────────────────────────────────────────────────
describe('the sweep itself', () => {
    it('reads the browser layer, so none of this is vacuous', () => {
        expect(walk(ROOT).length).toBeGreaterThan(150);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a server answer must not be silently discarded', () => {
    /**
     * Ceilings, not targets. Each number is what the sweep measured after
     * #293/#294 were fixed. Adding a new site fails here, which is the whole
     * point: the pattern stops growing while the backlog is worked down.
     */
    it('D3 — an action awaited with its result thrown away', () => {
        // Down from 7: #294 was one of them. What remains is logout (x2),
        // mark-as-read (x2) and an audit-log write — genuinely fire-and-forget,
        // though the audit one is worth a look next pass.
        expect(n('D3')).toBeLessThanOrEqual(6);
    });

    it('D1 — success checked, error and message never read', () => {
        expect(n('D1')).toBeLessThanOrEqual(87);
    });

    it('D2 — an action result captured and never inspected at all', () => {
        expect(n('D2')).toBeLessThanOrEqual(29);
    });

    it('D4 — a fetch response never checked for ok or status', () => {
        expect(n('D4')).toBeLessThanOrEqual(54);
    });

    it('D5 — a catch that swallows the failure', () => {
        expect(n('D5')).toBeLessThanOrEqual(55);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#293 — a payment reference invented in the browser', () => {
    const PAGE = 'src/app/cooperatives/onboarding/pending-payment/page.tsx';
    const raw = () => readFileSync(join(process.cwd(), PAGE), 'utf-8');
    const code = () => codeLines(raw()).map(([, l]) => l).join('\n');

    it('NO IDENTIFIER ANYWHERE IN THE BROWSER IS MINTED FROM Math.random', () => {
        // The derived form. It was a payment reference shown to a member as
        // bank-transfer narration; the rule it broke is stated in
        // wallet-ledger.ts — a reference that varies per attempt is not an
        // idempotency key.
        expect(HITS.D6.map((h) => `${h.file}:${h.line}`)).toEqual([]);
    });

    it('the page shows a reference only when it was given one', () => {
        expect(code()).toContain('searchParams.get("ref")');
        expect(code()).not.toMatch(/COOP-PAY-/);
    });

    it('AND NO LONGER PUBLISHES HARDCODED BANK DETAILS', () => {
        // The contradiction: this block sat directly above "Verification Is
        // Automatic … there is nothing you need to send us". Both halves
        // cannot be true, and every other cooperative surface says Paystack.
        expect(code()).not.toContain('2015678942');
        expect(code()).not.toMatch(/Bank Transfer Details/);
        expect(code()).not.toMatch(/Use this as narration/);
    });

    it('and the half that is true is still there', () => {
        // Vacuity guard. Deleting both halves would pass everything above and
        // leave a member with no idea how the fee is paid.
        expect(code()).toContain('Verification Is Automatic');
        expect(code()).toContain('confirmed with Paystack directly');
    });

    it('that account number appears nowhere else in the repository', () => {
        // The measurement behind removing it rather than correcting it: it was
        // in one component and in no config, so nothing else could reconcile
        // against it.
        // CODE ONLY. The first version read raw text and reported the page
        // itself, because the write-up left in place of the removed block
        // quotes the account number to explain what was removed. Third time in
        // this audit that an assertion about a defect matched its own
        // description of the defect — #285, #287, and here.
        const offenders = walk(ROOT).filter((f) => {
            const code = codeLines(readFileSync(f, 'utf-8')).map(([, l]) => l).join('\n');
            return code.includes('2015678942');
        });

        expect(offenders).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#294 — "Bulk Verify" un-verified the already-verified', () => {
    const PAGE = 'src/app/admin/users/page.tsx';
    const code = codeLines(readFileSync(join(process.cwd(), PAGE), 'utf-8'))
        .map(([, l]) => l).join('\n');
    const body = code.slice(
        code.indexOf('async function handleBulkVerify'),
        code.indexOf('function handleManageUser'),
    );

    it('the handler is found, so this is not vacuous', () => {
        expect(body.length).toBeGreaterThan(200);
    });

    it('IT SKIPS USERS WHO ARE ALREADY VERIFIED', () => {
        // The defect. toggleUserVerificationAction computes
        // `!currentData.isVerified`, so pressing "Verify" on a selection
        // containing verified users set them back to unverified — kycStatus to
        // "pending", verifiedAt to null, an audit row reading "user_unverify".
        // `[^)]*` was wrong here: the predicate contains `has(u.id)`, so the
        // character class stopped at that closing paren before reaching the
        // part being asserted.
        expect(body).toMatch(/\.filter\([\s\S]*?!u\.isVerified/);
    });

    it('AND READS WHAT EACH CALL RETURNED', () => {
        // Was a bare `await toggleUserVerificationAction(userId);` in a loop.
        expect(body).toMatch(/result\.success/);
        expect(body).toMatch(/result\.error/);
    });

    it('AND ONLY MARKS THE ROWS THAT ACTUALLY SUCCEEDED', () => {
        // It used to paint every selected row `isVerified: true` regardless,
        // so the table and the database disagreed in the direction where a
        // member had silently lost their verification.
        expect(body).not.toMatch(/selectedIds\.has\(u\.id\) \? \{ \.\.\.u, isVerified: true/);
        expect(body).toMatch(/done\.has\(u\.id\)/);
    });

    it('and reports the real tally rather than an unconditional success', () => {
        expect(body).not.toContain('"Bulk verification completed"');
        expect(body).toMatch(/failures\.length/);
    });

    it('the single-row handler it was the broken twin of is unchanged', () => {
        // Pinned: that one always read result.success, flipped the local row to
        // match, and surfaced result.message or result.error. It is the shape
        // the bulk path now follows.
        const single = code.slice(
            code.indexOf('async function handleToggleVerification'),
            code.indexOf('async function handleBulkVerify'),
        );

        expect(single).toMatch(/if \(result\.success\)/);
        expect(single).toMatch(/showToast\(result\.error/);
    });
});
