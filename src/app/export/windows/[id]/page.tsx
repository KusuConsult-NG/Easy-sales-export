"use client";

import { ArrowLeft, TrendingUp, Calendar, MapPin, Clock, Shield, FileText, Users, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { getExportOpportunityById, type ExportOpportunity } from "@/app/actions/export-investments";
import { initializeInvestmentPaymentAction } from "@/app/actions/export-payment";

export default function ExportWindowDetailPage() {
    const params = useParams();
    const windowId = params.id;
    const { data: session } = useSession();
    const router = useRouter();

    const [windowData, setWindowData] = useState<ExportOpportunity | null>(null);
    const [loading, setLoading] = useState(true);
    const [investing, setInvesting] = useState(false);
    const [investmentAmount, setInvestmentAmount] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);

    const loadWindow = useCallback(async () => {
        setTimeout(() => setLoading(true), 0);
        const result = await getExportOpportunityById(windowId as string);
        if (result.success) {
            setWindowData(result.data);
            setInvestmentAmount(result.data?.minInvestment ?? 0);
        }
        setLoading(false);
    }, [windowId]);

    useEffect(() => {
        if (windowId) {
             
            loadWindow();
        }
    }, [windowId, loadWindow]);

    async function handleInvest() {
        if (!session) {
            router.push("/auth/login?redirect=/export/windows/" + windowId);
            return;
        }

        if (!windowData) return;

        setInvesting(true);
        setError(null);

        try {
            const result = await initializeInvestmentPaymentAction(
                windowId as string,
                windowData.commodity,
                investmentAmount,
                windowData.commodity,
                parseFloat(windowData.projectedROI.replace("%", ""))
            );

            if (result.success) {
                // Redirect to Paystack for payment
                if (result.data?.authorizationUrl) {
                    globalThis.window.location.href = result.data.authorizationUrl;
                } else {
                    setError("Failed to initialize investment: No authorization URL");
                    setInvesting(false);
                }
            } else {
                setError(result.error || "Failed to initialize investment");
                setInvesting(false);
            }
        } catch (err) {
            setError("An error occurred while processing your investment");
            setInvesting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
            </div>
        );
    }

    if (!windowData) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8">
                <AlertCircle className="w-16 h-16 text-slate-400 mb-4" />
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Export Window Not Found</h1>
                <p className="text-slate-600 mb-6">The export opportunity you are looking for does not exist or is unavailable.</p>
                <Link href="/export/windows" className="px-6 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition">
                    Back to Export Windows
                </Link>
            </div>
        );
    }

    // Adapt data for UI
    const window = {
        ...windowData,
        minInvestment: new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(windowData.minInvestment),
        openDate: new Date(windowData.openDate).toLocaleDateString(),
        closeDate: new Date(windowData.closeDate).toLocaleDateString(),
        // Use real deep data with fallbacks
        description: windowData.description || "This premium export opportunity is secured and managed by experienced professionals.",
        specifications: windowData.specifications && windowData.specifications.length > 0
            ? windowData.specifications.reduce((acc: any, curr: string) => {
                // If spec is "Key: Value", parse it. Otherwise use generic key
                const parts = curr.split(":");
                if (parts.length > 1) {
                    acc[parts[0].trim()] = parts[1].trim();
                } else {
                    acc[`Spec ${Object.keys(acc).length + 1}`] = curr;
                }
                return acc;
            }, {})
            : {
                "Commodity Type": windowData.commodity,
                "Destination": windowData.destination,
                "Status": windowData.status,
                "Total Spots": windowData.totalSpots.toString(),
                "Certification": "Export Certified"
            },
        timeline: windowData.timeline && windowData.timeline.length > 0
            ? windowData.timeline
            : [
                { phase: "Investment Period", duration: "15 days", description: "Open for funding" },
                { phase: "Procurement", duration: "14 days", description: "Sourcing and aggregation" },
                { phase: "Export & Shipping", duration: "20 days", description: "Logistics to destination" },
                { phase: "Returns", duration: "7 days", description: "Profit distribution" }
            ],
        documents: windowData.documents && windowData.documents.length > 0
            ? windowData.documents.map((d: any) => d.name || d)
            : [
                "Export License",
                "Insurance Policy",
                "Quality Certificate",
                "Investment Agreement"
            ],
        benefits: windowData.benefits && windowData.benefits.length > 0
            ? windowData.benefits
            : [
                `Projected ROI: ${windowData.projectedROI}`,
                "Secure Payment",
                "Fully Insured",
                "Expert Management",
                "Trackable Shipment"
            ]
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-linear-to-r from-purple-600 to-pink-600 text-white py-8">
                <div className="max-w-7xl mx-auto px-8">
                    <Link
                        href="/export/windows"
                        className="inline-flex items-center gap-2 text-white/90 hover:text-white mb-4 transition"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Back to Export Windows
                    </Link>
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold mb-2">{window.commodity}</h1>
                            <div className="flex items-center gap-4 text-purple-100">
                                <div className="flex items-center gap-2">
                                    <MapPin className="w-4 h-4" />
                                    Destination: {window.destination}
                                </div>
                            </div>
                        </div>
                        <span
                            className={`px-4 py-2 rounded-full text-sm font-bold ${window.status === "Open"
                                ? "bg-green-500 text-white"
                                : "bg-blue-500 text-white"
                                }`}
                        >
                            {window.status}
                        </span>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-8 py-12">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Commodity Image */}
                        <div className="relative h-96 bg-white rounded-2xl overflow-hidden shadow-xl">
                            <Image
                                src={window.image}
                                alt={window.commodity}
                                fill
                                className="object-cover"
                                priority
                                sizes="(max-width: 1024px) 100vw, 66vw"
                            />
                        </div>

                        {/* Description */}
                        <div className="bg-white rounded-2xl p-6 shadow-lg">
                            <h2 className="text-2xl font-bold text-slate-900 mb-4">
                                About This Opportunity
                            </h2>
                            <p className="text-lg text-slate-900 leading-relaxed">
                                {window.description}
                            </p>
                        </div>

                        {/* Specifications */}
                        {Object.keys(window.specifications).length > 0 && (
                            <div className="bg-white rounded-2xl p-6 shadow-lg">
                                <h2 className="text-2xl font-bold text-slate-900 mb-4">
                                    Specifications
                                </h2>
                                <dl className="space-y-3">
                                    {Object.entries(window.specifications).map(([key, value]) => (
                                        <div
                                            key={key}
                                            className="flex justify-between border-b border-slate-200 pb-2"
                                        >
                                            <dt className="font-semibold text-slate-900">{key}</dt>
                                            <dd className="text-slate-600">{String(value)}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </div>
                        )}

                        {/* Timeline */}
                        {window.timeline.length > 0 && (
                            <div className="bg-white rounded-2xl p-6 shadow-lg">
                                <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                    Investment Timeline
                                </h2>
                                <div className="space-y-4">
                                    {window.timeline.map((phase, index) => (
                                        <div key={index} className="flex gap-4">
                                            <div className="flex flex-col items-center">
                                                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                                                    <span className="text-sm font-bold text-purple-600">
                                                        {index + 1}
                                                    </span>
                                                </div>
                                                {index < window.timeline.length - 1 && (
                                                    <div className="w-0.5 h-16 bg-purple-200 my-2"></div>
                                                )}
                                            </div>
                                            <div className="flex-1 pb-8">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h3 className="font-bold text-slate-900">
                                                        {phase.phase}
                                                    </h3>
                                                    <span className="text-sm text-purple-600">
                                                        ({phase.duration})
                                                    </span>
                                                </div>
                                                <p className="text-slate-600">{phase.description}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Documents */}
                        {window.documents.length > 0 && (
                            <div className="bg-white rounded-2xl p-6 shadow-lg">
                                <h2 className="text-2xl font-bold text-slate-900 mb-4">
                                    Required Documents
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {window.documents.map((doc, index) => (
                                        <div
                                            key={index}
                                            className="flex items-center gap-2 text-slate-900"
                                        >
                                            <FileText className="w-4 h-4 text-purple-600" />
                                            {doc}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        {/* Investment Card */}
                        <div className="bg-white rounded-2xl p-6 shadow-lg sticky top-8">
                            <div className="text-center mb-6">
                                <div className="text-sm text-slate-600 mb-2">Minimum Investment</div>
                                <div className="text-4xl font-bold text-purple-600 mb-4">
                                    {window.minInvestment}
                                </div>
                                <div className="flex items-center justify-center gap-2 text-green-600 mb-4">
                                    <TrendingUp className="w-5 h-5" />
                                    <span className="text-2xl font-bold">{window.projectedROI}</span>
                                    <span className="text-sm">Projected ROI</span>
                                </div>
                            </div>

                            {/* Availability */}
                            <div className="bg-slate-50 rounded-xl p-4 mb-6">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm text-slate-600">Available Spots</span>
                                    <span className="font-bold text-slate-900">
                                        {window.spotsLeft}/{window.totalSpots}
                                    </span>
                                </div>
                                <div className="w-full bg-slate-200 rounded-full h-2">
                                    <div
                                        className="bg-purple-600 h-2 rounded-full"
                                        style={{ width: `${(window.spotsLeft / window.totalSpots) * 100}%` }}
                                    ></div>
                                </div>
                            </div>

                            {/* Dates */}
                            <div className="space-y-3 mb-6">
                                <div className="flex items-center gap-2 text-sm">
                                    <Calendar className="w-4 h-4 text-slate-400" />
                                    <span className="text-slate-600">Opens:</span>
                                    <span className="font-semibold text-slate-900">{window.openDate}</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                    <Clock className="w-4 h-4 text-slate-400" />
                                    <span className="text-slate-600">Closes:</span>
                                    <span className="font-semibold text-slate-900">{window.closeDate}</span>
                                </div>
                            </div>

                            {/* Investment Amount Input */}
                            <div className="mb-4">
                                <label className="block text-sm font-semibold text-slate-900 mb-2">
                                    Investment Amount (₦)
                                </label>
                                <input
                                    type="number"
                                    value={investmentAmount}
                                    onChange={(e) => setInvestmentAmount(Number(e.target.value))}
                                    min={windowData.minInvestment}
                                    className="w-full px-4 py-3 border border-slate-300 bg-white text-slate-900 rounded-xl focus:ring-2 focus:ring-purple-600"
                                />
                            </div>

                            {/* Error Display */}
                            {error && (
                                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                                    <p className="text-sm text-red-600">{error}</p>
                                </div>
                            )}

                            {/* CTAs */}
                            <div className="space-y-3">
                                <button
                                    onClick={handleInvest}
                                    disabled={investing}
                                    className="w-full px-6 py-4 bg-purple-600 text-white font-bold text-lg rounded-xl hover:bg-purple-700 transition-all hover:scale-105 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {investing ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        "Invest Now"
                                    )}
                                </button>
                                <button className="w-full px-6 py-3 bg-slate-100 text-slate-900 font-semibold rounded-xl hover:bg-slate-200 transition">
                                    Save for Later
                                </button>
                            </div>
                        </div>

                        {/* Benefits */}
                        {window.benefits.length > 0 && (
                            <div className="bg-white rounded-2xl p-6 shadow-lg">
                                <h3 className="text-xl font-bold text-slate-900 mb-4">
                                    Investment Benefits
                                </h3>
                                <ul className="space-y-3">
                                    {window.benefits.map((benefit, index) => (
                                        <li key={index} className="flex items-start gap-2 text-sm text-slate-900">
                                            <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                                            {benefit}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Risk Info */}
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
                            <div className="flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="font-bold text-amber-900 mb-2">Investment Notice</h4>
                                    <p className="text-sm text-amber-800">
                                        All investments carry risk. Past performance does not guarantee future results. Please review all documentation before investing.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
