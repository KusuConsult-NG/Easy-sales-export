"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    Package,
    AlertTriangle,
    User,
    FileText,
    CheckCircle,
    Loader2,
    ShieldCheck,
    StickyNote,
    Send,
} from "lucide-react";
import {
    getDisputeByIdAction,
    updateDisputeStatusAction,
} from "@/app/actions/disputes";
import { getOrderByIdAction } from "@/app/actions/orders";
import { getEscrowTransactionByIdAction, escalateDisputeAction } from "@/app/actions/escrow";
import {
    addEscalationNoteAction,
    getEscalationNotesAction,
    type EscalationNote,
} from "@/app/actions/escalation-notes";
import type { Dispute, Order, DisputeResolution } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

const DISPUTE_REASON_LABELS: Record<string, string> = {
    not_received: "Item Not Received",
    wrong_item: "Wrong Item",
    damaged: "Damaged/Defective",
    fake_product: "Fake/Counterfeit",
    other: "Other Issue",
};

interface DisputeDetailPageProps {
    params: Promise<{ id: string }>;
}

export default function DisputeDetailPage(props: DisputeDetailPageProps) {
    // Next.js 16: params is now a Promise, must unwrap with React.use()
    const params = use(props.params);
    const router = useRouter();
    const { showToast } = useToast();

    const [dispute, setDispute] = useState<Dispute | null>(null);
    /** Order linked to this dispute — null for escrow-origin disputes */
    const [order, setOrder] = useState<Order | null>(null);
    /** Escrow transaction data — set when orderId is absent */
    const [escrowData, setEscrowData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [resolving, setResolving] = useState(false);
    const [escalating, setEscalating] = useState(false);
    const [showResolutionModal, setShowResolutionModal] = useState(false);

    // Escalation notes
    const [notes, setNotes] = useState<EscalationNote[]>([]);
    const [noteText, setNoteText] = useState("");
    const [savingNote, setSavingNote] = useState(false);
    const [loadingNotes, setLoadingNotes] = useState(false);

    async function loadNotes(dId: string) {
        setLoadingNotes(true);
        const res = await getEscalationNotesAction(dId);
        if (res.success && res.notes) setNotes(res.notes);
        setLoadingNotes(false);
    }

    async function handleAddNote() {
        if (!noteText.trim() || !dispute) return;
        setSavingNote(true);
        const res = await addEscalationNoteAction(dispute.id, noteText);
        setSavingNote(false);
        if (res.success) {
            showToast("Note saved", "success");
            setNoteText("");
            loadNotes(dispute.id);
        } else {
            showToast(res.error || "Failed to save note", "error");
        }
    }

    const [resolution, setResolution] = useState<DisputeResolution>("refund_buyer");
    const [adminNotes, setAdminNotes] = useState("");
    const [refundAmount, setRefundAmount] = useState("0");

    useEffect(() => {
        loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.id]);

    async function loadData() {
        setLoading(true);
        try {
            // Load dispute
            const disputeResult = await getDisputeByIdAction(params.id);
            if (!disputeResult.success || !disputeResult.data?.dispute) {
                showToast("Dispute not found", "error");
                router.push("/admin/marketplace/disputes");
                return;
            }

            setDispute(disputeResult.data.dispute);
            const d = disputeResult.data.dispute;
            // Load notes for escalated disputes
            if ((d as any).escalated) loadNotes(d.id);

            if (d.orderId) {
                // ── Marketplace order-origin dispute ──────────────────────
                const orderResult = await getOrderByIdAction(d.orderId);
                if (orderResult.success && orderResult.order) {
                    setOrder(orderResult.order);
                    setRefundAmount(orderResult.order.totalAmount.toString());
                }
            } else if (d.escrowId) {
                // ── Escrow-origin dispute (standalone escrow) ─────────────
                const escrowResult = await getEscrowTransactionByIdAction(d.escrowId);
                if (escrowResult.success && escrowResult.data) {
                    setEscrowData(escrowResult.data);
                    setRefundAmount(String(escrowResult.data.amount ?? 0));
                }
            }
        } catch (error) {
            showToast("Failed to load dispute", "error");
            router.push("/admin/marketplace/disputes");
        } finally {
            setLoading(false);
        }
    }

    async function handleResolve() {
        if (!dispute || !adminNotes.trim()) {
            showToast("Please provide admin notes", "error");
            return;
        }

        setResolving(true);
        try {
            const result = await updateDisputeStatusAction(
                dispute.id,
                resolution,
                adminNotes,
                resolution === "partial_refund" ? parseFloat(refundAmount) : undefined
            );

            if (result.success) {
                showToast("Dispute resolved successfully", "success");
                router.push("/admin/marketplace/disputes");
            } else {
                showToast(result.error || "Failed to resolve dispute", "error");
            }
        } catch (error) {
            showToast("Failed to resolve dispute", "error");
        } finally {
            setResolving(false);
        }
    }

    async function handleEscalate() {
        if (!dispute) return;
        setEscalating(true);
        const res = await escalateDisputeAction(dispute.id);
        setEscalating(false);
        if (res.success) {
            showToast("Dispute escalated — both parties notified", "success");
            loadData();
        } else {
            showToast(res.error || "Failed to escalate dispute", "error");
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
            </div>
        );
    }

    // Guard: dispute must exist; order OR escrowData must be set (but not necessarily both)
    if (!dispute) return null;

    const contextAmount = order?.totalAmount ?? escrowData?.amount ?? 0;
    const isEscrowDispute = !dispute.orderId && !!dispute.escrowId;

    const daysAgo = Math.floor(
        (Date.now() - new Date((dispute.createdAt as unknown as { toDate?: () => Date })?.toDate
            ? (dispute.createdAt as unknown as { toDate: () => Date }).toDate()
            : dispute.createdAt as unknown as Date | number | string).getTime()) / (1000 * 60 * 60 * 24)
    );

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-5xl mx-auto px-4">
                {/* Back Button */}
                <button
                    onClick={() => router.back()}
                    className="flex items-center gap-2 text-gray-600 hover:text-primary mb-6 transition"
                >
                    <ArrowLeft className="w-5 h-5" />
                    Back to Disputes
                </button>

                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                        <h1 className="text-3xl font-bold text-gray-900">
                            Dispute #{dispute.id.slice(0, 12).toUpperCase()}
                        </h1>
                        <span
                            className={`px-4 py-2 rounded-xl font-semibold text-sm ${dispute.status === "open"
                                ? "bg-yellow-100 text-yellow-800"
                                : dispute.status === "under_review"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-green-100 text-green-800"
                                }`}
                        >
                            {dispute.status.replace("_", " ").toUpperCase()}
                        </span>
                        {isEscrowDispute && (
                            <span className="px-3 py-1 rounded-xl font-semibold text-xs bg-purple-100 text-purple-800 flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3" /> Escrow Dispute
                            </span>
                        )}
                        {(dispute as any).escalated && (
                            <span className="px-3 py-1 rounded-xl font-semibold text-xs bg-red-100 text-red-800 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> ESCALATED
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 mt-3">
                        {(dispute.status === "open" || dispute.status === "under_review") && !(dispute as any).escalated && (
                            <button
                                onClick={handleEscalate}
                                disabled={escalating}
                                className="px-4 py-2 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition text-sm flex items-center gap-2 disabled:opacity-60"
                            >
                                {escalating ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                                Escalate Dispute
                            </button>
                        )}
                    </div>
                    <p className="text-gray-600 mt-1">
                        Opened {daysAgo} day{daysAgo !== 1 ? "s" : ""} ago •{" "}
                        {new Date((dispute.createdAt as unknown as { toDate?: () => Date })?.toDate
                            ? (dispute.createdAt as unknown as { toDate: () => Date }).toDate()
                            : dispute.createdAt as unknown as Date | number | string).toLocaleString()}
                    </p>
                </div>

                {/* Context Card: Order or Escrow */}
                <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                        {isEscrowDispute
                            ? <><ShieldCheck className="w-6 h-6 text-primary" /> Escrow Transaction</>
                            : <><Package className="w-6 h-6 text-primary" /> Order Information</>
                        }
                    </h2>

                    {order && (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm text-gray-600 mb-1">Order Number</p>
                                    <p className="font-semibold text-gray-900">{order.orderNumber}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-600 mb-1">Order Date</p>
                                    <p className="text-gray-900">{new Date(order.createdAt).toLocaleDateString()}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-600 mb-1">Total Amount</p>
                                    <p className="font-bold text-primary text-lg">{formatCurrency(order.totalAmount)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-600 mb-1">Order Status</p>
                                    <p className="capitalize text-gray-900">{order.status.replace("_", " ")}</p>
                                </div>
                            </div>
                            <div className="mt-4 pt-4 border-t border-gray-200">
                                <p className="text-sm font-semibold text-gray-700 mb-2">Order Items</p>
                                <div className="space-y-2">
                                    {order.items.map((item, idx) => (
                                        <div key={idx} className="flex justify-between text-sm">
                                            <span className="text-gray-900">{item.productTitle} × {item.quantity}</span>
                                            <span className="font-semibold text-gray-900">{formatCurrency(item.totalPrice)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {isEscrowDispute && escrowData && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm text-gray-600 mb-1">Product</p>
                                <p className="font-semibold text-gray-900">{escrowData.productName ?? "—"}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-600 mb-1">Escrow Amount</p>
                                <p className="font-bold text-primary text-lg">{formatCurrency(escrowData.amount ?? 0)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-600 mb-1">Escrow Status</p>
                                <p className="capitalize text-gray-900">{escrowData.status?.replace(/_/g, " ")}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-600 mb-1">Payment Reference</p>
                                <p className="font-mono text-gray-900 text-sm">{escrowData.paymentReference ?? "—"}</p>
                            </div>
                        </div>
                    )}

                    {isEscrowDispute && !escrowData && (
                        <p className="text-sm text-gray-400 italic">Escrow transaction data unavailable.</p>
                    )}
                </div>

                {/* Dispute Details */}
                <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                        <FileText className="w-6 h-6 text-primary" />
                        Dispute Details
                    </h2>

                    <div className="mb-4">
                        <p className="text-sm text-gray-600 mb-2">Reason</p>
                        <span className="inline-block px-4 py-2 bg-red-100 text-red-800 font-semibold rounded-lg">
                            {DISPUTE_REASON_LABELS[dispute.reason] || dispute.reason}
                        </span>
                    </div>

                    <div>
                        <p className="text-sm text-gray-600 mb-2">Description</p>
                        <p className="text-gray-900 p-4 bg-gray-50 rounded-xl">
                            {dispute.description}
                        </p>
                    </div>

                    {dispute.evidenceUrls && dispute.evidenceUrls.length > 0 && (
                        <div className="mt-4">
                            <p className="text-sm text-gray-600 mb-2">Evidence</p>
                            <div className="flex gap-2">
                                {dispute.evidenceUrls.map((url, idx) => (
                                    <a
                                        key={idx}
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline text-sm"
                                    >
                                        Evidence {idx + 1}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Parties */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div className="bg-white rounded-2xl shadow-lg p-6">
                        <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                            <User className="w-5 h-5 text-primary" />
                            {isEscrowDispute ? "Initiator" : "Buyer"}
                        </h3>
                        <p className="text-sm text-gray-600">ID: {dispute.buyerId ?? dispute.initiatorId ?? "—"}</p>
                    </div>

                    <div className="bg-white rounded-2xl shadow-lg p-6">
                        <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                            <User className="w-5 h-5 text-primary" />
                            {isEscrowDispute ? "Respondent" : "Seller"}
                        </h3>
                        <p className="text-sm text-gray-600">ID: {dispute.sellerId ?? dispute.respondentId ?? "—"}</p>
                    </div>
                </div>

                {/* Resolution Section */}
                {dispute.status !== "resolved" ? (
                    <div className="bg-white rounded-2xl shadow-lg p-6">
                        <button
                            onClick={() => setShowResolutionModal(true)}
                            className="w-full px-6 py-4 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition flex items-center justify-center gap-2 text-lg"
                        >
                            <CheckCircle className="w-6 h-6" />
                            Resolve Dispute
                        </button>
                    </div>
                ) : (
                    <div className="bg-green-50 border border-green-200 rounded-2xl p-6">
                        <h3 className="font-bold text-green-900 mb-2">Dispute Resolved</h3>
                        <p className="text-sm text-green-800 mb-2">
                            Resolution: {dispute.resolution?.replace(/_/g, " ").toUpperCase()}
                        </p>
                        {dispute.adminNotes && (
                            <>
                                <p className="text-sm text-green-800 mb-1">Admin Notes:</p>
                                <p className="text-green-900 bg-green-100 p-3 rounded-lg">
                                    {dispute.adminNotes}
                                </p>
                            </>
                        )}
                    </div>
                )}

                {/* Resolution Modal */}
                {showResolutionModal && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8">
                            <h2 className="text-2xl font-bold text-gray-900 mb-6">
                                Resolve Dispute
                            </h2>

                            {/* Resolution Type */}
                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-gray-700 mb-3">
                                    Resolution Decision
                                </label>
                                <div className="space-y-2">
                                    {[
                                        { value: "refund_buyer", label: "Refund Buyer (Full)" },
                                        { value: "release_seller", label: "Release to Seller" },
                                        { value: "partial_refund", label: "Partial Refund" },
                                    ].map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setResolution(option.value as DisputeResolution)}
                                            className={`w-full p-4 rounded-xl border-2 transition text-left ${resolution === option.value
                                                ? "border-primary bg-primary/5"
                                                : "border-gray-200 hover:border-primary/50"
                                                }`}
                                        >
                                            <div className="font-semibold text-gray-900">
                                                {option.label}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Refund Amount (for partial refund) */}
                            {resolution === "partial_refund" && (
                                <div className="mb-6">
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                                        Refund Amount (₦)
                                    </label>
                                    <input
                                        type="number"
                                        value={refundAmount}
                                        onChange={(e) => setRefundAmount(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                        placeholder="Enter refund amount"
                                    />
                                    <p className="text-sm text-gray-500 mt-1">
                                        {isEscrowDispute ? "Escrow" : "Order"} total: {formatCurrency(contextAmount)}
                                    </p>
                                </div>
                            )}

                            {/* Admin Notes */}
                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                    Admin Notes (Required)
                                </label>
                                <textarea
                                    value={adminNotes}
                                    onChange={(e) => setAdminNotes(e.target.value)}
                                    rows={4}
                                    placeholder="Explain the reasoning behind this resolution..."
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary resize-none"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowResolutionModal(false)}
                                    className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleResolve}
                                    disabled={resolving || !adminNotes.trim()}
                                    className="flex-1 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {resolving ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Resolving...
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle className="w-5 h-5" />
                                            Resolve & Close
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {/* ── Escalation Notes Panel ───────────────────────────── */}
                {(dispute as any).escalated && (
                    <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <StickyNote className="w-6 h-6 text-red-500" />
                            Escalation Notes
                        </h2>

                        {/* Notes log */}
                        {loadingNotes ? (
                            <div className="flex items-center justify-center py-6">
                                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                            </div>
                        ) : notes.length === 0 ? (
                            <p className="text-slate-400 text-sm mb-4">No notes yet — add the first one below.</p>
                        ) : (
                            <div className="space-y-3 mb-5">
                                {notes.map(note => (
                                    <div key={note.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-bold text-slate-600">{note.createdByName}</span>
                                            <span className="text-xs text-slate-400">
                                                {(note.createdAt as any)?.toDate
                                                    ? (note.createdAt as any).toDate().toLocaleString()
                                                    : String(note.createdAt)}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-800 whitespace-pre-wrap">{note.text}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Add note */}
                        {dispute.status !== "resolved" && (
                            <div className="flex gap-3">
                                <textarea
                                    value={noteText}
                                    onChange={e => setNoteText(e.target.value)}
                                    rows={3}
                                    maxLength={2000}
                                    placeholder="Add an internal note (visible to admins only)..."
                                    className="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm focus:ring-2 focus:ring-red-400 outline-none resize-none"
                                />
                                <button
                                    onClick={handleAddNote}
                                    disabled={savingNote || !noteText.trim()}
                                    className="px-4 py-2 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition disabled:opacity-50 flex items-center gap-2 text-sm self-end"
                                >
                                    {savingNote
                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                        : <Send className="w-4 h-4" />}
                                    Save
                                </button>
                            </div>
                        )}
                    </div>
                )}

            </div>
        </div>
    );
}
