"use client";

import { ArrowLeft, TrendingUp, Calendar, Package, Clock, CheckCircle2, AlertCircle, DollarSign, MapPin, FileText } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function InvestmentDetailPage() {
    const params = useParams();
    const investmentId = params.id;

    // Mock investment data - in production, fetch from API/database
    const investments: Record<string, {
        id: string;
        commodity: string;
        destination: string;
        amount: number;
        investmentDate: string;
        expectedReturn: number;
        expectedReturnDate: string;
        status: "active" | "completed" | "pending";
        daysRemaining: number;
        windowId: string;
        progress: number;
        milestones: Array<{ title: string; date: string; status: "completed" | "current" | "pending"; description: string }>;
        documents: string[];
        paymentSchedule: Array<{ phase: string; amount: number; date: string; status: "paid" | "pending" }>;
    }> = {
        "1": {
            id: "1",
            commodity: "Yam Tubers Export - UK",
            destination: "United Kingdom",
            amount: 1000000,
            investmentDate: "February 1, 2024",
            expectedReturn: 220000,
            expectedReturnDate: "April 15, 2024",
            status: "active",
            daysRemaining: 45,
            windowId: "1",
            progress: 65,
            milestones: [
                {
                    title: "Investment Received",
                    date: "Feb 1, 2024",
                    status: "completed",
                    description: "Your investment was confirmed and processed"
                },
                {
                    title: "Procurement Complete",
                    date: "Feb 15, 2024",
                    status: "completed",
                    description: "Premium yam tubers sourced from Benue farms"
                },
                {
                    title: "Processing & Packaging",
                    date: "Feb 25, 2024",
                    status: "current",
                    description: "Quality checks and export packaging in progress"
                },
                {
                    title: "Shipment to UK",
                    date: "Mar 5, 2024",
                    status: "pending",
                    description: "Air freight departure scheduled"
                },
                {
                    title: "Returns Distribution",
                    date: "Apr 15, 2024",
                    status: "pending",
                    description: "Investment returns processed to your account"
                }
            ],
            documents: [
                "Investment Agreement",
                "Export Certificate",
                "Insurance Policy",
                "Shipment Tracking",
                "Quality Assurance Report"
            ],
            paymentSchedule: [
                {
                    phase: "Initial Investment",
                    amount: 1000000,
                    date: "Feb 1, 2024",
                    status: "paid"
                },
                {
                    phase: "Expected Return",
                    amount: 1220000,
                    date: "Apr 15, 2024",
                    status: "pending"
                }
            ]
        },
        "2": {
            id: "2",
            commodity: "Sesame Seeds - Dubai",
            destination: "Dubai, UAE",
            amount: 750000,
            investmentDate: "January 20, 2024",
            expectedReturn: 150000,
            expectedReturnDate: "May 10, 2024",
            status: "active",
            daysRemaining: 78,
            windowId: "2",
            progress: 45,
            milestones: [
                {
                    title: "Investment Received",
                    date: "Jan 20, 2024",
                    status: "completed",
                    description: "Investment confirmed"
                },
                {
                    title: "Procurement Phase",
                    date: "Feb 10, 2024",
                    status: "current",
                    description: "Sourcing sesame seeds from verified suppliers"
                },
                {
                    title: "Processing",
                    date: "Mar 1, 2024",
                    status: "pending",
                    description: "Cleaning and quality grading"
                },
                {
                    title: "Export to UAE",
                    date: "Apr 1, 2024",
                    status: "pending",
                    description: "Sea freight to Dubai"
                },
                {
                    title: "Returns Distribution",
                    date: "May 10, 2024",
                    status: "pending",
                    description: "Returns credited to account"
                }
            ],
            documents: [
                "Investment Agreement",
                "Export License",
                "Quality Certificate",
                "Insurance Coverage"
            ],
            paymentSchedule: [
                {
                    phase: "Initial Investment",
                    amount: 750000,
                    date: "Jan 20, 2024",
                    status: "paid"
                },
                {
                    phase: "Expected Return",
                    amount: 900000,
                    date: "May 10, 2024",
                    status: "pending"
                }
            ]
        },
        "3": {
            id: "3",
            commodity: "Hibiscus Export - USA",
            destination: "United States",
            amount: 750000,
            investmentDate: "January 15, 2024",
            expectedReturn: 135000,
            expectedReturnDate: "May 20, 2024",
            status: "active",
            daysRemaining: 92,
            windowId: "3",
            progress: 38,
            milestones: [
                {
                    title: "Investment Received",
                    date: "Jan 15, 2024",
                    status: "completed",
                    description: "Investment processed successfully"
                },
                {
                    title: "Organic Sourcing",
                    date: "Feb 5, 2024",
                    status: "current",
                    description: "Sourcing USDA-certified organic hibiscus"
                },
                {
                    title: "Processing & Drying",
                    date: "Mar 10, 2024",
                    status: "pending",
                    description: "Quality processing for export"
                },
                {
                    title: "Export to USA",
                    date: "Apr 15, 2024",
                    status: "pending",
                    description: "Air freight to US distribution"
                },
                {
                    title: "Returns Distribution",
                    date: "May 20, 2024",
                    status: "pending",
                    description: "Investment returns distributed"
                }
            ],
            documents: [
                "Investment Agreement",
                "USDA Organic Certificate",
                "FDA Import Permit",
                "Insurance Policy"
            ],
            paymentSchedule: [
                {
                    phase: "Initial Investment",
                    amount: 750000,
                    date: "Jan 15, 2024",
                    status: "paid"
                },
                {
                    phase: "Expected Return",
                    amount: 885000,
                    date: "May 20, 2024",
                    status: "pending"
                }
            ]
        }
    };

    const investment = investments[investmentId as string] || {
        id: investmentId as string,
        commodity: "Investment Not Found",
        destination: "N/A",
        amount: 0,
        investmentDate: "N/A",
        expectedReturn: 0,
        expectedReturnDate: "N/A",
        status: "pending" as const,
        daysRemaining: 0,
        windowId: "0",
        progress: 0,
        milestones: [],
        documents: [],
        paymentSchedule: []
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="bg-linear-to-r from-purple-600 to-pink-600 text-white py-8">
                <div className="max-w-7xl mx-auto px-8">
                    <Link
                        href="/export/dashboard"
                        className="inline-flex items-center gap-2 text-white/90 hover:text-white mb-4 transition"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Back to Dashboard
                    </Link>
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold mb-2">{investment.commodity}</h1>
                            <div className="flex items-center gap-4 text-purple-100">
                                <div className="flex items-center gap-2">
                                    <MapPin className="w-4 h-4" />
                                    {investment.destination}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Calendar className="w-4 h-4" />
                                    Invested: {investment.investmentDate}
                                </div>
                            </div>
                        </div>
                        <span
                            className={`px-4 py-2 rounded-full text-sm font-bold ${investment.status === "active"
                                ? "bg-green-500 text-white"
                                : investment.status === "completed"
                                    ? "bg-blue-500 text-white"
                                    : "bg-amber-500 text-white"
                                }`}
                        >
                            {investment.status.charAt(0).toUpperCase() + investment.status.slice(1)}
                        </span>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-8 py-12">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Progress Overview */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                Investment Progress
                            </h2>
                            <div className="mb-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-900 dark:text-white">
                                        Overall Progress
                                    </span>
                                    <span className="text-sm font-bold text-purple-600 dark:text-purple-400">
                                        {investment.progress}%
                                    </span>
                                </div>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3">
                                    <div
                                        className="bg-linear-to-r from-purple-600 to-pink-600 h-3 rounded-full transition-all"
                                        style={{ width: `${investment.progress}%` }}
                                    ></div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                <Clock className="w-4 h-4" />
                                {investment.daysRemaining} days until expected return
                            </div>
                        </div>

                        {/* Milestones */}
                        {investment.milestones.length > 0 && (
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                    Investment Timeline
                                </h2>
                                <div className="space-y-6">
                                    {investment.milestones.map((milestone, index) => (
                                        <div key={index} className="flex gap-4">
                                            <div className="flex flex-col items-center">
                                                <div
                                                    className={`w-10 h-10 rounded-full flex items-center justify-center ${milestone.status === "completed"
                                                        ? "bg-green-100 dark:bg-green-900/30"
                                                        : milestone.status === "current"
                                                            ? "bg-purple-100 dark:bg-purple-900/30"
                                                            : "bg-slate-100 dark:bg-slate-700"
                                                        }`}
                                                >
                                                    {milestone.status === "completed" ? (
                                                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                                                    ) : (
                                                        <span
                                                            className={`text-sm font-bold ${milestone.status === "current"
                                                                ? "text-purple-600 dark:text-purple-400"
                                                                : "text-slate-400"
                                                                }`}
                                                        >
                                                            {index + 1}
                                                        </span>
                                                    )}
                                                </div>
                                                {index < investment.milestones.length - 1 && (
                                                    <div
                                                        className={`w-0.5 h-16 my-2 ${milestone.status === "completed"
                                                            ? "bg-green-200 dark:bg-green-900/30"
                                                            : "bg-slate-200 dark:bg-slate-700"
                                                            }`}
                                                    ></div>
                                                )}
                                            </div>
                                            <div className="flex-1 pb-8">
                                                <div className="flex items-center justify-between mb-1">
                                                    <h3 className="font-bold text-slate-900 dark:text-white">
                                                        {milestone.title}
                                                    </h3>
                                                    <span className="text-sm text-slate-500 dark:text-slate-400">
                                                        {milestone.date}
                                                    </span>
                                                </div>
                                                <p className="text-slate-600 dark:text-slate-400 text-sm">
                                                    {milestone.description}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Documents */}
                        {investment.documents.length > 0 && (
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                    Investment Documents
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {investment.documents.map((doc, index) => (
                                        <button
                                            key={index}
                                            className="flex items-center gap-3 p-3 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-purple-300 dark:hover:border-purple-700 transition text-left"
                                        >
                                            <FileText className="w-5 h-5 text-purple-600 shrink-0" />
                                            <span className="text-sm font-medium text-slate-900 dark:text-white">
                                                {doc}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        {/* Investment Summary */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                                Investment Summary
                            </h3>

                            <div className="space-y-4">
                                <div>
                                    <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                                        Amount Invested
                                    </div>
                                    <div className="text-3xl font-bold text-slate-900 dark:text-white">
                                        ₦{investment.amount.toLocaleString()}
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm text-slate-600 dark:text-slate-400">
                                            Expected Return
                                        </span>
                                        <span className="text-sm font-bold text-green-600 dark:text-green-400">
                                            +₦{investment.expectedReturn.toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-slate-600 dark:text-slate-400">
                                            Total Payout
                                        </span>
                                        <span className="text-lg font-bold text-slate-900 dark:text-white">
                                            ₦{(investment.amount + investment.expectedReturn).toLocaleString()}
                                        </span>
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm text-slate-600 dark:text-slate-400">
                                            Expected Date
                                        </span>
                                        <span className="text-sm font-medium text-slate-900 dark:text-white">
                                            {investment.expectedReturnDate}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400">
                                        <Clock className="w-4 h-4" />
                                        {investment.daysRemaining} days remaining
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Payment Schedule */}
                        {investment.paymentSchedule.length > 0 && (
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                                    Payment Schedule
                                </h3>
                                <div className="space-y-3">
                                    {investment.paymentSchedule.map((payment, index) => (
                                        <div
                                            key={index}
                                            className="p-3 bg-slate-50 dark:bg-slate-700 rounded-lg"
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-sm font-medium text-slate-900 dark:text-white">
                                                    {payment.phase}
                                                </span>
                                                <span
                                                    className={`text-xs px-2 py-1 rounded-full ${payment.status === "paid"
                                                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                                        }`}
                                                >
                                                    {payment.status}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-slate-600 dark:text-slate-400">
                                                    {payment.date}
                                                </span>
                                                <span className="text-sm font-bold text-slate-900 dark:text-white">
                                                    ₦{payment.amount.toLocaleString()}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* CTA */}
                        <div className="bg-linear-to-br from-purple-600 to-pink-600 rounded-2xl p-6 text-white">
                            <h3 className="font-bold mb-2">Need Help?</h3>
                            <p className="text-sm text-purple-100 mb-4">
                                Contact support for questions about your investment
                            </p>
                            <button className="w-full px-4 py-2 bg-white text-purple-600 font-semibold rounded-lg hover:bg-purple-50 transition">
                                Contact Support
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
