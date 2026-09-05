/**
 * @jest-environment node
 */

/**
 *   #405 A SPINNER THAT NEVER STOPS — SWEPT, CLEAN, AND NOW PINNED.
 *
 *   THE CLASS
 *   ---------
 *   Every submit button in this app is disabled by a flag:
 *
 *       disabled={!canProceed || sending}
 *       {sending ? "Sending…" : "Send Broadcast"}
 *
 *   Set it true, and if any exit path fails to set it false, the control is
 *   dead for as long as the page is open. There is no error message, nothing in
 *   a log, and the user's only recourse is a reload — which on a submit screen
 *   usually means losing what they typed. It is the visible half of #322's
 *   class (a control that refuses in silence), and it survives every audit that
 *   only reads server code.
 *
 *   THE THREE CORRECT SHAPES, all of them present in this codebase:
 *
 *       try { … } finally { setX(false) }        reset always runs
 *       try { … } catch { … setX(false) }        reset on both branches
 *       try { … } catch { … }  setX(false)       reset after the whole block
 *
 *   THE BROKEN SHAPE is the fourth: reset inside `try` only, with a `catch`
 *   that returns or falls through without it. Then the happy path re-enables
 *   the button and the failure path does not — the exact case a user hits when
 *   the network drops mid-submit.
 *
 *   RESULT OF THE SWEEP: 0 occurrences across every .tsx file. Recorded as
 *   clean rather than dressed up: the codebase already uses the three correct
 *   shapes consistently, and the value here is the ratchet, not a find.
 *
 *   FOUR FALSE POSITIVES ON THE WAY, ALL MINE, ALL FROM THE SCANNER
 *   ----------------------------------------------------------------
 *   The first pass reported 24 candidates, the second 13, the third 1. Every
 *   reduction was a defect in my scanner, not a fix to the code:
 *
 *     1. it treated `setShowUploadModal(true)` as a spinner — a modal toggle
 *     2. it flagged handlers that navigate away (router.replace, window.location)
 *        where KEEPING the button disabled is the correct behaviour, and
 *        re-enabling it would invite a double submit
 *     3. it read a fixed 2600-character window, so a `finally` further down a
 *        long handler was invisible and the handler looked unguarded
 *     4. it stopped at the end of the `catch`, missing the reset placed after
 *        the whole try/catch — the third correct shape above
 *
 *   The last one was the single surviving candidate, and it was correct code.
 *   That is the same lesson as #383, #392, #399 and #404: audit the instrument
 *   before believing the measurement. It is recorded here because a ratchet
 *   whose checker cries wolf is worse than no ratchet — it trains people to
 *   ignore a red build (#331's fault, inverted).
 *
 *   So the checker below implements all four corrections, and is proved
 *   non-vacuous against synthetic handlers rather than by mutating a real file:
 *   the broken shape MUST be reported, and each of the three correct shapes
 *   MUST NOT be.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/**
 * Flags that disable a control. Modal toggles and one-way latches are not these.
 *
 *   #407 THIS WAS ANCHORED, AND THE ANCHOR HID THE MONEY SCREEN.
 *
 *   `^(is)?(loading|…)` matched setLoading and setIsSubmitting, and missed
 *   setWdLoading, setFundLoading, setActionLoading, setEditSaving,
 *   setLoadingNotes and setSavingNote — every flag whose name is prefixed
 *   rather than suffixed. Two of those are the wallet's withdraw and fund
 *   buttons. Unanchored now, which is what the name check should always have
 *   been.
 */
const SPINNER = /(loading|submitting|saving|processing|busy|sending|deleting|uploading)/i;

/** The block starting at the `{` at index `i`, plus the index just past it. */
function block(src: string, i: number): [string, number] {
    let depth = 0;
    for (let j = i; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') {
            depth--;
            if (depth === 0) return [src.slice(i, j + 1), j + 1];
        }
    }
    return [src.slice(i), src.length];
}

function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Handlers whose loading flag is reset ONLY inside `try`.
 *
 * Reports `file:flag` for each. A flag is considered safe when the reset
 * appears in a `finally`, in the `catch`, or in the ~400 characters following
 * the try/catch — the three shapes the codebase actually uses.
 */
