"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
    ArrowLeft, ArrowRight, ShoppingCart, Minus, Plus, X,
    CheckCircle, Building2, User, Mail, Phone, Globe, Ship,
    CreditCard, Loader2, Store
} from "lucide-react";
import { useExportCart } from "@/contexts/ExportCartContext";
import { initializeExportOrderPaymentAction } from "@/app/actions/export-payment";

type ShippingTerm = "FOB" | "CIF" | "DDP";

const SHIPPING_TERMS: { id: ShippingTerm; label: string; description: string }[] = [
    { id: "FOB", label: "FOB (Free On Board)", description: "You handle shipping from Nigerian port" },
    { id: "CIF", label: "CIF (Cost, Insurance & Freight)", description: "We handle shipping to your port" },
    { id: "DDP", label: "DDP (Delivered Duty Paid)", description: "Full door-to-door delivery" },
];

export default function ExportCartPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const { cart, removeFromCart, updateQuantity, cartTotal, clearCart, cartCount } = useExportCart();

    const [step, setStep] = useState<"cart" | "details" | "payment" | "success">("cart");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [orderRef, setOrderRef] = useState("");
    const [paymentMethod, setPaymentMethod] = useState<"paystack">("paystack");
    const [error, setError] = useState<string | null>(null);

    // Warn before leaving mid-checkout
    useEffect(() => {
        if (step === "details" || step === "payment") {
            function handler(e: BeforeUnloadEvent) {
                e.preventDefault();
                e.returnValue = "";
            };
            window.addEventListener("beforeunload", handler);
            return () => window.removeEventListener("beforeunload", handler);
        }
    }, [step]);

    // Buyer details form state
    const [buyerDetails, setBuyerDetails] = useState({
        companyName: "",
        contactPerson: "",
        email: "",
        phone: "",
        country: "",
        portOfDestination: "",
        shippingTerm: "CIF" as ShippingTerm,
        additionalNotes: "",
    });

    const updateField = (field: string, value: string) => {
        setBuyerDetails(prev => ({ ...prev, [field]: value }));
    };

    const isDetailsValid =
        buyerDetails.companyName &&
        buyerDetails.contactPerson &&
        buyerDetails.email &&
        buyerDetails.country;

    // Convert cart total from USD to Naira for Paystack (approximate rate)
    const USD_TO_NGN_RATE = 1650;
    const totalInNaira = cartTotal * USD_TO_NGN_RATE;
    const shippingFee = 0; // Shipping calculated separately based on Incoterms

    async function handlePaystackCheckout() {
        if (!buyerDetails.email) {
            setError("Please provide your email address");
            return;
        }
        if (cart.length === 0) {
            setError("Your cart is empty");
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {

            // Prepare cart items for payment
            const cartItemsInput = cart.map(item => ({
                productId: item.product.id,
                quantityMT: item.quantityMT,
                grade: item.grade,
            }));

            // Initialize Paystack payment
            const result = await initializeExportOrderPaymentAction(
                cartItemsInput,
                buyerDetails
            );

            if (result.success ) {
                // Store buyer details in user-scoped localStorage for post-payment processing
                const userId = session?.user?.id;
                const detailsKey = userId ? `export_buyer_details_${userId}` : "export_buyer_details";
                localStorage.setItem(detailsKey, JSON.stringify({
                    ...buyerDetails,
                    cartSnapshot: cart.map(item => ({
                        product: item.product.name,
                        grade: item.grade,
                        quantityMT: item.quantityMT,
                        pricePerMT: item.product.pricePerMT,
                        total: item.product.pricePerMT * item.quantityMT,
                    })),
                    totalUSD: cartTotal,
                    totalNGN: totalInNaira,
                    timestamp: new Date().toISOString(),
                }));

                // The cart is cleared only once there is somewhere to go.
                //
                // clearCart() ran BEFORE this check, so any failure to obtain an
                // authorization URL emptied the buyer's basket and then told
                // them the payment could not be started. The action was
                // returning data: null on every success, so that was not a rare
                // path — it was the only path.
                if (result.data?.authorizationUrl) {
                    clearCart();
                    window.location.href = result.data.authorizationUrl;
                } else {
                    setError("Failed to initialize payment: No authorization URL");
                    setIsSubmitting(false);
                }
            } else {
                setError(result.error || "Failed to initialize payment");
                setIsSubmitting(false);
            }
        } catch (err) {
            setError("An error occurred while processing your payment. Please try again.");
            setIsSubmitting(false);
        }
    };

    function handlePayment() {
        handlePaystackCheckout();
    };

    // ── Success Screen ────────────────────────────────────────────────────────

    if (step === "success") {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
                <div className="max-w-lg w-full bg-white rounded-3xl p-8 md:p-12 text-center shadow-xl">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-10 h-10 text-green-600" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-3">
                        Order Placed Successfully!
                    </h1>
                    <p className="text-slate-600 mb-6">
                        Your payment has been received. Our export team will begin processing your order immediately.
                    </p>

                    {orderRef && (
                        <div className="bg-blue-50 rounded-xl p-4 mb-6">
                            <p className="text-sm text-blue-600 mb-1">Order Reference</p>
                            <p className="text-2xl font-bold font-mono text-blue-900">{orderRef}</p>
                        </div>
                    )}

                    <div className="text-left bg-slate-50 rounded-xl p-6 mb-8 space-y-3">
                        <h3 className="font-bold text-slate-900 mb-3">What happens next?</h3>
                        <div className="flex items-start gap-3">
                            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                                <span className="text-xs font-bold text-blue-600">1</span>
                            </div>
                            <p className="text-sm text-slate-600">
                                Payment confirmed automatically via Paystack
                            </p>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                                <span className="text-xs font-bold text-blue-600">2</span>
                            </div>
                            <p className="text-sm text-slate-600">Products are inspected and quality certified for export</p>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                                <span className="text-xs font-bold text-blue-600">3</span>
                            </div>
                            <p className="text-sm text-slate-600">Shipment arranged based on your selected shipping terms ({buyerDetails.shippingTerm})</p>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                        <Link
                            href="/export/buyer"
                            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition"
                        >
                            Continue Shopping
                        </Link>
                        <Link
                            href="/export"
                            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 border-2 border-slate-300 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition"
                        >
                            Back to Export
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    // ── Empty Cart ────────────────────────────────────────────────────────────

    if (cart.length === 0 && step !== "success" as string) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
                <div className="text-center">
                    <ShoppingCart className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Your cart is empty</h2>
                    <p className="text-slate-500 mb-6">Add export products to your cart to place an order</p>
                    <Link
                        href="/export/buyer"
                        className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Browse Products
                    </Link>
                </div>
            </div>
        );
    }

    // ── Cart Review + Details + Payment ────────────────────────────────────────

    return (
        <div className="min-h-screen bg-slate-50 py-6 md:py-8 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Back Button */}
                <button
                    onClick={() => {
                        if (step === "payment") setStep("details");
                        else if (step === "details") setStep("cart");
                        else router.push("/export/buyer");
                    }}
                    className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6 transition"
                >
                    <ArrowLeft className="w-5 h-5" />
                    {step === "payment" ? "Back to Details" : step === "details" ? "Back to Cart" : "Back to Catalog"}
                </button>

                {/* Progress Steps */}
                <div className="flex items-center justify-center gap-3 mb-8">
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${step === "cart" ? "bg-blue-600 text-white" : "bg-blue-100 text-blue-600"
                        }`}>
                        <ShoppingCart className="w-4 h-4" />
                        Cart
                    </div>
                    <div className="w-6 h-0.5 bg-slate-300"></div>
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${step === "details" ? "bg-blue-600 text-white" : step === "payment" ? "bg-blue-100 text-blue-600" : "bg-slate-200 text-slate-500"
                        }`}>
                        <Building2 className="w-4 h-4" />
                        Details
                    </div>
                    <div className="w-6 h-0.5 bg-slate-300"></div>
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${step === "payment" ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"
                        }`}>
                        <CreditCard className="w-4 h-4" />
                        Payment
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-6">
                        {step === "cart" ? (
                            /* ── Cart Items ──────────────────────────── */
                            <div className="bg-white rounded-2xl p-6 shadow-sm">
                                <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                    <ShoppingCart className="w-5 h-5 text-blue-600" />
                                    Cart Items ({cartCount})
                                </h2>

                                <div className="space-y-4">
                                    {cart.map((item) => (
                                        <div
                                            key={item.product.id}
                                            className="flex items-start gap-4 p-4 bg-slate-50 rounded-xl"
                                        >
                                            <div className="text-3xl">{item.product.icon}</div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-bold text-slate-900">{item.product.name}</h3>
                                                <p className="text-sm text-slate-500">Grade: {item.grade}</p>
                                                <p className="text-sm text-slate-500">{item.product.origin}</p>
                                                <p className="text-sm text-slate-500 mt-1">
                                                    ${item.product.pricePerMT.toLocaleString()} / MT
                                                </p>

                                                {/* Quantity controls */}
                                                <div className="flex items-center gap-3 mt-3">
                                                    <button
                                                        onClick={() => updateQuantity(item.product.id, item.quantityMT - 5)}
                                                        className="w-8 h-8 flex items-center justify-center bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition"
                                                    >
                                                        <Minus className="w-3 h-3" />
                                                    </button>
                                                    <span className="text-sm font-semibold min-w-[60px] text-center">
                                                        {item.quantityMT} MT
                                                    </span>
                                                    <button
                                                        onClick={() => updateQuantity(item.product.id, item.quantityMT + 5)}
                                                        className="w-8 h-8 flex items-center justify-center bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition"
                                                    >
                                                        <Plus className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="text-right">
                                                <p className="text-lg font-bold text-slate-900">
                                                    ${(item.product.pricePerMT * item.quantityMT).toLocaleString()}
                                                </p>
                                                <button
                                                    onClick={() => removeFromCart(item.product.id)}
                                                    className="mt-2 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : step === "details" ? (
                            /* ── Buyer Details Form ──────────────────── */
                            <div className="space-y-6">
                                {/* Company Information */}
                                <div className="bg-white rounded-2xl p-6 shadow-sm">
                                    <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                        <Building2 className="w-5 h-5 text-blue-600" />
                                        Company Information
                                    </h2>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                                Company Name *
                                            </label>
                                            <input
                                                type="text"
                                                value={buyerDetails.companyName}
                                                onChange={(e) => updateField("companyName", e.target.value)}
                                                placeholder="Your company name"
                                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                                Contact Person *
                                            </label>
                                            <div className="relative">
                                                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                                <input
                                                    type="text"
                                                    value={buyerDetails.contactPerson}
                                                    onChange={(e) => updateField("contactPerson", e.target.value)}
                                                    placeholder="Full name"
                                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    required
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                                Email Address *
                                            </label>
                                            <div className="relative">
                                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                                <input
                                                    type="email"
                                                    value={buyerDetails.email}
                                                    onChange={(e) => updateField("email", e.target.value)}
                                                    placeholder="buyer@company.com"
                                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    required
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                                Phone Number
                                            </label>
                                            <div className="relative">
                                                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                                <input
                                                    type="tel"
                                                    value={buyerDetails.phone}
                                                    onChange={(e) => updateField("phone", e.target.value)}
                                                    placeholder="+1 234 567 8900"
                                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Shipping Information */}
                                <div className="bg-white rounded-2xl p-6 shadow-sm">
                                    <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                        <Ship className="w-5 h-5 text-blue-600" />
                                        Shipping Information
                                    </h2>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                                Country *
                                            </label>
                                            <div className="relative">
                                                <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                                <input
                                                    type="text"
                                                    value={buyerDetails.country}
                                                    onChange={(e) => updateField("country", e.target.value)}
                                                    placeholder="e.g. United Arab Emirates"
                                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    required
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                                Port of Destination
                                            </label>
                                            <input
                                                type="text"
                                                value={buyerDetails.portOfDestination}
                                                onChange={(e) => updateField("portOfDestination", e.target.value)}
                                                placeholder="e.g. Jebel Ali Port, Dubai"
                                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                    </div>

                                    {/* Shipping Terms */}
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-3">
                                            Preferred Shipping Terms
                                        </label>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            {SHIPPING_TERMS.map((term) => (
                                                <button
                                                    key={term.id}
                                                    onClick={() => updateField("shippingTerm", term.id)}
                                                    className={`p-4 border-2 rounded-xl text-left transition ${buyerDetails.shippingTerm === term.id
                                                        ? "border-blue-600 bg-blue-50"
                                                        : "border-slate-200 hover:border-blue-300"
                                                        }`}
                                                >
                                                    <p className="font-semibold text-slate-900 text-sm">{term.label}</p>
                                                    <p className="text-xs text-slate-500 mt-1">{term.description}</p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Additional Notes */}
                                <div className="bg-white rounded-2xl p-6 shadow-sm">
                                    <h2 className="text-lg font-bold text-slate-900 mb-4">
                                        Additional Notes
                                    </h2>
                                    <textarea
                                        value={buyerDetails.additionalNotes}
                                        onChange={(e) => updateField("additionalNotes", e.target.value)}
                                        placeholder="Any special requirements, quality specifications, packaging preferences..."
                                        rows={4}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                    />
                                </div>
                            </div>
                        ) : (
                            /* ── Payment Step ──────────────────────────── */
                            <div className="space-y-6">
                                {/* Payment Method Selection */}
                                <div className="bg-white rounded-2xl p-6 shadow-sm">
                                    <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                        <CreditCard className="w-5 h-5 text-blue-600" />
                                        Payment Method
                                    </h2>
                                    <div className="p-5 border-2 border-blue-600 bg-blue-50 rounded-xl flex items-center gap-3">
                                        <CreditCard className="w-6 h-6 text-blue-600" />
                                        <div>
                                            <p className="font-bold text-slate-900">Card Payment (Paystack)</p>
                                            <p className="text-xs text-slate-600">Pay securely with your debit or credit card</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Order Review */}
                                <div className="bg-white rounded-2xl p-6 shadow-sm">
                                    <h3 className="font-bold text-slate-900 mb-4">Buyer Details</h3>
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <p className="text-slate-500">Company</p>
                                            <p className="font-semibold text-slate-900">{buyerDetails.companyName}</p>
                                        </div>
                                        <div>
                                            <p className="text-slate-500">Contact</p>
                                            <p className="font-semibold text-slate-900">{buyerDetails.contactPerson}</p>
                                        </div>
                                        <div>
                                            <p className="text-slate-500">Email</p>
                                            <p className="font-semibold text-slate-900">{buyerDetails.email}</p>
                                        </div>
                                        <div>
                                            <p className="text-slate-500">Shipping</p>
                                            <p className="font-semibold text-slate-900">{buyerDetails.shippingTerm} → {buyerDetails.country}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Order Summary Sidebar */}
                    <div className="lg:col-span-1">
                        <div className="bg-white rounded-2xl p-6 shadow-sm sticky top-8">
                            <h2 className="text-xl font-bold text-slate-900 mb-4">
                                Order Summary
                            </h2>

                            {/* Items summary */}
                            <div className="space-y-3 mb-6">
                                {cart.map((item) => (
                                    <div key={item.product.id} className="flex justify-between text-sm">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span>{item.product.icon}</span>
                                            <span className="text-slate-600 truncate">
                                                {item.product.name} × {item.quantityMT}MT
                                            </span>
                                        </div>
                                        <span className="font-semibold text-slate-900 shrink-0 ml-2">
                                            ${(item.product.pricePerMT * item.quantityMT).toLocaleString()}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            <div className="pt-4 border-t border-slate-200 space-y-2 mb-6">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">Total (USD)</span>
                                    <span className="font-bold text-slate-900">
                                        ${cartTotal.toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">Total (NGN)</span>
                                    <span className="font-bold text-green-600">
                                        ₦{totalInNaira.toLocaleString()}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500 pt-1">
                                    Rate: $1 = ₦{USD_TO_NGN_RATE.toLocaleString()} • Shipping calculated separately
                                </p>
                            </div>

                            {/* Error Display */}
                            {error && (
                                <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                                    <p className="text-sm text-red-600">{error}</p>
                                </div>
                            )}

                            {/* Action Button */}
                            {step === "cart" ? (
                                <button
                                    onClick={() => setStep("details")}
                                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-lg"
                                >
                                    Continue to Details
                                    <ArrowRight className="w-5 h-5" />
                                </button>
                            ) : step === "details" ? (
                                <button
                                    onClick={() => setStep("payment")}
                                    disabled={!isDetailsValid}
                                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Continue to Payment
                                    <CreditCard className="w-5 h-5" />
                                </button>
                            ) : (
                                <>
                                    <button
                                        onClick={handlePayment}
                                        disabled={isSubmitting}
                                        className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                Processing...
                                            </>
                                        ) : (
                                            <>
                                                <CreditCard className="w-5 h-5" />
                                                Pay ₦{totalInNaira.toLocaleString()}
                                            </>
                                        )}
                                    </button>
                                </>
                            )}

                            <p className="text-xs text-center text-slate-500 mt-4">
                                {step === "payment"
                                    ? "All payments are securely processed and escrow-protected"
                                    : "Secure checkout powered by Paystack"
                                }
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
