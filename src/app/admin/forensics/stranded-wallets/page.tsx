"use client";

/**
 * Money filed under a profile nobody can sign in as — #811.
 *
 * WHY THIS EXISTS
 * ---------------
 * `findStrandedWalletsAction` and `consolidateWalletAction` were written,
 * tested and shipped with NO CALLER. Money moves at the live id and nowhere
 * else — `credit_wallet_once` inserts at `p_user_id`, `debit_wallet_once`
 * updates `WHERE id = p_user_id`, and that id is the session's, which is live
 * by construction. So a balance left under a superseded profile cannot be
 * received into, spent from, or withdrawn, by the member or by anybody else.
 *
 * The platform could already DETECT that, REFUSE to create more of it, and do
 * nothing about what was there. Migration 046 gave it the one safe way to move
 * such a balance, and the only way to reach that was a database console.
 *
 * This screen is the way in. It is not a convenience: an admin who cannot reach
 * the repair reaches for raw SQL instead, and hand-written UPDATE statements
 * against two wallet rows is exactly the thing 046 exists to prevent.
 *
 * WHAT THIS SCREEN IS CAREFUL ABOUT
 * ---------------------------------
 * IT NEVER ASKS WHERE THE MONEY SHOULD GO. The destination is the profile the
 * superseded record ALREADY points at, read from the database, and 046 re-reads
 * that pointer inside the same transaction as the move. A destination field
 * would be a transfer primitive with an admin's hand on it, and the function
 * would refuse the input anyway — so offering it would be a form that lies
 * about what it can do.
 *
 * IT REQUIRES A SENTENCE, and the server requires it too. Six months on, the
 * rows will not explain why somebody's balance moved; the audit row is the only
 * place that can, and it is written BEFORE the effect.
 *
 * A FAILED SCAN IS SHOWN AS A FAILURE, NOT AS "no stranded money". #313's rule,
 * and it matters here as much as on the forensic scan: this is the screen
 * somebody reads to decide whether anybody's money is stuck, and "we could not
 * check" rendering as "nothing found" is the worst lie it could tell. Results
 * are held null until a scan returns, and an error REPLACES them rather than
 * emptying them (#307).
 *
 * AND `scanned` IS SHOWN BESIDE THE COUNT. "0 stranded" means something quite
 * different depending on whether 272 wallets were examined or none were, and
 * the figure that distinguishes those is the one an operator needs to trust the
 * zero. The measured state when this was written: 765 superseded profiles, 272
 * carrying a wallet row, every one of them at zero.
 */

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Wallet, ShieldCheck } from "lucide-react";
import {
    findStrandedWalletsAction,
    consolidateWalletAction,
    type StrandedWalletReport,
    type StrandedWallet,
} from "@/app/actions/admin";
import { numberOrZero } from "@/lib/numbers";

const naira = (n: number) => `₦${n.toLocaleString()}`;

