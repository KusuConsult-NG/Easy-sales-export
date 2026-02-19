"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
    ArrowLeft, MapPin, Maximize, DollarSign, Calendar, Heart, Share2,
    CheckCircle, AlertCircle, Lock, Loader2, Phone, Mail, User, Send, X
} from "lucide-react";
import { getPropertyByIdAction, submitLandInquiryAction, type LandListing } from "@/app/actions/land-listings";
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
    const [userTier, setUserTier] = useState<"Basic" | "Premium" | null>(null);
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [showInquiryModal, setShowInquiryModal] = useState(false);
    const [isFavorite, setIsFavorite] = useState(false);
    const { showToast } = useToast();

    // Inquiry State
    const [inquiryForm, setInquiryForm] = useState({
        name: "",
        email: "",
        phone: "",
        message: ""
    });
    const [submittingInquiry, setSubmittingInquiry] = useState(false);

    async function loadProperty() {
        try {
            const result = await getPropertyByIdAction(propertyId);
            if (result) {
                setProperty(result);
            } else {
                setError("Property not found");
            }
        } catch (error) {
            setError("Failed to load property details");
        }
        setLoading(false);
    }

    useEffect(() => {
        loadProperty();
    }, [propertyId]);

    useEffect(() => {
        if (status === "authenticated" && session?.user) {
            // Pre-fill inquiry form
            setInquiryForm(prev => ({
                ...prev,
                name: session.user.name || "",
                email: session.user.email || ""
            }));

            // Check tier
            try {
                getUserTierAction().then((res) => {
                    if (res && res.tier) setUserTier(res.tier as any);
                }).catch((err: any) => { console.warn("Failed to fetch user tier:", err?.message); });
            } catch (e) {
                // Tier check is non-critical; page still works without it
            }
        }
    }, [status, session]);

    const handleContactSeller = () => {
        if (status === "unauthenticated") {
            localStorage.setItem("pendingPropertyInquiry", params.id as string);
            router.push("/auth/login?callbackUrl=/farm-nation");
            return;
        }
        setShowInquiryModal(true);
    };

    const submitInquiry = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!property) return;

        setSubmittingInquiry(true);
        try {
            const result = await submitLandInquiryAction({
                listingId: property.id || "",
                listingTitle: property.title,
                listingOwnerId: property.ownerId,
                buyerName: inquiryForm.name,
                buyerEmail: inquiryForm.email,
                buyerPhone: inquiryForm.phone,
                message: inquiryForm.message,
            });

            if (result.success) {
                showToast("Inquiry Sent! The seller has been notified.", "success");
                setShowInquiryModal(false);
                setInquiryForm({ ...inquiryForm, message: "" });
            } else {
                showToast("Failed to send inquiry: " + result.error, "error");
            }
        } catch (error) {
            showToast("An error occurred while sending your inquiry.", "error");
        } finally {
            setSubmittingInquiry(false);
        }
    };

    const handleShare = async () => {
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
                                            <Image src={img} alt={`Thumbnail ${index + 1}`} fill className="object-cover" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Property Details */}
                        <div className="bg-white rounded-2xl p-6 shadow-sm">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                                        {property.title}
                                    </h1>
                                    <div className="flex items-center gap-2 text-slate-600">
                                        <MapPin className="w-4 h-4" />
                                        <span>{property.location.address}, {property.location.lga}, {property.location.state}</span>
                                    </div>
                                </div>
                                <div className="px-4 py-2 rounded-lg font-semibold bg-green-100 text-green-700">
                                    For Sale
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
                                        ₦{property.price.toLocaleString()}
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
                                    <p className="text-lg font-bold text-slate-900 capitalize">
                                        {property.category || "Farmland"}
                                    </p>
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
                                    ₦{property.price.toLocaleString()}
                                </p>
                                <p className="text-sm text-slate-500">Purchase price</p>
                            </div>

                            {property.status === "verified" ? (
                                <button
                                    onClick={handleContactSeller}
                                    className="w-full px-6 py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition flex items-center justify-center gap-2"
                                >
                                    <Mail className="w-5 h-5" />
                                    Contact Seller
                                </button>
                            ) : (
                                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                                    <p className="text-sm font-semibold text-yellow-800 capitalize">
                                        {property.status === "pending_verification" ? "Verification Pending" : `Status: ${property.status}`}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Seller Info (Protected) */}
                        <div className="bg-white rounded-2xl p-6 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-900 mb-4">Seller Information</h3>

                            {userTier === "Premium" ? (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <User className="w-5 h-5 text-slate-400" />
                                        <div>
                                            <p className="text-xs text-slate-500">Name</p>
                                            <p className="font-semibold text-slate-900">{property.ownerName}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Mail className="w-5 h-5 text-slate-400" />
                                        <div>
                                            <p className="text-xs text-slate-500">Email</p>
                                            <p className="font-semibold text-slate-900">{property.ownerEmail}</p>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer" onClick={() => setShowUpgradeModal(true)}>
                                    <Lock className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                                    <p className="text-sm text-center text-blue-800">
                                        Upgrade to Premium to view full seller contact details
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Inquiry Modal */}
            {showInquiryModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-lg w-full">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-2xl font-bold text-slate-900">Contact Seller</h2>
                            <button onClick={() => setShowInquiryModal(false)} className="p-2 hover:bg-slate-100 rounded-full">
                                <X className="w-6 h-6 text-slate-500" />
                            </button>
                        </div>

                        <form onSubmit={submitInquiry} className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-900 mb-1">Your Name</label>
                                <input
                                    type="text"
                                    value={inquiryForm.name}
                                    onChange={e => setInquiryForm({ ...inquiryForm, name: e.target.value })}
                                    required
                                    className="w-full px-4 py-2 border rounded-lg"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-1">Email</label>
                                    <input
                                        type="email"
                                        value={inquiryForm.email}
                                        onChange={e => setInquiryForm({ ...inquiryForm, email: e.target.value })}
                                        required
                                        className="w-full px-4 py-2 border rounded-lg"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-1">Phone</label>
                                    <input
                                        type="tel"
                                        value={inquiryForm.phone}
                                        onChange={e => setInquiryForm({ ...inquiryForm, phone: e.target.value })}
                                        required
                                        className="w-full px-4 py-2 border rounded-lg"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-900 mb-1">Message</label>
                                <textarea
                                    value={inquiryForm.message}
                                    onChange={e => setInquiryForm({ ...inquiryForm, message: e.target.value })}
                                    required
                                    rows={4}
                                    className="w-full px-4 py-2 border rounded-lg"
                                    placeholder="I am interested in this property..."
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={submittingInquiry}
                                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition flex items-center justify-center gap-2"
                            >
                                {submittingInquiry ? <Loader2 className="animate-spin" /> : <Send className="w-4 h-4" />}
                                Send Inquiry
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Upgrade Modal */}
            {showUpgradeModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-8 max-w-md w-full">
                        <Lock className="w-16 h-16 text-blue-600 mx-auto mb-4" />
                        <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">
                            Premium Membership Required
                        </h2>
                        <p className="text-slate-600 text-center mb-6">
                            Upgrade to Premium to view full seller contact details.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowUpgradeModal(false)}
                                className="flex-1 px-6 py-3 border border-slate-300 text-slate-900 font-semibold rounded-xl hover:bg-slate-50 transition"
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
