"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
    ArrowLeft, MapPin, Maximize, DollarSign, Calendar, Heart, Share2,
    CheckCircle, AlertCircle, Lock, Loader2, Phone, Mail, User
} from "lucide-react";
import { getPropertyByIdAction, type Property } from "@/app/actions/farm-nation";
import { getUserTierAction } from "@/app/actions/cooperative";

export default function PropertyDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const { data: session, status } = useSession();
    const propertyId = params.id as string;

    const [property, setProperty] = useState<Property | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [userTier, setUserTier] = useState<"Basic" | "Premium" | null>(null);
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [isFavorite, setIsFavorite] = useState(false);

    useEffect(() => {
        loadProperty();
        if (status === "authenticated") {
            getUserTierAction().then(({ tier }) => setUserTier(tier));
        }
    }, [propertyId, status]);

    const loadProperty = async () => {
        setLoading(true);
        setError(null);

        const result = await getPropertyByIdAction(propertyId);

        if (result.success && result.property) {
            setProperty(result.property);
        } else {
            setError(result.error || "Property not found");
        }

        setLoading(false);
    };

    const handleExpressInterest = () => {
        if (status !== "authenticated") {
            router.push("/login");
            return;
        }

        if (userTier !== "Premium") {
            setShowUpgradeModal(true);
            return;
        }

        router.push(`/farm-nation/checkout/${propertyId}`);
    };

    const handleShare = async () => {
        const url = window.location.href;
        if (navigator.share) {
            await navigator.share({
                title: property?.name,
                text: property?.description,
                url: url,
            });
        } else {
            navigator.clipboard.writeText(url);
            alert("Link copied to clipboard!");
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-green-600 mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">Loading property details...</p>
                </div>
            </div>
        );
    }

    if (error || !property) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-8">
                <div className="max-w-md text-center">
                    <AlertCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Property Not Found</h1>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">{error}</p>
                    <button
                        onClick={() => router.push("/farm-nation")}
                        className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl transition"
                    >
                        Back to Marketplace
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-12">
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <button
                        onClick={() => router.push("/farm-nation")}
                        className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Back to Marketplace
                    </button>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsFavorite(!isFavorite)}
                            className={`p-2 rounded-lg transition ${isFavorite
                                    ? "bg-red-100 dark:bg-red-900/20 text-red-600"
                                    : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:text-red-600"
                                }`}
                        >
                            <Heart className={`w-5 h-5 ${isFavorite ? "fill-current" : ""}`} />
                        </button>
                        <button
                            onClick={handleShare}
                            className="p-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:text-blue-600 rounded-lg transition"
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
                        <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden elevation-2">
                            {property.images && property.images.length > 0 ? (
                                <div className="relative">
                                    <div className="aspect-video relative bg-slate-200 dark:bg-slate-700">
                                        <Image
                                            src={property.images[currentImageIndex] || "/placeholder-land.jpg"}
                                            alt={property.name}
                                            fill
                                            className="object-cover"
                                        />
                                    </div>
                                    {property.images.length > 1 && (
                                        <>
                                            <button
                                                onClick={() =>
                                                    setCurrentImageIndex((currentImageIndex - 1 + property.images.length) % property.images.length)
                                                }
                                                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/90 dark:bg-slate-800/90 text-slate-900 dark:text-white rounded-full hover:bg-white dark:hover:bg-slate-800 transition"
                                            >
                                                ←
                                            </button>
                                            <button
                                                onClick={() =>
                                                    setCurrentImageIndex((currentImageIndex + 1) % property.images.length)
                                                }
                                                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/90 dark:bg-slate-800/90 text-slate-900 dark:text-white rounded-full hover:bg-white dark:hover:bg-slate-800 transition"
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
                                <div className="aspect-video bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
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
                                            <Image src={img} alt={`Thumbnail ${index + 1}`} fill className="object-cover" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Property Details */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                                        {property.name}
                                    </h1>
                                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                                        <MapPin className="w-4 h-4" />
                                        <span>{property.location}, {property.lga}, {property.state}</span>
                                    </div>
                                </div>
                                <div className={`px-4 py-2 rounded-lg font-semibold ${property.type === "sale"
                                        ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                                        : "bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                                    }`}>
                                    For {property.type === "sale" ? "Sale" : "Lease"}
                                </div>
                            </div>

                            {/* Key Stats */}
                            <div className="grid grid-cols-3 gap-4 mb-6">
                                <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4">
                                    <div className="flex items-center gap-2 text-green-600 mb-2">
                                        <DollarSign className="w-5 h-5" />
                                        <span className="text-sm font-semibold">Price</span>
                                    </div>
                                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                                        ₦{property.price.toLocaleString()}
                                    </p>
                                    {property.type === "lease" && property.leaseDuration && (
                                        <p className="text-xs text-slate-500 mt-1">per year ({property.leaseDuration} months)</p>
                                    )}
                                </div>

                                <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4">
                                    <div className="flex items-center gap-2 text-blue-600 mb-2">
                                        <Maximize className="w-5 h-5" />
                                        <span className="text-sm font-semibold">Size</span>
                                    </div>
                                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                                        {property.size} <span className="text-lg">ha</span>
                                    </p>
                                    <p className="text-xs text-slate-500 mt-1">hectares</p>
                                </div>

                                <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4">
                                    <div className="flex items-center gap-2 text-purple-600 mb-2">
                                        <Calendar className="w-5 h-5" />
                                        <span className="text-sm font-semibold">Category</span>
                                    </div>
                                    <p className="text-lg font-bold text-slate-900 dark:text-white capitalize">
                                        {property.category}
                                    </p>
                                    <p className="text-xs text-slate-500 mt-1">{property.viewCount} views</p>
                                </div>
                            </div>

                            {/* Description */}
                            <div className="mb-6">
                                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-3">Description</h2>
                                <p className="text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-line">
                                    {property.description}
                                </p>
                            </div>

                            {/* Features */}
                            {property.features && property.features.length > 0 && (
                                <div>
                                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-3">Features & Amenities</h2>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        {property.features.map((feature, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg"
                                            >
                                                <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                                                <span className="text-sm font-medium text-slate-900 dark:text-white">{feature}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="lg:col-span-1 space-y-6">
                        {/* CTA Card */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 sticky top-24">
                            <div className="mb-6">
                                <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                                    ₦{property.price.toLocaleString()}
                                </p>
                                <p className="text-sm text-slate-500">
                                    {property.type === "lease" ? "Annual lease price" : "Purchase price"}
                                </p>
                            </div>

                            {property.status === "available" ? (
                                <button
                                    onClick={handleExpressInterest}
                                    className="w-full px-6 py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition flex items-center justify-center gap-2"
                                >
                                    {userTier === "Premium" ? (
                                        "Express Interest"
                                    ) : (
                                        <>
                                            <Lock className="w-5 h-5" />
                                            Upgrade to Purchase
                                        </>
                                    )}
                                </button>
                            ) : (
                                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
                                    <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 capitalize">
                                        {property.status === "pending" ? "Sale Pending" : `Already ${property.status}`}
                                    </p>
                                </div>
                            )}

                            {userTier !== "Premium" && (
                                <p className="text-xs text-center text-slate-500 mt-3">
                                    Premium membership required to purchase properties
                                </p>
                            )}
                        </div>

                        {/* Seller Info */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Seller Information</h3>

                            {userTier === "Premium" ? (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <User className="w-5 h-5 text-slate-400" />
                                        <div>
                                            <p className="text-xs text-slate-500">Name</p>
                                            <p className="font-semibold text-slate-900 dark:text-white">{property.ownerName}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Mail className="w-5 h-5 text-slate-400" />
                                        <div>
                                            <p className="text-xs text-slate-500">Email</p>
                                            <p className="font-semibold text-slate-900 dark:text-white">{property.ownerEmail}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Phone className="w-5 h-5 text-slate-400" />
                                        <div>
                                            <p className="text-xs text-slate-500">Phone</p>
                                            <p className="font-semibold text-slate-900 dark:text-white">{property.ownerPhone}</p>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                                    <Lock className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                                    <p className="text-sm text-center text-blue-800 dark:text-blue-200">
                                        Upgrade to Premium to view seller contact information
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Verification Badge */}
                        {property.verified && (
                            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <CheckCircle className="w-5 h-5 text-green-600" />
                                    <p className="font-semibold text-green-800 dark:text-green-200">Verified Property</p>
                                </div>
                                <p className="text-xs text-green-700 dark:text-green-300">
                                    This property has been verified by our team and all documents have been reviewed.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Upgrade Modal */}
            {showUpgradeModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 max-w-md w-full">
                        <Lock className="w-16 h-16 text-blue-600 mx-auto mb-4" />
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white text-center mb-2">
                            Premium Membership Required
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400 text-center mb-6">
                            Upgrade to Premium (₦20,000 contribution) to purchase or lease properties on Farm Nation.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowUpgradeModal(false)}
                                className="flex-1 px-6 py-3 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => router.push("/cooperatives")}
                                className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
                            >
                                Upgrade Now
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
