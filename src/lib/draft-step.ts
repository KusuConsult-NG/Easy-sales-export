/**
 * Reading a saved wizard position back without trusting it.
 *
 *   #625 A SAVED DRAFT COULD LOCK A USER OUT OF A FLOW FOR GOOD.
 *
 *        Four multi-step flows save progress to localStorage and restore it on
 *        mount — the WAVE application and the marketplace, export and
 *        farm-nation onboardings. Every one of them took the saved step at its
 *        word:
 *
 *            const { step, data } = JSON.parse(saved);
 *            if (typeof step === "number") setCurrentStep(step);
 *
 *        and every one of them renders its steps through a `switch` or a chain
 *        of `currentStep === N &&` with NO DEFAULT BRANCH. A step outside the
 *        range therefore matches nothing and renders nothing.
 *
 *        MEASURED ON THE WAVE APPLICATION, which is the worst of the four. With
 *        a saved step of 7 the page renders a header, an empty card, and ZERO
 *        BUTTONS — its navigation block is itself conditional on
 *        `currentStep < 6`, so the Back button disappears along with the
 *        content. There is nothing to click.
 *
 *        AND RELOADING DOES NOT HELP, which is what turns a glitch into a
 *        lockout: the page restores the same draft and lands on the same dead
 *        step. Short of clearing site data, that user cannot apply to WAVE
 *        again. A saved step of -1 is the same trap in miniature — "Step 0 of
 *        7" over an empty card, with a Back button that does nothing because
 *        prevStep requires `currentStep > 0`.
 *
 *   HOW IT HAPPENS WITHOUT ANYBODY TAMPERING. Remove a step from one of these
 *   flows and every draft saved at the old last step is instantly out of range.
 *   The drafts outlive the deploy; nothing migrates them. That is an ordinary
 *   product change turning into a support queue.
 *
 *   WHY ONE MODULE AND NOT FOUR GUARDS. Four hand-written copies of one rule is
 *   the defect this audit keeps finding, and the copy that drifts is the one
 *   nobody looks at. Two shapes are needed because two of the flows index their
 *   steps by number and two by string id, so both are here, beside each other.
 *
 *   WHAT THEY DELIBERATELY DO NOT DO: clamp. A step of 99 does not become the
 *   last step, and an unknown id does not become the nearest one. Both return
 *   null and the caller starts at the beginning, because a position that cannot
 *   be trusted is not evidence of how far somebody got. The DATA is restored
 *   either way — nothing anybody typed is lost.
 */

/**
 * A saved step index, or null if it is not one this flow has.
 *
 * @param value     whatever was in the draft
 * @param stepCount how many steps the flow has today
 * @param firstStep the index the flow counts from (0 or 1 — both appear here)
 */
export function restoredStepIndex(
    value: unknown,
    stepCount: number,
    firstStep: 0 | 1 = 0,
): number | null {
    if (typeof value !== "number") return null;
    //   NaN and Infinity are numbers. NaN defeats every comparison, so it has to
    //   be refused by name rather than by a range check.
    if (!Number.isInteger(value)) return null;
    if (value < firstStep) return null;
    if (value > stepCount - 1 + firstStep) return null;
    return value;
}

/**
 * A saved step id, or null if this flow has no such step.
 */
export function restoredStepId<T extends string>(
    value: unknown,
    ids: readonly T[],
): T | null {
    if (typeof value !== "string") return null;
    return (ids as readonly string[]).includes(value) ? (value as T) : null;
}
