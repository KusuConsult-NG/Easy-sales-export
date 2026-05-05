"use client";

import { ArrowLeft, Package, ShoppingCart, Star, MapPin, Award, Phone, Mail, Shield, Loader2 } from "lucide-react";
import { logger } from '@/lib/logger';
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getProductAction, getRelatedProductsAction } from "@/app/actions/marketplace";
import type { Product } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import QuoteRequestModal from "./_components/QuoteRequestModal";

export default function ProductDetailPage() {
    const params = useParams();
    const productId = params.id as string;

    const [loading, setLoading] = useState(true);
    const [product, setProduct] = useState<Product & { sellerName?: string } | null>(null);
    const [error, setError] = useState("");
    const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
    const [showQuoteModal, setShowQuoteModal] = useState(false);

    useEffect(() => {
        async function loadProduct() {
            if (!productId) return;

            try {
                const result = await getProductAction(productId);
                if (result.success && result.data?.product) {
                    setProduct(result.data.product);

                    // Load related products
                    const relatedResult = await getRelatedProductsAction(productId, 4);
                    if (relatedResult.success) {
                        setRelatedProducts(relatedResult.data?.products || []);
                    }
                } else {
                    setError(result.error || "Product not found");
                }
            } catch (err) {
                logger.error("Failed to load product:", err);
                setError("Failed to load product details");
            } finally {
                setLoading(false);
            }
        }
        loadProduct();
    }, [productId]);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    if (error || !product) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8">
                <Package className="w-16 h-16 text-slate-300 mb-4" />
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Product Not Found</h1>
                <p className="text-slate-600 mb-6">{error || "The product you're looking for doesn't exist or has been removed."}</p>
                <Link
                    href="/marketplace/products"
                    className="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition"
                >
                    Browse Marketplace
                </Link>
            </div>
        );
    }

    const mainImage = product.images && product.images.length > 0 ? product.images[0] : "/images/placeholder-product.jpg";
    const priceDisplay = product.pricingTiers && product.pricingTiers.length > 0
        ? formatCurrency(product.pricingTiers[0].price)
        : "Price on Request";

    // Determine badge based on product attributes
    let badge = "In Stock";
    if (product.exportReady) badge = "Export Ready";
    else if (product.bulkAvailable) badge = "Bulk Available";

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-linear-to-r from-green-600 to-emerald-600 text-white py-8">
                <div className="max-w-7xl mx-auto px-8">
                    <Link
                        href="/marketplace/products"
                        className="inline-flex items-center gap-2 text-white/90 hover:text-white mb-4 transition"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Back to Products
                    </Link>
                    <div className="flex items-center gap-3">
                        <Package className="w-8 h-8" />
                        <h1 className="text-3xl font-bold">Product Details</h1>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-8 py-12">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* Product Image */}
                    <div className="space-y-6">
                        <div className="relative h-96 lg:h-[500px] bg-white rounded-2xl overflow-hidden shadow-xl">
                            <Image
                                src={mainImage}
                                alt={product.title}
                                fill
                                className="object-cover"
                            />
                            <div className="absolute top-6 right-6">
                                <span className="px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-full shadow-lg">
                                    {badge}
                                </span>
                            </div>
                        </div>

                        {/* Trust Badges */}
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-white p-4 rounded-xl text-center">
                                <Shield className="w-6 h-6 text-green-600 mx-auto mb-2" />
                                <div className="text-xs text-slate-600">Verified Seller</div>
                            </div>
                            <div className="bg-white p-4 rounded-xl text-center">
                                <Award className="w-6 h-6 text-green-600 mx-auto mb-2" />
                                <div className="text-xs text-slate-600">Quality Assured</div>
                            </div>
                            <div className="bg-white p-4 rounded-xl text-center">
                                <Package className="w-6 h-6 text-green-600 mx-auto mb-2" />
                                <div className="text-xs text-slate-600">Fast Shipping</div>
                            </div>
                        </div>
                    </div>

                    {/* Product Info */}
                    <div className="space-y-6">
                        <div>
                            <h1 className="text-4xl font-bold text-slate-900 mb-4">
                                {product.title}
                            </h1>

                            <div className="flex items-center gap-4 mb-6">
                                <div className="flex items-center gap-1">
                                    <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                                    <span className="text-lg font-semibold text-slate-900">
                                        {product.rating || 0}
                                    </span>
                                    <span className="text-slate-600">
                                        ({product.reviewCount || 0} reviews)
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-slate-600">
                                    <MapPin className="w-4 h-4" />
                                    {product.location?.state}, {product.location?.lga}
                                </div>
                            </div>

                            <div className="text-5xl font-bold text-green-600 mb-6">
                                {priceDisplay}
                                <span className="text-xl font-normal text-slate-500 ml-2">/{product.unit}</span>
                            </div>

                            <p className="text-lg text-slate-900 leading-relaxed mb-6">
                                {product.description}
                            </p>
                        </div>

                        {/* Seller Info */}
                        <div className="bg-slate-100 rounded-2xl p-6">
                            <h3 className="font-bold text-slate-900 mb-3">
                                Sold by: {product.sellerName || "AgriMarket Seller"}
                            </h3>
                            <div className="space-y-2 text-sm">
                                <div className="flex items-center gap-2 text-slate-600">
                                    <MapPin className="w-4 h-4" />
                                    Location: {product.location?.state}
                                </div>
                                <div className="flex items-center gap-2 text-slate-600">
                                    <Phone className="w-4 h-4" />
                                    Contact for details
                                </div>
                                <div className="flex items-center gap-2 text-slate-600">
                                    <Mail className="w-4 h-4" />
                                    Message seller
                                </div>
                            </div>
                        </div>

                        {/* CTA Buttons */}
                        <div className="flex flex-col sm:flex-row gap-4">
                            <button className="flex-1 flex items-center justify-center gap-2 px-8 py-4 bg-green-600 text-white font-bold text-lg rounded-xl hover:bg-green-700 transition-all hover:scale-105 shadow-lg">
                                <ShoppingCart className="w-5 h-5" />
                                Add to Cart
                            </button>
                            <button 
                                onClick={() => setShowQuoteModal(true)}
                                className="px-8 py-4 bg-white text-green-600 font-bold text-lg rounded-xl border-2 border-green-600 hover:bg-green-50 transition-all"
                            >
                                Request for Quote
                            </button>
                        </div>

                        {showQuoteModal && (
                            <QuoteRequestModal 
                                product={{
                                    id: product.id,
                                    title: product.title,
                                    sellerId: product.sellerId,
                                    unit: product.unit,
                                    sellerName: product.sellerName
                                }}
                                onClose={() => setShowQuoteModal(false)}
                            />
                        )}

                        {/* Specifications */}
                        <div className="bg-white rounded-2xl p-6 shadow-lg">
                            <h3 className="text-xl font-bold text-slate-900 mb-4">
                                Specifications
                            </h3>
                            <dl className="space-y-3">
                                <div className="flex justify-between border-b border-slate-200 pb-2">
                                    <dt className="font-semibold text-slate-900">Minimum Order</dt>
                                    <dd className="text-slate-600">{product.minimumOrderQuantity} {product.unit}</dd>
                                </div>
                                <div className="flex justify-between border-b border-slate-200 pb-2">
                                    <dt className="font-semibold text-slate-900">Available Quantity</dt>
                                    <dd className="text-slate-600">{product.availableQuantity} {product.unit}</dd>
                                </div>
                                <div className="flex justify-between border-b border-slate-200 pb-2">
                                    <dt className="font-semibold text-slate-900">Delivery Method</dt>
                                    <dd className="text-slate-600 capitalize">{product.deliveryMethod}</dd>
                                </div>
                                {product.estimatedDeliveryDays && (
                                    <div className="flex justify-between border-b border-slate-200 pb-2">
                                        <dt className="font-semibold text-slate-900">Est. Delivery</dt>
                                        <dd className="text-slate-600">{product.estimatedDeliveryDays} Days</dd>
                                    </div>
                                )}
                            </dl>
                        </div>

                        {/* Features/Certifications */}
                        {product.certifications && product.certifications.length > 0 && (
                            <div className="bg-white rounded-2xl p-6 shadow-lg">
                                <h3 className="text-xl font-bold text-slate-900 mb-4">
                                    Certifications
                                </h3>
                                <ul className="space-y-2">
                                    {product.certifications.map((cert, index) => (
                                        <li key={index} className="flex items-start gap-3 text-slate-900">
                                            <span className="text-green-600 mt-1">✓</span>
                                            {cert}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>

            {/* Related Products */}
            <div className="max-w-7xl mx-auto px-6 py-12">
                <h2 className="text-2xl font-bold text-slate-900 mb-6">Related Products</h2>
                {relatedProducts.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {relatedProducts.map((relatedProduct) => (
                            <Link
                                key={relatedProduct.id}
                                href={`/marketplace/products/${relatedProduct.id}`}
                                className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition group"
                            >
                                <div className="relative h-48">
                                    {relatedProduct.images?.[0] ? (
                                        <Image
                                            src={relatedProduct.images[0]}
                                            alt={relatedProduct.title}
                                            fill
                                            className="object-cover group-hover:scale-105 transition-transform duration-300"
                                        />
                                    ) : (
                                        <div className="w-full h-full bg-slate-200 flex items-center justify-center">
                                            <Package className="w-12 h-12 text-slate-400" />
                                        </div>
                                    )}
                                </div>
                                <div className="p-4">
                                    <h3 className="font-semibold text-slate-900 text-sm line-clamp-2 mb-2">
                                        {relatedProduct.title}
                                    </h3>
                                    <p className="text-lg font-bold text-green-600">
                                        ₦{relatedProduct.pricingTiers[0]?.price.toLocaleString()}
                                        <span className="text-xs text-slate-500 font-normal">
                                            /{relatedProduct.unit}
                                        </span>
                                    </p>
                                </div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="text-center text-slate-600 py-12 bg-white rounded-2xl">
                        <Package className="w-16 h-16 mx-auto mb-4 text-slate-400" />
                        <p>No related products available</p>
                    </div>
                )}
            </div>


            </div>
        </div>
    );
}
