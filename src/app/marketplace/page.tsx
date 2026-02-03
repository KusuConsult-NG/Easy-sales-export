import { ShoppingCart, PackageCheck, Truck, Shield } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function MarketplacePage() {
    // Mock product data
    const products = [
        {
            id: "1",
            name: "Premium Yam Tubers",
            description: "High-quality white yam tubers, perfect for export",
            price: 300,
            unit: "per kg",
            minOrder: 100,
            inStock: true,
            quality: "Premium",
            seller: "Farm Nation Cooperative",
            image: "/images/yam.png",
        },
        {
            id: "2",
            name: "Organic Sesame Seeds",
            description: "Certified organic sesame seeds with high oil content",
            price: 400,
            unit: "per kg",
            minOrder: 50,
            inStock: true,
            quality: "Organic",
            seller: "WAVE Women's Group",
            image: "/images/sesame.png",
        },
        {
            id: "3",
            name: "Dried Hibiscus Flowers",
            description: "Premium quality dried hibiscus (zobo) for beverages",
            price: 350,
            unit: "per kg",
            minOrder: 75,
            inStock: true,
            quality: "Standard",
            seller: "Northern Agro Coop",
            image: "/images/hibiscus.png",
        },
    ];

    const getBadgeColor = (quality: string) => {
        switch (quality) {
            case "Premium":
                return "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400";
            case "Organic":
                return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400";
            default:
                return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400";
        }
    };

    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Marketplace
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Browse and purchase premium agricultural commodities
                </p>
            </div>

            {/* Escrow Info Banner */}
            <div className="mb-8 p-6 bg-gradient-to-r from-primary/10 to-blue-600/10 border border-primary/20 rounded-2xl">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                        <Shield className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                            Escrow-Protected Purchases
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            Your payment is held securely in escrow until you confirm delivery
                            and quality. Release funds manually or they auto-release 15 days
                            after delivery confirmation.
                        </p>
                    </div>
                </div>
            </div>

            {/* Products Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                {products.map((product, index) => (
                    <div
                        key={product.id}
                        className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden elevation-3 hover-glow animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]"
                        style={{ animationDelay: `${index * 100}ms` }}
                    >
                        {/* Product Image Placeholder */}
                        <div className="h-48 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center">
                            <PackageCheck className="w-16 h-16 text-slate-400" />
                        </div>

                        {/* Product Info */}
                        <div className="p-6">
                            <div className="flex items-start justify-between mb-3">
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                    {product.name}
                                </h3>
                                <span
                                    className={`px-3 py-1 rounded-full text-xs font-bold ${getBadgeColor(
                                        product.quality
                                    )}`}
                                >
                                    {product.quality}
                                </span>
                            </div>

                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                                {product.description}
                            </p>

                            <div className="flex items-baseline gap-2 mb-4">
                                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                                    {formatCurrency(product.price)}
                                </span>
                                <span className="text-sm text-slate-500 dark:text-slate-400">
                                    {product.unit}
                                </span>
                            </div>

                            <div className="space-y-2 mb-4 text-sm">
                                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                                    <PackageCheck className="w-4 h-4" />
                                    <span>Min. Order: {product.minOrder} kg</span>
                                </div>
                                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                                    <Truck className="w-4 h-4" />
                                    <span>Seller: {product.seller}</span>
                                </div>
                            </div>

                            <button className="w-full py-3 bg-gradient-to-r from-primary to-blue-600 text-white font-semibold rounded-xl hover:scale-105 transition-transform elevation-2 flex items-center justify-center gap-2">
                                <ShoppingCart className="w-5 h-5" />
                                Add to Cart
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* How It Works Section */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                    How Marketplace Works
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div>
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                            <ShoppingCart className="w-6 h-6 text-primary" />
                        </div>
                        <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                            1. Browse & Order
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            Select products, specify quantity, and place your order. Payment
                            goes into escrow for protection.
                        </p>
                    </div>
                    <div>
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                            <Truck className="w-6 h-6 text-primary" />
                        </div>
                        <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                            2. Processing & Delivery
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            Seller processes and ships your order. Track shipment status in
                            real-time through your dashboard.
                        </p>
                    </div>
                    <div>
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                            <Shield className="w-6 h-6 text-primary" />
                        </div>
                        <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                            3. Confirm & Release
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            Verify delivery and quality. Release escrow payment or file a
                            dispute if there are issues.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
