"use client";

/**
 * Reviewing the Farm Nation approvals the forensic scan cannot settle — #725.
 *
 * Two findings that look alike and are not. An approval whose application
 * DISAGREES with it is reconciled; an approval with no application findable
 * under any key is confirmed or revoked. Offering the same buttons for both
 * would let an admin "confirm" a drift case and leave the two records still
 * disagreeing while believing they had handled it, so the options come from the
 * case.
 *
 * WHAT THIS SCREEN IS CAREFUL ABOUT
 * ---------------------------------
 * IT NEVER OFFERS TO CREATE AN APPLICATION. That is the move that would make
 * the report green by making the data lie, and it is not on the screen because
 * it is not in the server either.
 *
 * REVOKE IS NOT DESTRUCTIVE AND THE SCREEN SAYS SO. The registration moves to
 * `revoked` and the status it held before is kept beside it. An admin who
 * believes revoking erases a member's history will hesitate over a reversible
 * action; one who believes confirming is free will not think about it. Both
 * misreadings cost something, so both are answered in the text.
 *
 * THE REASON BOX IS THE POINT, NOT A FORMALITY. On a "no application" case the
 * admin's sentence IS the record — there is no form, no submission and no
 * payment trail to point at afterwards. The placeholder says that rather than
 * asking for "notes".
 */

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck, Sprout } from "lucide-react";
import {
    listFarmNationApprovalCasesAction,
    decideFarmNationApprovalAction,
    type FarmNationApprovalReport,
} from "@/app/actions/admin";
import { decisionsFor, type FarmerCase } from "@/lib/farm-nation-approval-decision";

const DECISION_LABEL: Record<string, string> = {
    confirm: "Approval stands — record why",
    revoke: "Revoke the approval",
    reconcile: "Make the two records agree",
};

