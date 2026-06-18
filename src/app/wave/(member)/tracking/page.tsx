"use client";

import { useState, useEffect } from "react";
import { logger } from "@/lib/logger";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
    TrendingUp, Clock, Download, Calendar,
    Eye, Loader2, ArrowDownCircle, CheckCircle, ChevronDown,
    Shield, Landmark, AlertCircle, RefreshCw, PlusCircle
} from "lucide-react";
import {
    getWaveApplicationAction,
    getMemberDisbursementsAction,
    withdrawEarningsAction,
    calculateEarningsAction
} from "@/app/actions/wave";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

export default function WaveTrackingPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const { showToast } = useToast();

    const [application, setApplication] = useState<any>(null);
    const [disbursements, setDisbursements] = useState<any[]>([]);
    const [earningsBalance, setEarningsBalance] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [submittingDisbursement, setSubmittingDisbursement] = useState(false);
    const [disbursementAmount, setDisbursementAmount] = useState("");
    const [showDisbursementModal, setShowDisbursementModal] = useState(false);
    const [expandedDisbursementId, setExpandedDisbursementId] = useState<string | null>(null);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        } else if (status === "authenticated" && session?.user?.id) {
            loadTrackingData();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, session]);

    async function loadTrackingData() {
        if (!session?.user?.id) return;
        setLoading(true);
        try {
            // Load application
            const appResult = await getWaveApplicationAction();
            if (appResult.success) {
                setApplication(appResult.data);
            }

            // Load disbursements
            const disbResult = await getMemberDisbursementsAction();
            if (disbResult.success && disbResult.data) {
                setDisbursements(disbResult.data);
            }

            // Load earnings balance
            const earningsResult = await calculateEarningsAction(session.user.id);
            if (earningsResult.success && earningsResult.data) {
                setEarningsBalance(earningsResult.data.paidAmount || 0);
            }
        } catch (error) {
            logger.error("Failed to load tracking data:", error);
            showToast("Failed to load tracking data", "error");
        } finally {
            setLoading(false);
        }
    }

    async function handleRequestDisbursement() {
        const amount = parseFloat(disbursementAmount);
        if (isNaN(amount) || amount < 5000) {
            showToast("Minimum disbursement request is ₦5,000", "error");
            return;
        }
        if (amount > earningsBalance) {
            showToast("Amount exceeds your available balance", "error");
            return;
        }

        setSubmittingDisbursement(true);
        try {
            const result = await withdrawEarningsAction(amount);
            if (result.success) {
                showToast(`Disbursement request of ₦${amount.toLocaleString()} submitted successfully!`, "success");
                setShowDisbursementModal(false);
                setDisbursementAmount("");
                loadTrackingData(); // Refresh
            } else {
                showToast(result.error || "Disbursement request failed", "error");
            }
        } catch (error) {
            showToast("An error occurred submitting disbursement request", "error");
        } finally {
            setSubmittingDisbursement(false);
        }
    }

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-linear-to-br from-emerald-50 to-emerald-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-emerald-700" />
            </div>
        );
    }

    const appStatus = application?.status || "none";
    const fundingNeeded = application?.fundingNeeded || 0;

    // Timeline Steps for WAVE Application
    const timelineSteps = [
        {
            title: "Application Submitted",
            description: "Your official beneficiary application form was received",
            date: application?.submittedAt || application?.createdAt,
            status: appStatus !== "none" ? "completed" : "pending"
        },
        {
            title: "Under Review",
            description: "WAVE program officers are checking your documents and business plan",
            date: application?.reviewedAt || (appStatus === "under_review" || appStatus === "approved" || appStatus === "rejected" ? application?.updatedAt : null),
            status: appStatus === "under_review" || appStatus === "approved" || appStatus === "rejected" ? "completed" : "pending"
        },
        {
            title: "Funding Approved",
            description: fundingNeeded ? `Approved grant/loan value: ₦${fundingNeeded.toLocaleString()}` : "Grant/loan approval status",
            date: appStatus === "approved" ? application?.reviewedAt || application?.updatedAt : null,
            status: appStatus === "approved" ? "completed" : appStatus === "rejected" ? "failed" : "pending"
        },
        {
            title: "Disbursements Initiated",
            description: disbursements.length > 0 ? `${disbursements.length} disbursement request(s) registered` : "Awaiting initial disbursement milestone",
            status: disbursements.some(d => d.status === "completed") ? "completed" : disbursements.length > 0 ? "active" : "pending"
        }
    ];

    const totalDisbursed = disbursements
        .filter(d => d.status === "completed")
        .reduce((sum, d) => sum + (d.amount || 0), 0);

    const pendingDisbursed = disbursements
        .filter(d => d.status === "pending" || d.status === "approved" || d.status === "approved_pending_payout" || d.status === "processing")
        .reduce((sum, d) => sum + (d.amount || 0), 0);

    return (
        <div className="min-h-screen bg-linear-to-br from-emerald-50 to-emerald-50 py-8 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                            🌾 Grant & Loan Tracking
                        </h1>
                        <p className="text-slate-600">
                            Monitor your WAVE program application, approved funding, and regional disbursements.
                        </p>
                    </div>
                    <button
                        onClick={loadTrackingData}
                        className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition flex items-center gap-2 shadow-sm"
                    >
                        <RefreshCw className="w-4 h-4 text-emerald-700" />
                        Refresh Status
                    </button>
                </div>

                {/* Status Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {/* Approved Funding */}
                    <div className="bg-linear-to-br from-emerald-700 to-emerald-800 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-15">
                            <Landmark className="w-24 h-24" />
                        </div>
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-emerald-100 text-xs font-bold uppercase tracking-wider">Total Approved Funding</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                appStatus === "approved" ? "bg-emerald-600/50 text-white" : "bg-white/20 text-white"
                            }`}>
                                {appStatus === "approved" ? "Approved" : appStatus === "rejected" ? "Rejected" : "In Review"}
                            </span>
                        </div>
                        <p className="text-3xl font-bold mb-1">
                            {formatCurrency(appStatus === "approved" ? fundingNeeded : 0)}
                        </p>
                        <p className="text-emerald-200 text-xs mt-2">
                            {appStatus === "approved" ? "WAVE Program Grant/Loan Capital" : "Awaiting application approval"}
                        </p>
                    </div>

                    {/* Total Disbursed */}
                    <div className="bg-white rounded-2xl p-6 shadow-xl border border-slate-100 relative overflow-hidden">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">Total Disbursed</span>
                            <CheckCircle className="w-5 h-5 text-emerald-600" />
                        </div>
                        <p className="text-3xl font-bold text-slate-900 mb-1">
                            {formatCurrency(totalDisbursed)}
                        </p>
                        <p className="text-slate-500 text-xs mt-2">
                            Funds successfully paid into your bank account.
                        </p>
                    </div>

                    {/* Pending Disbursement */}
                    <div className="bg-white rounded-2xl p-6 shadow-xl border border-slate-100 relative overflow-hidden">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">Pending Disbursement</span>
                            <Clock className="w-5 h-5 text-amber-500" />
                        </div>
                        <p className="text-3xl font-bold text-slate-900 mb-1">
                            {formatCurrency(pendingDisbursed)}
                        </p>
                        <p className="text-slate-500 text-xs mt-2">
                            Awaiting admin clearance or bank processing.
                        </p>
                    </div>
                </div>

                {/* Application Timeline & Request Panel */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                    {/* Timeline Column */}
                    <div className="lg:col-span-2 bg-white rounded-2xl p-6 shadow-xl border border-slate-100">
                        <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                            <Shield className="w-5 h-5 text-emerald-700" />
                            Application Status Timeline
                        </h2>

                        {appStatus === "none" ? (
                            <div className="text-center py-10">
                                <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                                <p className="text-slate-600 font-semibold mb-2">No Active Application Found</p>
                                <p className="text-slate-500 text-sm max-w-sm mx-auto mb-4">
                                    You haven't submitted your WAVE beneficiary application yet.
                                </p>
                                <button
                                    onClick={() => router.push("/wave/application")}
                                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition"
                                >
                                    Start Application
                                </button>
                            </div>
                        ) : (
                            <div className="relative border-l-2 border-slate-100 ml-4 pl-6 space-y-8">
                                {timelineSteps.map((step, idx) => {
                                    const isCompleted = step.status === "completed";
                                    const isActive = step.status === "active";
                                    const isFailed = step.status === "failed";

                                    return (
                                        <div key={idx} className="relative">
                                            {/* Line Node */}
                                            <div className={`absolute -left-[35px] top-1.5 w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                                                isCompleted ? "bg-emerald-700 border-emerald-700 text-white" :
                                                isFailed ? "bg-red-600 border-red-600 text-white" :
                                                isActive ? "bg-emerald-50 border-emerald-700 text-emerald-700 animate-pulse" :
                                                "bg-white border-slate-200 text-slate-400"
                                            }`}>
                                                {isCompleted ? <CheckCircle className="w-3.5 h-3.5" /> : 
                                                 isFailed ? <AlertCircle className="w-3.5 h-3.5" /> :
                                                 <div className="w-1.5 h-1.5 rounded-full bg-current" />}
                                            </div>

                                            {/* Content */}
                                            <div>
                                                <div className="flex justify-between items-start gap-4">
                                                    <h3 className={`font-semibold text-sm ${isFailed ? "text-red-600" : "text-slate-900"}`}>
                                                        {step.title}
                                                    </h3>
                                                    {step.date && (
                                                        <span className="text-[10px] text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full font-mono">
                                                            {new Date(step.date).toLocaleDateString()}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-slate-500 mt-1">{step.description}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Disbursement Request Card */}
                    <div className="bg-white rounded-2xl p-6 shadow-xl border border-slate-100 flex flex-col justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
                                <Landmark className="w-5 h-5 text-emerald-700" />
                                Available Balance
                            </h2>
                            <p className="text-xs text-slate-500 mb-6">
                                Request a payout of your cleared program funding directly into your registered bank details.
                            </p>

                            <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4 mb-6 text-center">
                                <span className="text-[10px] text-emerald-800 font-bold uppercase tracking-wider block mb-1">Available for Disbursement</span>
                                <span className="text-3xl font-black text-emerald-800 font-mono">{formatCurrency(earningsBalance)}</span>
                            </div>
                        </div>

                        <button
                            onClick={() => setShowDisbursementModal(true)}
                            disabled={earningsBalance < 5000}
                            className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold shadow-md transition flex items-center justify-center gap-2"
                        >
                            <ArrowDownCircle className="w-4 h-4" />
                            Request Disbursement
                        </button>
                    </div>
                </div>

                {/* Disbursement History */}
                <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
                    <div className="p-6 border-b border-slate-100">
                        <h2 className="text-lg font-bold text-gray-900">
                            Disbursement History & Status Tracking
                        </h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Follow the progress of each disbursement transaction individually in real-time.
                        </p>
                    </div>

                    {disbursements.length === 0 ? (
                        <div className="p-12 text-center text-slate-400">
                            <Landmark className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                            <p className="text-slate-600 font-medium">No disbursements initiated yet.</p>
                            <p className="text-xs text-slate-400 mt-1">
                                Your requests will appear here once you initiate a disbursement.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {disbursements.map((disb) => {
                                const isExpanded = expandedDisbursementId === disb.id;
                                const isCompleted = disb.status === "completed";
                                const isRejected = disb.status === "rejected";
                                const isProcessing = disb.status === "processing" || disb.status === "approved" || disb.status === "approved_pending_payout";

                                return (
                                    <div
                                        key={disb.id}
                                        className="p-5 hover:bg-slate-50/50 transition cursor-pointer"
                                        onClick={() => setExpandedDisbursementId(isExpanded ? null : disb.id)}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-start gap-4">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                                    isCompleted ? "bg-emerald-50 text-emerald-700" :
                                                    isRejected ? "bg-red-50 text-red-600" :
                                                    "bg-amber-50 text-amber-600"
                                                }`}>
                                                    <Landmark className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <h4 className="font-semibold text-slate-900 text-sm">Disbursement Request</h4>
                                                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                                                        <Calendar className="w-3.5 h-3.5" />
                                                        <span>{disb.requestedAt ? new Date(disb.requestedAt).toLocaleDateString() : "Pending"}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="text-right">
                                                    <p className="font-bold text-sm text-slate-900">
                                                        {formatCurrency(disb.amount)}
                                                    </p>
                                                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold tracking-wide mt-1 inline-block uppercase ${
                                                        isCompleted ? "bg-emerald-100 text-emerald-800" :
                                                        isRejected ? "bg-red-100 text-red-700" :
                                                        "bg-amber-100 text-amber-700"
                                                    }`}>
                                                        {disb.status.replace(/_/g, " ")}
                                                    </span>
                                                </div>
                                                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                            </div>
                                        </div>

                                        {/* Expanded Details / Timeline */}
                                        {isExpanded && (
                                            <div className="mt-4 pt-4 border-t border-slate-100 bg-slate-50/50 p-4 rounded-xl space-y-4">
                                                {/* Mini Transaction Details */}
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                                    <div>
                                                        <p className="text-slate-400 font-semibold mb-0.5">Reference ID</p>
                                                        <p className="font-mono text-slate-800 font-medium select-all">{disb.id}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-slate-400 font-semibold mb-0.5">Payout Code</p>
                                                        <p className="text-slate-800 font-medium font-mono">{disb.transactionReference || "Generating..."}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-slate-400 font-semibold mb-0.5">Updated At</p>
                                                        <p className="text-slate-800 font-medium">{disb.completedAt || disb.processedAt ? new Date(disb.completedAt || disb.processedAt).toLocaleString() : "Awaiting processing"}</p>
                                                    </div>
                                                </div>

                                                {/* Payout Status Timeline */}
                                                <div className="bg-white p-4 rounded-lg border border-slate-100">
                                                    <p className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">Transaction Progress</p>
                                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-5 h-5 rounded-full bg-emerald-700 text-white flex items-center justify-center text-[10px] font-bold">1</div>
                                                            <div className="text-xs">
                                                                <p className="font-semibold text-slate-800">Request Received</p>
                                                                <p className="text-[10px] text-slate-500">Awaiting admin review</p>
                                                            </div>
                                                        </div>
                                                        <div className="hidden md:block flex-1 h-0.5 bg-slate-100" />
                                                        <div className="flex items-center gap-2">
                                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                                                isCompleted || isProcessing ? "bg-emerald-700 text-white" : isRejected ? "bg-red-600 text-white" : "bg-slate-100 text-slate-400"
                                                            }`}>2</div>
                                                            <div className="text-xs">
                                                                <p className="font-semibold text-slate-800">Processing</p>
                                                                <p className="text-[10px] text-slate-500">{isRejected ? "Rejected by program officer" : "Payment approval and validation"}</p>
                                                            </div>
                                                        </div>
                                                        <div className="hidden md:block flex-1 h-0.5 bg-slate-100" />
                                                        <div className="flex items-center gap-2">
                                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                                                isCompleted ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-400"
                                                            }`}>3</div>
                                                            <div className="text-xs">
                                                                <p className="font-semibold text-slate-800">Funds Disbursed</p>
                                                                <p className="text-[10px] text-slate-500">Transferred to bank details</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {isRejected && disb.adminNotes && (
                                                    <div className="bg-red-50 border border-red-100 text-red-800 text-xs p-3 rounded-lg">
                                                        <strong className="block mb-0.5">Rejection Reason:</strong>
                                                        {disb.adminNotes}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Request Payout Modal */}
                {showDisbursementModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
                            <h2 className="text-2xl font-bold text-gray-900 mb-2">
                                Request Disbursement
                            </h2>
                            <p className="text-xs text-slate-500 mb-6">
                                Enter the amount you wish to withdraw from your available program balance.
                            </p>

                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                    Disbursement Amount (₦)
                                </label>
                                <input
                                    type="number"
                                    value={disbursementAmount}
                                    onChange={(e) => setDisbursementAmount(e.target.value)}
                                    placeholder="Enter amount"
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-mono font-bold text-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                    disabled={submittingDisbursement}
                                />
                                <div className="mt-3 flex justify-between items-center text-xs text-slate-500">
                                    <span>Available balance: <strong>{formatCurrency(earningsBalance)}</strong></span>
                                    <span>Min. request: ₦5,000</span>
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => {
                                        setShowDisbursementModal(false);
                                        setDisbursementAmount("");
                                    }}
                                    className="flex-1 px-4 py-3 border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition"
                                    disabled={submittingDisbursement}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleRequestDisbursement}
                                    disabled={submittingDisbursement || !disbursementAmount || parseFloat(disbursementAmount) < 5000 || parseFloat(disbursementAmount) > earningsBalance}
                                    className="flex-1 px-4 py-3 bg-emerald-700 text-white font-semibold rounded-xl hover:bg-emerald-800 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {submittingDisbursement ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Submitting...
                                        </>
                                    ) : (
                                        "Confirm Request"
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
