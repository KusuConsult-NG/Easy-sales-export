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

        /**
         *   Shape 3: a reset placed after the whole try/catch(/finally).
         *
         *   #491 AND IT IS ONLY SAFE IF THE CATCH CAN REACH IT.
         *
         *        This accepted a tail reset unconditionally. A catch that
         *        RETURNS — which is the ordinary shape for a handler that stops
         *        on failure, and which four of #491's own repairs use — never
         *        reaches the line after it, so the flag stays set forever. The
         *        checker called that clean.
         *
         *        Found by mutation-testing #491's fixes: moving the reset out of
         *        `finally` in KYCVerificationStep and QuizComponent produced a
         *        genuinely dead button and this reported nothing. Every result
         *        this function has given since #405 was measured with that hole
         *        in it.
         *
         *        A `throw` in the catch is the same case. Both are conservative:
         *        a return inside a nested callback would be counted too, and an
         *        over-strict spinner check costs a look at a handler that turns
         *        out to be fine.
         */
        //   #492 AND THE TRY CAN LEAVE EARLY TOO.
        //
        //        The tail is unreachable from ANY branch that returns, not only
        //        from the catch. A loader that refuses early —
        //        `setLoadError(...); return;` inside the try — skips a reset
        //        placed after the block just as surely, and #492's own quiz
        //        loader has exactly that shape. Found by mutating it: removing
        //        the `finally` produced a genuinely stuck spinner and this
        //        reported nothing. Third gap in this checker, and the third
        //        found by mutating a repair rather than by reading it.
        const catchEscapes = /\breturn\b|\bthrow\b/.test(catchBody);
        const tail = catchEscapes
            ? ''
            : src.slice(finallyMatch ? afterCatch + finallyBody.length : afterCatch,
                (finallyMatch ? afterCatch + finallyBody.length : afterCatch) + 400);

        /**
         *   #491 THE FLAGS CONSIDERED ARE THE ONES SET ON THE WAY IN, NOT THE
         *        ONES RESET INSIDE THE TRY.
         *
         *        This iterated `set*(false)` occurrences WITHIN tryBody, so a
         *        handler that sets a flag, awaits, and resets it ONLY after the
         *        try/catch was never examined at all — there was no reset inside
         *        the body to iterate. Combined with the tail being accepted
         *        unconditionally, that made two genuine defects invisible:
         *        a returning catch with the reset behind it.
         *
         *        Both were found by mutation-testing #491's own repairs, and
         *        both had been invisible since #405. The population this
         *        function reports is only as honest as the question it asks, and
         *        the question was narrower than the header claimed.
         *
         *        Starting from the flag that was SET is the same question asked
         *        from the other end, and it cannot miss a handler for not
         *        containing the shape it was looking for.
         */
        /**
         *   #491 THE LOOKBACK STOPS AT THE ENCLOSING FUNCTION.
         *
         *        A flat 400 characters crosses function boundaries, and asking
         *        "what was set on the way in" made that matter: the disputes
         *        screen has a loader ending 40 characters above the next
         *        handler's try, and its `setLoadingNotes(true)` was read as
         *        entering a try in a DIFFERENT function. A checker that reports
         *        a defect in the wrong place teaches people to ignore it, which
         *        is worse than one that misses.
         */
        const window = src.slice(Math.max(0, tryMatch.index! - 400), tryMatch.index!);
        const boundary = Math.max(
            window.lastIndexOf('async function '),
            window.lastIndexOf('= async ('),
            window.lastIndexOf('=> {'),
        );
        const before = boundary === -1 ? window : window.slice(boundary);
        const entered = new Set(
            [...before.matchAll(/\bset([A-Z]\w*)\(\s*true\s*\)/g)].map((m) => m[1]),
        );

        for (const flag of entered) {
            if (!SPINNER.test(flag)) continue;
            //   Nothing to strand if the guarded region cannot reject.
            if (!/\bawait\b/.test(tryBody)) continue;

            const resets = new RegExp(`\\bset${flag}\\(\\s*false\\s*\\)`);
            if (resets.test(catchBody)) continue;    // shape 2
            if (resets.test(finallyBody)) continue;  // shape 1

            /**
             *   #492 AND THE TRY CAN LEAVE EARLY TOO — but only when it leaves
             *        WITHOUT resetting.
             *
             *        The tail is unreachable from any branch that returns, not
             *        just from the catch: a loader that refuses early —
             *        `setLoadError(...); return;` — skips a reset placed after
             *        the block. #492's quiz loader has exactly that shape, and
             *        removing its `finally` produced a genuinely stuck spinner
             *        the checker did not report.
             *
             *        The first version of this rule flagged the broadcast
             *        screen, which is CORRECT: its early return does
             *        `setSending(false); return;`. So the question is not
             *        whether the try returns, but whether it returns having
             *        already reset — which is what this per-flag test asks, and
             *        why it lives here rather than beside catchEscapes.
             */
            const tryReturnsUnreset = /\breturn\b/.test(tryBody) && !resets.test(tryBody);
            if (!tryReturnsUnreset && resets.test(tail)) continue;   // shape 3, reachable

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

    it('#491 — IT REPORTS A TAIL RESET THE CATCH CANNOT REACH', () => {
        //   THE case the checker was blind to since #405, found by mutating
        //   #491's own repairs. A catch that RETURNS is the ordinary shape for a
        //   handler that stops on failure, and the line after it never runs.
        expect(stuckFlags(`
            async function handleSubmit() {
                setSaving(true);
                try {
                    const r = await save();
                    if (!r.ok) { showToast("failed"); }
                } catch (e) {
                    showToast("error");
                    return;
                }
                setSaving(false);
            }
        `, 'synthetic')).toEqual(['synthetic:setSaving']);
    });

    it('#492 — AND A TAIL RESET IS UNREACHABLE FROM A TRY THAT RETURNS', () => {
        //   The early-refusal shape every loader in #492 has: the try answers
        //   "could not read" and returns, so a reset after the block never runs.
        expect(stuckFlags(`
            async function loadQuiz() {
                setLoading(true);
                try {
                    const r = await get();
                    if (!r.success) { setLoadError("no"); return; }
                    setQuiz(r.data);
                } catch (e) {
                    setLoadError("no");
                }
                setLoading(false);
            }
        `, 'synthetic')).toEqual(['synthetic:setLoading']);
    });

    it('#492 — AND A TRY THAT RETURNS HAVING ALREADY RESET IS FINE', () => {
        //   The false positive the first version of that rule produced, on the
        //   broadcast screen: `setSending(false); return;` inside the try is
        //   correct, and flagging it would have taught people to ignore the
        //   checker. The question is not whether the try returns — it is
        //   whether it returns WITHOUT resetting.
        expect(stuckFlags(`
            async function handleSend() {
                setSending(true);
                try {
                    const r = await post();
                    if (!r.success) { showToast("failed"); setSending(false); return; }
                    setStep("done");
                } catch (e) {
                    showToast("error");
                }
                setSending(false);
            }
        `, 'synthetic')).toEqual([]);
    });

    it('#491 — AND A TAIL RESET THE CATCH CAN REACH IS STILL FINE', () => {
        //   The other direction, without which the rule above could be
        //   satisfied by rejecting every tail reset — which would flag correct
        //   code and teach people to ignore the checker.
        expect(stuckFlags(`
            async function handleSubmit() {
                setSaving(true);
                try {
                    await save();
                } catch (e) {
                    showToast("error");
                }
                setSaving(false);
            }
        `, 'synthetic')).toEqual([]);
    });

    it('#491 — AND A FLAG WITH NO RESET INSIDE THE TRY IS STILL EXAMINED', () => {
        //   The second half of the same hole: the checker used to iterate
        //   `set*(false)` occurrences INSIDE the try, so a handler that never
        //   reset the flag at all had nothing to iterate and was skipped —
        //   the worst case reported as clean.
        expect(stuckFlags(`
            async function handleSubmit() {
                setSaving(true);
                try {
                    await save();
                } catch (e) {
                    showToast("error");
                }
            }
        `, 'synthetic')).toEqual(['synthetic:setSaving']);
    });

    it('#491 — and a flag set in a DIFFERENT function is not attributed here', () => {
        //   The false positive the widened question produced on first run: a
        //   loader ending just above a handler's try had its own flag read as
        //   entering that try. A checker that reports a defect in the wrong
        //   place teaches people to ignore it.
        expect(stuckFlags(`
            async function loadNotes() {
                setLoadingNotes(true);
                const r = await get();
                setLoadingNotes(false);
            }
            async function handleAddNote() {
                setSavingNote(true);
                try { await save(); } catch (e) { showToast("x"); } finally { setSavingNote(false); }
            }
        `, 'synthetic')).toEqual([]);
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
        ['src/app/dashboard/wallet/WalletClient.tsx', 'handleFund'],
        ['src/app/dashboard/wallet/WalletClient.tsx', 'handleWithdraw'],
        ['src/app/loans/approve/page.tsx', 'handleApproval'],
        ['src/app/land/verify/page.tsx', 'handleVerification'],
        ['src/app/escrow/[id]/dispute/CreateDisputeClient.tsx', 'handleSubmit'],
        ['src/app/escrow/[id]/chat/page.tsx', 'handleSendMessage'],
        ['src/app/admin/content-approval/page.tsx', 'handleApprove'],
        ['src/app/admin/content-approval/page.tsx', 'handleReject'],
        /**
         *   #491 THE REMAINING TWENTY-ONE ACTION HANDLERS.
         *
         *        #407 fixed the money and irreversible-decision ones and
         *        recorded the rest, correctly, as needing per-screen thought
         *        rather than a blanket wrapper. These are that thought, applied:
         *        every one resets its flag in a `finally` and reports the
         *        failure through the channel its own screen already uses —
         *        showToast, sonner, or a local message state — rather than a
         *        console line nobody sees.
         *
         *        Three of them do more than reset, and those are the ones worth
         *        naming: the AI composer puts the member's text back in the box
         *        rather than losing it with the optimistic row; the timed quiz
         *        does NOT clear its localStorage timer on a failure, because
         *        that would hand the student a quiz with no time left and no
         *        score; and every dialog that could have half-succeeded says so
         *        — "check before retrying" — instead of implying nothing
         *        happened.
         */
        ['src/app/admin/communications/in-app/page.tsx', 'handleSend'],
        ['src/app/admin/communications/in-app/page.tsx', 'handlePreview'],
        ['src/app/admin/settings/general/page.tsx', 'handleSave'],
        ['src/app/admin/academy/[courseId]/quiz/[quizId]/page.tsx', 'handleSave'],
        ['src/app/admin/export/applications/page.tsx', 'handleSaveRevision'],
        ['src/app/admin/export/edit/[id]/page.tsx', 'handleSave'],
        ['src/app/admin/export/page.tsx', 'handleStatusUpdate'],
        ['src/app/admin/marketplace/disputes/[id]/page.tsx', 'handleAddNote'],
        ['src/app/admin/marketplace/sellers/page.tsx', 'handleSaveEdit'],
        ['src/app/admin/marketplace/village-market/page.tsx', 'handleCreate'],
        ['src/app/admin/marketplace/village-market/page.tsx', 'handle'],
        ['src/app/admin/wave/applications/page.tsx', 'handleSaveEdit'],
        ['src/app/admin/wave/resources/page.tsx', 'handleUpload'],
        ['src/app/export/onboarding/steps/KYCVerificationStep.tsx', 'handleSubmit'],
        ['src/app/marketplace/buyer/orders/[id]/review/page.tsx', 'handleProductReview'],
        ['src/app/marketplace/buyer/orders/[id]/review/page.tsx', 'handleSellerReview'],
        ['src/app/profile/ProfileClient.tsx', 'handleSave'],
        ['src/app/academy/[courseId]/quiz/[moduleId]/page.tsx', 'submitQuiz'],
        ['src/components/academy/QuizComponent.tsx', 'handleSubmit'],
        ['src/components/admin/EnrollStudentModal.tsx', 'handleEnroll'],
        ['src/components/ai/AISidebar.tsx', 'handleSendMessage'],
        /**
         *   #492 THE EIGHT LOADERS, and they needed the OTHER repair.
         *
         *        #407 said a blanket try/finally is wrong for a loader because
         *        it turns "spinner forever" into "empty screen with no
         *        explanation". True — and the stuck spinner was never the worst
         *        of these. Each was already rendering a confident, wrong answer
         *        on a failed read: ₦0 total revenue, "verification required" to
         *        an approved seller, "0% complete" to a student who had
         *        finished, "Event not found", "Quiz Not Found", "No notes yet".
         *
         *        So each gained an error state AND the branch order that makes
         *        it reachable — "could not read" answered before "there is
         *        nothing there".
         */
        ['src/app/academy/[courseId]/quiz/[moduleId]/page.tsx', 'loadQuiz'],
        ['src/app/admin/export/edit/[id]/page.tsx', 'loadData'],
        ['src/app/admin/finance/page.tsx', 'loadFinanceData'],
        ['src/app/admin/marketplace/disputes/[id]/page.tsx', 'loadNotes'],
        ['src/app/marketplace/sell/SellerHomeClient.tsx', 'loadSellerData'],
        ['src/app/marketplace/village-market/[id]/VillageMarketEventClient.tsx', 'loadEvent'],
        ['src/app/wave/(member)/resources/WaveResourcesClient.tsx', 'loadResources'],
        ['src/components/lms/CourseProgressCard.tsx', 'fetchProgress'],
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
         * failed read). #409 took one more — RepaymentSchedule's fetchSchedule,
         * which also rendered NaN% and treated a failed read as an empty
         * schedule. That left 29.
         *
         * #491 took the twenty-one ACTION HANDLERS. #492 took the last eight,
         * which were LOADERS and needed the different repair #407 named: an
         * error state in what the screen RENDERS, asked BEFORE the empty state,
         * or it is unreachable behind the old lie. See
         * a-failed-read-is-not-an-empty-screen.render.test.tsx — the stuck
         * spinner was never the worst of those eight. Each was rendering a
         * confident, wrong answer: ₦0 revenue, "verification required" to an
         * approved seller, "0% complete" to a student who had finished.
         *
         * ZERO, and that is the number to defend. It is not "no known defects
         * of this shape" — it is "none", and a new one is a test failure on the
         * commit that introduces it.
         */
        expect(found.length).toBe(0);
        // And every handler fixed above is genuinely out of the population.
        for (const [rel, fn] of FIXED) expect(found).not.toContain(`${rel}:${fn}`);

        /**
         *   #491 NAMED, NOT JUST COUNTED.
         *
         *        The header above has said "the rest are recorded in KNOWN,
         *        named, so the count cannot grow quietly" since #407, and there
         *        was no such list — only the number. A count alone is satisfied
         *        by ANY eight handlers, so fixing one of these and introducing a
         *        new one somewhere else would have passed silently. That is the
         *        exact failure mode the sentence was written to prevent.
         *
         *        These eight are LOADERS. Each needs an error state in what its
         *        screen renders, which is a change to the page rather than to
         *        the handler — see the note on the count above.
         */
        //   #492 emptied it. Kept rather than deleted: the list is the shape
        //   this ratchet needs the day somebody has a reason to add one back,
        //   and an empty KNOWN states plainly that nothing is currently
        //   tolerated. A count alone never could.
        const KNOWN: string[] = [];
        expect([...found].sort()).toEqual([...KNOWN].sort());
    });
});
