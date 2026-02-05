"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, ArrowLeft, FileText, Send } from "lucide-react";
import { createDisputeAction, getEscrowTransactionByIdAction, type EscrowTransaction } from "@/app/actions/escrow";

interface DisputePageProps {
    params: { id: string };
}

export default function CreateDisputePage({ params }: DisputePageProps) {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [reason, setReason] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [escrowData, setEscrowData] = useState<any>(null);
    const [loadingEscrow, setLoadingEscrow] = useState(true);
    const escrowId = params.id;

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        }
    }, [status, router]);

    // Load escrow transaction data
    useEffect(() => {
        async function loadEscrow() {
            if (status !== "authenticated" || !session?.user) return;

            const result = await getEscrowTransactionByIdAction(escrowId);
            if (result.success && result.data) {
                setEscrowData(result.data);
            } else {
                alert("Escrow transaction not found");
                router.push("/escrow");
            }
            setLoadingEscrow(false);
        }
        loadEscrow();
    }, [status, session, escrowId, router]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!reason.trim() || !session?.user || !escrowData) return;

        if (!confirm("Are you sure you want to create a dispute? This will notify the admin for review.")) {
            return;
        }

        setSubmitting(true);

        // Determine if current user is buyer or seller
        const isBuyer = escrowData.buyerId === session.user.id;
        const isSeller = escrowData.sellerId === session.user.id;

        if (!isBuyer && !isSeller) {
            alert("You are not authorized to create a dispute for this transaction");
            setSubmitting(false);
            return;
        }

        const result = await createDisputeAction({
            escrowId,
            initiatedBy: isBuyer ? "buyer" : "seller",
            initiatorId: session.user.id,
            respondentId: isBuyer ? escrowData.sellerId : escrowData.buyerId,
            reason: reason.trim(),
        });

        if (result.success) {
            alert("Dispute created successfully! Our team will review it shortly.");
            router.push("/escrow");
        } else {
            alert(result.error || "Failed to create dispute");
        }

        setSubmitting(false);
    }

    if (loadingEscrow) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-900 via-yellow-900 to-slate-900 p-6 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-900 via-yellow-900 to-slate-900 p-6">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.push("/escrow")}
                        className="mb-4 flex items-center space-x-2 text-yellow-200 hover:text-yellow-100 transition"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span>Back to Escrow</span>
                    </button>

                    <div className="flex items-center space-x-4 mb-4">
                        <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center">
                            <AlertTriangle className="w-6 h-6 text-yellow-400" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-white">Create Dispute</h1>
                            <p className="text-yellow-200">Transaction #{escrowId.slice(0, 8)}</p>
                        </div>
                    </div>

                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                        <h3 className="font-semibold text-yellow-300 mb-2">Before you proceed:</h3>
                        <ul className="text-sm text-yellow-200 space-y-1 list-disc list-inside">
                            <li>Disputes should only be used for serious issues</li>
                            <li>Try resolving the issue with the other party first via chat</li>
                            <li>Our admin team will review and make a fair decision</li>
                            <li>The escrow funds will remain held during review</li>
                        </ul>
                    </div>
                </div>

                {/* Dispute Form */}
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Reason */}
                        <div>
                            <label className="block text-sm font-medium text-white mb-2">
                                Reason for Dispute *
                            </label>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Describe the issue in detail. Include relevant information such as what went wrong, when it happened, and what resolution you're seeking..."
                                required
                                maxLength={2000}
                                rows={8}
                                className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder:text-yellow-200/50 focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
                            />
                            <div className="mt-2 text-xs text-yellow-300 text-right">
                                {reason.length}/2000 characters
                            </div>
                        </div>

                        {/* Evidence Upload Info */}
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
                            <div className="flex items-start space-x-3">
                                <FileText className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="font-medium text-blue-300 mb-1">Evidence & Documentation</h4>
                                    <p className="text-sm text-blue-200">
                                        After submitting, you can upload evidence (screenshots, contracts, receipts) via the escrow chat.
                                        Our admin team will review all materials.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => router.push("/escrow")}
                                disabled={submitting}
                                className="flex-1 px-6 py-3 bg-white/10 hover:bg-white/20 disabled:bg-white/5 text-white rounded-xl font-medium transition"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!reason.trim() || submitting}
                                className="flex-1 px-6 py-3 bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-500/50 text-white rounded-xl font-medium transition flex items-center justify-center space-x-2"
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span>Submitting...</span>
                                    </>
                                ) : (
                                    <>
                                        <Send className="w-5 h-5" />
                                        <span>Submit Dispute</span>
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Notice */}
                        <div className="text-xs text-yellow-200 text-center">
                            By submitting this dispute, you agree to cooperate with the admin review process
                            and provide any requested additional information.
                        </div>
                    </form>
                </div>

                {/* What Happens Next */}
                <div className="mt-6 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
                    <h3 className="font-semibold text-white mb-4">What happens next?</h3>
                    <div className="space-y-3">
                        <div className="flex items-start space-x-3">
                            <div className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0">
                                <span className="text-xs font-bold text-yellow-400">1</span>
                            </div>
                            <div>
                                <p className="text-sm text-white font-medium">Review Initiated</p>
                                <p className="text-xs text-yellow-200">Escrow status changes to "Disputed" - funds remain held</p>
                            </div>
                        </div>
                        <div className="flex items-start space-x-3">
                            <div className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0">
                                <span className="text-xs font-bold text-yellow-400">2</span>
                            </div>
                            <div>
                                <p className="text-sm text-white font-medium">Investigation</p>
                                <p className="text-xs text-yellow-200">Admin reviews evidence from both parties (typically 2-5 business days)</p>
                            </div>
                        </div>
                        <div className="flex items-start space-x-3">
                            <div className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0">
                                <span className="text-xs font-bold text-yellow-400">3</span>
                            </div>
                            <div>
                                <p className="text-sm text-white font-medium">Resolution</p>
                                <p className="text-xs text-yellow-200">Funds released to seller OR refunded to buyer based on findings</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
