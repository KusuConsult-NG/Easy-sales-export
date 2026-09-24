"use client";

/**
 *   THE OWNER: "when opportunities are listed on export window, it doesn't show
 *   for the users."
 *
 * ── THEY WERE NEVER LISTED, BECAUSE NOTHING COULD LIST THEM ─────────────────
 *
 *   export_windows holds two entities. A SHIPMENT is one member's private
 *   export request (pending → in_transit → delivered → completed). An
 *   AGGREGATION is a crowdfunded opportunity — targetVolume, slotPrice,
 *   currentVolume — and members browse those through
 *   `getActiveExportWindowsAction`, which asks for `status == "open"`.
 *
 *   Three member screens read that action: /export, the export landing page,
 *   and /export/(app)/opportunities. Exactly one function in the codebase
 *   writes an aggregation window with status "open" —
 *   `createExportWindowAction` in actions/export-aggregation.ts — and NOTHING
 *   CALLED IT. No page, no component, no route.
 *
 *   So the three screens were correct, the action behind them was correct, the
 *   booking flow underneath was correct, and the whole thing could only ever
 *   render "no opportunities", because there was no door anywhere that made
 *   one. The owner was listing through /admin/export/catalog, which writes a
 *   different collection (export_catalog) read by a different screen
 *   (/export/buyer) — a real feature, and not this one.
 *
 * ── WHY THE LIST BELOW READS THE MEMBER'S OWN ACTION ────────────────────────
 *
 *   `getActiveExportWindowsAction` is what /export/(app)/opportunities calls,
 *   unchanged and unwrapped. So this screen cannot show an admin something a
 *   member would not see, and it cannot hide something a member would: if a
 *   window is in this list it is on theirs, by construction rather than by
 *   agreement between two queries.
 *
 *   That is deliberately the defect class this page exists to close. A separate
 *   admin query would have shown a window the members' filter rejected — for an
 *   end date already past, say — and reported the feature working.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
    Container, Plus, Loader2, AlertCircle, Calendar, Target, Coins, MapPin,
} from "lucide-react";
import { logger } from "@/lib/logger";
import { useToast } from "@/contexts/ToastContext";
import {
    createExportWindowAction,
    getActiveExportWindowsAction,
} from "@/app/actions/export-aggregation";
import { formatCurrency } from "@/lib/utils";
import { formatShortDateOrDash } from "@/lib/date-utils";
import ListLoadFailed from "@/components/common/ListLoadFailed";

/** What the form holds while it is being filled in. */
interface WindowDraft {
    title: string;
    commodity: string;
    targetVolume: string;
    slotPrice: string;
    startDate: string;
    endDate: string;
    destination: string;
}

const EMPTY: WindowDraft = {
    title: "", commodity: "", targetVolume: "", slotPrice: "",
    startDate: "", endDate: "", destination: "",
};

/**
 * Everything the draft has not answered, in the order it is asked.
 *
 *   The server refuses a non-positive slot price and target volume — #127 made
 *   slotPrice the figure a booking is multiplied by, so a window created at
 *   zero produces bookings that path then refuses. Those refusals are the
 *   authority; this exists so the admin is told which box before a round trip,
 *   not instead of them.
 */
function missing(draft: WindowDraft): string[] {
    const gaps: string[] = [];
    if (!draft.title.trim()) gaps.push("Give the opportunity a title.");
    if (!draft.commodity.trim()) gaps.push("Name the commodity.");
    if (!draft.destination.trim()) gaps.push("Name the destination.");

    const volume = Number(draft.targetVolume);
    if (!Number.isFinite(volume) || volume <= 0) gaps.push("Target volume must be greater than zero.");

    const price = Number(draft.slotPrice);
    if (!Number.isFinite(price) || price <= 0) gaps.push("Slot price must be greater than zero.");

    if (!draft.startDate) gaps.push("Set an opening date.");
    if (!draft.endDate) gaps.push("Set a closing date.");
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
        gaps.push("The closing date cannot be before the opening date.");
    }
    /*
     *   A window whose end date has passed is refused HERE rather than created
     *   and then hidden. getActiveExportWindowsAction filters expired windows
     *   out of the members' list, so creating one would look like a success on
     *   this screen and appear nowhere — the exact shape of what the owner
     *   reported.
     */
    if (draft.endDate && draft.endDate < new Date().toISOString().slice(0, 10)) {
        gaps.push("That closing date has already passed, so no member would see this window.");
    }
    return gaps;
}

