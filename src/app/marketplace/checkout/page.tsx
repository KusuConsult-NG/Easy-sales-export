"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ShoppingCart, CreditCard, ArrowLeft, Loader2, CheckCircle, X, Store } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { createOrderAction } from "@/app/actions/orders";
import { useToast } from "@/contexts/ToastContext";
import type { Product } from "@/lib/types/marketplace";

// Disable static generation for this page - must be client-only due to Paystack
export const dynamic = 'force-dynamic';

interface CartItem extends Product {
    quantity: number;
}

export default function CheckoutPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<"paystack" | "bank_transfer">("paystack");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [deliveryAddress, setDeliveryAddress] = useState({
        street: "",
        city: "",
        state: "",
        lga: "",
    });
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        setIsClient(true);
        // Retrieve cart from localStorage
        const savedCart = localStorage.getItem("marketplace_cart");
        if (savedCart) {
            setCart(JSON.parse(savedCart));
        } else {
            // No cart items, redirect back to marketplace
            router.push("/marketplace");
        }
    }, [router]);

    const subtotal = cart.reduce((sum, item) => sum + (item.pricingTiers[0]?.price || 0) * item.quantity, 0);
    const deliveryFee = 5000;

    const handlePaystackCheckout = () => {
        if (!email || !phone) {
            alert("Please provide your email and phone number");
            return;
        }

        const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;
        if (!publicKey) {
            alert("Payment temporarily unavailable. Please contact support.");
            return;
        }

        setIsProcessing(true);

        // Dynamically import and use Paystack only on client
        if (typeof window !== 'undefined') {
            import('react-paystack').then((mod) => {
                const PaystackPop = (window as any).PaystackPop;

                const handler = PaystackPop.setup({
                    key: publicKey,
                    email: email,
                    amount: Math.round((subtotal + deliveryFee) * 100),
                    currency: 'NGN',
                    ref: `MP-${Date.now()}`,
                    onClose: () => {
                        setIsProcessing(false);
                    },
                    callback: (response: any) => {
                        setIsProcessing(false);
                        localStorage.removeItem("marketplace_cart");
                        router.push(`/marketplace/success?reference=${response.reference}`);
                    },
                });
                handler.openIframe();
            }).catch(() => {
                setIsProcessing(false);
                alert("Payment system error. Please try again.");
            });
        }
    };

    const handleBankTransfer = () => {
        alert("Bank transfer instructions will be sent to your email");
        // TODO: Implement bank transfer logic
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
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Phone Number
                                    </label>
                                    <input
                                        type="tel"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        placeholder="+234 XXX XXX XXXX"
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                                        required
                                    />
                                </div>
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

                                <button
                                    onClick={() => setPaymentMethod("bank_transfer")}
                                    className={`w-full p-4 border-2 rounded-xl flex items-center gap-3 transition ${paymentMethod === "bank_transfer"
                                        ? "border-primary bg-primary/5"
                                        : "border-slate-200 dark:border-slate-700"
                                        }`}
                                    disabled
                                >
                                    <div className="w-6 h-6 bg-slate-300 dark:bg-slate-600 rounded" />
                                    <div className="flex-1 text-left">
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            Bank Transfer
                                        </p>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            Coming Soon
                                        </p>
                                    </div>
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

                            {process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ? (
                                <button
                                    onClick={handlePaystackCheckout}
                                    disabled={isProcessing || !email || !phone}
                                    className="w-full px-6 py-4 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isProcessing ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <CreditCard className="w-5 h-5" />
                                            Complete Payment
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

                            {/* Add Paystack inline script */}
                            <script src="https://js.paystack.co/v1/inline.js" async></script>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
