"use client";

import { useEffect, useState } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import {
    DollarSign, Clock, TrendingUp, ArrowLeft, Users, FileText,
    AlertCircle, CheckCircle, Calculator, Plus
} from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import OnboardingGuide from "@/components/onboarding/OnboardingGuide";
import { useActionState } from "react";
import { applyForLoanAction } from "@/app/actions/cooperative";
import { Loader2 } from "lucide-react";

type LoanProduct = {
    id: string;
    name: string;
    minAmount: number;
    maxAmount: number;
    interestRate: number;
    durationMonths: number;
    description: string;
};

type LoanApplication = {
    id: string;
    productId: string;
    productName: string;
    amount: number;
    interestRate: number;
    durationMonths: number;
    monthlyPayment: number;
    status: "pending" | "approved" | "rejected" | "disbursed" | "active" | "completed";
    appliedAt: Date;
};

export default function LoansPage() {
    const router = useRouter();
    const [products, setProducts] = useState<LoanProduct[]>([]);
    const [applications, setApplications] = useState<LoanApplication[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [membershipStatus, setMembershipStatus] = useState<"approved" | "pending" | "not_member" | null>(null);
    const [selectedProduct, setSelectedProduct] = useState<LoanProduct | null>(null);

    useEffect(() => {
        checkMembership();
        fetchProducts();
        fetchApplications();
    }, []);

    const checkMembership = async () => {
        try {
            const response = await fetch("/api/cooperative/check-membership");
            const data = await response.json();

            if (data.isMember) {
                setMembershipStatus(data.status);
            } else {
                setMembershipStatus("not_member");
            }
        } catch (error) {
            logger.error("Failed to check membership:", error);
            setMembershipStatus("not_member");
        }
    };

    const fetchProducts = async () => {
        try {
            const response = await fetch("/api/cooperative/loan-products");
            const data = await response.json();

            if (data.success) {
                setProducts(data.products || []);
            }
        } catch (error) {
            logger.error("Failed to fetch loan products:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchApplications = async () => {
        try {
            const response = await fetch("/api/cooperative/my-loan-applications");
            const data = await response.json();

            if (data.success) {
                setApplications(data.applications || []);
            }
        } catch (error) {
            logger.error("Failed to fetch applications:", error);
        }
    };

    const calculateMonthlyPayment = (principal: number, rate: number, months: number) => {
        const monthlyRate = rate / 100 / 12;
        const payment = (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) /
            (Math.pow(1 + monthlyRate, months) - 1);
        return payment;
    };

    // Show onboarding if not a member or pending approval
    if (membershipStatus === "not_member" || membershipStatus === "pending") {
        return (
            <div className="min-h-screen bg-slate-50 py-8">
                <div className="max-w-7xl mx-auto px-4">
                    <Link
                        href="/cooperatives"
                        className="inline-flex items-center gap-2 text-primary hover:underline mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Cooperatives
                    </Link>

                    <OnboardingGuide
                        title="Cooperative Loans"
                        description="Access low-interest loans based on your savings balance. Borrow up to 3× your cooperative savings at competitive rates. To apply for loans, you must first become an approved cooperative member."
                        icon={<DollarSign className="w-8 h-8 text-white" />}
                        steps={[
                            {
                                title: "Join the Cooperative",
                                description: "Complete your membership registration with all required details including personal information and next of kin.",
                                completed: membershipStatus === "pending",
                                action: membershipStatus === "not_member" ? {
                                    label: "Start Registration",
                                    href: "/cooperatives/register"
                                } : undefined
                            },
                            {
                                title: "Pay Membership Fee",
                                description: "Choose your membership tier (Basic ₦10,000 or Premium ₦20,000) and complete payment via Paystack.",
                                completed: membershipStatus === "pending",
                                action: undefined
                            },
                            {
                                title: "Await Approval",
                                description: "Your application will be reviewed by our admin team. This usually takes 1-2 business days.",
                                completed: false,
                                action: undefined
                            },
                            {
                                title: "Build Your Savings",
                                description: "Make regular contributions to your cooperative savings. Loan eligibility is based on your savings balance (up to 3× your savings).",
                                completed: false,
                                action: undefined
                            },
                            {
                                title: "Apply for a Loan",
                                description: "Once approved and with sufficient savings, browse loan products and submit your application.",
                                completed: false,
                                action: undefined
                            }
                        ]}
                        primaryAction={membershipStatus === "not_member" ? {
                            label: "Get Started - Join Cooperative",
                            href: "/cooperatives/register"
                        } : undefined}
                    />
                </div>
            </div>
        );
    }

    const activeApplications = applications.filter(a => a.status === "active" || a.status === "disbursed");
    const pendingApplications = applications.filter(a => a.status === "pending");

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <Link
                        href="/cooperatives"
                        className="inline-flex items-center gap-2 text-primary hover:underline mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Cooperatives
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">
                            Cooperative Loans
                        </h1>
                        <p className="text-slate-600">
                            Access low-interest loans based on your savings balance
                        </p>
                    </div>
                </div>

                {isLoading ? (
                    <div className="bg-white rounded-2xl p-12 text-center shadow-xl">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-600">Loading loan products...</p>
                    </div>
                ) : (
                    <>
                        {/* Stats Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                            <div className="bg-white rounded-2xl p-6 shadow-xl">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                        <DollarSign className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <p className="text-sm text-slate-600">Active Loans</p>
                                </div>
                                <p className="text-3xl font-bold text-slate-900">
                                    {activeApplications.length}
                                </p>
                            </div>

                            <div className="bg-white rounded-2xl p-6 shadow-xl">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                                        <Clock className="w-5 h-5 text-yellow-600" />
                                    </div>
                                    <p className="text-sm text-slate-600">Pending Applications</p>
                                </div>
                                <p className="text-3xl font-bold text-slate-900">
                                    {pendingApplications.length}
                                </p>
                            </div>

                            <div className="bg-white rounded-2xl p-6 shadow-xl">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                                        <FileText className="w-5 h-5 text-green-600" />
                                    </div>
                                    <p className="text-sm text-slate-600">Available Products</p>
                                </div>
                                <p className="text-3xl font-bold text-slate-900">
                                    {products.length}
                                </p>
                            </div>
                        </div>

                        {/* Loan Products */}
                        <div className="mb-8">
                            <h2 className="text-2xl font-bold text-slate-900 mb-4">
                                Available Loan Products
                            </h2>
                            {products.length === 0 ? (
                                <div className="bg-white rounded-2xl p-12 text-center shadow-xl">
                                    <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                                    <h3 className="text-xl font-bold text-slate-900 mb-2">
                                        No Loan Products Available
                                    </h3>
                                    <p className="text-slate-600">
                                        Loan products will be displayed here once they're created by administrators.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {products.map((product) => (
                                        <div
                                            key={product.id}
                                            className="bg-white rounded-2xl p-6 shadow-xl border border-blue-100 hover:shadow-2xl transition-all"
                                        >
                                            <div className="flex items-start justify-between mb-4">
                                                <div className="w-12 h-12 bg-linear-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
                                                    <DollarSign className="w-6 h-6 text-white" />
                                                </div>
                                                <div className="px-3 py-1 bg-blue-100 rounded-full">
                                                    <span className="text-xs font-bold text-blue-700">
                                                        {product.interestRate}% APR
                                                    </span>
                                                </div>
                                            </div>

                                            <h3 className="text-xl font-bold text-slate-900 mb-2">
                                                {product.name}
                                            </h3>
                                            <p className="text-sm text-slate-600 mb-4">
                                                {product.description}
                                            </p>

                                            <div className="space-y-2 mb-6">
                                                <div className="flex items-center justify-between text-sm">
                                                    <span className="text-slate-600">Loan Range</span>
                                                    <span className="font-bold text-slate-900">
                                                        {formatCurrency(product.minAmount)} - {formatCurrency(product.maxAmount)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between text-sm">
                                                    <span className="text-slate-600">Duration</span>
                                                    <span className="font-bold text-slate-900">
                                                        {product.durationMonths} months
                                                    </span>
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => setSelectedProduct(product)}
                                                className="w-full px-6 py-3 bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                                            >
                                                Apply for Loan
                                                <ArrowLeft className="w-4 h-4 rotate-180" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* My Applications */}
                        {applications.length > 0 && (
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900 mb-4">
                                    My Loan Applications
                                </h2>
                                <div className="space-y-4">
                                    {applications.map((app) => (
                                        <div
                                            key={app.id}
                                            className="bg-white rounded-2xl p-6 shadow-xl"
                                        >
                                            <div className="flex items-start justify-between mb-4">
                                                <div>
                                                    <h3 className="text-lg font-bold text-slate-900 mb-1">
                                                        {app.productName}
                                                    </h3>
                                                    <p className="text-sm text-slate-600">
                                                        Applied on {new Date(app.appliedAt).toLocaleDateString()}
                                                    </p>
                                                </div>
                                                <div className={`px-3 py-1 rounded-full ${app.status === "approved" || app.status === "active"
                                                    ? "bg-green-100"
                                                    : app.status === "pending" || app.status === "disbursed"
                                                        ? "bg-yellow-100"
                                                        : app.status === "rejected"
                                                            ? "bg-red-100"
                                                            : "bg-blue-100"
                                                    }`}>
                                                    <span className={`text-xs font-bold ${app.status === "approved" || app.status === "active"
                                                        ? "text-green-700"
                                                        : app.status === "pending" || app.status === "disbursed"
                                                            ? "text-yellow-700"
                                                            : app.status === "rejected"
                                                                ? "text-red-700"
                                                                : "text-blue-700"
                                                        }`}>
                                                        {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                <div>
                                                    <p className="text-xs text-slate-500 mb-1">Loan Amount</p>
                                                    <p className="font-bold text-slate-900">
                                                        {formatCurrency(app.amount)}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500 mb-1">Interest Rate</p>
                                                    <p className="font-bold text-slate-900">
                                                        {app.interestRate}% APR
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500 mb-1">Duration</p>
                                                    <p className="font-bold text-slate-900">
                                                        {app.durationMonths} months
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500 mb-1">Monthly Payment</p>
                                                    <p className="font-bold text-green-600">
                                                        {formatCurrency(app.monthlyPayment)}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Application Modal */}
            {selectedProduct && (
                <LoanApplicationModal
                    product={selectedProduct}
                    onClose={() => setSelectedProduct(null)}
                    onSuccess={() => {
                        setSelectedProduct(null);
                        fetchApplications();
                    }}
                />
            )}
        </div>
    );
}

function LoanApplicationModal({
    product,
    onClose,
    onSuccess
}: {
    product: LoanProduct;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const initialState: Awaited<ReturnType<typeof applyForLoanAction>> = {
        error: "",
        success: false as const,
        data: null,
        meta: null
    };

    const [state, action, isPending] = useActionState(applyForLoanAction, initialState);

    useEffect(() => {
        if (state.success) {
            // Wait a bit to show success message then close
            const timer = setTimeout(() => {
                onSuccess();
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [state.success, onSuccess]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                {state.success ? (
                    <div className="p-12 text-center">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-8 h-8 text-green-600" />
                        </div>
                        <h3 className="text-2xl font-bold text-slate-900 mb-2">
                            Application Submitted!
                        </h3>
                        <p className="text-slate-600">
                            Your loan application for {formatCurrency(product.minAmount)} has been received.
                        </p>
                    </div>
                ) : (
                    <form action={action} className="p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-slate-900">
                                Apply for {product.name}
                            </h3>
                            <button
                                type="button"
                                onClick={onClose}
                                className="text-slate-500 hover:text-slate-900"
                            >
                                <ArrowLeft className="w-6 h-6 rotate-180" />
                            </button>
                        </div>

                        <input type="hidden" name="productId" value={product.id} />

                        <div className="space-y-4">
                            {state.error && (
                                <div className="p-4 bg-red-50 text-red-600 text-sm rounded-xl flex items-start gap-2">
                                    <AlertCircle className="w-5 h-5 shrink-0" />
                                    <span>{state.error}</span>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-slate-900 mb-1">
                                    Loan Amount (₦)
                                </label>
                                <input
                                    name="amount"
                                    type="number"
                                    defaultValue={product.minAmount}
                                    min={product.minAmount}
                                    max={product.maxAmount}
                                    required
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Range: {formatCurrency(product.minAmount)} - {formatCurrency(product.maxAmount)}
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-900 mb-1">
                                    Purpose of Loan
                                </label>
                                <textarea
                                    name="purpose"
                                    required
                                    minLength={10}
                                    placeholder="Describe why you need this loan..."
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500 h-24 resize-none"
                                />
                            </div>

                            <div className="bg-blue-50 p-4 rounded-xl space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">Interest Rate</span>
                                    <span className="font-semibold text-slate-900">{product.interestRate}%</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">Duration</span>
                                    <span className="font-semibold text-slate-900">{product.durationMonths} months</span>
                                </div>
                            </div>

                            <div className="pt-4">
                                <button
                                    type="submit"
                                    disabled={isPending}
                                    className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isPending ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Submitting...
                                        </>
                                    ) : (
                                        "Submit Application"
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    disabled={isPending}
                                    className="w-full mt-3 py-3 text-slate-600 font-semibold hover:bg-slate-100 rounded-xl transition-all"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

