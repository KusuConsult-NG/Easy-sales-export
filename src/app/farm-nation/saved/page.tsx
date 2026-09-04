"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AlertCircle, ChevronLeft, Loader2, MapPin, Maximize } from "lucide-react";
import { getSavedPropertiesAction, type SavedPropertyRecord } from "@/app/actions/saved-items";
import { SaveItemButton } from "@/components/saved/SaveItemButton";

/**
 * The properties somebody has saved — #105.
 *
 * The heart on a property page was useState, so there was nothing to list. It
 * writes now, and this is where the list is; the browse screen links here.
 *
 * A listing that has been sold, withdrawn or put back into the review queue is
 * shown as unavailable rather than dropped — the row is still the member's, and
 * quietly shortening their list is #307's shape.
 */
export default function SavedPropertiesPage() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [properties, setProperties] = useState<SavedPropertyRecord[]>([]);

    useEffect(() => {
        async function load() {
            const result = await getSavedPropertiesAction();
            if (result.success && result.data) {
                setProperties(result.data.properties);
                setError(null);
            } else {
                setError(result.error || "Could not load your saved properties");
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
                        href="/farm-nation/properties"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition mb-2"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Back to Browse
                    </Link>
                    <h1 className="text-3xl font-bold text-slate-900">Saved Properties</h1>
                    <p className="text-slate-600 mt-1">
                        Land you have kept, so you can find it again.
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

                {!error && properties.length === 0 && (
                    <div className="bg-white rounded-xl p-10 text-center border border-slate-200">
                        <h2 className="font-semibold text-slate-900">Nothing saved yet</h2>
                        <p className="text-sm text-slate-500 mb-4">
                            Open a property and use the heart to keep it here.
                        </p>
                        <Link
                            href="/farm-nation/properties"
                            className="text-green-600 font-semibold hover:underline"
                        >
                            Browse Farms
                        </Link>
                    </div>
                )}

                <div className="space-y-4">
                    {properties.map((row) => (
                        <div
                            key={row.targetId}
                            className="bg-white rounded-xl p-5 border border-slate-200 flex items-center gap-4"
                        >
                            <div className="w-20 h-16 rounded-xl bg-slate-100 overflow-hidden shrink-0 relative">
                                {row.listing?.image && (
                                    <Image
                                        src={row.listing.image}
                                        alt=""
                                        fill
                                        className="object-cover"
                                        sizes="80px"
                                    />
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                {row.listing ? (
                                    <>
                                        <Link
                                            href={`/farm-nation/property/${row.targetId}`}
                                            className="font-bold text-slate-900 hover:text-green-700 transition"
                                        >
                                            {row.listing.title}
                                        </Link>
                                        <div className="flex items-center gap-4 text-sm text-slate-500 mt-1 flex-wrap">
                                            {row.listing.location && (
                                                <span className="flex items-center gap-1.5">
                                                    <MapPin className="w-3.5 h-3.5" />
                                                    {row.listing.location}
                                                </span>
                                            )}
                                            {row.listing.size !== "" && (
                                                <span className="flex items-center gap-1.5">
                                                    <Maximize className="w-3.5 h-3.5" />
                                                    {row.listing.size} ha
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-green-700 font-bold mt-1">
                                            ₦{row.listing.price.toLocaleString()}
                                        </p>
                                    </>
                                ) : (
                                    <p className="text-sm text-slate-500">
                                        This listing is no longer available.
                                    </p>
                                )}
                            </div>

                            <SaveItemButton itemType="land_listing" targetId={row.targetId} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
