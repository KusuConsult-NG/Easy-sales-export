/**
 * Village Market — Public Listing Page
 * /marketplace/village-market
 * 
 * Shows all upcoming and active flash sale events
 */

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    MapPin, Clock, Calendar, Users, ChevronRight, Loader2,
    Zap, ExternalLink,
} from "lucide-react";
import { getActiveVillageMarketEventsAction } from "@/app/actions/village-market";
import type { VillageMarketEvent } from "@/lib/types/marketplace";

const fmtDate = (val: any) => {
    if (!val) return "—";
    const d = val?.toDate ? val.toDate() : new Date(val);
    return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(d);
};

function isLive(event: VillageMarketEvent) {
    const now = new Date();
    const start = (event.startTime as any)?.toDate ? (event.startTime as any).toDate() : new Date(event.startTime as any);
    const end = (event.endTime as any)?.toDate ? (event.endTime as any).toDate() : new Date(event.endTime as any);
    return now >= start && now <= end;
}

function EventStatusBadge({ event }: { event: VillageMarketEvent }) {
    const now = new Date();
    const start = (event.startTime as any)?.toDate ? (event.startTime as any).toDate() : new Date(event.startTime as any);
    const end = (event.endTime as any)?.toDate ? (event.endTime as any).toDate() : new Date(event.endTime as any);

    if (now < start) {
        const diff = Math.round((start.getTime() - now.getTime()) / 60000);
        const label = diff < 60 ? `Starts in ${diff}m` : `Starts in ${Math.round(diff / 60)}h`;
        return <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-xs font-bold rounded-full flex items-center gap-1.5"><Clock className="w-3 h-3" />{label}</span>;
    }
    if (now >= start && now <= end) {
        return <span className="px-3 py-1 bg-green-100 text-green-800 text-xs font-bold rounded-full flex items-center gap-1.5 animate-pulse"><Zap className="w-3 h-3" />LIVE NOW</span>;
    }
    return <span className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">Ended</span>;
}

export default function VillageMarketPage() {
    const [events, setEvents] = useState<VillageMarketEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getActiveVillageMarketEventsAction().then((data) => {
            setEvents(data);
            setLoading(false);
        });
    }, []);

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Hero */}
            <div className="relative overflow-hidden bg-linear-to-br from-emerald-700 to-teal-800 text-white">
                <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJ3aGl0ZSIgZmlsbC1vcGFjaXR5PSIwLjMiIGZpbGwtcnVsZT0iZXZlbm9kZCI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iNCIvPjwvZz48L3N2Zz4=')]" />
                <div className="relative max-w-5xl mx-auto px-6 py-16">
                    <div className="flex items-center gap-2 mb-4">
                        <Zap className="w-6 h-6 text-yellow-300" />
                        <span className="text-yellow-300 font-bold text-sm tracking-wider uppercase">Flash Sales</span>
                    </div>
                    <h1 className="text-4xl md:text-5xl font-extrabold mb-4">
                        Village Market
                    </h1>
                    <p className="text-emerald-100 text-lg max-w-2xl">
                        Timed flash sales from local farmers, traders, and merchants. Shop exclusive deals within a limited window — every week across Nigerian communities.
                    </p>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-6 py-10">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900">Upcoming Events</h2>
                        <p className="text-slate-500 text-sm">Click any event to view its products and merchants</p>
                    </div>
                    <Link
                        href="/marketplace/village-market/seller"
                        className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold text-sm hover:bg-emerald-700 transition flex items-center gap-2"
                    >
                        <Users className="w-4 h-4" /> Seller Hub
                    </Link>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
                    </div>
                ) : events.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
                        <Calendar className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 mb-2">No Active Events</h3>
                        <p className="text-slate-500">No village market events are scheduled right now. Check back soon!</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {events.map((event) => {
                            const sellerCount = event.participantSellerIds?.length || 0;
                            const extMerchantCount = event.externalMerchants?.length || 0;
                            return (
                                <Link
                                    key={event.id}
                                    href={`/marketplace/village-market/${event.id}`}
                                    className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-lg hover:border-emerald-300 transition-all group"
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <h3 className="text-lg font-bold text-slate-900 group-hover:text-emerald-700 transition mb-1">{event.title}</h3>
                                            {event.description && (
                                                <p className="text-sm text-slate-500 line-clamp-2">{event.description}</p>
                                            )}
                                        </div>
                                        <EventStatusBadge event={event} />
                                    </div>

                                    <div className="space-y-2 mb-4">
                                        <div className="flex items-center gap-2 text-sm text-slate-600">
                                            <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                                            <span>{event.location}, {event.state}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-slate-600">
                                            <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                                            <span>{fmtDate(event.startTime)} → {fmtDate(event.endTime)}</span>
                                        </div>
                                        {event.isRecurring && (
                                            <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium">
                                                <Calendar className="w-3.5 h-3.5" />
                                                <span>Recurring every {event.recurringDay}</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                                        <div className="flex items-center gap-4 text-xs text-slate-500">
                                            <span className="flex items-center gap-1">
                                                <Users className="w-3.5 h-3.5" />
                                                {sellerCount} platform seller{sellerCount !== 1 ? "s" : ""}
                                            </span>
                                            {extMerchantCount > 0 && (
                                                <span className="flex items-center gap-1">
                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                    {extMerchantCount} market merchant{extMerchantCount !== 1 ? "s" : ""}
                                                </span>
                                            )}
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-emerald-600 transition" />
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
