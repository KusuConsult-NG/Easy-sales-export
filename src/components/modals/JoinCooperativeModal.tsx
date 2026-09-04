"use client";

/**
 *   #380 A FOURTH WAY TO JOIN THE COOPERATIVE, WHICH CREDITED SAVINGS WITH NO
 *        PAYMENT — AND A DESCRIPTION OF THIS FILE THAT I HAD PROPAGATED AND
 *        WHICH WAS FALSE IN EVERY PART.
 *
 *   WHAT WAS HERE
 *   -------------
 *   A module-scope async function carrying the server directive on its own
 *   first line, inside this client module, wired to the form below through
 *   useActionState. It hand-rolled a complete join, and it was wrong in four
 *   independent ways:
 *
 *   1. IT CREDITED AN UNPAID CONTRIBUTION IN FULL. The form's "Initial
 *      Contribution (Optional)" number went straight onto the membership row's
 *      opening balance and was incremented into the cooperative's totalSavings.
 *      No payment was taken anywhere in the function. This is the SAME defect
 *      joinCooperativeAction was fixed for in an earlier pass — that door now
 *      refuses any non-zero contribution, with the reason recorded on it: the
 *      cooperative loan limit is a multiple of savings balance
 *      (lib/cooperative-utils.ts), so an invented balance was borrowing power
 *      too. The fix landed on one of two doors. #83/#297's shape exactly.
 *
 *   2. THE MEMBERSHIP IT CREATED WAS INVISIBLE TO THE PRODUCT. It wrote to the
 *      legacy nested path under a cooperative document — the only code in the
 *      tree that still touches it. Every reader in this codebase, from
 *      getDashboardData to canTransactAsMember to every admin list, reads the
 *      root cooperative_members collection. So somebody "joined" here would
 *      have a savings balance no screen could show them and no admin could
 *      find, while the cooperative's totalSavings counted it.
 *
 *   3. IT BYPASSED THE REGISTRATION FEE. The product has exactly one live join
 *      path — /cooperatives/onboarding — and every "Join Cooperative" control
 *      in the app points there (CooperativeWidget, the id-card page, the loans
 *      and fixed-savings empty states). That path takes the fee through
 *      Paystack and leaves the member pending until it clears. This one made
 *      them a member immediately, for nothing.
 *
 *   4. IT RESTATED A RULE NOBODY ELSE HOLDS. It required a "Monthly Savings
 *      Target" of at least ₦1,000 and stored it. Nothing in this repository
 *      READS monthlyTarget — not a screen, not a query, not a rule; the field
 *      has three writers and zero readers. A required input whose value is
 *      discarded is a screen announcing what the code cannot deliver.
 *
 *   HOW BAD IT WAS, MEASURED RATHER THAN ASSUMED
 *   --------------------------------------------
 *   Not a live endpoint. Two facts, both established rather than reasoned:
 *
 *   - NOTHING IMPORTS THIS FILE. It is in no page's module graph, so webpack
 *     never compiled it and no action id was ever registered for it.
 *
 *   - AND IT COULD NOT HAVE BEEN MOUNTED. A probe page holding the same
 *     construct — an inline server function inside a client module, wired
 *     through useActionState — was put into src/app and built. Next 16.3
 *     refuses it outright:
 *
 *         It is not allowed to define inline "use server" annotated Server
 *         Actions in Client Components.
 *
 *     The probe was then removed. So this was a build failure waiting for its
 *     first caller, not an armed endpoint — which is a smaller claim than the
 *     one this comment would have made without running the experiment, and the
 *     right one to record.
 *
 *   That does NOT make it harmless. #382 established, on the same day, that no
 *   test in this repository can see a build failure, and that CI's build runs
 *   only on pull requests to main. So the person who mounted this modal would
 *   have found out from a red deploy, and the four faults below would have been
 *   sitting in the file they then repaired to get it green.
 *   the-app-can-still-be-built.test.ts now fails on the construct itself.
 *
 *   WHY IT IS NOT BEING WIRED, AND NOT BEING KEPT BEHIND A FLAG
 *   ----------------------------------------------------------
 *   The offline checkouts retired in #379 were kept whole behind an env flag
 *   because their implementations were CORRECT and merely unsettleable. This
 *   one is not correct: each of the four faults above would have to be undone
 *   before the code could run, and preserving it would preserve them. What is
 *   worth keeping is the record of what it did, which is this comment, and the
 *   door it duplicated, which already exists and is already hardened.
 *
 *   Nor is the modal pointed at joinCooperativeAction. That action has no UI
 *   caller either, creates a membership with no fee, and building a way into it
 *   would be opening a second front door beside the paid one the product uses.
 *
 *   So the modal keeps its job — showing a prospective member what the
 *   cooperative offers — and its primary control now goes to the join flow that
 *   exists. Nothing is deleted from any store; a form that wrote three
 *   documents no longer writes any.
 *
 *   THE FALSE CLAIM, CORRECTED WHEREVER IT APPEARS
 *   ----------------------------------------------
 *   Four places described this file as "a client-side Firebase-SDK component
 *   from before the Supabase migration", named as the sole writer of
 *   users.cooperativeId. TWO OF THOSE FOUR I WROTE MYSELF, in the #248 pass,
 *   by repeating what the other two said instead of reading the file. It was
 *   wrong in all three of its parts:
 *
 *     - not Firebase: the writes went through @/lib/supabase-db;
 *     - not client-side: they ran inside the server function described above;
 *     - not from before the migration: `git log -S` shows the file has never
 *       at any commit contained a firebase/firestore import, and the
 *       supabase-db import arrived with the migration commit itself.
 *
 *   With the writes gone, users.cooperativeId now has ZERO writers anywhere in
 *   the tree — which is what #248's decision (cooperative admins are not
 *   scoped) already assumed in substance, and the ratchet in
 *   cooperative-admin-scope-is-inert.test.ts now pins the stronger fact.
 */

