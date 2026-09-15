"use client";

/**
 * Forensic data-integrity scan — the way in. #266.
 *
 * WHY THIS EXISTS
 * ---------------
 * `runForensicScanAction` is 747 lines of cross-module integrity checking:
 * ghost auth users, orphaned products, phone drift between a seller's profile
 * and their verification, WAVE eligibility paradoxes, cooperative balance
 * against the ledger, Farm Nation badge against approval, export funding
 * against its ceiling, academy access against plan.
 *
 * It had no caller. Four findings in this audit (#331, #372, #373 and the
 * phone-drift one) repaired checks that could never fail, and four suites
 * execute it — but nothing in the product ran it, so an operator could not read
 * a single one of its answers. #331 recorded "build the screen or drop it" as an
 * owner decision; #266 took it, and this is the screen.
 *
 * WHAT THIS SCREEN IS CAREFUL ABOUT
 * ---------------------------------
 * A FAILED SCAN IS SHOWN AS A FAILURE, NOT AS A CLEAN BILL OF HEALTH. #313's
 * lesson, and it matters more here than anywhere: this is the screen an operator
 * reads to decide whether the platform's data is sound, so "we could not check"
 * rendering as "nothing found" would be the worst possible lie to tell them.
 * The results are held as null until a scan actually returns, and an error
 * replaces them rather than emptying them (#307).
 *
 * "inconclusive" IS RENDERED AS ITS OWN STATE. The status exists because two
 * checks used to report "pass" for a question they could not ask (#331). Folding
 * it in with pass on the screen would undo that repair at the last step.
 *
 * IT RUNS ON DEMAND. The scan reads across eight collections; firing it on
 * navigation would charge that cost to every visit. The operator presses a
 * button, and the button says what it is about to do.
 */

import { useState } from "react";
import {
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
    HelpCircle,
    Loader2,
    ShieldAlert,
    Stethoscope,
} from "lucide-react";
import { runForensicScanAction, repairForensicFindingAction, type ScanResult } from "@/app/actions/forensics";

type Status = ScanResult["status"];

const STATUS_STYLE: Record<Status, { chip: string; icon: typeof CheckCircle2; label: string }> = {
    pass: { chip: "bg-green-50 text-green-800 border-green-200", icon: CheckCircle2, label: "Pass" },
    fail: { chip: "bg-red-50 text-red-800 border-red-200", icon: AlertCircle, label: "Fail" },
    warning: { chip: "bg-amber-50 text-amber-900 border-amber-200", icon: AlertTriangle, label: "Warning" },
    // Distinct from pass, deliberately — see the header note.
    inconclusive: {
        chip: "bg-slate-100 text-slate-700 border-slate-300",
        icon: HelpCircle,
        label: "Could not check",
    },
};

/** Ordered worst-first, so what needs attention is what an operator reads first. */
const STATUS_ORDER: Status[] = ["fail", "warning", "inconclusive", "pass"];

