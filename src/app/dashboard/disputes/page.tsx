"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    AlertTriangle, Loader2, Plus, Package,
    Clock, CheckCircle, XCircle, Eye, MessageCircle,
    ChevronRight,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { useToast } from "@/contexts/ToastContext";
import { startConversationAction } from "@/app/actions/messages";

interface Dispute {
    id: string;
    orderId: string;
    buyerId: string;
    sellerId?: string;
    title: string;
    description: string;
    status: "open" | "under_review" | "resolved" | "closed" | "rejected";
    reason?: string;
    resolution?: string;
    createdAt: any;
    updatedAt?: any;
}

function StatusBadge({ status }: { status: Dispute["status"] }) {
    const map: Record<Dispute["status"], { label: string; cls: string; icon: React.ElementType }> = {
        open: { label: "Open", cls: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: Clock },
        under_review: { label: "Under Review", cls: "bg-blue-100 text-blue-800 border-blue-200", icon: Eye },
        resolved: { label: "Resolved", cls: "bg-green-100 text-green-800 border-green-200", icon: CheckCircle },
        closed: { label: "Closed", cls: "bg-gray-100 text-gray-700 border-gray-200", icon: XCircle },
        rejected: { label: "Rejected", cls: "bg-red-100 text-red-800 border-red-200", icon: XCircle },
    };
    const { label, cls, icon: Icon } = map[status] ?? map.open;
    return (
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${cls}`}>
            <Icon className="w-3.5 h-3.5" />
            {label}
        </span>
    );
}

function toDate(val: any): Date {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (val?.toDate) return val.toDate();
    if (val?.seconds) return new Date(val.seconds * 1000);
    return new Date(val);
}

export default function DisputesPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const { showToast } = useToast();

    const [disputes, setDisputes] = useState<Dispute[]>([]);
    const [loading, setLoading] = useState(true);
    const [contactingId, setContactingId] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<"all" | Dispute["status"]>("all");

    const userId = session?.user?.id;

    // Real-time listener
    useEffect(() => {
        if (status === "unauthenticated") { router.push("/auth/login"); return; }
        if (!userId) return;

        const q = query(
            collection(db, COLLECTIONS.DISPUTES),
            where("buyerId", "==", userId),
            orderBy("createdAt", "desc")
        );

        const unsub = onSnapshot(q, (snap) => {
            setDisputes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Dispute)));
            setLoading(false);
        }, () => setLoading(false));

        return () => unsub();
    }, [userId, status, router]);

    async function handleContactSupport(dispute: Dispute) {
        if (!dispute.sellerId) {
            showToast("No seller contact available for this dispute", "error");
            return;
        }
        setContactingId(dispute.id);
        try {
            const result = await startConversationAction(dispute.sellerId);
            if (result && "conversationId" in result && result.conversationId) {
                router.push(`/messages?conversation=${result.conversationId}`);
            } else {
                showToast((result as any)?.error || "Failed to contact support", "error");
            }
        } catch {
            showToast("Failed to contact support", "error");
        } finally {
            setContactingId(null);
        }
    }

    const filtered = disputes.filter(d =>
        filterStatus === "all" ? true : d.status === filterStatus
    );

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin text-orange-500" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-4xl mx-auto">

                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-1 flex items-center gap-2.5">
                            <AlertTriangle className="w-7 h-7 text-orange-500" />
                            Disputes
                        </h1>
                        <p className="text-slate-500 text-sm">
                            {disputes.length} dispute{disputes.length !== 1 ? "s" : ""} on your account
                        </p>
                    </div>
                    <button
                        onClick={() => router.push("/dashboard/disputes/new")}
                        className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl transition text-sm"
                    >
                        <Plus className="w-4 h-4" />
                        Open Dispute
                    </button>
                </div>

                {/* Filter tabs */}
                <div className="bg-white rounded-xl p-3 shadow-sm mb-5 overflow-x-auto">
                    <div className="flex items-center gap-2 min-w-max">
                        {([
                            { key: "all", label: "All" },
                            { key: "open", label: "Open" },
                            { key: "under_review", label: "Under Review" },
                            { key: "resolved", label: "Resolved" },
                            { key: "closed", label: "Closed" },
                        ] as { key: "all" | Dispute["status"]; label: string }[]).map(f => (
                            <button
                                key={f.key}
                                onClick={() => setFilterStatus(f.key)}
                                className={`px-3 py-1.5 rounded-lg font-medium text-sm transition whitespace-nowrap ${
                                    filterStatus === f.key
                                        ? "bg-orange-600 text-white shadow-sm"
                                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                }`}
                            >
                                {f.label}
                                {f.key !== "all" && (
                                    <span className="ml-1.5 opacity-70">
                                        ({disputes.filter(d => d.status === f.key).length})
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Empty state */}
                {filtered.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                        <AlertTriangle className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-700 mb-2">
                            {filterStatus === "all" ? "No Disputes" : `No ${filterStatus} disputes`}
                        </h3>
                        <p className="text-slate-500 text-sm max-w-sm mx-auto mb-6">
                            {filterStatus === "all"
                                ? "You have no disputes. If you have an issue with an order, you can open a dispute."
                                : `You have no disputes with status "${filterStatus}".`}
                        </p>
                        {filterStatus === "all" && (
                            <button
                                onClick={() => router.push("/dashboard/disputes/new")}
                                className="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl transition text-sm"
                            >
                                Open a Dispute
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {filtered.map((dispute) => (
                            <div
                                key={dispute.id}
                                className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-md transition-shadow"
                            >
                                {/* Dispute header */}
                                <div className="flex items-start justify-between gap-4 mb-3">
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-slate-900 text-base mb-1 truncate">
                                            {dispute.title}
                                        </h3>
                                        <div className="flex items-center gap-2 text-xs text-slate-500">
                                            <Package className="w-3.5 h-3.5" />
                                            Ref: {dispute.orderId}
                                            <span className="text-slate-300">•</span>
                                            {toDate(dispute.createdAt).toLocaleDateString("en-NG", {
                                                day: "numeric", month: "short", year: "numeric"
                                            })}
                                        </div>
                                    </div>
                                    <StatusBadge status={dispute.status} />
                                </div>

                                {/* Description */}
                                <p className="text-sm text-slate-600 leading-relaxed mb-4 line-clamp-2">
                                    {dispute.description}
                                </p>

                                {/* Resolution (if any) */}
                                {dispute.resolution && (
                                    <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
                                        <p className="text-xs font-bold text-green-800 mb-1">Resolution</p>
                                        <p className="text-sm text-green-700">{dispute.resolution}</p>
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => router.push(`/dashboard/orders`)}
                                        className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition"
                                    >
                                        <Package className="w-3.5 h-3.5" />
                                        View Order
                                    </button>
                                    {(dispute.status === "open" || dispute.status === "under_review") && (
                                        <button
                                            onClick={() => handleContactSupport(dispute)}
                                            disabled={contactingId === dispute.id}
                                            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
                                        >
                                            {contactingId === dispute.id
                                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                : <MessageCircle className="w-3.5 h-3.5" />
                                            }
                                            Message Support
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