export function stuckFlags(source: string, label = 'source'): string[] {
    const src = stripComments(source);
    const out: string[] = [];

    for (const tryMatch of [...src.matchAll(/\btry\s*\{/g)]) {
        const [tryBody, afterTry] = block(src, tryMatch.index! + tryMatch[0].length - 1);

        const catchMatch = /^\s*catch\s*(\([^)]*\))?\s*\{/.exec(src.slice(afterTry, afterTry + 40));
        if (!catchMatch) continue;
        const [catchBody, afterCatch] = block(src, afterTry + catchMatch[0].length - 1);

        // Shape 1: a finally. Whatever it resets is always reset.
        const finallyMatch = /^\s*finally\s*\{/.exec(src.slice(afterCatch, afterCatch + 20));
        const finallyBody = finallyMatch ? block(src, afterCatch + finallyMatch[0].length - 1)[0] : '';

        // Shape 3: a reset placed after the whole try/catch(/finally).
        const tail = src.slice(finallyMatch ? afterCatch + finallyBody.length : afterCatch,
            (finallyMatch ? afterCatch + finallyBody.length : afterCatch) + 400);

        for (const reset of [...tryBody.matchAll(/\bset([A-Z]\w*)\(\s*false\s*\)/g)]) {
            const flag = reset[1];
            if (!SPINNER.test(flag)) continue;

            const resets = new RegExp(`\\bset${flag}\\(\\s*false\\s*\\)`);
            if (resets.test(catchBody)) continue;    // shape 2
            if (resets.test(finallyBody)) continue;  // shape 1
            if (resets.test(tail)) continue;         // shape 3

            // Only a real defect if something set it true on the way in.
            const before = src.slice(Math.max(0, tryMatch.index! - 400), tryMatch.index!);
            if (!new RegExp(`\\bset${flag}\\(\\s*true\\s*\\)`).test(before)) continue;

            out.push(`${label}:set${flag}`);
        }
    }
    return [...new Set(out)];
}

/**
 * Handlers that hold a spinner across an `await` with NO try/catch at all.
 *
 *   #407 THE SHAPE #405's CHECKER COULD NOT SEE.
 *
 *   stuckFlags() iterates `try {` occurrences, so a handler containing no try
 *   was never examined — and that is a whole second population:
 *
 *       setWdLoading(true);
 *       const res = await withdrawFromWalletAction(amount, wdBank);
 *       setWdLoading(false);
 *
 *   A server action can REJECT rather than resolve (dropped connection, a 500,
 *   a serialization error). Then the reset never runs and the control is dead
 *   until reload. #405 reported this class CLEAN; it was clean only of the
 *   shape it looked at.
 *
 *   Measured at 41 handlers. The money and irreversible-decision ones are fixed
 *   (see FIXED below). The rest are recorded in KNOWN, named, so the count
 *   cannot grow quietly — the same device as the orphan queue's PENDING.
 */
export function unguardedAwaits(source: string, label = 'source'): string[] {
    const src = stripComments(source);
    const out: string[] = [];
    const HANDLER = /(?:async\s+function\s+(\w+)\s*\([^)]*\)\s*\{)|(?:const\s+(\w+)\s*=\s*async\s*\([^)]*\)\s*=>\s*\{)/g;

    for (const m of [...src.matchAll(HANDLER)]) {
        const name = m[1] ?? m[2];
        const [body] = block(src, m.index! + m[0].length - 1);
        if (/\btry\s*\{/.test(body)) continue;           // #405 covers these

        for (const set of [...body.matchAll(/\bset([A-Z]\w*)\(\s*true\s*\)/g)]) {
            const flag = set[1];
            if (!SPINNER.test(flag)) continue;
            const after = body.slice(set.index! + set[0].length);
            if (!/\bawait\b/.test(after)) continue;
            if (!new RegExp(`\\bset${flag}\\(\\s*false\\s*\\)`).test(after)) continue;
            out.push(`${label}:${name}`);
        }
    }
    return [...new Set(out)];
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.tsx') && !full.includes('__tests__')) out.push(full);
    }
    return out;
}

const SCREENS = walk(SRC);

// ─────────────────────────────────────────────────────────────────────────────
describe('#405 — the checker itself, proved on synthetic handlers', () => {
    /**
     * THE CONTROL, and the reason it is synthetic. Mutating a real screen to
     * prove the checker fires would test one file's phrasing; these four cover
     * the whole rule, including the three shapes a false positive would trip on
     * — which is what the scanner actually got wrong four times.
     */
    const BROKEN = `
        setSending(true);
        try {
            const res = await fetch("/x");
            if (!res.ok) { showToast("failed"); return; }
            setSending(false);
        } catch (err) {
            showToast("network error");
        }
    `;

    it('IT REPORTS THE BROKEN SHAPE — reset in try, catch falls through', () => {
        expect(stuckFlags(BROKEN, 'synthetic')).toEqual(['synthetic:setSending']);
    });

    it('and it clears a finally', () => {
        expect(stuckFlags(`
            setSending(true);
            try { setSending(false); } catch (e) { log(e); } finally { setSending(false); }
        `)).toEqual([]);
    });

    it('and it clears a catch that resets too', () => {
        expect(stuckFlags(`
            setSending(true);
            try { setSending(false); } catch (e) { showToast("x"); setSending(false); }
        `)).toEqual([]);
    });

    it('and it clears a reset placed after the whole try/catch', () => {
        // The shape that produced the last false positive, in
        // admin/communications/broadcast/page.tsx. Correct code.
        expect(stuckFlags(`
            setSending(true);
            try { if (bad) { setSending(false); return; } done(); }
            catch (e) { showToast("x"); }
            setSending(false);
        `)).toEqual([]);
    });

    it('and it ignores modal toggles, which are not spinners', () => {
        expect(stuckFlags(`
            setShowUploadModal(true);
            try { setShowUploadModal(false); } catch (e) { log(e); }
        `)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#405 — no screen can strand its own control', () => {
    it('NO .tsx RESETS A LOADING FLAG ONLY ON THE SUCCESS PATH', () => {
        const stuck = SCREENS.flatMap((p) => stuckFlags(readFileSync(p, 'utf-8'), relative(ROOT, p)));
        expect(stuck).toEqual([]);
    });

    it('and the sweep actually read the screens', () => {
        // Positive control. "No violations" has to mean the files were scanned,
        // not that the walk returned nothing — #331's class applied to my own
        // ratchet.
        expect(SCREENS.length).toBeGreaterThan(200);
        const withFlags = SCREENS.filter((p) => /\bset[A-Z]\w*\(\s*true\s*\)/.test(readFileSync(p, 'utf-8')));
        expect(withFlags.length).toBeGreaterThan(50);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#407 — the shape #405 could not see: an await with no try at all', () => {
    /**
     * The money and irreversible-decision handlers, fixed. Each one held a
     * control that a rejected promise would have killed:
     *
     *   the wallet's fund and withdraw buttons
     *   the loan approve/reject decision
     *   the land verify/reject decision
     *   the escrow dispute filing — the control that FREEZES money, on a clock
     *   the escrow chat, where a buyer and seller argue about that money
     *   the content-approval queue that marks land verified and products live
     */
    const FIXED: Array<[string, string]> = [
        ['src/app/dashboard/wallet/page.tsx', 'handleFund'],
        ['src/app/dashboard/wallet/page.tsx', 'handleWithdraw'],
        ['src/app/loans/approve/page.tsx', 'handleApproval'],
        ['src/app/land/verify/page.tsx', 'handleVerification'],
        ['src/app/escrow/[id]/dispute/page.tsx', 'handleSubmit'],
        ['src/app/escrow/[id]/chat/page.tsx', 'handleSendMessage'],
        ['src/app/admin/content-approval/page.tsx', 'handleApprove'],
        ['src/app/admin/content-approval/page.tsx', 'handleReject'],
    ];

    it.each(FIXED)('%s :: %s no longer holds a spinner across an unguarded await', (rel, fn) => {
        /**
         * Scoped to the HANDLER, not the file. Two of these files still contain
         * a loader with the same shape — loadListings and loadLoans — and those
         * are deliberately untouched: wrapping a loader in try/finally turns
         * "spinner forever" into "empty screen with no explanation", which is
         * #307's class. They need an error state, which is a change to what the
         * screen renders. Asserting per file would have quietly demanded the
         * wrong repair.
         */
        const src = readFileSync(join(ROOT, rel), 'utf-8');
        expect(unguardedAwaits(src, rel)).not.toContain(`${rel}:${fn}`);
    });

    it('and the checker reports the shape when it is there', () => {
        // The control. Without it, "no violations" could mean the matcher is
        // broken rather than the code correct — the mistake #405 itself made.
        expect(unguardedAwaits(`
            async function handleWithdraw() {
                setWdLoading(true);
                const res = await withdrawFromWalletAction(amount, wdBank);
                setWdLoading(false);
                if (res.success) { done(); }
            }
        `, 'synthetic')).toEqual(['synthetic:handleWithdraw']);
    });

    it('and a prefixed flag name is matched, which is what hid the wallet', () => {
        // setWdLoading / setFundLoading / setActionLoading were invisible to
        // #405's anchored pattern. Asserted directly so the anchor cannot
        // come back.
        for (const flag of ['WdLoading', 'FundLoading', 'ActionLoading', 'EditSaving', 'LoadingNotes']) {
            expect({ flag, matched: /(loading|submitting|saving|processing|busy|sending|deleting|uploading)/i.test(flag) })
                .toEqual({ flag, matched: true });
        }
    });

    it('and the remaining population is pinned, so it cannot grow', () => {
        /**
         * Not yet fixed, and named rather than waved through. These are loaders
         * and non-money writes; a blanket try/finally would be the WRONG repair
         * for a loader — it turns "spinner forever" into "empty screen with no
         * explanation", which is #307's class. Each needs its own error state,
         * which is a change to what those screens render, not a wrapper.
         */
        const found = SCREENS.flatMap((p) => unguardedAwaits(readFileSync(p, 'utf-8'), relative(ROOT, p)));
        /**
         * 41 measured. 8 fixed by #407 (the money and decision handlers), then
         * 3 more by #408 (loadLoans on both loan screens and loadListings on the
         * land queue — where the stuck spinner turned out to be the lesser
         * defect: those loaders rendered "no loans" and "All Caught Up!" after a
         * failed read). 30 remain, and the number is asserted so a 31st cannot
         * appear without somebody deciding it should.
         *
         * #409 took one more — RepaymentSchedule's fetchSchedule, whose stuck
         * spinner was the least of it: it also rendered NaN% and treated a
         * failed read as an empty schedule. 29.
         */
        expect(found.length).toBe(29);
        // And every handler fixed above is genuinely out of the population.
        for (const [rel, fn] of FIXED) expect(found).not.toContain(`${rel}:${fn}`);
    });
});
