"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
    Store,
    CheckCircle,
    AlertCircle,
    Phone,
    CreditCard,
    MapPin,
    FileText,
    Loader2
} from "lucide-react";
import { submitSellerVerificationAction, getSellerVerificationAction } from "@/app/actions/marketplace";
import { useToast } from "@/contexts/ToastContext";

const initialState = { success: false };

const nigerianStates = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo",
    "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa",
    "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba",
    "Yobe", "Zamfara"
];

const nigerianBanks = [
    { name: "Access Bank", code: "044" },
    { name: "Zenith Bank", code: "057" },
    { name: "GTBank", code: "058" },
    { name: "First Bank", code: "011" },
    { name: "UBA", code: "033" },
    { name: "Fidelity Bank", code: "070" },
    { name: "FCMB", code: "214" },
    { name: "Stanbic IBTC", code: "221" },
    { name: "Sterling Bank", code: "232" },
    { name: "Wema Bank", code: "035" },
];

export default function SellerVerificationPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const { showToast } = useToast();
    const [state, formAction, isPending] = useActionState(submitSellerVerificationAction, initialState);

    const [existingVerification, setExistingVerification] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // Check existing verification status
    useEffect(() => {
        async function checkVerification() {
            const result = await getSellerVerificationAction();
            if (result.success && result.verification) {
                setExistingVerification(result.verification);
            }
            setLoading(false);
        }
        checkVerification();
    }, []);

    // Handle form submission result
    useEffect(() => {
        if (state.success) {
            showToast("Verification application submitted successfully!", "success");
            setTimeout(() => router.push("/marketplace"), 2000);
        } else if ((state as any).error) {
            showToast((state as any).error, "error");
        }
    }, [state, showToast, router]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    // Show status if already verified or pending
    if (existingVerification) {
        const statusConfig = {
            pending: {
                icon: <Loader2 className="w-16 h-16 text-yellow-500 animate-spin" />,
                title: "Verification Pending",
                message: "Your seller verification is under review. We'll notify you once it's approved.",
                color: "yellow"
            },
            approved: {
                icon: <CheckCircle className="w-16 h-16 text-green-500" />,
                title: "Verified Seller",
                message: "Your seller account is verified! You can now start listing products.",
                color: "green",
                action: () => router.push("/marketplace/sell/create")
            },
            rejected: {
                icon: <AlertCircle className="w-16 h-16 text-red-500" />,
                title: "Verification Rejected",
                message: existingVerification.rejectionReason || "Your verification was rejected. Please contact support.",
                color: "red"
            },
            suspended: {
                icon: <AlertCircle className="w-16 h-16 text-orange-500" />,
                title: "Account Suspended",
                message: "Your seller account has been suspended. Please contact support.",
                color: "orange"
            }
        };

        const config = statusConfig[existingVerification.status as keyof typeof statusConfig];

        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center">
                    <div className="flex justify-center mb-6">{config.icon}</div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                        {config.title}
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mb-8">
                        {config.message}
                    </p>
                    {'action' in config && config.action && (
                        <button
                            onClick={config.action}
                            className="w-full px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition"
                        >
                            Create Product Listing
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-3xl mx-auto px-4">
                {/* Header */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 mb-6">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="p-3 rounded-xl bg-primary/10">
                            <Store className="w-8 h-8 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                                Become a Seller
                            </h1>
                            <p className="text-gray-600 dark:text-gray-400">
                                Complete verification to start selling on our marketplace
                            </p>
                        </div>
                    </div>
                </div>

                {/* Verification Form */}
                <form action={formAction} className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 space-y-8">

                    {/* Phone Verification */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <Phone className="w-5 h-5 text-primary" />
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                                Phone Verification
                            </h2>
                        </div>
                        <input
                            type="tel"
                            name="phoneNumber"
                            required
                            placeholder="+234 800 000 0000"
                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </section>

                    {/* Identity Documents */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <FileText className="w-5 h-5 text-primary" />
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                                Identity Documents
                            </h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    NIN (Optional)
                                </label>
                                <input
                                    type="text"
                                    name="nin"
                                    placeholder="12345678901"
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    BVN (Optional)
                                </label>
                                <input
                                    type="text"
                                    name="bvn"
                                    placeholder="12345678901"
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    CAC (For Business - Optional)
                                </label>
                                <input
                                    type="text"
                                    name="cac"
                                    placeholder="RC1234567"
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                />
                            </div>
                        </div>
                    </section>

                    {/* Bank Details */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <CreditCard className="w-5 h-5 text-primary" />
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                                Bank Account Details
                            </h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Bank Name *
                                </label>
                                <select
                                    name="bankName"
                                    required
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                >
                                    <option value="">Select Bank</option>
                                    {nigerianBanks.map(bank => (
                                        <option key={bank.code} value={bank.name}>
                                            {bank.name}
                                        </option>
                                    ))}
                                </select>
                                <input type="hidden" name="bankCode" value="044" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Account Number *
                                </label>
                                <input
                                    type="text"
                                    name="accountNumber"
                                    required
                                    placeholder="0123456789"
                                    maxLength={10}
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Account Name *
                                </label>
                                <input
                                    type="text"
                                    name="accountName"
                                    required
                                    placeholder="John Doe"
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                />
                            </div>
                        </div>
                    </section>

                    {/* Address */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <MapPin className="w-5 h-5 text-primary" />
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                                Physical Address
                            </h2>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Street Address *
                                </label>
                                <input
                                    type="text"
                                    name="street"
                                    required
                                    placeholder="123 Main Street"
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        City *
                                    </label>
                                    <input
                                        type="text"
                                        name="city"
                                        required
                                        placeholder="Lagos"
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        State *
                                    </label>
                                    <select
                                        name="state"
                                        required
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                    >
                                        <option value="">Select State</option>
                                        {nigerianStates.map(state => (
                                            <option key={state} value={state}>{state}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        LGA *
                                    </label>
                                    <input
                                        type="text"
                                        name="lga"
                                        required
                                        placeholder="Ikeja"
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                    />
                                </div>
                            </div>
                            <input type="hidden" name="country" value="Nigeria" />
                        </div>
                    </section>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={isPending}
                        className="w-full px-6 py-4 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isPending ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Submitting...
                            </>
                        ) : (
                            <>
                                <CheckCircle className="w-5 h-5" />
                                Submit Verification
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
