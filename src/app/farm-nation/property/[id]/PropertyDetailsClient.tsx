"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";

//   #871 Leaflet touches `window` on import, so this cannot be server rendered —
//   the same reason the listing form loads the picker this way.
const PropertyLocationMap = dynamic(
    () => import("@/components/farm-nation/LocationPicker"),
    {
        ssr: false,
        loading: () => (
            <div className="h-64 w-full rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center">
                <p className="text-xs text-slate-500">Loading map…</p>
            </div>
        ),
    },
);
import { isPurchasable } from "@/lib/land-listing-status";
import { landLocationText } from "@/lib/land-location";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
    ArrowLeft, MapPin, Maximize, DollarSign, Calendar, Share2,
    CheckCircle, AlertCircle, Lock, Loader2, User
} from "lucide-react";
import { SaveItemButton } from "@/components/saved/SaveItemButton";
import { getPropertyByIdAction, type LandListing } from "@/app/actions/land-listings";
import { getUserTierAction } from "@/app/actions/cooperative";
import { useToast } from "@/contexts/ToastContext";
import { imageSrcOrNull, renderableImages } from "@/lib/first-image";

//   #791 A broken thumbnail must not paint its alt text over the
//   badges in the same box — see components/ui/ThumbnailImage.
import { ThumbnailImage } from "@/components/ui/ThumbnailImage";