import Link from "next/link";
import { Users, CheckCircle, ArrowRight } from "lucide-react";
import Modal from "@/components/ui/Modal";

/**
 * NO cooperativeId PROP.
 *
 * The old one took a cooperative id and wrote it onto three documents. The join
 * flow does not accept one: /cooperatives/onboarding reads exactly one search
 * param, `token`, for an invite. Passing a `cooperativeId` through would be a
 * value nothing reads — the defect this file is being fixed for. #248 also
 * measured that nothing in the tree CREATES a cooperative, so the estate is
 * one; there is no second cooperative to disambiguate.
 */
interface JoinCooperativeModalProps {
    isOpen: boolean;
    onClose: () => void;
    cooperativeName: string;
}

/** The one live join path. Every other "Join Cooperative" control points here. */
export const COOPERATIVE_JOIN_PATH = "/cooperatives/onboarding";

export default function JoinCooperativeModal({
    isOpen,
    onClose,
    cooperativeName,
}: JoinCooperativeModalProps) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Join Cooperative">
            <div className="space-y-6">
                {/* Cooperative Info */}
                <div className="bg-linear-to-br from-primary/10 to-primary/5 rounded-xl p-6 border border-primary/20">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                            <Users className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900">{cooperativeName}</h3>
                            <p className="text-xs text-slate-500">Agricultural Cooperative</p>
                        </div>
                    </div>
                    <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-600" />
                            <span className="text-slate-900">Earn interest on savings</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-600" />
                            <span className="text-slate-900">Access to low-interest loans</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-600" />
                            <span className="text-slate-900">Share profits from collective sales</span>
                        </div>
                    </div>
                </div>

                {/* What actually happens next, rather than a form that did something else. */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                    <p className="text-sm font-semibold text-slate-900">How joining works</p>
                    <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
                        <li>Complete the membership form and pay the registration fee.</li>
                        <li>Your membership activates once the payment is confirmed.</li>
                        <li>You then make contributions from the cooperative dashboard.</li>
                    </ol>
                    <p className="text-xs text-slate-500 pt-1">
                        Savings are only ever credited by a contribution you have actually
                        paid — never at the point of joining.
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 px-6 py-3 rounded-xl border border-slate-300 text-slate-900 font-semibold hover:bg-slate-50 transition"
                    >
                        Cancel
                    </button>
                    <Link
                        href={COOPERATIVE_JOIN_PATH}
                        className="flex-1 px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition inline-flex items-center justify-center gap-2"
                    >
                        Continue to Membership
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </div>
        </Modal>
    );
}