export default function ForensicsPage() {
    const [results, setResults] = useState<ScanResult[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [ranAt, setRanAt] = useState<Date | null>(null);
    //   #757 — which repair is running, and what the last one said.
    const [repairing, setRepairing] = useState<string | null>(null);
    const [repairMessage, setRepairMessage] =
        useState<{ kind: string; ok: boolean; text: string } | null>(null);

    async function runScan() {
        setRunning(true);
        try {
            const res: any = await runForensicScanAction();

            if (res?.success && Array.isArray(res.results)) {
                setResults(res.results as ScanResult[]);
                setError(null);
                setRanAt(new Date());
            } else {
                // The refusal, kept. Not an empty result set: a scan that did
                // not run has found nothing BECAUSE IT DID NOT RUN, and the two
                // must not look the same on this of all screens.
                setError(res?.error || "The scan could not be run.");
                setResults(null);
            }
        } catch {
            setError("The scan could not be run.");
            setResults(null);
        } finally {
            setRunning(false);
        }
    }

    /**
     *   #757 RUN A REPAIR, THEN RE-SCAN.
     *
     *   The re-scan is the point. A repair that reports "fixed 12" and leaves
     *   the screen showing the same twelve findings has told an administrator
     *   nothing they can trust — and this audit has spent several findings on
     *   the difference between a claim and a measurement. Re-running turns the
     *   result into one.
     */
    async function runRepair(kind: string) {
        setRepairing(kind);
        setRepairMessage(null);
        try {
            const res: any = await repairForensicFindingAction(kind);
            if (res?.success) {
                setRepairMessage({ kind, ok: true, text: `${res.details} Re-scanning…` });
                await runScan();
                setRepairMessage({ kind, ok: true, text: res.details });
            } else {
                setRepairMessage({
                    kind, ok: false,
                    text: res?.error || "The repair could not be run.",
                });
            }
        } catch {
            setRepairMessage({ kind, ok: false, text: "The repair could not be run." });
        } finally {
            setRepairing(null);
        }
    }

    const counts = results
        ? STATUS_ORDER.map((s) => [s, results.filter((r) => r.status === s).length] as const)
        : [];
    const sorted = results
        ? [...results].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
        : [];

    return (
        <div className="min-h-screen space-y-6 bg-slate-50 p-6 md:p-10">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-3xl font-bold text-slate-900">
                        <Stethoscope className="h-7 w-7 text-slate-700" />
                        Forensic Data Scan
                    </h1>
                    <p className="mt-1 max-w-2xl text-slate-500">
                        Cross-module integrity checks: accounts without profiles, products whose
                        seller is gone, contact details that disagree with what was verified,
                        balances that do not match the ledger, and funding past its ceiling.
                    </p>
                </div>

                <button
                    onClick={runScan}
                    disabled={running}
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                    {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
                    {running ? "Scanning…" : "Run scan"}
                </button>
            </div>

            <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <span>
                    The scan only reads — it changes nothing and fixes nothing. It samples each
                    collection rather than reading all of it, so an empty result is evidence about
                    the sample and not a guarantee about the whole platform.
                </span>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                        <p className="font-semibold">The scan did not run</p>
                        <p className="text-sm">{error}</p>
                        <p className="mt-1 text-sm">
                            This is not a clean result. Nothing was checked.
                        </p>
                    </div>
                </div>
            )}

            {!results && !error && !running && (
                <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
                    No scan has been run in this session. Press <strong>Run scan</strong> to check
                    the platform&apos;s data now.
                </div>
            )}

            {results && (
                <>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {counts.map(([status, count]) => {
                            const style = STATUS_STYLE[status];
                            const Icon = style.icon;
                            return (
                                <div
                                    key={status}
                                    className={`rounded-xl border p-4 ${style.chip}`}
                                >
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide">
                                        <Icon className="h-4 w-4" />
                                        {style.label}
                                    </div>
                                    <p
                                        data-testid={`count-${status}`}
                                        className="mt-1 text-2xl font-bold tabular-nums"
                                    >
                                        {count}
                                    </p>
                                </div>
                            );
                        })}
                    </div>

                    {ranAt && (
                        <p className="text-xs text-slate-500">
                            {results.length} checks run at {ranAt.toLocaleTimeString()}.
                        </p>
                    )}

                    <div className="space-y-3">
                        {sorted.map((r, i) => {
                            const style = STATUS_STYLE[r.status] ?? STATUS_STYLE.inconclusive;
                            const Icon = style.icon;
                            return (
                                <div
                                    key={`${r.module}-${r.check}-${i}`}
                                    className="rounded-xl border border-slate-200 bg-white p-4"
                                >
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span
                                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${style.chip}`}
                                        >
                                            <Icon className="h-3.5 w-3.5" />
                                            {style.label}
                                        </span>
                                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            {r.module}
                                        </span>
                                        <span className="font-semibold text-slate-900">{r.check}</span>
                                    </div>

                                    <p className="mt-2 text-sm text-slate-700">{r.details}</p>

                                    {/*
                                      *   #757 — THE REPAIR, OR THE REASON THERE IS NOT ONE.
                                      *
                                      *   The scan reported ten defect classes and repaired
                                      *   none, while the repairs for three of them already
                                      *   existed in this tree with no caller. Offered only
                                      *   where a machine can act without deciding anything a
                                      *   person should decide; everywhere else the reason is
                                      *   printed, because "no button" and "no explanation"
                                      *   together read as an oversight.
                                      */}
                                    {r.status !== "pass" && r.repair?.safe && r.repair.kind && (
                                        <button
                                            type="button"
                                            onClick={() => runRepair(r.repair!.kind!)}
                                            disabled={repairing !== null}
                                            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                                        >
                                            {repairing === r.repair.kind ? "Repairing…" : "Repair these"}
                                        </button>
                                    )}

                                    {r.status !== "pass" && r.repair && !r.repair.safe && r.repair.reason && (
                                        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                                            <span className="font-semibold">Not repaired automatically. </span>
                                            {r.repair.reason}
                                        </p>
                                    )}

                                    {repairMessage?.kind === r.repair?.kind && repairMessage && (
                                        <p
                                            role="status"
                                            className={`mt-2 text-xs font-semibold ${repairMessage.ok ? "text-emerald-700" : "text-red-700"}`}
                                        >
                                            {repairMessage.text}
                                        </p>
                                    )}

                                    {/*
                                      *   #475 THE FINDING AND THE GAP ARE NOT THE SAME LIST.
                                      *
                                      *        The WAVE check reported "Affected records (190)"
                                      *        over 1 ineligible participant and 189 records
                                      *        nobody could check. The summary said which was
                                      *        which; this list did not, and this list is what a
                                      *        reader scrolls.
                                      *
                                      *        Findings stay where they were and keep the
                                      *        heading. The unchecked are still shown — a scan
                                      *        that hid what it could not read would report a
                                      *        clean result on a fraction of the population — but
                                      *        below, folded, and counted separately.
                                      */}
                                    {/*
                                      *   #609 — `r.affectedIds.length` with no guard, three
                                      *   lines above a sibling that reads
                                      *   `r.notCheckedIds?.length ?? 0`. One check in a scan
                                      *   result that carries no affectedIds threw inside this
                                      *   .map and took the whole forensics page down — the
                                      *   screen an administrator opens BECAUSE they suspect
                                      *   the data is wrong. Adjacent reads of the same shape,
                                      *   one guarded and one not.
                                      */}
                                    {(r.affectedIds?.length ?? 0) > 0 && (
                                        <div className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-3">
                                            <p className="mb-1 text-xs font-semibold text-slate-500">
                                                Affected records ({r.affectedIds?.length ?? 0})
                                            </p>
                                            <code className="whitespace-pre text-xs text-slate-700">
                                                {(r.affectedIds ?? []).join("\n")}
                                            </code>
                                        </div>
                                    )}

                                    {(r.notCheckedIds?.length ?? 0) > 0 && (
                                        <details className="mt-3 rounded-lg border border-slate-200 bg-white">
                                            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700">
                                                Could not be checked ({r.notCheckedIds!.length})
                                                {" — "}
                                                <span className="font-normal">
                                                    a gap in the records, not a finding about these people
                                                </span>
                                            </summary>
                                            <div className="overflow-x-auto border-t border-slate-100 bg-slate-50 p-3">
                                                <code className="whitespace-pre text-xs text-slate-600">
                                                    {r.notCheckedIds!.join("\n")}
                                                </code>
                                            </div>
                                        </details>
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