export default function AdminExportOpportunitiesPage() {
    const { showToast } = useToast();
    const [windows, setWindows] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [draft, setDraft] = useState<WindowDraft>(EMPTY);
    const [saving, setSaving] = useState(false);
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getActiveExportWindowsAction();
            if (result.success) {
                setWindows(result.data ?? []);
                setLoadFailed(false);
            } else {
                //   #595 An empty list and a failed read are different claims.
                //
                //   And the server's own reason is kept rather than collapsed
                //   into a boolean: ListLoadFailed can only say "this did not
                //   load", so if the reason is dropped here it exists nowhere.
                logger.error("Failed to load export opportunities", { reason: result.error });
                setLoadFailed(true);
            }
        } catch (error) {
            logger.error("Failed to load export opportunities", error);
            setLoadFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        const gaps = missing(draft);
        if (gaps.length > 0) {
            showToast(gaps[0], "error");
            return;
        }

        setSaving(true);
        try {
            const result = await createExportWindowAction({
                title: draft.title.trim(),
                commodity: draft.commodity.trim(),
                targetVolume: Number(draft.targetVolume),
                slotPrice: Number(draft.slotPrice),
                startDate: draft.startDate,
                endDate: draft.endDate,
                destination: draft.destination.trim(),
            });

            if (result.success) {
                showToast("Opportunity published. Members can book slots now.", "success");
                setDraft(EMPTY);
                setOpen(false);
                //   Reloaded through the MEMBERS' action, so the row appearing
                //   here is the row appearing on their screen.
                await load();
            } else {
                showToast(result.error || "Could not create the opportunity", "error");
            }
        } catch (error) {
            logger.error("Failed to create export opportunity", error);
            showToast("Could not create the opportunity", "error");
        } finally {
            setSaving(false);
        }
    }

    const field = "w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 text-sm focus:ring-2 focus:ring-blue-400 focus:border-transparent";

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="max-w-6xl mx-auto">
                <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">Export Opportunities</h1>
                        <p className="text-slate-600">
                            Crowdfunded windows members book slots against. This is the same list
                            they see on <Link href="/export/opportunities" className="text-blue-600 underline">their opportunities page</Link>.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setOpen((was) => !was)}
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition"
                    >
                        <Plus className="w-4 h-4" />
                        {open ? "Close form" : "New opportunity"}
                    </button>
                </div>

                {open && (
                    <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-6 mb-8 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Title</label>
                                <input
                                    className={field}
                                    value={draft.title}
                                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                                    placeholder="March sesame shipment to Turkey"
                                    aria-label="Title"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Commodity</label>
                                <input
                                    className={field}
                                    value={draft.commodity}
                                    onChange={(e) => setDraft({ ...draft, commodity: e.target.value })}
                                    placeholder="Sesame seeds"
                                    aria-label="Commodity"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Target volume (kg)</label>
                                <input
                                    type="number"
                                    min="1"
                                    className={field}
                                    value={draft.targetVolume}
                                    onChange={(e) => setDraft({ ...draft, targetVolume: e.target.value })}
                                    placeholder="20000"
                                    aria-label="Target volume"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Slot price (₦ per kg)</label>
                                <input
                                    type="number"
                                    min="1"
                                    className={field}
                                    value={draft.slotPrice}
                                    onChange={(e) => setDraft({ ...draft, slotPrice: e.target.value })}
                                    placeholder="1800"
                                    aria-label="Slot price"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Opens</label>
                                <input
                                    type="date"
                                    className={field}
                                    value={draft.startDate}
                                    onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                                    aria-label="Opening date"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Closes</label>
                                <input
                                    type="date"
                                    className={field}
                                    value={draft.endDate}
                                    onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                                    aria-label="Closing date"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Destination</label>
                                <input
                                    className={field}
                                    value={draft.destination}
                                    onChange={(e) => setDraft({ ...draft, destination: e.target.value })}
                                    placeholder="Istanbul, Turkey"
                                    aria-label="Destination"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-4 pt-2">
                            <p className="text-xs text-slate-500">
                                Raising {draft.targetVolume && draft.slotPrice
                                    ? formatCurrency(Number(draft.targetVolume) * Number(draft.slotPrice))
                                    : "—"} in total.
                            </p>
                            <button
                                type="submit"
                                disabled={saving}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition disabled:opacity-60"
                            >
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                Publish opportunity
                            </button>
                        </div>
                    </form>
                )}

                <h2 className="text-lg font-bold text-slate-900 mb-3">Live right now</h2>

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : loadFailed ? (
                    <ListLoadFailed what="the live opportunities" />
                ) : windows.length === 0 ? (
                    <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                        <Container className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <h3 className="font-bold text-slate-900 mb-1">No live opportunities</h3>
                        <p className="text-sm text-slate-500 max-w-md mx-auto">
                            Members browsing the export module are seeing this same emptiness.
                            Publish one above and it appears on their screen immediately.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {windows.map((window: any) => {
                            const target = Number(window.targetVolume) || 0;
                            const taken = Number(window.currentVolume) || 0;
                            const percent = target > 0 ? Math.min(100, Math.round((taken / target) * 100)) : 0;
                            return (
                                <div key={window.id} className="bg-white rounded-xl border border-slate-200 p-5">
                                    <div className="flex items-start justify-between gap-3 mb-3">
                                        <h3 className="font-bold text-slate-900">{window.title}</h3>
                                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 whitespace-nowrap">
                                            Open
                                        </span>
                                    </div>
                                    <dl className="grid grid-cols-2 gap-3 text-sm">
                                        <div className="flex items-center gap-2 text-slate-600">
                                            <Target className="w-4 h-4 text-slate-400" />
                                            <span>{taken.toLocaleString()} / {target.toLocaleString()} kg</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-slate-600">
                                            <Coins className="w-4 h-4 text-slate-400" />
                                            <span>{formatCurrency(Number(window.slotPrice) || 0)}/kg</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-slate-600">
                                            <MapPin className="w-4 h-4 text-slate-400" />
                                            <span className="truncate">{window.destination}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-slate-600">
                                            <Calendar className="w-4 h-4 text-slate-400" />
                                            <span>closes {formatShortDateOrDash(window.endDate)}</span>
                                        </div>
                                    </dl>
                                    <div className="mt-4 h-2 bg-slate-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-600 rounded-full" style={{ width: `${percent}%` }} />
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1.5">{percent}% of the target booked</p>
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="mt-8 flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-blue-900">
                        A window disappears from this list once its closing date passes, because that
                        is when it leaves the members&apos; list too. Bookings already made against it
                        are unaffected — see <Link href="/admin/export/bookings" className="underline font-semibold">Export Bookings</Link>.
                    </p>
                </div>
            </div>
        </div>
    );
}
