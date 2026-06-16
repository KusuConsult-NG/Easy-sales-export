"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { ShoppingCart, CreditCard, ArrowLeft, Loader2, CheckCircle, X, Store, Plus, Minus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { MarketplaceErrorBoundary } from "@/components/marketplace/MarketplaceErrorBoundary";
import { initializeOrderPaymentAction, calculateDeliveryAction } from "@/app/actions/marketplace";
import { useToast } from "@/contexts/ToastContext";
import PhoneInput, { isValidNigerianPhone } from "@/components/ui/PhoneInput";
import type { Product, CartItem } from "@/lib/types/marketplace";

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
    const [paymentMethod, setPaymentMethod] = useState<"paystack">("paystack");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [phoneError, setPhoneError] = useState<string>("");
    const [deliveryAddress, setDeliveryAddress] = useState({
        street: "",
        city: "",
        state: "",
        lga: "",
    });
    const [deliveryFee, setDeliveryFee] = useState<number>(0);
    const [isCalculatingFee, setIsCalculatingFee] = useState(true);
    const [isClient, setIsClient] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
         
        setIsClient(true);
        if (session?.user?.email) setEmail(session.user.email);

        // Use user-scoped cart key to match what product page sets
        const userId = session?.user?.id;
        const cartKey = userId ? `marketplace_cart_${userId}` : "marketplace_cart";
        const savedCart = localStorage.getItem(cartKey);
        if (savedCart) {
            setCart(JSON.parse(savedCart));
        } else {
            router.push("/marketplace");
        }
    }, [router, session]);
 
    const handleUpdateQuantity = (productId: string, newQty: number) => {
        const item = cart.find(i => i.id === productId);
        if (!item) return;

        const minQty = item.minimumOrderQuantity || 1;
        if (newQty < minQty) {
            showToast(`Minimum order quantity for this item is ${minQty}`, "warning");
            return;
        }

        const updated = cart.map(i => {
            if (i.id === productId) {
                return { ...i, quantity: newQty };
            }
            return i;
        });
        setCart(updated);
        const userId = session?.user?.id;
        const cartKey = userId ? `marketplace_cart_${userId}` : "marketplace_cart";
        localStorage.setItem(cartKey, JSON.stringify(updated));
    };

    const handleRemoveProduct = (productId: string) => {
        const updated = cart.filter(i => i.id !== productId);
        setCart(updated);
        const userId = session?.user?.id;
        const cartKey = userId ? `marketplace_cart_${userId}` : "marketplace_cart";
        if (updated.length === 0) {
            localStorage.removeItem(cartKey);
            router.push("/marketplace");
        } else {
            localStorage.setItem(cartKey, JSON.stringify(updated));
        }
        showToast("Product removed from cart", "success");
    };

    // Calculate delivery fee when cart is loaded
    useEffect(() => {
        async function fetchFee() {
            if (cart.length === 0) return;
            setIsCalculatingFee(true);
            try {
                const cartItems: CartItem[] = cart.map(item => ({
                    id: item.id,
                    title: item.title,
                    sellerId: item.sellerId,
                    price: item.pricingTiers[0]?.price || 0,
                    quantity: item.quantity,
                    unit: item.unit,
                    selectedTier: item.pricingTiers[0]?.type || "retail",
                    addedAt: new Date(),
                }));
                const res = await calculateDeliveryAction(cartItems);
                if (res.success && res.data) {
                    setDeliveryFee(res.data.fee);
                } else {
                    setDeliveryFee(0);
                    showToast(res.error || "Failed to calculate delivery fee", "error");
                }
            } catch (err) {
                setDeliveryFee(0);
                showToast("Error calculating delivery fee", "error");
            } finally {
                setIsCalculatingFee(false);
            }
        }
        fetchFee();
    }, [cart, showToast]);

    const subtotal = cart.reduce((sum, item) => sum + (item.pricingTiers[0]?.price || 0) * item.quantity, 0);

    async function handlePaystackCheckout() {
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
                selectedTier: item.pricingTiers[0]?.type || "retail",
                addedAt: new Date(),
            }));

            // Initialize payment
            const result = await initializeOrderPaymentAction(
                cartItems,
                email,
                phone,
                deliveryFee
            );

            if (result.success ) {
                // Redirect to Paystack for payment
                if (result.data?.authorizationUrl) {
                    window.location.href = result.data.authorizationUrl;
                } else {
                    setError("Failed to initialize payment: No authorization URL");
                    setIsProcessing(false);
                }
            } else {
                setError(result.error || "Failed to initialize payment");
                setIsProcessing(false);
            }
        } catch (err) {
            setError("An error occurred while processing your payment");
            setIsProcessing(false);
        }
    };



    if (!isClient || cart.length === 0) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-slate-600">Loading checkout...</p>
                </div>
            </div>
        );
    }

    return (
        <MarketplaceErrorBoundary>
            <div className="min-h-screen bg-slate-50 py-8 px-4">
                <div className="max-w-6xl mx-auto">
                    {/* Header */}
                    <button
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6 transition"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Back to Marketplace
                    </button>

                    <h1 className="text-3xl font-bold text-slate-900 mb-8">
                        Checkout
                    </h1>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Order Summary */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* Cart Items */}
                            <div className="bg-white rounded-2xl p-6">
                                <h2 className="text-xl font-bold text-slate-900 mb-4">
                                    Order Summary
                                </h2>
                                <div className="space-y-4">
                                    {cart.map((item) => {
                                        const price = item.pricingTiers[0]?.price || 0;
                                        return (
                                            <div
                                                key={item.id}
                                                className="flex items-start gap-4 pb-4 border-b border-slate-200 last:border-0"
                                            >
                                                <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-slate-100">
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
                                                    <h3 className="font-bold text-slate-900">
                                                        {item.title}
                                                    </h3>
                                                    <p className="text-sm text-slate-600 mb-2">
                                                        {formatCurrency(price)} per {item.unit}
                                                    </p>
                                                    <div className="flex items-center gap-4">
                                                        <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden bg-slate-50">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)}
                                                                className="px-2.5 py-1.5 hover:bg-slate-200 text-slate-600 transition"
                                                            >
                                                                <Minus className="w-3.5 h-3.5" />
                                                            </button>
                                                            <span className="px-3 font-semibold text-slate-900 min-w-[32px] text-center text-sm">
                                                                {item.quantity}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                                                                className="px-2.5 py-1.5 hover:bg-slate-200 text-slate-600 transition"
                                                            >
                                                                <Plus className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveProduct(item.id)}
                                                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-lg transition"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
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
                            <div className="bg-white rounded-2xl p-6">
                                <h2 className="text-xl font-bold text-slate-900 mb-4">
                                    Contact Information
                                </h2>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            Email Address
                                        </label>
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="your.email@example.com"
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
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


                        </div>

                        {/* Order Total */}
                        <div className="lg:col-span-1">
                            <div className="bg-white rounded-2xl p-6 sticky top-8">
                                <h2 className="text-xl font-bold text-slate-900 mb-4">
                                    Order Total
                                </h2>
                                <div className="space-y-3 mb-6">
                                    <div className="flex justify-between text-slate-600">
                                        <span>Subtotal</span>
                                        <span>{formatCurrency(subtotal)}</span>
                                    </div>
                                    <div className="flex justify-between text-slate-600">
                                        <span>Delivery Fee</span>
                                        <span>
                                            {isCalculatingFee ? (
                                                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                                            ) : (
                                                formatCurrency(deliveryFee)
                                            )}
                                        </span>
                                    </div>
                                    <div className="pt-3 border-t border-slate-200 flex justify-between text-lg font-bold">
                                        <span className="text-slate-900">Total</span>
                                        <span className="text-primary">
                                            {isCalculatingFee ? (
                                                <span className="text-sm font-normal text-slate-400">Calculating...</span>
                                            ) : (
                                                formatCurrency(subtotal + deliveryFee)
                                            )}
                                        </span>
                                    </div>
                                </div>


                                <div className="mb-6">
                                    <label className="block text-sm font-semibold text-slate-900 mb-3">
                                        Payment Method
                                    </label>
                                    <div className="p-4 border-2 border-primary bg-primary/10 rounded-xl flex items-center gap-3">
                                        <CreditCard className="w-6 h-6 text-primary" />
                                        <div>
                                            <p className="font-semibold text-slate-900">Card Payment (Paystack)</p>
                                            <p className="text-xs text-slate-600">Pay securely with your debit or credit card</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Error Display */}
                                {error && (
                                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                                        <p className="text-sm text-red-600">{error}</p>
                                    </div>
                                )}

                                {process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ? (
                                    <button
                                        onClick={handlePaystackCheckout}
                                        disabled={isProcessing || isCalculatingFee || !email || !phone}
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
                                    <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                                        <p className="text-sm text-yellow-800 font-semibold mb-2">
                                            Payment Temporarily Unavailable
                                        </p>
                                        <p className="text-xs text-yellow-700">
                                            Please contact support to complete your order.
                                        </p>
                                        <button
                                            disabled
                                            className="w-full mt-3 px-6 py-3 bg-slate-300 text-slate-500 font-bold rounded-xl cursor-not-allowed"
                                        >
                                            Payment Disabled
                                        </button>
                                    </div>
                                )}

                                <p className="text-xs text-center text-slate-500 mt-4">
                                    All payments are escrow-protected for your security
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </MarketplaceErrorBoundary>
    );
}
