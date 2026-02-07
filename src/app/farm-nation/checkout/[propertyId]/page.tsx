"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
    ArrowLeft, ShoppingCart, Lock, AlertCircle, Loader2, CheckCircle,
    MapPin, Maximize, DollarSign, Shield, FileText, User, Mail, Phone
} from "lucide-react";
import { getPropertyByIdAction, initiatePropertyPurchaseAction, type Property } from "@/app/actions/farm-nation";
import { getUserTierAction } from "@/app/actions/cooperative";

export default function CheckoutPage() {
    const params = useParams();
    const router = useRouter();
    const { data: session, status } = useSession();
    const propertyId = params.propertyId as string;

    const [property, setProperty] = useState<Property | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [userTier, setUserTier] = useState<"Basic" | "Premium" | null>(null);
    const [agreed, setAgreed] = useState(false);

    const [buyerInfo, setBuyerInfo] = useState({
        name: session?.user?.name || "",
        email: session?.user?.email || "",
        phone: "",
        purpose: "",
    });

    useEffect(() => {
        if (status === "authenticated") {
            getUserTierAction().then(({ tier }) => {
                setUserTier(tier);
                if (tier !== "Premium") {
                    router.push(`/farm-nation/property/${propertyId}`);
                }
            });

            setBuyerInfo(prev => ({
                ...prev,
                name: session?.user?.name || "",
                email: session?.user?.email || "",
            }));
        } else if (status === "unauthenticated") {
            router.push("/login");
        }

        loadProperty();
    }, [propertyId, status, session]);

    const loadProperty = async () => {
        setLoading(true);
        const result = await getPropertyByIdAction(propertyId);

        if (result.success && result.property) {
            if (result.property.status !== "available") {
                setError("This property is no longer available");
            } else {
                setProperty(result.property);
            }
        } else {
            setError(result.error || "Property not found");
        }

        setLoading(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!agreed) {
            setError("Please agree to the terms and conditions");
            return;
        }

        if (!buyerInfo.phone.trim()) {
            setError("Phone number is required");
            return;
        }

        if (!buyerInfo.purpose.trim()) {
            setError("Please specify your intended use for this property");
            return;
        }

        setSubmitting(true);
        setError(null);

        const result = await initiatePropertyPurchaseAction(propertyId, {
            fullName: buyerInfo.name,
            email: buyerInfo.email,
            phone: buyerInfo.phone,
            purpose: buyerInfo.purpose,
        });

        if (result.success && result.requestId) {
            // In a real app, redirect to Paystack payment page
            // For now, show success and redirect to purchases
            alert(`Purchase request submitted! Request ID: ${result.requestId}\n\nIn production, you would be redirected to Paystack to complete payment of ₦${result.amount?.toLocaleString()}`);
            router.push("/farm-nation/my-purchases");
        } else {
            setError(result.error || "Failed to initiate purchase");
        }

        setSubmitting(false);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-green-600 mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">Loading checkout...</p>
                </div>
            </div>
        );
    }

    if (error || !property) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-8">
                <div className="max-w-md text-center">
                    <AlertCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Checkout Error</h1>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">{error}</p>
                    <button
                        onClick={() => router.push("/farm-nation")}
                        className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl transition"
                    >
                        Back to Marketplace
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-6xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.push(`/farm-nation/property/${propertyId}`)}
                        className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mb-4 transition"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Property
                    </button>
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">Checkout</h1>
                    <p className="text-slate-600 dark:text-slate-400">Complete your purchase request</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Form */}
                    <div className="lg:col-span-2">
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Buyer Information */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                    <User className="w-6 h-6" />
                                    Your Information
                                </h2>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                            Full Name *
                                        </label>
                                        <input
                                            type="text"
                                            value={buyerInfo.name}
                                            onChange={(e) => setBuyerInfo({ ...buyerInfo, name: e.target.value })}
                                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-green-600"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                            Email Address *
                                        </label>
                                        <input
                                            type="email"
                                            value={buyerInfo.email}
                                            onChange={(e) => setBuyerInfo({ ...buyerInfo, email: e.target.value })}
                                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-green-600"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                            Phone Number *
                                        </label>
                                        <input
                                            type="tel"
                                            value={buyerInfo.phone}
                                            onChange={(e) => setBuyerInfo({ ...buyerInfo, phone: e.target.value })}
                                            placeholder="e.g., +234 801 234 5678"
                                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-green-600"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                            Intended Use / Purpose *
                                        </label>
                                        <textarea
                                            value={buyerInfo.purpose}
                                            onChange={(e) => setBuyerInfo({ ...buyerInfo, purpose: e.target.value })}
                                            rows={4}
                                            placeholder="Briefly describe how you plan to use this land (e.g., rice farming, livestock grazing, commercial agriculture)..."
                                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-green-600 resize-none"
                                            required
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Escrow Information */}
                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-6">
                                <div className="flex items-start gap-4">
                                    <Shield className="w-12 h-12 text-blue-600 shrink-0" />
                                    <div>
                                        <h3 className="text-lg font-bold text-blue-900 dark:text-blue-100 mb-2">
                                            Escrow Protection Enabled
                                        </h3>
                                        <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
                                            Your payment will be held securely in escrow until the transaction is completed.
                                        </p>
                                        <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                                            <li>✓ Funds released only after successful property transfer</li>
                                            <li>✓ Full refund if seller fails to deliver</li>
                                            <li>✓ Dispute resolution available if needed</li>
                                            <li>✓ Admin oversight for your protection</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            {/* Terms & Conditions */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                    <FileText className="w-5 h-5" />
                                    Terms & Conditions
                                </h2>

                                <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 max-h-48 overflow-y-auto mb-4 text-sm text-slate-600 dark:text-slate-400 space-y-2">
                                    <p><strong>1. Payment:</strong> Full payment is required to proceed with the purchase.</p>
                                    <p><strong>2. Escrow:</strong> Funds will be held in escrow until property transfer is verified.</p>
                                    <p><strong>3. Verification:</strong> You agree to conduct due diligence and verify property documents.</p>
                                    <p><strong>4. Transfer:</strong> Seller is responsible for providing all necessary documents for title transfer.</p>
                                    <p><strong>5. Inspection:</strong> You have the right to inspect the property before completing the purchase.</p>
                                    <p><strong>6. Cancellation:</strong> Cancellation terms are subject to mutual agreement and platform policy.</p>
                                    <p><strong>7. Disputes:</strong> Any disputes will be resolved through the platform's mediation process.</p>
                                </div>

                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={agreed}
                                        onChange={(e) => setAgreed(e.target.checked)}
                                        className="w-5 h-5 mt-0.5 rounded border-slate-300 dark:border-slate-600 text-green-600 focus:ring-2 focus:ring-green-600"
                                    />
                                    <span className="text-sm text-slate-700 dark:text-slate-300">
                                        I agree to the terms and conditions and confirm that I have read and understood the escrow policy.
                                    </span>
                                </label>
                            </div>

                            {/* Error Display */}
                            {error && (
                                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                                    <p className="text-red-800 dark:text-red-200">{error}</p>
                                </div>
                            )}

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={submitting || !agreed}
                                className="w-full px-6 py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <ShoppingCart className="w-5 h-5" />
                                        Proceed to Payment
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                    {/* Order Summary */}
                    <div className="lg:col-span-1">
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 sticky top-24">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Order Summary</h2>

                            {/* Property Preview */}
                            {property.images && property.images.length > 0 && (
                                <div className="relative aspect-video rounded-xl overflow-hidden mb-4">
                                    <Image
                                        src={property.images[0]}
                                        alt={property.name}
                                        fill
                                        className="object-cover"
                                    />
                                </div>
                            )}

                            <h3 className="font-bold text-slate-900 dark:text-white mb-3">{property.name}</h3>

                            <div className="space-y-3 mb-6">
                                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                    <MapPin className="w-4 h-4" />
                                    <span>{property.location}, {property.state}</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                    <Maximize className="w-4 h-4" />
                                    <span>{property.size} hectares</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                    <span className={`px-3 py-1 rounded-lg font-semibold ${property.type === "sale"
                                        ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                                        : "bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                                        }`}>
                                        {property.type === "sale" ? "Purchase" : "Lease"}
                                    </span>
                                </div>
                            </div>

                            <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-400">Property Price</span>
                                    <span className="font-semibold text-slate-900 dark:text-white">
                                        ₦{property.price.toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-400">Platform Fee</span>
                                    <span className="font-semibold text-slate-900 dark:text-white">₦0</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-400">Escrow Service</span>
                                    <span className="font-semibold text-green-600">Included</span>
                                </div>
                                <div className="border-t border-slate-200 dark:border-slate-700 pt-3 flex justify-between">
                                    <span className="font-bold text-slate-900 dark:text-white">Total Amount</span>
                                    <span className="text-2xl font-bold text-green-600">
                                        ₦{property.price.toLocaleString()}
                                    </span>
                                </div>
                            </div>

                            {property.type === "lease" && property.leaseDuration && (
                                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                                    <p className="text-xs text-blue-800 dark:text-blue-200">
                                        <strong>Lease Duration:</strong> {property.leaseDuration} months
                                    </p>
                                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                                        Annual payment required
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
