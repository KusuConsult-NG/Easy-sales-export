"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { BadgeCheck, ChevronLeft, Loader2, MapPin, Store, AlertCircle } from "lucide-react";
import { getSavedSellersAction, type SavedSellerRecord } from "@/app/actions/saved-items";
import { SaveItemButton } from "@/components/saved/SaveItemButton";

/**
 * The buyer's saved sellers — #105.
 *
 * The dashboard displayed a "Saved Sellers" count and there was nowhere to go
 * from it and nowhere in the app to save a seller from. A count with no list
 * behind it is #362's shape: a screen announcing something the product cannot
 * deliver. The tile links here now, and the seller storefront carries the
 * control that puts a seller in this list.
 *
 * A SELLER WHOSE PROFILE CANNOT BE READ IS SHOWN AS SUCH, NOT DROPPED. #307's
 * lesson: a list that failed to load must not look like an empty one. The row
 * is still the buyer's, and it still un-saves.
 */
export default function SavedSellersPage() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sellers, setSellers] = useState<SavedSellerRecord[]>([]);

    useEffect(() => {
        async function load() {
            const result = await getSavedSellersAction();
            if (result.success && result.data) {
                setSellers(result.data.sellers);
                setError(null);
            } else {
                setError(result.error || "Could not load your saved sellers");
            }
            setLoading(false);
        }
        load();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-8 py-6">
                    <Link
                        href="/marketplace/buyer/dashboard"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition mb-2"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Back to Dashboard
                    </Link>
                    <h1 className="text-3xl font-bold text-slate-900">Saved Sellers</h1>
                    <p className="text-slate-600 mt-1">
                        Sellers you have kept, so you can find them again.
                    </p>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-8 py-8">
                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {!error && sellers.length === 0 && (
                    <div className="bg-white rounded-xl p-10 text-center border border-slate-200">
                        <Store className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <h2 className="font-semibold text-slate-900">Nothing saved yet</h2>
                        <p className="text-sm text-slate-500 mb-4">
                            Open a seller&apos;s store and use Save to keep them here.
                        </p>
                        <Link
                            href="/marketplace/products"
                            className="text-green-600 font-semibold hover:underline"
                        >
                            Browse Marketplace
                        </Link>
                    </div>
                )}

                <div className="space-y-4">
                    {sellers.map((row) => (
                        <div
                            key={row.targetId}
                            className="bg-white rounded-xl p-5 border border-slate-200 flex items-center gap-4"
                        >
                            <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                                {row.seller?.logoUrl ? (
                                    <Image
                                        src={row.seller.logoUrl}
                                        alt=""
                                        width={56}
                                        height={56}
                                        className="object-cover w-full h-full"
                                    />
                                ) : (
                                    <Store className="w-6 h-6 text-slate-400" />
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                {row.seller ? (
                                    <>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <Link
                                                href={`/marketplace/sellers/${row.targetId}`}
                                                className="font-bold text-slate-900 hover:text-green-700 transition truncate"
                                            >
                                                {row.seller.businessName || "Unnamed seller"}
                                            </Link>
                                            {row.seller.isVerifiedBadge && (
                                                <span className="flex items-center gap-1 bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-[11px] font-bold">
                                                    <BadgeCheck className="w-3 h-3" />
                                                    Verified
                                                </span>
                                            )}
                                        </div>
                                        {row.seller.state && (
                                            <p className="flex items-center gap-1.5 text-sm text-slate-500 mt-1">
                                                <MapPin className="w-3.5 h-3.5" />
                                                {row.seller.state}
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-sm text-slate-500">
                                        This seller&apos;s store is not available right now.
                                    </p>
                                )}
                            </div>

                            <SaveItemButton
                                itemType="marketplace_seller"
                                targetId={row.targetId}
                                variant="labelled"
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
