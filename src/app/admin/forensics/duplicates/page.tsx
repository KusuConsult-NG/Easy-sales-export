"use client";

/**
 * Settling the duplicate profiles the forensic scan reports — #724.
 *
 * The scan names the finding and refuses to act on it, correctly:
 *
 *     "Nothing here merges or deletes them: which of somebody's records is the
 *      person is not a decision code should make unattended."
 *
 * So the owner had a number and no next step. This screen is the next step. It
 * makes the DECISION easy to take and impossible to take carelessly; it does
 * not take it.
 *
 * WHAT THIS SCREEN IS CAREFUL ABOUT
 * ---------------------------------
 * IT LEADS WITH WHAT IS ACTUALLY OWED. The scan sorts worst-first by size,
 * which is right for a report and wrong for a worklist: most of the thirty-odd
 * groups are settled migrations — the scan's own text says "TWO IS NORMAL" —
 * and sorting by size would bury the handful of real decisions under them. The
 * groups that need a person come first and the resolved ones are collapsed.
 *
 * NOTHING IS DESTROYED AND THE SCREEN SAYS SO. The button does not say "merge"
 * or "delete", because it does neither: the records not chosen are marked as
 * superseded, keep everything they hold, and can be restored by clearing one
 * field. An operator who believes they are about to delete somebody's record
 * will hesitate over a safe action, and one who believes a merge is safe will
 * not hesitate over a dangerous one. The wording is the safeguard.
 *
 * THE RECOMMENDATION IS THE PLATFORM'S OWN. The suggested record is ranked by
 * the same rule the LOGIN uses to pick between candidates (#490), so the screen
 * cannot recommend one record while the platform hands the person another.
 * It is shown as a suggestion, and the operator can choose any row.
 *
 * A REASON IS REQUIRED. Six months on, the evidence on these rows will have
 * moved and the choice will not be re-derivable from them — the operator's own
 * sentence is the only thing that will still explain it. The server refuses
 * without one; this screen says so before the button is pressed rather than
 * after.
 */

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck, Users } from "lucide-react";
import {
    listDuplicateProfileGroupsAction,
    resolveDuplicateProfileGroupAction,
    type DuplicateProfileReport,
} from "@/app/actions/admin";
import type { DuplicateGroup } from "@/lib/duplicate-profile-resolution";

const naira = (n: number) => `₦${n.toLocaleString()}`;

