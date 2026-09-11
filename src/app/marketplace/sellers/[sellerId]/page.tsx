import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { BadgeCheck, Store, MapPin, Star, Package, ArrowLeft, ShoppingCart } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { SaveItemButton } from "@/components/saved/SaveItemButton";
import { firstImageSrc } from "@/lib/first-image";

interface SellerPageProps {
    params: Promise<{ sellerId: string }>;
}

/**
 *   #621 A SELLER'S SHOP SAID "NOT FOUND" WHENEVER THE READ FAILED.
 *
 *        The endpoint behind this page is careful: 404 when the seller does not
 *        exist, 400 for a bad id, 500 when something broke. This page collapsed
 *        all three into `return null`, and `null` meant `notFound()`.
 *
 *        So a transient failure took a real seller's public storefront off the
 *        air with "This page could not be found" — and because notFound() sets
 *        an HTTP 404, a crawler following that link is told the shop is
 *        permanently GONE, while a 5xx would simply be retried. The shop can be
 *        de-indexed by a database blip.
 *
 *        #514 SETTLED THIS EXACT PRINCIPLE ON THIS EXACT PAGE — "an absence is
 *        not a fact. Where it is unknown this page says so" — for `products`
 *        and `reviews`, whose nulls it carefully keeps apart from empty lists.
 *        It did not apply it to the read of the SELLER, one level up. The fix
 *        reached the inner doors and not the outer one.
 */
type SellerFetch =
    | { status: "ok"; data: any }
    | { status: "not_found" }
    | { status: "unreadable"; reason: string };

async function fetchSellerData(sellerId: string): Promise<SellerFetch> {
    const port = process.env.PORT || "3000";
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        const res = await fetch(`${baseUrl}/api/marketplace/sellers/${sellerId}`, {
            next: { revalidate: 60 },
        });
        //   The ONLY status that means "there is no such seller".
        if (res.status === 404) return { status: "not_found" };
        if (!res.ok) return { status: "unreadable", reason: `HTTP ${res.status}` };
        return { status: "ok", data: await res.json() };
    } catch (error) {
        //   A refused connection or a timeout is the least knowable outcome of
        //   all, and was previously the one that propagated as a raw crash.
        return { status: "unreadable", reason: error instanceof Error ? error.message : "request failed" };
    }
}

export async function generateMetadata({ params }: SellerPageProps) {
    const { sellerId } = await params;
    const result = await fetchSellerData(sellerId);

    //   Metadata must never throw — a failure here would take down a page that
    //   is otherwise able to render. It reports the same three outcomes.
    if (result.status === "not_found") return { title: "Seller not found | Easy Sales Export" };
    if (result.status === "unreadable") return { title: "Seller unavailable | Easy Sales Export" };

    const { data } = result;
    return {
        title: `${data.seller.businessName} | Easy Sales Export`,
        description: data.seller.businessDescription || `Browse products from ${data.seller.businessName} on Easy Sales Export.`,
    };
}

