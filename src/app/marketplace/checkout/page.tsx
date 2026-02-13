"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { ShoppingCart, CreditCard, ArrowLeft, Loader2, CheckCircle, X, Store } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { initializeOrderPaymentAction, type CartItem } from "@/app/actions/marketplace-payment";
import { useToast } from "@/contexts/ToastContext";
import PhoneInput, { isValidNigerianPhone } from "@/components/ui/PhoneInput";
import type { Product } from "@/lib/types/marketplace";

// Disable static generation for this page - must be client-only due to Paystack
export const dynamic = 'force-dynamic';

interface LocalCartItem extends Product {
    quantity: number;
}

export default function CheckoutPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const { showToast } = useToast();
    const [cart, setCart] = useState<LocalCartItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<"paystack" | "bank_transfer">("paystack");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [phoneError, setPhoneError] = useState<string>("");
    const [deliveryAddress, setDeliveryAddress] = useState({
        street: "",
        city: "",
        state: "",
        lga: "",
    });
    const [isClient, setIsClient] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setIsClient(true);
        // Pre-fill email from session
        if (session?.user?.email) {
            setEmail(session.user.email);
        }

        // Retrieve cart from localStorage
        const savedCart = localStorage.getItem("marketplace_cart");
        if (savedCart) {
            setCart(JSON.parse(savedCart));
        } else {
            // No cart items, redirect back to marketplace
            router.push("/marketplace");
        }
    }, [router, session]);

    const subtotal = cart.reduce((sum, item) => sum + (item.pricingTiers[0]?.price || 0) * item.quantity, 0);
    const deliveryFee = 5000;

    const handlePaystackCheckout = async () => {
        if (!session) {
            router.push("/auth/login?redirect=/marketplace/checkout");
            return;
        }

        if (!email || !phone) {
            setError("Please provide your email and phone number");
            return;
        }

        // Validate phone number
        if (!isValidNigerianPhone(phone)) {
            setPhoneError("Please enter a valid Nigerian phone number");
            return;
        }

        if (cart.length === 0) {
            setError("Your cart is empty");
            return;
        }

        setIsProcessing(true);
        setError(null);
        setPhoneError("");

        try {
            // Prepare cart items for payment
            const cartItems: CartItem[] = cart.map(item => ({
                id: item.id,
                title: item.title,
                sellerId: item.sellerId,
                price: item.pricingTiers[0]?.price || 0,
                quantity: item.quantity,
                unit: item.unit,
            }));

            // Initialize payment
            const result = await initializeOrderPaymentAction(
                cartItems,
                email,
                phone,
                deliveryFee
            );

            if (result.success && result.data) {
                // Redirect to Paystack for payment
                (window as any).location.href = result.data.authorizationUrl;
            } else {
                setError(result.error || "Failed to initialize payment");
                setIsProcessing(false);
            }
        } catch (err) {
            setError("An error occurred while processing your payment");
            setIsProcessing(false);
        }
    };

    const handleBankTransfer = async () => {
        if (!session) {
            router.push("/auth/login?redirect=/marketplace/checkout");
            return;
        }

        if (!email || !phone) {
            setError("Please provide your email and phone number");
            return;
        }

        // Validate phone number
        if (!isValidNigerianPhone(phone)) {
            setPhoneError("Please enter a valid Nigerian phone number");
            return;
        }

        if (cart.length === 0) {
            setError("Your cart is empty");
            return;
        }

        setIsProcessing(true);
        setError(null);
        setPhoneError("");

        try {
            // Import the bank transfer action
            const { createBankTransferOrderAction } = await import("@/app/actions/marketplace-payment");

            // Prepare cart items
            const cartItems = cart.map(item => ({
                id: item.id,
                title: item.title,
                sellerId: item.sellerId,
                price: item.pricingTiers[0]?.price || 0,
                quantity: item.quantity,
                unit: item.unit,
            }));

            // Create bank transfer order
            const result = await createBankTransferOrderAction(
                cartItems,
                email,
                phone,
                deliveryFee
            );

            if (result.success && result.orderId) {
                // Clear cart
                localStorage.removeItem("marketplace_cart");

                // Show success message
                showToast(
                    "Order Created! Please complete bank transfer to the account details shown.",
                    "success"
                );

                // Redirect to success page with order details
                router.push(`/marketplace/orders/${result.orderId}?payment=pending`);
            } else {
                setError(result.error || "Failed to create order");
                setIsProcessing(false);
            }
        } catch (err) {
            setError("An error occurred while creating your order");
            setIsProcessing(false);
        }
    };

    if (!isClient || cart.length === 0) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">Loading checkout...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <button
                    onClick={() => router.back()}
                    className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mb-6 transition"
                >
                    <ArrowLeft className="w-5 h-5" />
                    Back to Marketplace
                </button>

                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">
                    Checkout
                </h1>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Order Summary */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Cart Items */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                                Order Summary
                            </h2>
                            <div className="space-y-4">
                                {cart.map((item) => {
                                    const price = item.pricingTiers[0]?.price || 0;
                                    return (
                                        <div
                                            key={item.id}
                                            className="flex items-start gap-4 pb-4 border-b border-slate-200 dark:border-slate-700 last:border-0"
                                        >
                                            <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700">
                                                {item.images[0] ? (
                                                    <Image
                                                        src={item.images[0]}
                                                        alt={item.title}
                                                        fill
                                                        className="object-cover"
                                                    />
                                                ) : (
                                                    <Store className="w-8 h-8 text-gray-400 mx-auto mt-6" />
                                                )}
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="font-bold text-slate-900 dark:text-white">
                                                    {item.title}
                                                </h3>
                                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                                    {formatCurrency(price)} × {item.quantity} {item.unit}
                                                </p>
                                            </div>
                                            <p className="font-bold text-primary">
                                                {formatCurrency(price * item.quantity)}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Contact Information */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                                Contact Information
                            </h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Email Address
                                    </label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="your.email@example.com"
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                                        required
                                    />
                                </div>
                                <PhoneInput
                                    label="Phone Number"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    error={phoneError}
                                    required
                                />
                            </div>
                        </div>

                        {/* Payment Method */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                                Payment Method
                            </h2>
                            <div className="space-y-3">
                                <button
                                    onClick={() => setPaymentMethod("paystack")}
                                    className={`w-full p-4 border-2 rounded-xl flex items-center gap-3 transition ${paymentMethod === "paystack"
                                        ? "border-primary bg-primary/5"
                                        : "border-slate-200 dark:border-slate-700"
                                        }`}
                                >
                                    <CreditCard className="w-6 h-6 text-primary" />
                                    <div className="flex-1 text-left">
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            Card Payment (Paystack)
                                        </p>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            Pay securely with your debit/credit card
                                        </p>
                                    </div>
                                    {paymentMethod === "paystack" && (
                                        <CheckCircle className="w-6 h-6 text-primary" />
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Order Total */}
                    <div className="lg:col-span-1">
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 sticky top-8">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                                Order Total
                            </h2>
                            <div className="space-y-3 mb-6">
                                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                                    <span>Subtotal</span>
                                    <span>{formatCurrency(subtotal)}</span>
                                </div>
                                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                                    <span>Delivery Fee</span>
                                    <span>{formatCurrency(deliveryFee)}</span>
                                </div>
                                <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between text-lg font-bold">
                                    <span className="text-slate-900 dark:text-white">Total</span>
                                    <span className="text-primary">{formatCurrency(subtotal + deliveryFee)}</span>
                                </div>
                            </div>


                            {/* Payment Method Selection */}
                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-3">
                                    Payment Method *
                                </label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <button
                                        type="button"
                                        onClick={() => setPaymentMethod("paystack")}
                                        className={`p-4 border-2 rounded-xl transition-all text-left ${paymentMethod === "paystack"
                                            ? "border-primary bg-primary/10"
                                            : "border-slate-200 dark:border-slate-700 hover:border-primary/50"
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <CreditCard className="w-6 h-6 text-primary" />
                                            <div>
                                                <p className="font-semibold text-slate-900 dark:text-white">Card Payment</p>
                                                <p className="text-xs text-slate-600 dark:text-slate-400">Pay with debit/credit card</p>
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setPaymentMethod("bank_transfer")}
                                        className={`p-4 border-2 rounded-xl transition-all text-left ${paymentMethod === "bank_transfer"
                                            ? "border-primary bg-primary/10"
                                            : "border-slate-200 dark:border-slate-700 hover:border-primary/50"
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Store className="w-6 h-6 text-primary" />
                                            <div>
                                                <p className="font-semibold text-slate-900 dark:text-white">Bank Transfer</p>
                                                <p className="text-xs text-slate-600 dark:text-slate-400">Transfer directly to our account</p>
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>

                            {/* Bank Transfer Details */}
                            {paymentMethod === "bank_transfer" && (
                                <div className="mb-6 p-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                                    <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-4">Bank Transfer Details</h3>
                                    <div className="space-y-3 text-sm">
                                        <div className="flex justify-between items-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                                            <span className="text-slate-600 dark:text-slate-400">Bank Name:</span>
                                            <span className="font-semibold text-slate-900 dark:text-white">First Bank of Nigeria</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                                            <span className="text-slate-600 dark:text-slate-400">Account Number:</span>
                                            <span className="font-semibold text-slate-900 dark:text-white font-mono">1234567890</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                                            <span className="text-slate-600 dark:text-slate-400">Account Name:</span>
                                            <span className="font-semibold text-slate-900 dark:text-white">Easy Sales Export Ltd</span>
                                        </div>
                                    </div>
                                    <div className="mt-4 p-3 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded-lg">
                                        <p className="text-xs text-yellow-900 dark:text-yellow-200">
                                            ⚠️ <strong>Important:</strong> After transfer, your order will be marked as "pending payment verification".
                                            We'll confirm your payment within 24 hours and ship your order.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Error Display */}
                            {error && (
                                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4">
                                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                                </div>
                            )}

                            {process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ? (
                                <button
                                    onClick={paymentMethod === "paystack" ? handlePaystackCheckout : handleBankTransfer}
                                    disabled={isProcessing || !email || !phone}
                                    className="w-full px-6 py-4 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isProcessing ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Processing...
                                        </>
                                    ) : paymentMethod === "paystack" ? (
                                        <>
                                            <CreditCard className="w-5 h-5" />
                                            Complete Payment
                                        </>
                                    ) : (
                                        <>
                                            <Store className="w-5 h-5" />
                                            Confirm Order
                                        </>
                                    )}
                                </button>
                            ) : (
                                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
                                    <p className="text-sm text-yellow-800 dark:text-yellow-200 font-semibold mb-2">
                                        Payment Temporarily Unavailable
                                    </p>
                                    <p className="text-xs text-yellow-700 dark:text-yellow-300">
                                        Please contact support to complete your order.
                                    </p>
                                    <button
                                        disabled
                                        className="w-full mt-3 px-6 py-3 bg-slate-300 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-bold rounded-xl cursor-not-allowed"
                                    >
                                        Payment Disabled
                                    </button>
                                </div>
                            )}

                            <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-4">
                                All payments are escrow-protected for your security
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