const STATE_STYLE: Record<string, { label: string; cls: string }> = {
    "needs-a-decision": { label: "Needs a decision", cls: "bg-amber-100 text-amber-800 border-amber-200" },
    inconsistent: { label: "Look at this one", cls: "bg-red-100 text-red-800 border-red-200" },
    resolved: { label: "Already settled", cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

export default function DuplicateProfilesPage() {
    const [report, setReport] = useState<DuplicateProfileReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busyEmail, setBusyEmail] = useState<string | null>(null);
    const [choice, setChoice] = useState<Record<string, string>>({});
    const [reason, setReason] = useState<Record<string, string>>({});
    const [done, setDone] = useState<Record<string, string>>({});
    //   #806 — consent to move a balance, per group. Never defaulted to true:
    //   the whole point is that moving somebody's money is a second decision.
    const [moveMoney, setMoveMoney] = useState<Record<string, boolean>>({});

    const load = async () => {
        setLoading(true);
        //   #307 — an error REPLACES the results rather than emptying them, and
        //   the results are not cleared before the call. A screen that blanks
        //   on refresh tells an operator the problem went away.
        setError(null);
        try {
            const res: any = await listDuplicateProfileGroupsAction();
            if (!res?.success) {
                setError(res?.error ?? "Could not read the duplicate profiles.");
                return;
            }
            setReport(res.data);
        } catch {
            setError("Could not read the duplicate profiles.");
        } finally {
            setLoading(false);
        }
    };

    /** Records that would be superseded by the current choice AND hold money. */
    const fundedLosers = (group: DuplicateGroup, keepId: string | undefined) =>
        group.candidates.filter((c) => c.id !== keepId && c.walletBalance > 0);

    const apply = async (group: DuplicateGroup) => {
        const keepId = choice[group.email] ?? group.candidates.find((c) => c.recommended)?.id;
        const why = (reason[group.email] ?? "").trim();
        if (!keepId) return;
        if (why.length < 4) {
            setError("Say why that record is the person before applying it.");
            return;
        }

        /*
         *   #806 — the server refuses this too, and says so specifically. This
         *   is here so the operator is stopped by a sentence naming the amount
         *   rather than by a round trip.
         */
        const stranding = fundedLosers(group, keepId);
        if (stranding.length > 0 && !moveMoney[group.email]) {
            setError(
                `${stranding.map((c) => `${c.id} holds ${naira(c.walletBalance)}`).join(" and ")}. `
                + "Confirm the move before applying, or keep that record instead.",
            );
            return;
        }

        setBusyEmail(group.email);
        setError(null);
        try {
            const res: any = await resolveDuplicateProfileGroupAction({
                email: group.email,
                keepId,
                supersedeIds: group.candidates.filter((c) => c.id !== keepId).map((c) => c.id),
                reason: why,
                moveBalances: moveMoney[group.email] === true,
            });
            if (!res?.success) {
                setError(res?.error ?? "Could not apply that decision.");
                return;
            }
            setDone((d) => ({
                ...d,
                [group.email]: `Kept ${keepId}. ${res.data.superseded.length} record(s) marked superseded`
                    + `${res.data.moved?.length ? `, and moved ${res.data.moved.join(" and ")} onto it` : ""}.`,
            }));
            await load();
        } catch {
            setError("Could not apply that decision.");
        } finally {
            setBusyEmail(null);
        }
    };

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <Users className="w-6 h-6 text-slate-500" />
                    Duplicate profiles
                </h1>
                <p className="text-slate-600 mt-2 text-sm leading-relaxed">
                    One address, several records. Choose which record is the person — the others are
                    marked as <strong>superseded</strong>, keep everything they hold, and are never
                    deleted. Every module already follows that marker, and clearing it undoes the
                    decision.
                </p>
            </div>

            <button
                onClick={load}
                disabled={loading}
                className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-2"
            >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {loading ? "Reading profiles…" : "Load duplicate profiles"}
            </button>

            {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-red-800">{error}</p>
                </div>
            )}

            {report && (
                <>
                    <div className="mt-6 grid grid-cols-3 gap-3">
                        {[
                            { n: report.needsADecision, label: "Need a decision" },
                            { n: report.inconsistent, label: "Look at these" },
                            { n: report.resolved, label: "Already settled" },
                        ].map((t) => (
                            <div key={t.label} className="p-4 bg-white border border-slate-200 rounded-xl">
                                <p className="text-2xl font-bold text-slate-900 tabular-nums">{t.n}</p>
                                <p className="text-xs text-slate-500 mt-1">{t.label}</p>
                            </div>
                        ))}
                    </div>

                    <div className="mt-6 space-y-4">
                        {report.groups.map((group) => {
                            const style = STATE_STYLE[group.state];
                            const settled = group.state === "resolved";
                            const keepId = choice[group.email]
                                ?? group.candidates.find((c) => c.recommended)?.id;

                            return (
                                <div key={group.email} className="bg-white border border-slate-200 rounded-xl p-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="font-semibold text-slate-900">{group.maskedEmail}</p>
                                            <p className="text-sm text-slate-600 mt-1">{group.explanation}</p>
                                        </div>
                                        <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full border ${style.cls}`}>
                                            {style.label}
                                        </span>
                                    </div>

                                    {done[group.email] && (
                                        <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                            <p className="text-sm text-emerald-800">{done[group.email]}</p>
                                        </div>
                                    )}

                                    <div className="mt-4 space-y-2">
                                        {group.candidates.map((c) => (
                                            <label
                                                key={c.id}
                                                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
                                                    keepId === c.id && !settled
                                                        ? "border-slate-900 bg-slate-50"
                                                        : "border-slate-200"
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name={`keep-${group.email}`}
                                                    checked={keepId === c.id}
                                                    disabled={settled}
                                                    onChange={() => setChoice((s) => ({ ...s, [group.email]: c.id }))}
                                                    className="mt-1"
                                                />
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-slate-900 break-all">
                                                        {c.fullName || "(no name on this record)"}
                                                        {c.recommended && (
                                                            <span className="ml-2 text-xs text-emerald-700">
                                                                suggested
                                                            </span>
                                                        )}
                                                        {c.migratedTo && (
                                                            <span className="ml-2 text-xs text-slate-500">
                                                                superseded → {c.migratedTo}
                                                            </span>
                                                        )}
                                                    </p>
                                                    <p className="text-xs text-slate-500 break-all mt-0.5">{c.id}</p>
                                                    {c.walletBalance > 0 && (
                                                        <p className="text-xs font-medium text-amber-700 mt-1">
                                                            holds {naira(c.walletBalance)} in its wallet
                                                        </p>
                                                    )}
                                                    <p className="text-xs text-slate-600 mt-1">
                                                        {c.registrations} registration(s) · {c.roles.length} role(s)
                                                        {c.profileComplete ? " · profile complete" : ""}
                                                        {c.createdAt ? ` · created ${c.createdAt.slice(0, 10)}` : ""}
                                                    </p>
                                                </div>
                                            </label>
                                        ))}
                                    </div>

                                    {!settled && fundedLosers(group, keepId).length > 0 && (
                                        /*
                                         *   #806 — THE SECOND DECISION, STATED.
                                         *
                                         *   Superseding a funded record used to
                                         *   be refused outright, with an
                                         *   instruction ("move the balance
                                         *   first") that no screen could carry
                                         *   out. It can be done now, and the
                                         *   amount is named here rather than
                                         *   moved quietly: the member can reach
                                         *   the money on the keeper, but it is
                                         *   still their money changing rows.
                                         */
                                        <label className="mt-4 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="mt-0.5"
                                                checked={moveMoney[group.email] === true}
                                                onChange={(e) =>
                                                    setMoveMoney((m) => ({ ...m, [group.email]: e.target.checked }))}
                                            />
                                            <span className="text-sm text-amber-900">
                                                Also move{" "}
                                                {fundedLosers(group, keepId)
                                                    .map((c) => `${naira(c.walletBalance)} from ${c.id}`)
                                                    .join(" and ")}{" "}
                                                onto {keepId}. Without this the group cannot be settled —
                                                superseding a funded record would leave the money where
                                                nothing can reach it.
                                            </span>
                                        </label>
                                    )}

                                    {!settled && (
                                        <div className="mt-4 flex flex-col sm:flex-row gap-3">
                                            <input
                                                value={reason[group.email] ?? ""}
                                                onChange={(e) =>
                                                    setReason((s) => ({ ...s, [group.email]: e.target.value }))}
                                                placeholder="Why is this the person? (recorded on the audit trail)"
                                                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                            />
                                            <button
                                                onClick={() => apply(group)}
                                                disabled={busyEmail === group.email}
                                                className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                                            >
                                                {busyEmail === group.email && (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                )}
                                                Mark the others superseded
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