export default async function SellerStorefrontPage({ params }: SellerPageProps) {
    const { sellerId } = await params;
    const result = await fetchSellerData(sellerId);

    //   A real answer: this seller does not exist. 404 is correct and permanent.
    if (result.status === "not_found") notFound();

    if (result.status === "unreadable") {
        /*
         *   THROWN, NOT RENDERED, AND THE HTTP STATUS IS THE REASON.
         *
         *   marketplace/error.tsx catches this and shows the module's own error
         *   screen, and Next serves it as a 5xx — which is what a shop that
         *   might be back in a minute must return. A friendly panel rendered at
         *   200 would tell a crawler the page is fine and this IS the content;
         *   notFound() tells it the shop is gone. Both are lies about a seller
         *   who is trading.
         */
        throw new Error(`Seller storefront could not be read (${result.reason})`);
    }

    const data = result.data;
    const { seller } = data;

    /**
     *   #514. `products` and `reviews` are null when the endpoint COULD NOT READ
     *   them, and [] / {0,0} when it read them and there was nothing there. They
     *   used to be the same value, so a failed query rendered as "No products
     *   listed yet." and silently deleted the seller's star rating.
     *
     *   An absence is not a fact. Where it is unknown this page says so.
     */
    const productsUnavailable = data.products === null;
    const reviewsUnavailable = data.reviews === null;
    const products: any[] = data.products ?? [];
    const reviews = data.reviews ?? { avgRating: 0, reviewCount: 0 };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Hero Banner */}
            <div className="bg-linear-to-br from-emerald-700 via-emerald-600 to-teal-600 text-white">
                <div className="max-w-6xl mx-auto px-4 py-10">
                    <Link
                        href="/marketplace"
                        className="inline-flex items-center gap-2 text-white/70 hover:text-white mb-6 transition text-sm"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Marketplace
                    </Link>

                    <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                        {/* Logo */}
                        <div className="w-24 h-24 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center overflow-hidden shrink-0 border-2 border-white/30">
                            {seller.logoUrl ? (
                                <Image
                                    src={seller.logoUrl}
                                    alt={`${seller.businessName} logo`}
                                    width={96}
                                    height={96}
                                    className="object-cover w-full h-full"
                                />
                            ) : (
                                <Store className="w-10 h-10 text-white/80" />
                            )}
                        </div>

                        {/* Info */}
                        <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                                <h1 className="text-3xl font-bold">{seller.businessName}</h1>
                                {seller.isVerifiedBadge && (
                                    <span className="flex items-center gap-1 bg-amber-400 text-amber-900 px-3 py-1 rounded-full text-sm font-bold">
                                        <BadgeCheck className="w-4 h-4" />
                                        Verified Seller
                                    </span>
                                )}
                            </div>

                            {seller.state && (
                                <p className="flex items-center gap-2 text-white/80 text-sm mb-2">
                                    <MapPin className="w-4 h-4" />
                                    {seller.state}
                                </p>
                            )}

                            {reviewsUnavailable ? (
                                <p className="text-white/70 text-sm">Ratings are temporarily unavailable.</p>
                            ) : reviews.reviewCount > 0 && (
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1 text-amber-300">
                                        {[1, 2, 3, 4, 5].map((star) => (
                                            <Star
                                                key={star}
                                                className={`w-4 h-4 ${star <= Math.round(reviews.avgRating) ? "fill-current" : "opacity-30"}`}
                                            />
                                        ))}
                                    </div>
                                    <span className="text-white/80 text-sm">
                                        {reviews.avgRating} ({reviews.reviewCount} review{reviews.reviewCount !== 1 ? "s" : ""})
                                    </span>
                                </div>
                            )}

                            {seller.businessDescription && (
                                <p className="mt-3 text-white/90 max-w-2xl leading-relaxed">
                                    {seller.businessDescription}
                                </p>
                            )}
                        </div>

                        {/* Stats */}
                        <div className="flex gap-4 md:flex-col md:text-right">
                            {/*
                              * #105. The buyer dashboard has always shown a
                              * "Saved Sellers" count, read from a field nothing
                              * wrote — and there was no control anywhere in the
                              * app through which a seller could be saved. This
                              * is it.
                              */}
                            <div className="md:flex md:justify-end">
                                <SaveItemButton
                                    itemType="marketplace_seller"
                                    targetId={sellerId}
                                    variant="labelled"
                                />
                            </div>
                            <div className="bg-white/10 backdrop-blur rounded-xl px-4 py-3 text-center">
                                <p className="text-2xl font-bold">{productsUnavailable ? "—" : products.length}</p>
                                <p className="text-white/70 text-xs">Products</p>
                            </div>
                            {reviews.reviewCount > 0 && (
                                <div className="bg-white/10 backdrop-blur rounded-xl px-4 py-3 text-center">
                                    <p className="text-2xl font-bold">{reviews.avgRating}★</p>
                                    <p className="text-white/70 text-xs">Rating</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Products Grid */}
            <div className="max-w-6xl mx-auto px-4 py-10">
                <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                    <Package className="w-6 h-6 text-emerald-600" />
                    Product Listings
                    {!productsUnavailable && (
                        <span className="ml-2 text-sm font-normal text-slate-500">({products.length} active)</span>
                    )}
                </h2>

                {productsUnavailable ? (
                    <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
                        <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-500 text-lg">We couldn&apos;t load this seller&apos;s products.</p>
                        <p className="text-slate-400 text-sm mt-1">This is a temporary problem on our side — please refresh in a moment.</p>
                    </div>
                ) : products.length === 0 ? (
                    <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
                        <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-500 text-lg">No products listed yet.</p>
                        <p className="text-slate-400 text-sm mt-1">Check back soon!</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                        {products.map((product: any) => (
                            <Link
                                key={product.id}
                                href={`/marketplace/products/${product.id}`}
                                className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-slate-100 group"
                            >
                                {/* Image */}
                                <div className="h-44 bg-slate-100 overflow-hidden relative">
                                    {firstImageSrc(product.images) ? (
                                        <Image
                                            src={firstImageSrc(product.images)!}
                                            alt={product.title}
                                            fill
                                            className="object-cover group-hover:scale-105 transition-transform duration-300"
                                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                            <Package className="w-12 h-12 text-slate-300" />
                                        </div>
                                    )}
                                </div>

                                {/* Details */}
                                <div className="p-4">
                                    <p className="text-xs text-emerald-600 font-semibold uppercase tracking-wide mb-1">
                                        {product.category}
                                    </p>
                                    <h3 className="font-bold text-slate-900 mb-1 line-clamp-1 group-hover:text-emerald-700 transition">
                                        {product.title}
                                    </h3>
                                    <div className="flex items-center justify-between mt-2">
                                        <p className="text-lg font-bold text-emerald-700">
                                            {formatCurrency(product.price)}
                                            {product.unit && (
                                                <span className="text-xs text-slate-400 font-normal ml-1">
                                                    / {product.unit}
                                                </span>
                                            )}
                                        </p>
                                        <span className="p-2 rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition">
                                            <ShoppingCart className="w-4 h-4" />
                                        </span>
                                    </div>
                                    {product.stock !== null && (
                                        <p className="text-xs text-slate-400 mt-1">
                                            {product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}
                                        </p>
                                    )}
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
