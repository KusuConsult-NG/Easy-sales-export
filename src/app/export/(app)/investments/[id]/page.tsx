"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, TrendingUp, Calendar, Clock, CheckCircle2, DollarSign, MapPin, FileText, Loader2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getMyExportInvestmentsAction } from "@/app/actions/export";

type InvestmentSlot = {
    id: string;
    exportId: string;
    amount: number;
    expectedReturn: number;
    status: "active" | "completed" | "pending";
    paymentReference: string;
    purchaseDate: Date | null;
    roi: string;
    windowTitle: string;
    createdAt: Date | null;
};

export default function InvestmentDetailPage() {
    const params = useParams();
    const investmentId = params.id as string;

    const [investment, setInvestment] = useState<InvestmentSlot | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getMyExportInvestmentsAction().then((result) => {
            if (result.success ) {
                const found = result.data?.find((inv: any) => inv.id === investmentId);
                if (found) {
                    setInvestment(found as any);
                } else {
                    setError("Investment not found or you don't have access to it.");
                }
            } else {
                setError(result.error || "Failed to load investment.");
            }
            setLoading(false);
        });
    }, [investmentId]);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-purple-600" />
            </div>
        );
    }

    if (error || !investment) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="bg-white rounded-2xl p-12 text-center shadow-lg max-w-md">
                    <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-slate-900 mb-2">Investment Not Found</h2>
                    <p className="text-slate-600 mb-6">{error || "This investment could not be loaded."}</p>
                    <Link href="/export/dashboard" className="px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition">
                        Back to Dashboard
                    </Link>
                </div>
            </div>
        );
    }

    const totalPayout = investment.amount + (investment.expectedReturn || 0);
    const formatDate = (d: Date | null) => d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—";
    const statusColors: Record<string, string> = {
        active: "bg-green-500",
        completed: "bg-blue-500",
        pending: "bg-amber-500",
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-linear-to-r from-purple-600 to-pink-600 text-white py-8">
                <div className="max-w-7xl mx-auto px-8">
                    <Link href="/export/dashboard" className="inline-flex items-center gap-2 text-white/90 hover:text-white mb-4 transition">
                        <ArrowLeft className="w-5 h-5" />
                        Back to Dashboard
                    </Link>
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold mb-2">{investment.windowTitle}</h1>
                            <div className="flex items-center gap-4 text-purple-100">
                                <div className="flex items-center gap-2">
                                    <Calendar className="w-4 h-4" />
                                    Invested: {formatDate(investment.purchaseDate || investment.createdAt)}
                                </div>
                                <div className="flex items-center gap-2">
                                    <TrendingUp className="w-4 h-4" />
                                    ROI: {investment.roi}
                                </div>
                            </div>
                        </div>
                        <span className={`px-4 py-2 rounded-full text-sm font-bold ${statusColors[investment.status] ?? "bg-slate-500"} text-white`}>
                            {investment.status.charAt(0).toUpperCase() + investment.status.slice(1)}
                        </span>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-8 py-12">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Investment Progress */}
                        <div className="bg-white rounded-2xl p-6 shadow-lg">
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">Investment Timeline</h2>
                            <div className="space-y-6">
                                {[
                                    {
                                        title: "Investment Received",
                                        date: formatDate(investment.purchaseDate || investment.createdAt),
                                        done: true,
                                        desc: "Your payment was confirmed and processed via Paystack.",
                                    },
                                    {
                                        title: "Processing & Procurement",
                                        date: "Ongoing",
                                        done: investment.status !== "pending",
                                        desc: "Commodity sourcing and export preparation underway.",
                                    },
                                    {
                                        title: "Shipment & Delivery",
                                        date: "Planned",
                                        done: investment.status === "completed",
                                        desc: "Export shipment to international destination.",
                                    },
                                    {
                                        title: "Returns Distribution",
                                        date: investment.status === "completed" ? "Completed" : "Upcoming",
                                        done: investment.status === "completed",
                                        desc: "Investment returns distributed to your account.",
                                    },
                                ].map((step, idx, arr) => (
                                    <div key={idx} className="flex gap-4">
                                        <div className="flex flex-col items-center">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${step.done ? "bg-green-100" : "bg-slate-100"}`}>
                                                {step.done ? (
                                                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                                                ) : (
                                                    <span className="text-sm font-bold text-slate-400">{idx + 1}</span>
                                                )}
                                            </div>
                                            {idx < arr.length - 1 && (
                                                <div className={`w-0.5 h-16 my-2 ${step.done ? "bg-green-200" : "bg-slate-200"}`} />
                                            )}
                                        </div>
                                        <div className="flex-1 pb-8">
                                            <div className="flex items-center justify-between mb-1">
                                                <h3 className="font-bold text-slate-900">{step.title}</h3>
                                                <span className="text-sm text-slate-500">{step.date}</span>
                                            </div>
                                            <p className="text-slate-600 text-sm">{step.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Documents */}
                        <div className="bg-white rounded-2xl p-6 shadow-lg">
                            <h2 className="text-2xl font-bold text-slate-900 mb-4">Investment Documents</h2>
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-4">
                                <FileText className="w-8 h-8 text-amber-500 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-semibold text-amber-900 mb-1">Documents prepared after processing</p>
                                    <p className="text-sm text-amber-800">
                                        Your Investment Agreement, Payment Receipt, Export Certificate and Insurance Policy
                                        will be generated and made available for download once our team completes the export window
                                        processing. You will receive a notification when they are ready.
                                    </p>
                                    {investment.status === "completed" && (
                                        <p className="text-sm font-semibold text-amber-900 mt-2">
                                            📬 Your export window is complete — documents should be in your email or available via support.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        <div className="bg-white rounded-2xl p-6 shadow-lg">
                            <h3 className="text-xl font-bold text-slate-900 mb-4">Investment Summary</h3>
                            <div className="space-y-4">
                                <div>
                                    <p className="text-sm text-slate-600 mb-1">Amount Invested</p>
                                    <p className="text-3xl font-bold text-slate-900">₦{investment.amount?.toLocaleString()}</p>
                                </div>
                                <div className="pt-4 border-t border-slate-200 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-slate-600">Expected Return</span>
                                        <span className="text-sm font-bold text-green-600">+₦{(investment.expectedReturn || 0).toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-slate-600">Total Payout</span>
                                        <span className="text-lg font-bold text-slate-900">₦{totalPayout.toLocaleString()}</span>
                                    </div>
                                </div>
                                <div className="pt-4 border-t border-slate-200">
                                    <p className="text-xs text-slate-500 mb-1">Payment Reference</p>
                                    <p className="text-xs font-mono text-slate-700 break-all">{investment.paymentReference || "—"}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-linear-to-br from-purple-600 to-pink-600 rounded-2xl p-6 text-white">
                            <h3 className="font-bold mb-2">Need Help?</h3>
                            <p className="text-sm text-purple-100 mb-4">Contact support for questions about your investment</p>
                            <Link
                                href="/contact"
                                className="block text-center w-full px-4 py-2 bg-white text-purple-600 font-semibold rounded-lg hover:bg-purple-50 transition"
                            >
                                Contact Support
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