export default function FarmNationApprovalsPage() {
    const [report, setReport] = useState<FarmNationApprovalReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [reason, setReason] = useState<Record<string, string>>({});
    const [authoritative, setAuthoritative] = useState<Record<string, string>>({});
    const [done, setDone] = useState<Record<string, string>>({});

    const load = async () => {
        setLoading(true);
        //   #307 — an error REPLACES the results rather than emptying them. A
        //   screen that blanks on refresh tells an operator the problem went
        //   away.
        setError(null);
        try {
            const res: any = await listFarmNationApprovalCasesAction();
            if (!res?.success) {
                setError(res?.error ?? "Could not read the Farm Nation approvals.");
                return;
            }
            setReport(res.data);
        } catch {
            setError("Could not read the Farm Nation approvals.");
        } finally {
            setLoading(false);
        }
    };

    const decide = async (c: FarmerCase, decision: string) => {
        const why = (reason[c.userId] ?? "").trim();
        if (why.length < 8) {
            setError("Say why, in a sentence — on these cases your note is the only record of the basis.");
            return;
        }
        setBusy(`${c.userId}:${decision}`);
        setError(null);
        try {
            const res: any = await decideFarmNationApprovalAction({
                userId: c.userId,
                decision: decision as any,
                reason: why,
                authoritative: authoritative[c.userId],
            });
            if (!res?.success) {
                setError(res?.error ?? "Could not record that decision.");
                return;
            }
            setDone((d) => ({ ...d, [c.userId]: `Recorded: ${decision}.` }));
            await load();
        } catch {
            setError("Could not record that decision.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <Sprout className="w-6 h-6 text-slate-500" />
                    Farm Nation approvals
                </h1>
                <p className="text-slate-600 mt-2 text-sm leading-relaxed">
                    Members whose approval has no application behind it, or whose application disagrees
                    with it. Nothing here creates an application — confirming records that <em>you</em>{" "}
                    vouched for the approval, which is what was missing. Revoking keeps the previous
                    status beside it, so it can be read back and undone.
                </p>
            </div>

            <button
                onClick={load}
                disabled={loading}
                className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-2"
            >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {loading ? "Reading approvals…" : "Load approval cases"}
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
                            { n: report.noApplication, label: "No application behind it" },
                            { n: report.drift, label: "Records disagree" },
                            { n: report.settled, label: "Already reviewed" },
                        ].map((t) => (
                            <div key={t.label} className="p-4 bg-white border border-slate-200 rounded-xl">
                                <p className="text-2xl font-bold text-slate-900 tabular-nums">{t.n}</p>
                                <p className="text-xs text-slate-500 mt-1">{t.label}</p>
                            </div>
                        ))}
                    </div>

                    <div className="mt-6 space-y-4">
                        {report.cases.map((c) => (
                            <div key={c.userId} className="bg-white border border-slate-200 rounded-xl p-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="font-semibold text-slate-900">
                                            {c.fullName || "(no name on this record)"}
                                        </p>
                                        <p className="text-xs text-slate-500 break-all mt-0.5">
                                            {c.userId} · {c.maskedEmail}
                                        </p>
                                        <p className="text-sm text-slate-600 mt-2">
                                            {c.issue === "no-application"
                                                ? `Registration says "${c.userStatus}". No application found under any key.`
                                                : `Registration says "${c.userStatus}"; application says "${c.applicationStatuses.join("/")}"`
                                                  + `${c.foundVia ? ` (found via ${c.foundVia})` : ""}.`}
                                        </p>
                                    </div>
                                    <span
                                        className={`shrink-0 text-xs px-2.5 py-1 rounded-full border ${
                                            c.settled
                                                ? "bg-slate-100 text-slate-600 border-slate-200"
                                                : c.issue === "drift"
                                                    ? "bg-red-100 text-red-800 border-red-200"
                                                    : "bg-amber-100 text-amber-800 border-amber-200"
                                        }`}
                                    >
                                        {c.settled ? "Reviewed" : c.issue === "drift" ? "Records disagree" : "Needs a decision"}
                                    </span>
                                </div>

                                {c.settled && (
                                    <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                        <p className="text-sm text-slate-700">
                                            Reviewed by {c.confirmedBy ?? "an admin"}
                                            {c.confirmedReason ? ` — “${c.confirmedReason}”` : ""}
                                        </p>
                                    </div>
                                )}

                                {done[c.userId] && (
                                    <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                        <p className="text-sm text-emerald-800">{done[c.userId]}</p>
                                    </div>
                                )}

                                {!c.settled && (
                                    <div className="mt-4 space-y-3">
                                        {c.issue === "drift" && (
                                            <div className="flex flex-wrap gap-3 text-sm">
                                                <span className="text-slate-600">Which record is right?</span>
                                                {["user", "application"].map((side) => (
                                                    <label key={side} className="flex items-center gap-1.5">
                                                        <input
                                                            type="radio"
                                                            name={`auth-${c.userId}`}
                                                            checked={authoritative[c.userId] === side}
                                                            onChange={() =>
                                                                setAuthoritative((s) => ({ ...s, [c.userId]: side }))}
                                                        />
                                                        {side === "user" ? "The registration" : "The application"}
                                                    </label>
                                                ))}
                                            </div>
                                        )}

                                        <input
                                            value={reason[c.userId] ?? ""}
                                            onChange={(e) =>
                                                setReason((s) => ({ ...s, [c.userId]: e.target.value }))}
                                            placeholder="Why? On these cases your note is the only record of the basis."
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                        />

                                        <div className="flex flex-col sm:flex-row gap-3">
                                            {decisionsFor(c.issue).map((d) => (
                                                <button
                                                    key={d}
                                                    onClick={() => decide(c, d)}
                                                    disabled={busy === `${c.userId}:${d}`}
                                                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2 ${
                                                        d === "revoke"
                                                            ? "border border-red-300 text-red-700 hover:bg-red-50"
                                                            : "bg-slate-900 text-white hover:bg-slate-800"
                                                    }`}
                                                >
                                                    {busy === `${c.userId}:${d}` && (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    )}
                                                    {DECISION_LABEL[d]}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