export default function StrandedWalletsPage() {
    const [report, setReport] = useState<StrandedWalletReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [reason, setReason] = useState<Record<string, string>>({});
    const [done, setDone] = useState<Record<string, string>>({});

    const load = async () => {
        setLoading(true);
        //   #307 — an error REPLACES the results rather than emptying them.
        setError(null);
        try {
            const res: any = await findStrandedWalletsAction();
            if (!res?.success) {
                setError(res?.error ?? "Could not read the wallets.");
                return;
            }
            setReport(res.data);
        } catch {
            setError("Could not read the wallets.");
        } finally {
            setLoading(false);
        }
    };

    const move = async (w: StrandedWallet) => {
        const why = (reason[w.fromId] ?? "").trim();
        if (why.length < 4) {
            setError("Say why this balance is being moved, in a sentence.");
            return;
        }
        setBusy(w.fromId);
        setError(null);
        try {
            const res: any = await consolidateWalletAction({
                fromId: w.fromId, toId: w.toId, reason: why,
            });
            if (!res?.success) {
                //   The server's own words. Every refusal here comes from
                //   migration 046 and each asks for something different, so
                //   flattening them to "could not move" would take away the
                //   part that says what to do next.
                setError(res?.error ?? "Could not move that balance.");
                return;
            }
            setDone((d) => ({
                ...d,
                [w.fromId]: res.data?.moved
                    ? `Moved ${naira(res.data.amount)}. The live wallet now holds ${naira(res.data.toBalance)}.`
                    : "Nothing was left to move — the balance is already where it belongs.",
            }));
            await load();
        } catch {
            setError("Could not move that balance.");
        } finally {
            setBusy(null);
        }
    };

    const total = report?.stranded.reduce((sum, w) => sum + w.balance, 0) ?? 0;

    /*
     *   #928 — WHETHER THE WALK SAW THE WHOLE TABLE.
     *
     *   Read the way #918's duplicates screen reads it, and for its reason: a
     *   report from a deployment older than this screen carries no `scope` at
     *   runtime, whatever the type says, and a plain member access on it takes
     *   the screen down. An absent scope means the server said nothing, so this
     *   claims nothing in either direction.
     */
    const scope = report?.scope;
    const scanIncomplete = scope ? scope.complete === false : false;

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <Wallet className="w-6 h-6 text-slate-500" />
                    Stranded wallet balances
                </h1>
                <p className="text-slate-600 mt-2 text-sm leading-relaxed">
                    Money filed under a profile the platform no longer signs anybody in as. It cannot be
                    received into, spent from or withdrawn — not by the member, not by anybody.{" "}
                    <strong>The destination is not a choice:</strong> it is the profile the old record
                    already points at, and the database re-reads that pointer inside the same transaction
                    as the move.
                </p>
            </div>

            <button
                onClick={load}
                disabled={loading}
                className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-2"
            >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {loading ? "Reading wallets…" : "Find stranded balances"}
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
                            { n: String(report.stranded.length), label: "Balances that cannot be reached" },
                            { n: naira(total), label: "Held in them altogether" },
                            { n: String(report.scanned), label: "Superseded profiles with a wallet, examined" },
                        ].map((t) => (
                            <div key={t.label} className="p-4 bg-white border border-slate-200 rounded-xl">
                                <p className="text-2xl font-bold text-slate-900 tabular-nums">{t.n}</p>
                                <p className="text-xs text-slate-500 mt-1">{t.label}</p>
                            </div>
                        ))}
                    </div>

                    {/*
                      *   #928 — WHAT THE THREE NUMBERS ABOVE DO NOT COVER.
                      *
                      *   This screen's header already argues the near half of this:
                      *   "0 stranded means something quite different depending on
                      *   whether 272 wallets were examined or none were." One step
                      *   further back is the walk itself, which stops at fifty pages
                      *   of a thousand — and `scanned` cannot reveal that, because
                      *   272 is below the ceiling whether the walk read the whole
                      *   table or gave up halfway.
                      */}
                    {scanIncomplete && (
                        <div className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-4">
                            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                                What this list does not cover
                            </p>
                            <p className="mt-2 text-sm text-slate-600">
                                The walk read {numberOrZero(scope?.scanned).toLocaleString()} profiles and
                                stopped at its {numberOrZero(scope?.ceiling).toLocaleString()}-row limit, so
                                there may be superseded profiles holding a balance it never reached. Among the
                                rows it did read, what is listed above is everything — but a clean result here
                                is not a clean table.
                            </p>
                        </div>
                    )}

                    {/*
                      *   #928 — AND NOT WHEN THE WALK STOPPED SHORT. "No money is
                      *   stranded" is a claim about the table; a walk that gave up
                      *   at its ceiling cannot make it, and this is the screen
                      *   somebody reads to decide whether anybody's money is stuck.
                      *   The notice above says what was read instead.
                      */}
                    {report.stranded.length === 0 && !scanIncomplete && (
                        <div className="mt-6 p-5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm font-semibold text-emerald-900">
                                    No money is stranded.
                                </p>
                                <p className="text-sm text-emerald-800 mt-1">
                                    {report.scanned} superseded {report.scanned === 1 ? "profile" : "profiles"}{" "}
                                    {report.scanned === 1 ? "carries" : "carry"} a wallet row, and{" "}
                                    {report.scanned === 1 ? "it holds" : "every one holds"} nothing. That
                                    count is shown because &ldquo;none found&rdquo; means something different
                                    when nothing was examined.
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="mt-6 space-y-4">
                        {report.stranded.map((w) => (
                            <div key={w.fromId} className="bg-white border border-slate-200 rounded-xl p-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="font-semibold text-slate-900">
                                            {w.fullName || "(no name on this record)"}
                                        </p>
                                        <p className="text-xs text-slate-500 break-all mt-0.5">{w.email}</p>
                                    </div>
                                    <span className="shrink-0 text-sm font-bold text-amber-800 bg-amber-100 border border-amber-200 px-3 py-1 rounded-full tabular-nums">
                                        {naira(w.balance)}
                                    </span>
                                </div>

                                <dl className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <dt className="text-xs text-slate-500">Filed under (superseded)</dt>
                                        <dd className="font-mono text-xs text-slate-800 break-all mt-0.5">
                                            {w.fromId}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs text-slate-500">
                                            Belongs to (live) — read from the record, not chosen
                                        </dt>
                                        <dd className="font-mono text-xs text-slate-800 break-all mt-0.5">
                                            {w.toId}
                                        </dd>
                                    </div>
                                </dl>

                                {done[w.fromId] ? (
                                    <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                                        <p className="text-sm text-emerald-800">{done[w.fromId]}</p>
                                    </div>
                                ) : (
                                    <div className="mt-4 space-y-3">
                                        <label className="block">
                                            <span className="text-xs text-slate-500">
                                                Why this balance is being moved — recorded in the audit log
                                            </span>
                                            <input
                                                type="text"
                                                value={reason[w.fromId] ?? ""}
                                                onChange={(e) =>
                                                    setReason((r) => ({ ...r, [w.fromId]: e.target.value }))
                                                }
                                                placeholder="Same person, duplicate settled on 12 March."
                                                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                            />
                                        </label>
                                        <button
                                            onClick={() => move(w)}
                                            disabled={busy === w.fromId}
                                            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-2"
                                        >
                                            {busy === w.fromId && <Loader2 className="w-4 h-4 animate-spin" />}
                                            {busy === w.fromId
                                                ? "Moving…"
                                                : `Move ${naira(w.balance)} to the live profile`}
                                        </button>
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
