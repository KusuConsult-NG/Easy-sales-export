"use client";

import { useState, useEffect } from "react";
import { landLocationText } from "@/lib/land-location";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
    Plus, MapPin, DollarSign, Maximize, Eye, Edit, Trash2,
    Loader2, AlertCircle
} from "lucide-react";
import { getMyLandListings, deleteLandListing } from "@/app/actions/land-actions";
import { useToast } from "@/contexts/ToastContext";
import { firstImageSrc } from "@/lib/first-image";
import { humanise } from "@/lib/humanise";

//   #791 A broken thumbnail must not paint its alt text over the
//   badges in the same box — see components/ui/ThumbnailImage.
import { ThumbnailImage } from "@/components/ui/ThumbnailImage";

export default function MyPropertiesPage() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const { showToast } = useToast();

    const [properties, setProperties] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>("all");

    /*
     *   #886 THE OWNER: "when they click on my properties nothing is shown."
     *
     *   TWO DEFECTS, and between them they cover both readings of "nothing".
     *
     *   1. A FAILED READ WAS SHOWN AS AN EMPTY LIST. This was
     *
     *          if (result.success && result.data) setProperties(result.data);
     *
     *      with no else. `error` and `setError` were declared and the failure
     *      banner below was written and wired to them — and NOTHING EVER CALLED
     *      setError, so it was dead code guarding a branch that could not run.
     *      A refusal fell through to `properties: []` and the screen said "No
     *      Listings Found — Get started by sharing your first farm land", to a
     *      seller with nine listings. #588 swept thirty-six screens with this
     *      exact rule and #793 applied it to the forms; this screen had the
     *      banner and not the call.
     *
     *      It matters most HERE because of what the empty state then offers:
     *      "List Your Land". A seller who believes it re-lists a parcel that is
     *      already there.
     *
     *   2. THE SPINNER HAD NO EXIT. `if (!session?.user?.id) return;` returned
     *      before `setLoading(false)`, and `loading` starts true. The effect
     *      calls this on `status === "authenticated"`, which is not the same as
     *      "the session object has an id" — auth.ts's session callback sets
     *      `session.user = null` outright for a banned or revoked token, and a
     *      re-render between the two leaves the screen spinning for ever with
     *      no error, no empty state and no way out.
     */
    /*
     *   AND WHAT EACH RUN WRITES DEPENDS ONLY ON THE OUTCOME.
     *
     *   The first draft cleared `error` at the top of this function, and #620's
     *   render sweep caught it as a five-second timeout rather than a wrong
     *   screen. The effect below lists `session`, whose identity is not stable
     *   across renders, so it re-runs on every render — and a failing read then
     *   alternated `null` and the message for ever: set error, re-render,
     *   re-run, clear error, re-render, re-run.
     *
     *   Writing a value fixed by the OUTCOME makes the second run a no-op,
     *   React bails on the identical value and the renders stop. The effect's
     *   dependency is narrowed to the id as well, so this cannot be reached
     *   again through a different unstable object.
     */
    async function loadProperties() {
        if (!session?.user?.id) {
            setLoading(false);
            return;
        }

        try {
            const result = await getMyLandListings();
            if (result.success && result.data) {
                setProperties(result.data);
                setError(null);
            } else {
                //   A refusal is not an empty list, and saying so is the whole
                //   finding. The existing listings are left alone rather than
                //   blanked — a failed refresh must not erase what is on screen.
                logger.error("Failed to load properties:", result.error);
                setError(result.error || "We could not load your listings. Please try again.");
            }
        } catch (error) {
            logger.error("Failed to load properties:", error);
            setError("We could not load your listings. Please try again.");
        }
        setLoading(false);
    }

    async function handleDeleteProperty(propertyId: string, propertyName: string) {
        if (!confirm(`Are you sure you want to delete "${propertyName}"? This action cannot be undone.`)) {
            return;
        }

        try {
            const result = await deleteLandListing(propertyId);
            if (result.success) {
                showToast("Listing deleted successfully", "success");
                loadProperties();
            } else {
                showToast(result.error || "Failed to delete listing", "error");
            }
        } catch (error) {
            showToast("An error occurred while deleting listing", "error");
        }
    }

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        } else if (status === "authenticated") {
            loadProperties();
        }
    //   The ID, not the session object: useSession's return is a fresh object
    //   per call, so listing `session` re-runs this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, session?.user?.id]);

    const filteredProperties = properties.filter(prop => {
        if (filterStatus === "all") return true;
        return prop.status === filterStatus;
    });

    const stats = {
        total: properties.length,
        verified: properties.filter(p => p.status === "verified").length,
        pending: properties.filter(p => p.status === "pending_verification").length,
        rejected: properties.filter(p => p.status === "rejected").length,
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-green-600 mx-auto mb-4" />
                    <p className="text-slate-600">Loading your land listings...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-4xl font-bold text-slate-900 mb-2">My Listings</h1>
                        <p className="text-slate-600">Manage your farm land listings</p>
                    </div>
                    <button
                        onClick={() => router.push("/farm-nation/list-land")}
                        className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition flex items-center gap-2"
                    >
                        <Plus className="w-5 h-5" />
                        List New Land
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <p className="text-sm text-slate-600 mb-1">Total Listings</p>
                        <p className="text-3xl font-bold text-slate-900">{stats.total}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <p className="text-sm text-slate-600 mb-1">Verified</p>
                        <p className="text-3xl font-bold text-green-600">{stats.verified}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <p className="text-sm text-slate-600 mb-1">Pending Verification</p>
                        <p className="text-3xl font-bold text-yellow-600">{stats.pending}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <p className="text-sm text-slate-600 mb-1">Rejected</p>
                        <p className="text-3xl font-bold text-red-600">{stats.rejected}</p>
                    </div>
                </div>

                <div className="bg-white rounded-2xl p-4 mb-6 shadow-sm">
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900">Filter:</span>
                        {[
                            { value: "all", label: "All" },
                            { value: "verified", label: "Verified" },
                            { value: "pending_verification", label: "Pending" },
                            { value: "rejected", label: "Rejected" }
                        ].map(({ value, label }) => (
                            <button
                                key={value}
                                onClick={() => setFilterStatus(value)}
                                className={`px-4 py-2 rounded-lg font-medium text-sm transition ${filterStatus === value
                                    ? "bg-green-600 text-white"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="text-red-800">{error}</p>
                            {/*   #886 A way out. The complaint was that nothing is
                              *   shown; a banner with no action is still nothing
                              *   she can do. */}
                            <button
                                onClick={() => { setLoading(true); loadProperties(); }}
                                className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition"
                            >
                                Try again
                            </button>
                        </div>
                    </div>
                )}

                {/*   #886 The banner and the empty state are alternatives, not
                  *   neighbours. Rendering both says "we could not load your
                  *   listings" directly above "No Listings Found — list your
                  *   land", which is the same wrong invitation the banner was
                  *   added to prevent. */}
                {error && filteredProperties.length === 0 ? null : filteredProperties.length === 0 ? (
                    <div className="bg-white rounded-2xl p-12 text-center shadow-sm">
                        <div className="max-w-md mx-auto">
                            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <MapPin className="w-12 h-12 text-slate-400" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 mb-2">
                                {filterStatus === "all" ? "No Listings Found" : `No ${filterStatus.replace("_", " ")} Listings`}
                            </h3>
                            <p className="text-slate-600 mb-6">
                                {filterStatus === "all"
                                    ? "Get started by sharing your first farm land on the marketplace."
                                    : `You don't have any listings with status "${filterStatus.replace("_", " ")}".`}
                            </p>
                            {filterStatus === "all" && (
                                <button
                                    onClick={() => router.push("/farm-nation/list-land")}
                                    className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition"
                                >
                                    List Your Land
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredProperties.map((property) => (
                            <div
                                key={property.id}
                                className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition"
                            >
                                <div className="relative aspect-video bg-slate-200">
                                    {/*   #791 The empty case was handled; a set-but-broken
                                      *   image was not, and painted the property title
                                      *   under the badge positioned in this same box. */}
                                    <ThumbnailImage
                                        src={firstImageSrc(property.images)}
                                        alt={property.title}
                                        fallback={<MapPin className="w-12 h-12 text-slate-400" />}
                                    />

                                    <div className="absolute top-3 right-3">
                                        <span
                                            className={`px-3 py-1 rounded-lg text-xs font-bold uppercase ${
                                                property.status === "verified"
                                                ? "bg-green-600 text-white"
                                                : property.status === "pending_verification"
                                                    ? "bg-yellow-600 text-white"
                                                    : "bg-red-600 text-white"
                                                }`}
                                        >
                                            {humanise(property.status)}
                                        </span>
                                    </div>
                                </div>

                                <div className="p-5">
                                    <h3 className="text-lg font-bold text-slate-900 mb-2 line-clamp-1">
                                        {property.title}
                                    </h3>

                                    <div className="flex items-center gap-2 text-sm text-slate-600 mb-4">
                                        <MapPin className="w-4 h-4" />
                                        {/* #689 This had no copy of the defence at all and rendered ", " for
                                            a string location, which is what the Farm Nation writer stored. */}
                                        <span className="line-clamp-1">{landLocationText(property)}</span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 mb-4">
                                        <div className="bg-slate-50 rounded-lg p-3">
                                            <div className="flex items-center gap-1 text-green-600 mb-1">
                                                <DollarSign className="w-4 h-4" />
                                                <span className="text-xs font-semibold">Price</span>
                                            </div>
                                            <p className="text-sm font-bold text-slate-900">
                                                ₦{Number(property.price || 0).toLocaleString()}
                                            </p>
                                        </div>

                                        <div className="bg-slate-50 rounded-lg p-3">
                                            <div className="flex items-center gap-1 text-blue-600 mb-1">
                                                <Maximize className="w-4 h-4" />
                                                <span className="text-xs font-semibold">Size</span>
                                            </div>
                                            <p className="text-sm font-bold text-slate-900">
                                                {property.size} {property.unit || "acres"}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex gap-2 pt-4 border-t border-slate-100">
                                        <button
                                            onClick={() => router.push(`/farm-nation/property/${property.id}`)}
                                            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition flex items-center justify-center gap-2"
                                        >
                                            <Eye className="w-4 h-4" />
                                            View
                                        </button>
                                        <button
                                            onClick={() => router.push(`/farm-nation/edit-property/${property.id}`)}
                                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition"
                                            title="Edit Property"
                                        >
                                            <Edit className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteProperty(property.id, property.title)}
                                            className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg transition"
                                            title="Delete Property"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
