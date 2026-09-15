/**
 * The two controls the owner asked for on every application form.
 *
 *   #777 SIX FORMS, AND NO WAY OUT OF ANY OF THEM.
 *
 *   The owner: "On each of the forms, add a button to submit another
 *   application when one is completed and also add a home button to return
 *   back to home at the top left corner."
 *
 *   Six multi-step forms — WAVE, Academy, Export, Farm Nation, Marketplace and
 *   the Cooperative onboarding — and none of them carried a link home. An
 *   applicant part-way through a seven-step form whose mind changed had the
 *   browser's Back button and nothing else, and several of these forms install
 *   a beforeunload handler, so Back asks her to confirm she wants to discard
 *   her answers. That is the whole of the exit.
 *
 * ── WHY ONE COMPONENT AND NOT SIX HEADERS ───────────────────────────────────
 *
 *   Because six copies is how every other finding in this audit began. The
 *   wording, the destination and the placement are settled once here; a form
 *   adds the component and cannot get them subtly different.
 *
 * ── THE ONE JUDGEMENT CALL, STATED ──────────────────────────────────────────
 *
 *   "Submit another application" has two possible readings and only one of them
 *   is buildable:
 *
 *     (a) FILE A SECOND APPLICATION TO THE SAME PROGRAMME. The server refuses
 *         this, deliberately and by name — "Your previous application is still
 *         being processed" — and it is right to: a member with two pending WAVE
 *         applications is a duplicate for the reviewer to reconcile, which is
 *         what findConflictingApplication exists to prevent. A button that
 *         produces that error every time is worse than no button.
 *
 *     (b) APPLY TO ANOTHER PROGRAMME. The platform runs six, the get-started
 *         page is the chooser for all of them, and an applicant who has just
 *         finished one is exactly the person who might want a second.
 *
 *   (b) is what this builds, and it is labelled "Apply to another programme" so
 *   the button says what it does rather than what it was called. If the owner
 *   meant (a), the label is the only thing that needs changing — the refusal it
 *   would hit is a server rule, not a missing screen.
 */

"use client";

import Link from "next/link";
import { Home, LayoutGrid } from "lucide-react";

/**
 * A link home, for the top-left corner of a form.
 *
 * Rendered as a LINK and not a router.push button on purpose: a form that
 * guards against accidental navigation should still let the applicant leave
 * deliberately, and a real anchor is what middle-click, right-click and a
 * screen reader's link list all expect.
 */
export function FormHomeButton({ className = "" }: { className?: string }) {
    return (
        <Link
            href="/"
            aria-label="Return to home"
            className={`inline-flex items-center gap-2 px-3 py-2 -ml-1 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors ${className}`}
        >
            <Home className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Home</span>
        </Link>
    );
}

/**
 * The "apply to another programme" control, for a completed application.
 *
 * See the header for why this is not a second application to the same
 * programme.
 */
export function ApplyToAnotherProgrammeButton({ className = "" }: { className?: string }) {
    return (
        <Link
            href="/auth/get-started"
            className={`inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50 transition-colors ${className}`}
        >
            <LayoutGrid className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Apply to another programme</span>
        </Link>
    );
}
