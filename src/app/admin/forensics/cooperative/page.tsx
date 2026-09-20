"use client";

/**
 * Writing the cooperative membership rows the platform owes — #726.
 *
 * The reconciliation check says what this is: "The role was granted. The row
 * should exist. Somebody has to make it exist." So unlike the Farm Nation
 * screen beside it, the answer here is usually just "yes, write it" — and this
 * screen's job is to make clear how little of it is actually a decision.
 *
 * WHAT THIS SCREEN IS CAREFUL ABOUT
 * ---------------------------------
 * IT SHOWS THE BALANCE AS DERIVED, AND WHERE FROM. "₦42,000 from 7 completed
 * transactions" is a figure an admin can check; a bare number in a box is one
 * they have to trust. There is no input for it, because there is nothing to
 * decide — inventing a savings figure would be inventing money.
 *
 * AND IT ONLY ASKS FOR A TIER WHEN THERE IS ONE TO CHOOSE. Where the
 * registration already records a tier, the screen states it rather than
 * offering a box. An editable field would invite an admin to "correct" a tier
 * the member paid for, and the server refuses that anyway — so offering it
 * would be a form that lies about what it can do.
 *
 *   #803 AND FOR A WHILE IT WAS EXACTLY THAT FORM. This cooperative has a
 *   single tier, "Member" — calculateUserTier returns it at every savings
 *   level and the membership schema admits nothing else — but the screen
 *   offered a choice between "tier1" and "tier2" from a stale second constant
 *   that happened to share the name COOPERATIVE_TIERS with the live one.
 *   Eighteen members were held under "Need a tier chosen" waiting on a
 *   decision that does not exist, and either answer would have written a value
 *   the schema rejects. The list is derived from the tier system now, so the
 *   radios appear only if a second tier is ever priced again.
 *
 * THE ROW IS CREATED `pending`, AND THE TEXT SAYS SO. An admin who believes
 * this activates a membership would be surprised later; one who knows it does
 * not will go and activate it if that is what they meant.
 */

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck, Landmark } from "lucide-react";
import {
    listMissingMembershipsAction,
    createMissingMembershipAction,
    type MissingMembershipReport,
} from "@/app/actions/admin";
import {
    MEMBERSHIP_TIERS,
    DEFAULT_MEMBERSHIP_TIER,
    type MissingMembershipCase,
} from "@/lib/cooperative-membership-repair";

const naira = (n: number) => `₦${n.toLocaleString()}`;

export default function CooperativeMembershipsPage() {
    const [report, setReport] = useState<MissingMembershipReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [reason, setReason] = useState<Record<string, string>>({});
    const [tier, setTier] = useState<Record<string, string>>({});
    const [done, setDone] = useState<Record<string, string>>({});

    const load = async () => {
        setLoading(true);
        //   #307 — an error REPLACES the results rather than emptying them.
        setError(null);
        try {
            const res: any = await listMissingMembershipsAction();
            if (!res?.success) {
                setError(res?.error ?? "Could not read the cooperative memberships.");
                return;
            }
            setReport(res.data);
        } catch {
            setError("Could not read the cooperative memberships.");
        } finally {
            setLoading(false);
        }
    };

    const create = async (c: MissingMembershipCase) => {
        const why = (reason[c.userId] ?? "").trim();
        if (why.length < 8) {
            setError("Say why this membership is owed, in a sentence.");
            return;
        }
        setBusy(c.userId);
        setError(null);
        try {
            const res: any = await createMissingMembershipAction({
                userId: c.userId,
                reason: why,
                tier: c.needsATier ? tier[c.userId] : undefined,
            });
            if (!res?.success) {
                setError(res?.error ?? "Could not create that membership row.");
                return;
            }
            setDone((d) => ({
                ...d,
                [c.userId]: `Created at ${res.data.tier}, balance ${naira(res.data.balance)}.`,
            }));
            await load();
        } catch {
            setError("Could not create that membership row.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <Landmark className="w-6 h-6 text-slate-500" />
                    Cooperative memberships
                </h1>
                <p className="text-slate-600 mt-2 text-sm leading-relaxed">
                    Members who hold the cooperative role with no membership row behind it. The row is
                    owed — creating it is bookkeeping, not a grant. The balance is{" "}
                    <strong>derived from their completed transactions</strong>, never typed in, and the
                    row is created <strong>pending</strong> so the usual activation paths still decide.
                </p>
            </div>

            <button
                onClick={load}
                disabled={loading}
                className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-2"
            >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {loading ? "Reading memberships…" : "Load missing memberships"}
            </button>

            {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-red-800">{error}</p>
                </div>
            )}

            {report && (
                <>
                    <div className="mt-6 grid grid-cols-2 gap-3">
                        {[
                            { n: report.fullyKnown, label: "Everything already known" },
                            { n: report.needATier, label: "Need a tier chosen" },
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
                                    </div>
                                    <span
                                        className={`shrink-0 text-xs px-2.5 py-1 rounded-full border ${
                                            c.needsATier
                                                ? "bg-amber-100 text-amber-800 border-amber-200"
                                                : "bg-slate-100 text-slate-700 border-slate-200"
                                        }`}
                                    >
                                        {c.needsATier ? "Needs a tier" : "Ready to write"}
                                    </span>
                                </div>

                                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <dt className="text-xs text-slate-500">Tier</dt>
                                        <dd className="text-slate-900">
                                            {c.knownTier
                                                ?? (c.needsATier
                                                    ? "not recorded — choose below"
                                                    : `not recorded — will be written as "${DEFAULT_MEMBERSHIP_TIER}"`)}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs text-slate-500">Balance, derived</dt>
                                        <dd className="text-slate-900 tabular-nums">
                                            {naira(c.ledgerBalance)}{" "}
                                            <span className="text-xs text-slate-500">
                                                from {c.ledgerRows} completed transaction
                                                {c.ledgerRows === 1 ? "" : "s"}
                                            </span>
                                        </dd>
                                    </div>
                                </dl>

                                {done[c.userId] && (
                                    <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                        <p className="text-sm text-emerald-800">{done[c.userId]}</p>
                                    </div>
                                )}

                                <div className="mt-4 space-y-3">
                                    {c.needsATier && (
                                        <div className="flex flex-wrap gap-3 text-sm">
                                            <span className="text-slate-600">Tier:</span>
                                            {MEMBERSHIP_TIERS.map((t) => (
                                                <label key={t} className="flex items-center gap-1.5">
                                                    <input
                                                        type="radio"
                                                        name={`tier-${c.userId}`}
                                                        checked={tier[c.userId] === t}
                                                        onChange={() => setTier((s) => ({ ...s, [c.userId]: t }))}
                                                    />
                                                    {t}
                                                </label>
                                            ))}
                                        </div>
                                    )}

                                    <div className="flex flex-col sm:flex-row gap-3">
                                        <input
                                            value={reason[c.userId] ?? ""}
                                            onChange={(e) =>
                                                setReason((s) => ({ ...s, [c.userId]: e.target.value }))}
                                            placeholder="Why is this membership owed? (recorded on the row and the audit trail)"
                                            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                        />
                                        <button
                                            onClick={() => create(c)}
                                            disabled={busy === c.userId}
                                            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                                        >
                                            {busy === c.userId && <Loader2 className="w-4 h-4 animate-spin" />}
                                            Write the membership row
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
