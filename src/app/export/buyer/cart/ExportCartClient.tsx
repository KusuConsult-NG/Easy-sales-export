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
import { numberOrZero } from "@/lib/numbers";

type ShippingTerm = "FOB" | "CIF" | "DDP";

/**
 *   #577 THE BUTTON SAID "Pay ₦X" AND THE SERVER CHARGED ₦Y.
 *
 *   This screen priced the order in naira like this:
 *
 *       // Convert cart total from USD to Naira for Paystack (approximate rate)
 *       const USD_TO_NGN_RATE = 1650;
 *       const totalInNaira = cartTotal * USD_TO_NGN_RATE;
 *
 *   and put that number in three places a buyer reads as a price: the "Total
 *   (NGN)" line, the note "Rate: $1 = ₦1,650", and the button itself — "Pay
 *   ₦94,050,000".
 *
 *   The server charges `totalUSD * (await getExchangeRates()).usdToNgn`. That
 *   rate is a system setting an admin edits at /admin, bounds-checked and
 *   cache-invalidated, and the whole point of #381 was that an FX rate frozen
 *   in source "is wrong the day after it is written". #381 took the constant
 *   out of the action — its corpse is still there, commented, at the top of
 *   export-payment.ts — AND LEFT THE COPY IN THIS SCREEN. The fix reached one
 *   of the two doors, which is the most common shape in this audit.
 *
 *   The default is 1650, so today the two agree. The moment the owner uses the
 *   screen that was built for exactly this, they do not: the buyer approves one
 *   number and Paystack debits another, and the only local record of what they
 *   were charged (#569's key, written below) records the number they were
 *   SHOWN, so even the support conversation afterwards has the wrong figure.
 *
 *   The goods can drift the same way. `cartTotal` is a sum over prices
 *   snapshotted into localStorage when the item was added; the server re-prices
 *   every line from the catalogue row. A price edited in between moves the
 *   charge and not the button.
 *
 * ── SO THE NUMBER ON THE BUTTON IS NOW A QUOTE, AND THE SERVER HONOURS IT ───
 *
 *   Two halves, and neither is sufficient alone:
 *
 *     THE RATE IS SEEDED FROM THE SERVER (page.tsx, one line, no round trip),
 *     so what is displayed is what this application will charge at — one
 *     definition of the rate instead of two.
 *
 *     AND THE DISPLAYED TOTAL IS SENT WITH THE CHECKOUT. The action refuses
 *     unless its own total agrees to the kobo, and hands back what it computed
 *     — so a rate or a price that moved between the render and the click
 *     re-quotes the screen instead of quietly charging a different amount.
 *
 *   The re-quote is held against the cart it was made for, so editing the
 *   basket discards it rather than pricing new contents at an old total.
 */
export interface ExportCartQuote {
    /** The cart total in USD this quote was computed for. */
    forCartTotal: number;
    totalUSD: number;
    totalNGN: number;
    usdToNgn: number;
}

const SHIPPING_TERMS: { id: ShippingTerm; label: string; description: string }[] = [
    { id: "FOB", label: "FOB (Free On Board)", description: "You handle shipping from Nigerian port" },
    { id: "CIF", label: "CIF (Cost, Insurance & Freight)", description: "We handle shipping to your port" },
    { id: "DDP", label: "DDP (Delivered Duty Paid)", description: "Full door-to-door delivery" },
];

export default function ExportCartClient({ usdToNgn }: { usdToNgn: number }) {
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

    /**
     * What this cart costs, in the two currencies — see the header.
     *
     * The rate comes from the server. A re-quote returned by a refused checkout
     * supersedes it, but ONLY for the basket it was made for: `forCartTotal`
     * is compared against the live cart, so adding a ton discards the quote
     * rather than pricing the new basket at the old total.
     */
    const [quote, setQuote] = useState<ExportCartQuote | null>(null);
    const liveQuote = quote && quote.forCartTotal === cartTotal ? quote : null;

    const effectiveRate = liveQuote ? liveQuote.usdToNgn : usdToNgn;
    const totalInDollars = liveQuote ? liveQuote.totalUSD : cartTotal;
    const totalInNaira = liveQuote ? liveQuote.totalNGN : cartTotal * effectiveRate;
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

            /**
             * The amount on the button goes with the request — #577.
             *
             * `quotedTotalNGN` is not advisory. The action refuses unless its
             * own total agrees to the kobo, so this buyer is charged the number
             * they just read or they are charged nothing.
             */
            const quotedTotalNGN = totalInNaira;
            const quotedForCartTotal = cartTotal;

            const result = await initializeExportOrderPaymentAction(
                cartItemsInput,
                buyerDetails,
                quotedTotalNGN
            );

            if (result.success ) {
                /**
                 * Store buyer details in user-scoped localStorage.
                 *
                 *   #569 KEPT, AND NOW ACTUALLY CLEARED. Nothing in this
                 *   codebase reads this key — it was written "for post-payment
                 *   processing" that was never built — so what it did was leave
                 *   the buyer's name, email, phone and delivery details, plus a
                 *   snapshot of what they bought and paid, on the machine
                 *   indefinitely.
                 *
                 *   It is NOT removed here, because a buyer who is about to be
                 *   sent to Paystack may come back to a support conversation
                 *   about what they were charged, and this is the only local
                 *   record of the basket at the moment of payment. It is
                 *   cleared where it stops being needed: the payment callback,
                 *   once the order exists server-side. See the `finally` block
                 *   in export/buyer/cart/payment-callback.
                 */
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
                    //   The figures the server agreed to charge, not the ones
                    //   this browser guessed — #577. A support conversation
                    //   about "what was I charged" is the one thing this record
                    //   exists for. The lines above stay as the basket held
                    //   them, which is what the buyer recognises; these three
                    //   are the amount that left their card.
                    totalUSD: totalInDollars,
                    totalNGN: quotedTotalNGN,
                    usdToNgn: effectiveRate,
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
                /**
                 * A refusal may carry the price the server actually holds.
                 *
                 *   #577 — the rate or a catalogue price moved between this
                 *   page being rendered and the button being pressed. Nothing
                 *   has been charged. The summary re-prices itself from these
                 *   figures, so the second press sends a total the server will
                 *   accept, and the buyer sees the change before agreeing to it
                 *   rather than on their statement afterwards.
                 */
                const requote = (result as { meta?: { quote?: ExportCartQuote } }).meta?.quote;
                if (requote
                    && Number.isFinite(requote.totalNGN)
                    && Number.isFinite(requote.usdToNgn)) {
                    setQuote({ ...requote, forCartTotal: quotedForCartTotal });
                }
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
                                                    ${numberOrZero(item.product?.pricePerMT).toLocaleString()} / MT
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
                                        ${totalInDollars.toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">Total (NGN)</span>
                                    <span className="font-bold text-green-600">
                                        ₦{totalInNaira.toLocaleString()}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500 pt-1">
                                    Rate: $1 = ₦{effectiveRate.toLocaleString()} • Shipping calculated separately
                                </p>
                                {liveQuote && (
                                    //   #577 — the server re-priced this basket. Say so, with
                                    //   the new figures already applied above, rather than
                                    //   letting the change arrive on a bank statement.
                                    <p className="text-xs text-amber-700 pt-1">
                                        Updated to the current price and exchange rate.
                                    </p>
                                )}
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
