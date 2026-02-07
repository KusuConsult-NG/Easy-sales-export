"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import {
    ArrowLeft,
    ShoppingCart,
    MapPin,
    Package,
    Truck,
    Shield,
    Star,
    MessageCircle,
    Store,
    Loader2,
    Plus,
    Minus,
    DollarSign
} from "lucide-react";
import { getProductByIdAction } from "@/app/actions/marketplace-buyer";
import { createConversationAction } from "@/app/actions/messaging";
import type { Product } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

import ProductReviewsSection from "@/components/marketplace/ProductReviewsSection";
export default function ProductDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { showToast } = useToast();
    const productId = params.id as string;

    const [product, setProduct] = useState<Product | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedImage, setSelectedImage] = useState(0);
    const [quantity, setQuantity] = useState(1);
    const [selectedTier, setSelectedTier] = useState(0);

    useEffect(() => {
        loadProduct();
    }, [productId]);

    async function loadProduct() {
        try {
            const result = await getProductByIdAction(productId);
            if (result.success && result.product) {
                setProduct(result.product);
            } else {
                showToast("Product not found", "error");
                router.push("/marketplace");
            }
        } catch (error) {
            showToast("Failed to load product", "error");
        } finally {
            setLoading(false);
        }
    }

    const addToCart = () => {
        if (!product) return;

        // Get current cart from localStorage
        const cart = JSON.parse(localStorage.getItem("marketplace_cart") || "[]");

        // Check if product already in cart
        const existingIndex = cart.findIndex((item: any) => item.id === product.id);

        if (existingIndex >= 0) {
            cart[existingIndex].quantity += quantity;
        } else {
            cart.push({ ...product, quantity });
        }

        localStorage.setItem("marketplace_cart", JSON.stringify(cart));
        showToast(`Added ${quantity} ${product.unit} to cart`, "success");
        router.push("/marketplace");
    };

    const handleContactSeller = async () => {
        if (!product) return;

        try {
            const result = await createConversationAction({
                recipientId: product.sellerId,
                productId: product.id,
            });

            if (result.success) {
                router.push(`/dashboard/messages?conversation=${result.conversationId}`);
            } else {
                showToast(result.error || "Failed to start conversation", "error");
            }
        } catch (error) {
            showToast("Failed to start conversation", "error");
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
            </div>
        );
    }

    if (!product) return null;

    const selectedPrice = product.pricingTiers[selectedTier];
    const inStock = product.status === "active" && product.availableQuantity > 0;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Back Button */}
                <button
                    onClick={() => router.back()}
                    className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-primary mb-6 transition"
                >
                    <ArrowLeft className="w-5 h-5" />
                    Back to Marketplace
                </button>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                    {/* Images */}
                    <div className="space-y-4">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-lg">
                            <div className="relative h-96">
                                {product.images[selectedImage] ? (
                                    <Image
                                        src={product.images[selectedImage]}
                                        alt={product.title}
                                        fill
                                        className="object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-700">
                                        <Store className="w-24 h-24 text-gray-400" />
                                    </div>
                                )}
                                {product.exportReady && (
                                    <div className="absolute top-4 right-4 px-4 py-2 bg-green-500 text-white font-bold rounded-xl">
                                        Export Ready
                                    </div>
                                )}
                                {!inStock && (
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                        <span className="px-6 py-3 bg-red-500 text-white font-bold rounded-xl text-lg">
                                            Out of Stock
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Image Thumbnails */}
                        {product.images.length > 1 && (
                            <div className="grid grid-cols-4 gap-2">
                                {product.images.map((img, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setSelectedImage(idx)}
                                        className={`relative h-24 rounded-xl overflow-hidden border-2 transition ${selectedImage === idx
                                            ? "border-primary"
                                            : "border-gray-200 dark:border-gray-700"
                                            }`}
                                    >
                                        <Image
                                            src={img}
                                            alt={`${product.title} ${idx + 1}`}
                                            fill
                                            className="object-cover"
                                        />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Product Info */}
                    <div className="space-y-6">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
                            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
                                {product.title}
                            </h1>

                            <div className="flex items-center gap-4 mb-6">
                                <div className="flex items-center gap-1">
                                    {[...Array(5)].map((_, i) => (
                                        <Star
                                            key={i}
                                            className={`w-5 h-5 ${i < 4
                                                ? "fill-yellow-400 text-yellow-400"
                                                : "text-gray-300 dark:text-gray-600"
                                                }`}
                                        />
                                    ))}
                                    <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">
                                        (0 reviews)
                                    </span>
                                </div>
                            </div>

                            {/* Pricing Tiers */}
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                                    Select Pricing Tier
                                </label>
                                <div className="space-y-2">
                                    {product.pricingTiers.map((tier, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setSelectedTier(idx)}
                                            className={`w-full p-4 rounded-xl border-2 transition text-left ${selectedTier === idx
                                                ? "border-primary bg-primary/5"
                                                : "border-gray-200 dark:border-gray-700 hover:border-primary/50"
                                                }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <div className="font-semibold text-gray-900 dark:text-white capitalize">
                                                        {tier.type} Price
                                                    </div>
                                                    <div className="text-sm text-gray-600 dark:text-gray-400">
                                                        Min: {tier.minQuantity} {product.unit}
                                                    </div>
                                                </div>
                                                <div className="text-2xl font-bold text-primary">
                                                    {formatCurrency(tier.price)}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Quantity */}
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                                    Quantity ({product.unit})
                                </label>
                                <div className="flex items-center gap-4">
                                    <button
                                        onClick={() => setQuantity(Math.max(product.minimumOrderQuantity, quantity - 1))}
                                        className="w-12 h-12 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition"
                                    >
                                        <Minus className="w-5 h-5" />
                                    </button>
                                    <input
                                        type="number"
                                        value={quantity}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value) || product.minimumOrderQuantity;
                                            setQuantity(Math.max(product.minimumOrderQuantity, val));
                                        }}
                                        min={product.minimumOrderQuantity}
                                        className="w-24 px-4 py-3 text-center text-lg font-semibold border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    />
                                    <button
                                        onClick={() => setQuantity(quantity + 1)}
                                        className="w-12 h-12 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition"
                                    >
                                        <Plus className="w-5 h-5" />
                                    </button>
                                    <div className="flex-1">
                                        <p className="text-sm text-gray-500">
                                            Min: {product.minimumOrderQuantity} {product.unit}
                                        </p>
                                        <p className="text-sm text-gray-500">
                                            Available: {product.availableQuantity} {product.unit}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Total Price */}
                            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 mb-6">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                                    <span className="text-2xl font-bold text-gray-900 dark:text-white">
                                        {formatCurrency(selectedPrice.price * quantity)}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-500">
                                    {quantity} {product.unit} × {formatCurrency(selectedPrice.price)}
                                </p>
                            </div>

                            {/* Action Buttons */}
                            <div className="space-y-3">
                                <button
                                    onClick={addToCart}
                                    disabled={!inStock}
                                    className="w-full px-6 py-4 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    <ShoppingCart className="w-5 h-5" />
                                    {inStock ? "Add to Cart" : "Out of Stock"}
                                </button>
                                <button
                                    onClick={handleContactSeller}
                                    className="w-full px-6 py-4 border-2 border-primary text-primary font-semibold rounded-xl hover:bg-primary/5 transition flex items-center justify-center gap-2"
                                >
                                    <MessageCircle className="w-5 h-5" />
                                    Contact Seller
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Product Details Tabs */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
                    <div className="space-y-6">
                        {/* Description */}
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                                Description
                            </h2>
                            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                                {product.description}
                            </p>
                        </div>

                        {/* Specifications */}
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                                Specifications
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
                                    <Package className="w-5 h-5 text-primary" />
                                    <div>
                                        <p className="text-sm text-gray-500">Category</p>
                                        <p className="font-semibold text-gray-900 dark:text-white capitalize">
                                            {product.category.replace("_", " ")}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
                                    <MapPin className="w-5 h-5 text-primary" />
                                    <div>
                                        <p className="text-sm text-gray-500">Location</p>
                                        <p className="font-semibold text-gray-900 dark:text-white">
                                            {product.location.lga}, {product.location.state}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
                                    <Truck className="w-5 h-5 text-primary" />
                                    <div>
                                        <p className="text-sm text-gray-500">Delivery Method</p>
                                        <p className="font-semibold text-gray-900 dark:text-white capitalize">
                                            {product.deliveryMethod}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
                                    <Shield className="w-5 h-5 text-primary" />
                                    <div>
                                        <p className="text-sm text-gray-500">Status</p>
                                        <p className="font-semibold text-green-600">Verified Seller</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                    {/* Reviews Section */}
                    <ProductReviewsSection productId={productId} />

            </div>
        </div>
    );
}