export default function PropertyDetailsClient({ initial = null }: {
    /**  #553 The property the server already fetched. A refusal passes null, so
     *   "Property not found" is still the client's own message. */
    initial?: LandListing | null;
}) {
    const params = useParams();
    const router = useRouter();
    const { data: session, status } = useSession();
    const propertyId = params.id as string;

    const [property, setProperty] = useState<LandListing | null>(initial);
    const [loading, setLoading] = useState(initial === null);
    const [error, setError] = useState<string | null>(null);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

    /**
     *   #869 WHICH OFFER THE BUYER IS TAKING.
     *
     *   THE OWNER: "…except if the land can be for either sell or rent etc."
     *
     *   Only meaningful when a parcel is offered BOTH ways, which is the case
     *   this exists for. For every single-offer listing — all of them until a
     *   seller ticks two — it settles to that one offer below, so nothing about
     *   the existing flow changes.
     */
    const [mode, setMode] = useState<"buy" | "rent">("buy");

    const offersSale = property?.availableForSale === true;
    const offersRental = property?.availableForRent === true
        || property?.availableForLease === true;
    const bothOffered = offersSale && offersRental;

    /*
     *   A listing offered ONLY for rent must not be read as a purchase just
     *   because `mode` starts at "buy" — the toggle is not shown for it, so
     *   nothing would ever move it. Derived rather than set in an effect, so
     *   there is no render where the label and the price disagree.
     */
    const effectiveMode: "buy" | "rent" = bothOffered
        ? mode
        : (offersRental && !offersSale ? "rent" : "buy");

    /*
     *   #869 THE PRICE FOLLOWS THE OFFER. `price` is the SALE price; `rentPrice`
     *   is what the land costs for the term. A rental listing written before
     *   this has no rentPrice, so it falls back to `price` — which is exactly
     *   what it has always meant on those rows.
     */
    const offerPrice = effectiveMode === "rent"
        ? (Number(property?.rentPrice) > 0 ? property?.rentPrice : property?.price)
        : property?.price;
    const { showToast } = useToast();

    /*
     *   #875 ONE FILTERED LIST FOR THE WHOLE GALLERY.
     *
     *   This screen was a half-fix in miniature, and it is worth naming: the
     *   MAIN image already went through imageSrcOrNull, and the thumbnail strip
     *   forty lines below handed `property.images` straight to <Image>. So the
     *   rule was imported, called once, and skipped at the second site in the
     *   same component — the defect class this audit meets most often.
     *
     *   Filtering into ONE list also closes a bug the half-fix created:
     *   `currentImageIndex` indexed the RAW array while the main panel rendered
     *   a guarded value, so a listing whose first entry was unrenderable showed
     *   an empty main panel beside a strip of working thumbnails, and the
     *   arrows counted positions that could not be displayed.
     */
    const gallery = renderableImages(property?.images);

    /*
     *   #881 IS THIS MY OWN LAND? Compared against the LISTING's ownerId, which
     *   is the value both server doors compare against.
     */
    const isMine = !!session?.user?.id && session.user.id === property?.ownerId;

    /*
     *   #874 THE OFFER FORM. Held here rather than in a modal because the
     *   figure only means anything beside the price it is an offer against.
     */
    const [showOffer, setShowOffer] = useState(false);
    const [offerAmount, setOfferAmount] = useState("");
    const [offerNote, setOfferNote] = useState("");
    const [offerSending, setOfferSending] = useState(false);

    /**
     *   Send it.
     *
     *   try/catch/finally around the await: without the finally a thrown action
     *   leaves the button reading "Sending…" for ever, which is the defect
     *   #872's reply box shipped with and the reason this repo ratchets on it.
     */
    async function sendOffer() {
        setOfferSending(true);
        try {
            const { makeLandOfferAction } = await import("@/app/actions/land-offers");
            const result = await makeLandOfferAction({
                listingId: propertyId,
                offeredPrice: Number(offerAmount),
                //   A hint. The action resolves it against the listing's own
                //   flags, so naming "rent" on a sale-only parcel cannot pick
                //   the cheaper of two figures.
                mode: effectiveMode,
                message: offerNote,
            });

            if (!result.success) {
                showToast(result.error || "Could not send your offer.", "error");
                return;
            }
            showToast("Offer sent. You will see the owner's answer under My Offers.", "success");
            setShowOffer(false);
            setOfferAmount("");
            setOfferNote("");
        } catch (e) {
            showToast("An unexpected error occurred.", "error");
        } finally {
            setOfferSending(false);
        }
    }

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
        //   #553 Already supplied by the server.
        if (initial !== null) return;
        loadProperty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propertyId, initial]);

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
                        {/*
                          * #105. This was a <button> over useState(false): the
                          * heart filled on click and the state died with the
                          * component, so nothing was persisted and
                          * `favoriteCount` — which _fn_listings.ts initialises
                          * to 0 on every listing — was moved by nothing.
                          *
                          * SaveItemButton writes a saved_items row, renders
                          * what the server says rather than what the browser
                          * assumed, and steps favoriteCount in the database.
                          */}
                        <SaveItemButton itemType="land_listing" targetId={propertyId} />
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
                            {gallery.length > 0 ? (
                                <div className="relative">
                                    <div className="aspect-video relative bg-slate-200">
                                        {/*   #791 See components/ui/ThumbnailImage. */}
                                        <ThumbnailImage
                                            //   #829 — see PropertiesClient. The file named here has
                                            //   never existed; null lets ThumbnailImage's fallback run.
                                            src={gallery[currentImageIndex] ?? null}
                                            alt={property.title}
                                            className="object-cover"
                                            priority
                                            sizes="(max-width: 1024px) 100vw, 66vw"
                                            fallback={<MapPin className="w-16 h-16 text-slate-400" />}
                                        />
                                    </div>
                                    {gallery.length > 1 && (
                                        <>
                                            <button
                                                onClick={() =>
                                                    setCurrentImageIndex((currentImageIndex - 1 + gallery.length) % gallery.length)
                                                }
                                                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/90 text-slate-900 rounded-full hover:bg-white transition"
                                            >
                                                ←
                                            </button>
                                            <button
                                                onClick={() =>
                                                    setCurrentImageIndex((currentImageIndex + 1) % gallery.length)
                                                }
                                                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/90 text-slate-900 rounded-full hover:bg-white transition"
                                            >
                                                →
                                            </button>
                                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                                                {gallery.map((_, index) => (
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
                            {gallery.length > 1 && (
                                <div className="grid grid-cols-6 gap-2 p-4">
                                    {gallery.slice(0, 6).map((img, index) => (
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
                                        {/*
                                          *   #856 THE SELLER'S OWN UPLOAD MARKED THE LAND
                                          *   VERIFIED.
                                          *
                                          *   THE OWNER: "when a user upload a product, the
                                          *   user has a 'This land is verified' badge even
                                          *   before land is approved by admin."
                                          *
                                          *   This read `documents.length > 0`, and that one
                                          *   expression gave three different wrong answers
                                          *   depending on who was looking:
                                          *
                                          *     array-shaped rows   the LIVE form path stores
                                          *                         `documents: data.documentUrls`
                                          *                         (land-listings.ts:958, typed
                                          *                         `string[]`), so ANY upload
                                          *                         makes this true — verified
                                          *                         before an admin has seen it
                                          *     object-shaped rows  _fn_listings writes
                                          *                         `documents: {}`, where
                                          *                         `.length` is undefined, so
                                          *                         APPROVED land read
                                          *                         "Unverified" forever
                                          *     a buyer             land-visibility strips
                                          *                         `documents` from public
                                          *                         payloads, so it is undefined
                                          *                         and every listing read
                                          *                         "Unverified"
                                          *
                                          *   Which is why the owner saw it and a buyer did not:
                                          *   land-actions.ts:249 hands the UNSTRIPPED listing to
                                          *   a `privileged` caller, and the seller viewing her
                                          *   own land is one.
                                          *
                                          *   #340 FIXED THIS BADGE ON THE LANDING PAGE and gave
                                          *   the reason that settles it: "uploading a survey
                                          *   plan is not the same as an admin approving it. The
                                          *   status IS the verification decision." It reached
                                          *   one of the three screens that carry this badge.
                                          *
                                          *   isPurchasable() is that decision — the three
                                          *   spellings of approved-and-for-sale, from
                                          *   lib/land-listing-status, which #340 calls "the
                                          *   single place that has to change".
                                          */}
                                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-sm uppercase tracking-wider ${
                                            isPurchasable(property.status)
                                                ? "bg-emerald-100 text-emerald-800"
                                                : "bg-red-100 text-red-800"
                                        }`}>
                                            {isPurchasable(property.status) ? "Verified Land" : "Unverified Land"}
                                        </span>
                                    </div>
                                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                                        {property.title}
                                    </h1>
                                    <div className="flex items-center gap-2 text-slate-600">
                                        <MapPin className="w-4 h-4" />
                                        <span>
                                            {/* #689 One rule for four shapes — see lib/land-location.ts. */}
                                            {landLocationText(property) || "Nigeria"}
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

                            {/*
                              *   #871 WHERE THE LAND ACTUALLY IS.
                              *
                              *   THE OWNER: "where users have coordinates of latitude
                              *   and longitude, the map picks the location and display
                              *   it on the details (can this be done)."
                              *
                              *   It can, and it was not there: this page never read
                              *   `gpsCoordinates` at all. A seller who took the trouble
                              *   to place her land on the map — which #868 made possible
                              *   — showed a buyer nothing, and the buyer had a state, an
                              *   LGA and an address to go on.
                              *
                              *   The SAME component the seller placed the pin with, in
                              *   read-only mode. One map, one tile source, one teardown.
                              *
                              *   Shown only when there is a coordinate. An empty map
                              *   centred on the middle of Nigeria says "this land is
                              *   somewhere in Nigeria", which is worse than no map.
                              */}
                            {typeof property.gpsCoordinates?.latitude === "number"
                                && typeof property.gpsCoordinates?.longitude === "number" && (
                                <div className="mb-6">
                                    <h2 className="text-xl font-bold text-slate-900 mb-3">Location</h2>
                                    <PropertyLocationMap
                                        latitude={String(property.gpsCoordinates.latitude)}
                                        longitude={String(property.gpsCoordinates.longitude)}
                                        onChange={() => undefined}
                                        readOnly
                                    />
                                </div>
                            )}

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
                             {/*
                               *   #869 ONE PARCEL, POSSIBLY TWO OFFERS.
                               *
                               *   THE OWNER: "…except if the land can be for either sell or
                               *   rent etc."
                               *
                               *   This showed ONE price and labelled it off a single boolean:
                               *   `availableForRent ? "Lease/Rental price" : "Purchase price"`.
                               *   For a parcel offered BOTH ways that is not a label problem —
                               *   the buyer is shown one number and the checkout charges it
                               *   whichever way she is buying, so one of the two is charged the
                               *   wrong amount. Both offers are shown, and she picks one.
                               */}
                             <div className="mb-6">
                                  <p className="text-3xl font-bold text-slate-900 mb-1">
                                      ₦{Number(offerPrice || 0).toLocaleString()}
                                  </p>
                                 <p className="text-sm text-slate-500">
                                     {effectiveMode === "buy" ? "Purchase price" : "Lease/Rental price"}
                                 </p>

                                 {bothOffered && (
                                     <div className="mt-3 grid grid-cols-2 gap-2">
                                         {([
                                             { key: "buy", label: "Buy" },
                                             { key: "rent", label: property.availableForLease ? "Lease" : "Rent" },
                                         ] as const).map((o) => (
                                             <button
                                                 key={o.key}
                                                 type="button"
                                                 onClick={() => setMode(o.key)}
                                                 aria-pressed={effectiveMode === o.key}
                                                 className={`px-3 py-2 rounded-lg text-sm font-semibold border transition ${
                                                     effectiveMode === o.key
                                                         ? "bg-green-600 text-white border-green-600"
                                                         : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                                                 }`}
                                             >
                                                 {o.label}
                                             </button>
                                         ))}
                                     </div>
                                 )}
                                 {/*
                                   *   #861 THE TERM, shown where the price is.
                                   *
                                   *   A rental price with no duration is not a price — "₦2m"
                                   *   for a season and "₦2m" for ten years are different
                                   *   offers, and a buyer had to message the seller to find
                                   *   out which. The form collects it now; a stored field
                                   *   nothing displays is the other half of the same defect.
                                   */}
                                 {effectiveMode === "rent" && typeof property.durationValue === "number"
                                     && property.durationValue > 0 && (
                                     <p className="text-sm font-semibold text-slate-700">
                                         Term: {property.durationValue}{" "}
                                         {property.durationUnit ?? "years"}
                                     </p>
                                 )}
                             </div>

                            {/*
                              *   #881 AN OWNER WAS OFFERED THEIR OWN LAND.
                              *
                              *   THE OWNER: "why is there an option for seller to
                              *   make an offer on when the listed product belongs
                              *   to the seller."
                              *
                              *   Both doors already refuse it server-side —
                              *   farm-nation-payment returns "You cannot purchase
                              *   your own property" and makeLandOfferAction returns
                              *   "You cannot make an offer on your own property" —
                              *   so this was a reservation button and an offer form
                              *   that could only ever fail.
                              *
                              *   Replaced by what the owner of a listing actually
                              *   wants at this point: a way to edit it.
                              */}
                            {isMine ? (
                                <div className="space-y-3">
                                    <p className="text-sm text-slate-600">
                                        This is your listing.
                                    </p>
                                    <button
                                        onClick={() => router.push(`/farm-nation/edit-property/${propertyId}`)}
                                        className="w-full px-6 py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-green-600/20"
                                    >
                                        Edit this listing
                                    </button>
                                    <button
                                        onClick={() => router.push("/farm-nation/my-properties")}
                                        className="w-full px-6 py-3 border border-green-600 text-green-700 font-semibold rounded-xl transition hover:bg-green-50"
                                    >
                                        My properties
                                    </button>
                                </div>
                            ) : property.status === "verified" ? (
                                <div className="space-y-3">
                                    <button
                                        onClick={() => {
                                            if (status === "unauthenticated") {
                                                router.push(`/auth/register?callbackUrl=/farm-nation/checkout/${propertyId}`);
                                                return;
                                            }
                                            //   #869 The chosen offer travels with the buyer.
                                            //   The checkout charges what it is told, and a
                                            //   missing mode still means "buy" for every
                                            //   single-offer listing, which is all of them
                                            //   until a seller ticks two.
                                            router.push(`/farm-nation/checkout/${propertyId}?mode=${effectiveMode}`);
                                        }}
                                        className="w-full px-6 py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-green-600/20"
                                    >
                                        <Lock className="w-5 h-5" />
                                        {effectiveMode === "rent" ? "Lock Lease/Rental Reservation" : "Lock Land Reservation"}
                                    </button>

                                    {/*
                                      *   #874 THE OFFER, beside the price it is an offer
                                      *   against.
                                      *
                                      *   THE OWNER: "a buyer wants to ask for discount on
                                      *   certain product/property". Before this there was
                                      *   nothing on Farm Nation to ask WITH: the only
                                      *   buyer-to-owner channel is a land inquiry, which is a
                                      *   public intake with no account behind it and so
                                      *   cannot carry money.
                                      *
                                      *   Nothing here sets a price. The figure is a proposal
                                      *   until the OWNER accepts it, and the checkout then
                                      *   re-reads the row.
                                      */}
                                    {!showOffer ? (
                                        <button
                                            onClick={() => {
                                                if (status === "unauthenticated") {
                                                    router.push(`/auth/register?callbackUrl=/farm-nation/property/${propertyId}`);
                                                    return;
                                                }
                                                setShowOffer(true);
                                            }}
                                            className="w-full px-6 py-3 border border-green-600 text-green-700 font-semibold rounded-xl transition hover:bg-green-50"
                                        >
                                            Make an offer
                                        </button>
                                    ) : (
                                        <div className="p-4 border border-green-200 bg-green-50/60 rounded-xl space-y-3">
                                            <label className="block text-sm font-semibold text-slate-800">
                                                Your offer{effectiveMode === "rent" ? " per term" : ""}
                                            </label>
                                            <input
                                                type="number"
                                                min="1"
                                                step="any"
                                                value={offerAmount}
                                                onChange={(e) => setOfferAmount(e.target.value)}
                                                placeholder={`Listed at ₦${Number(offerPrice || 0).toLocaleString()}`}
                                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                                            />
                                            <textarea
                                                value={offerNote}
                                                onChange={(e) => setOfferNote(e.target.value)}
                                                rows={3}
                                                placeholder="Anything the owner should know (optional)"
                                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                                            />
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={sendOffer}
                                                    disabled={offerSending || offerAmount.trim() === ""}
                                                    className="grow px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition disabled:bg-slate-300"
                                                >
                                                    {offerSending ? "Sending…" : "Send offer"}
                                                </button>
                                                <button
                                                    onClick={() => setShowOffer(false)}
                                                    disabled={offerSending}
                                                    className="px-4 py-3 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-white transition"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                            <p className="text-xs text-slate-500">
                                                The owner can accept your figure, send one back, or
                                                decline. You will see their answer under My Offers.
                                            </p>
                                        </div>
                                    )}
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
