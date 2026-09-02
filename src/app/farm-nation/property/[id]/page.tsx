"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
    ArrowLeft, MapPin, Maximize, DollarSign, Calendar, Heart, Share2,
    CheckCircle, AlertCircle, Lock, Loader2, Mail, User
} from "lucide-react";
import { getPropertyByIdAction, type LandListing } from "@/app/actions/land-listings";
import { getUserTierAction } from "@/app/actions/cooperative";
import { useToast } from "@/contexts/ToastContext";

export default function PropertyDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const { data: session, status } = useSession();
    const propertyId = params.id as string;

    const [property, setProperty] = useState<LandListing | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [isFavorite, setIsFavorite] = useState(false);
    const { showToast } = useToast();

    async function loadProperty() {
        try {
            const result = await getPropertyByIdAction(propertyId);
            if (result.success && result.data) {
                setProperty(result.data);
            } else {
                setError(result.error || "Property not found");
            }
        } catch (error) {
            setError("Failed to load property details");
        }
        setLoading(false);
    }

    useEffect(() => {
        loadProperty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propertyId]);

    async function handleShare() {
        const url = window.location.href;
        if (navigator.share) {
            await navigator.share({
                title: property?.title,
                text: property?.description,
                url: url,
            });
        } else {
            navigator.clipboard.writeText(url);
            showToast("Link copied to clipboard!", "success");
        }
    };


    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-green-600 mx-auto mb-4" />
                    <p className="text-slate-600">Loading property details...</p>
                </div>
            </div>
        );
    }

    if (error || !property) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
                <div className="max-w-md text-center">
                    <AlertCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Property Not Found</h1>
                    <p className="text-slate-600 mb-6">{error || "This property may have been removed."}</p>
                    <button
                        onClick={() => router.push("/farm-nation/properties")}
                        className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl transition"
                    >
                        Back to Marketplace
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 pb-12">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 p-4">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <button
                        onClick={() => router.push("/farm-nation/properties")}
                        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Back to Marketplace
                    </button>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsFavorite(!isFavorite)}
                            className={`p-2 rounded-lg transition ${isFavorite
                                ? "bg-red-100 text-red-600"
                                : "bg-slate-100 text-slate-600 hover:text-red-600"
                                }`}
                        >
                            <Heart className={`w-5 h-5 ${isFavorite ? "fill-current" : ""}`} />
                        </button>
                        <button
                            onClick={handleShare}
                            className="p-2 bg-slate-100 text-slate-600 hover:text-blue-600 rounded-lg transition"
                        >
                            <Share2 className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Image Gallery */}
                        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
                            {property.images && property.images.length > 0 ? (
                                <div className="relative">
                                    <div className="aspect-video relative bg-slate-200">
                                        <Image
                                            src={property.images[currentImageIndex] || "/placeholder-land.jpg"}
                                            alt={property.title}
                                            fill
                                            className="object-cover"
                                            priority
                                            sizes="(max-width: 1024px) 100vw, 66vw"
                                        />
                                    </div>
                                    {property.images.length > 1 && (
                                        <>
                                            <button
                                                onClick={() =>
                                                    setCurrentImageIndex((currentImageIndex - 1 + property.images.length) % property.images.length)
                                                }
                                                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/90 text-slate-900 rounded-full hover:bg-white transition"
                                            >
                                                ←
                                            </button>
                                            <button
                                                onClick={() =>
                                                    setCurrentImageIndex((currentImageIndex + 1) % property.images.length)
                                                }
                                                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/90 text-slate-900 rounded-full hover:bg-white transition"
                                            >
                                                →
                                            </button>
                                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                                                {property.images.map((_, index) => (
                                                    <button
                                                        key={index}
                                                        onClick={() => setCurrentImageIndex(index)}
                                                        className={`w-2 h-2 rounded-full transition ${index === currentImageIndex
                                                            ? "bg-white w-8"
                                                            : "bg-white/50 hover:bg-white/75"
                                                            }`}
                                                    />
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <div className="aspect-video bg-slate-200 flex items-center justify-center">
                                    <p className="text-slate-500">No images available</p>
                                </div>
                            )}

                            {/* Thumbnail Grid */}
                            {property.images && property.images.length > 1 && (
                                <div className="grid grid-cols-6 gap-2 p-4">
                                    {property.images.slice(0, 6).map((img, index) => (
                                        <button
                                            key={index}
                                            onClick={() => setCurrentImageIndex(index)}
                                            className={`aspect-video relative rounded-lg overflow-hidden border-2 transition ${index === currentImageIndex
                                                ? "border-green-600"
                                                : "border-transparent hover:border-green-400"
                                                }`}
                                        >
                                            <Image src={img} alt={`Thumbnail ${index + 1}`} fill className="object-cover" sizes="(max-width: 768px) 16vw, 120px" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Property Details */}
                        <div className="bg-white rounded-2xl p-6 shadow-sm">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-sm uppercase tracking-wider ${
                                            (property.documents && property.documents.length > 0)
                                                ? "bg-emerald-100 text-emerald-800"
                                                : "bg-red-100 text-red-800"
                                        }`}>
                                            {(property.documents && property.documents.length > 0) ? "Verified Land" : "Unverified Land"}
                                        </span>
                                    </div>
                                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                                        {property.title}
                                    </h1>
                                    <div className="flex items-center gap-2 text-slate-600">
                                        <MapPin className="w-4 h-4" />
                                        <span>
                                            {typeof property.location === "object" && property.location
                                                ? `${property.location.address || ""}, ${property.location.lga || ""}, ${property.location.state || ""}`.trim().replace(/^,\s*/, "").replace(/,\s*,/g, ",").replace(/,\s*$/, "")
                                                : (property.location as any || "Nigeria")}
                                        </span>
                                    </div>
                                </div>
                                <div className={`px-4 py-2 rounded-lg font-semibold ${
                                    property.status === 'sold' ? 'bg-red-100 text-red-700' :
                                    property.status === 'leased' ? 'bg-blue-100 text-blue-700' :
                                    property.availableForRent ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-green-100 text-green-700'
                                }`}>
                                    {property.status === 'sold' ? 'Sold' :
                                     property.status === 'leased' ? 'Leased' :
                                     property.availableForRent ? 'Leasing / Renting' :
                                     'For Sale'}
                                </div>
                            </div>

                            {/* Key Stats */}
                            <div className="grid grid-cols-3 gap-4 mb-6">
                                <div className="bg-slate-50 rounded-xl p-4">
                                    <div className="flex items-center gap-2 text-green-600 mb-2">
                                        <DollarSign className="w-5 h-5" />
                                        <span className="text-sm font-semibold">Price</span>
                                    </div>
                                    <p className="text-2xl font-bold text-slate-900">
                                        ₦{Number(property.price || 0).toLocaleString()}
                                    </p>
                                </div>

                                <div className="bg-slate-50 rounded-xl p-4">
                                    <div className="flex items-center gap-2 text-blue-600 mb-2">
                                        <Maximize className="w-5 h-5" />
                                        <span className="text-sm font-semibold">Size</span>
                                    </div>
                                    <p className="text-2xl font-bold text-slate-900">
                                        {property.size} <span className="text-lg">ha</span>
                                    </p>
                                </div>

                                <div className="bg-slate-50 rounded-xl p-4">
                                    <div className="flex items-center gap-2 text-purple-600 mb-2">
                                        <Calendar className="w-5 h-5" />
                                        <span className="text-sm font-semibold">Category</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                        {Array.isArray(property.category) ? (
                                            property.category.map((cat, idx) => (
                                                <span key={idx} className="px-2.5 py-1 bg-purple-100 text-purple-800 text-xs font-bold rounded-lg capitalize">
                                                    {cat}
                                                </span>
                                            ))
                                        ) : property.category ? (
                                            <span className="px-2.5 py-1 bg-purple-100 text-purple-800 text-xs font-bold rounded-lg capitalize">
                                                {property.category}
                                            </span>
                                        ) : (
                                            <span className="px-2.5 py-1 bg-slate-100 text-slate-800 text-xs font-bold rounded-lg">
                                                Farmland
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Description */}
                            <div className="mb-6">
                                <h2 className="text-xl font-bold text-slate-900 mb-3">Description</h2>
                                <p className="text-slate-600 leading-relaxed whitespace-pre-line">
                                    {property.description}
                                </p>
                            </div>

                            {/* Features */}
                            <div className="grid grid-cols-2 gap-4">
                                {property.soilType && (
                                    <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg">
                                        <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                                        <span className="text-sm font-medium text-slate-900">Soil: {property.soilType}</span>
                                    </div>
                                )}
                                {property.waterSource && (
                                    <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
                                        <CheckCircle className="w-5 h-5 text-blue-600 shrink-0" />
                                        <span className="text-sm font-medium text-slate-900">Water: {property.waterSource}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="lg:col-span-1 space-y-6">
                        {/* CTA Card */}
                        <div className="bg-white rounded-2xl p-6 shadow-sm sticky top-24">
                             <div className="mb-6">
                                  <p className="text-3xl font-bold text-slate-900 mb-1">
                                      ₦{Number(property.price || 0).toLocaleString()}
                                  </p>
                                 <p className="text-sm text-slate-500">
                                     {property.availableForRent ? "Lease/Rental price" : "Purchase price"}
                                 </p>
                             </div>

                            {property.status === "verified" ? (
                                <div className="space-y-3">
                                    <button
                                        onClick={() => {
                                            if (status === "unauthenticated") {
                                                router.push(`/auth/register?callbackUrl=/farm-nation/checkout/${propertyId}`);
                                                return;
                                            }
                                            router.push(`/farm-nation/checkout/${propertyId}`);
                                        }}
                                        className="w-full px-6 py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-green-600/20"
                                    >
                                        <Lock className="w-5 h-5" />
                                        {property.availableForRent ? "Lock Lease/Rental Reservation" : "Lock Land Reservation"}
                                    </button>
                                </div>
                            ) : (
                                <div className={`p-4 border rounded-xl text-center font-bold ${
                                    property.status === "sold" ? "bg-red-50 border-red-200 text-red-800" :
                                    property.status === "leased" ? "bg-blue-50 border-blue-200 text-blue-800" :
                                    "bg-yellow-50 border-yellow-200 text-yellow-800"
                                }`}>
                                    {property.status === "sold" ? "This Land has been Sold" :
                                     property.status === "leased" ? "This Land has been Leased" :
                                     property.status === "pending_verification" ? "Verification Pending" :
                                     `Status: ${property.status}`}
                                </div>
                            )}
                        </div>

                        {/* Seller Info (Protected) */}
                        <div className="bg-white rounded-2xl p-6 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-900 mb-4">Farm Owner Information</h3>

                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <User className="w-5 h-5 text-slate-400" />
                                        <div>
                                            <p className="text-xs text-slate-500">Name</p>
                                            <p className="font-semibold text-slate-900">{property.ownerName}</p>
                                        </div>
                                    </div>
                                    {/*
                                      * #340. This printed {property.ownerEmail}.
                                      *
                                      * This page has no auth guard, so that was a land
                                      * owner's email address on a public URL — and
                                      * lib/land-visibility.ts had already listed ownerEmail
                                      * as internal, for the reason its header gives: the
                                      * owner "has not agreed to be listed anywhere yet".
                                      * The action feeding this page simply never applied
                                      * the strip. It does now, so this row would have
                                      * rendered an empty string beside a Mail icon.
                                      *
                                      * A buyer is not stranded: the Buy button below goes
                                      * to the checkout, which is the flow this module is
                                      * built around. submitLandInquiryAction exists and is
                                      * public by design for the "ask before buying" case —
                                      * it has no UI, which is recorded as its own finding
                                      * rather than built here.
                                      */}
                                </div>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    );
}
