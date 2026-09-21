"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { landLocationText } from "@/lib/land-location";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
    ArrowLeft, ShoppingCart, Lock, AlertCircle, Loader2, CheckCircle,
    MapPin, Maximize, DollarSign, Shield, FileText, User, Mail, Phone
} from "lucide-react";
import { getPropertyByIdAction, type LandListing } from "@/app/actions/land-listings";
import { useServerSeed } from "@/hooks/useServerSeed";
import { getUserTierAction } from "@/app/actions/cooperative";
import { initializePropertyPaymentAction } from "@/app/actions/farm-nation-payment";
import { firstImageSrc } from "@/lib/first-image";

export default function CheckoutClient({ initial = null }: {
    /**
     *   #550 The RAW property result the server already fetched.
     *
     *   Raw, because the client applies the availability rule — a property whose
     *   status is not "verified" shows "no longer available" rather than a
     *   checkout form. Deciding that on the server as well would be two copies
     *   of one rule, and getting it wrong would sell an unavailable property.
     */
    initial?: Awaited<ReturnType<typeof getPropertyByIdAction>> | null;
}) {
    const params = useParams();
    const router = useRouter();
    const { data: session, status } = useSession();
    const propertyId = params.propertyId as string;

    const takeSeed = useServerSeed(initial);
    const [property, setProperty] = useState<LandListing | null>(null);

    /**
     *   #869 WHICH OFFER IS BEING PAID FOR.
     *
     *   THE OWNER: "…except if the land can be for either sell or rent etc."
     *
     *   This page charged `property.price` and labelled it off
     *   `availableForRent`. While a listing was one thing OR the other that was
     *   right; the moment a parcel is offered BOTH ways it charges one of the
     *   two buyers the wrong amount. The property page now sends the offer the
     *   buyer chose.
     *
     *   ABSENT MEANS BUY, and that is the safe default rather than a guess: a
     *   listing offered only for rent is resolved below from its own flags, and
     *   every listing written before this is offered exactly one way.
     */
    const searchParams = useSearchParams();
    const requestedMode = searchParams.get("mode") === "rent" ? "rent" : "buy";
    /*
     *   #874 AN ACCEPTED OFFER TO BE CHARGED AT.
     *
     *   AN ID OFF THE URL, and that is deliberately all it is. The server reads
     *   the row and checks it is this buyer's, on this listing, accepted,
     *   unspent and unexpired — so a pasted id cannot lower anybody's price, it
     *   can only name an agreement the OWNER already recorded. The same
     *   treatment `amount` and `mode` already get on this path.
     */
    const offerId = searchParams.get("offer") || undefined;
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [userTier, setUserTier] = useState<"Member" | null>(null);
    /**
     *   #814 — WHY CHECKOUT IS REFUSED, so the buyer can be told.
     *
     *   `null` while unknown, and one of two answers once the membership read
     *   has happened. Kept apart from `error` because neither of these is an
     *   error: one is a rule and the other is a read that did not answer, and
     *   both need a different thing said to the person.
     */
    const [membershipBlock, setMembershipBlock] =
        useState<"not-a-member" | "could-not-check" | null>(null);
    const [agreed, setAgreed] = useState(false);

    const [buyerInfo, setBuyerInfo] = useState({
        name: session?.user?.name || "",
        email: session?.user?.email || "",
        phone: "",
        purpose: "",
    });

    async function loadProperty() {
        try {
            const result = takeSeed() ?? await getPropertyByIdAction(propertyId);
            if (result.success && result.data) {
                if (result.data.status !== "verified") {
                    setError("This property is no longer available");
                } else {
                    setProperty(result.data);
                }
            } else {
                setError(result.error || "Property not found");
            }
        } catch (error) {
            setError("Failed to load property details");
        }
        setLoading(false);
    }

    useEffect(() => {
        if (status === "unauthenticated") {
            router.replace(`/auth/register?callbackUrl=/farm-nation/checkout/${propertyId}`);
        } else if (status === "authenticated") {
            /*
             *   #814 THE ONE REFUSAL ON THIS PAGE THAT SAID NOTHING.
             *
             *   This used to be `router.push(property page)` and nothing else.
             *   A buyer pressed Buy on a verified property, arrived back at the
             *   listing, and was told NOTHING — not on the way out and not when
             *   they got there. The property page does not mention membership
             *   either, so the only available reading is that the button is
             *   broken.
             *
             *   Every other refusal in this file already speaks: "This property
             *   is no longer available", "Phone number is required", "Please
             *   specify your intended use". The one that blocks the PURCHASE was
             *   the silent one.
             *
             *   AND A READ THAT DID NOT ANSWER IS NOT A PASS. `res.success ===
             *   false` fell through this block entirely, so a membership check
             *   that failed rendered the full checkout form — the buyer then
             *   fills it in and finds out at the payment step, if at all. It is
             *   its own state now, with a retry, rather than being folded into
             *   either answer.
             */
            getUserTierAction().then((res) => {
                if (res.success && res.data) {
                    const tier = res.data.tier;
                    setUserTier(tier || null);
                    setMembershipBlock(tier === "Member" ? null : "not-a-member");
                    return;
                }
                setMembershipBlock("could-not-check");
            }).catch(() => setMembershipBlock("could-not-check"));

            setBuyerInfo(prev => ({
                ...prev,
                name: session?.user?.name || "",
                email: session?.user?.email || "",
            }));

            loadProperty(); // Call loadProperty here
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propertyId, status, session, params.propertyId, router]);

    /*
     *   #869 THE OFFER, RESOLVED AGAINST THE LISTING'S OWN FLAGS.
     *
     *   The query string says what the buyer chose; the LISTING says what is
     *   actually on offer. A `?mode=rent` on a parcel that is only for sale must
     *   not become a rental — the URL is the buyer's, and a price must never be
     *   decided by one.
     *
     *   Derived, not stored in state: there is no render where the label, the
     *   figure and what is sent to Paystack can disagree.
     */
    const offersRental = property?.availableForRent === true
        || property?.availableForLease === true;
    const offersSale = property?.availableForSale === true;
    const mode: "buy" | "rent" =
        requestedMode === "rent" && offersRental ? "rent"
        : (offersRental && !offersSale ? "rent" : "buy");

    /*
     *   `price` is the SALE price; `rentPrice` is what the term costs. A rental
     *   listing written before #869 carries no rentPrice, so it falls back to
     *   `price` — which is what that field has always meant on those rows, and
     *   is the behaviour this page had before today.
     */
    const chargedPrice = mode === "rent" && Number(property?.rentPrice) > 0
        ? Number(property?.rentPrice)
        : Number(property?.price ?? 0);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!agreed) {
            setError("Please agree to the terms and conditions");
            return;
        }

        if (!buyerInfo.phone.trim()) {
            setError("Phone number is required");
            return;
        }

        if (!buyerInfo.purpose.trim()) {
            setError("Please specify your intended use for this property");
            return;
        }

        if (!property) {
            setError("Property information not available");
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            // Initialize Paystack payment
            const result = await initializePropertyPaymentAction(
                propertyId,
                property.title,
                //   #869 The price of the offer being taken, not whichever
                //   number the row happens to carry.
                chargedPrice,
                property.ownerId,
                {
                    fullName: buyerInfo.name,
                    email: buyerInfo.email,
                    phone: buyerInfo.phone,
                    purpose: buyerInfo.purpose,
                    zoningComplianceDeclarationAccepted: true
                },
                //   #869 Which offer. The server re-checks it against the
                //   listing's own flags — a mode the seller never offered is
                //   ignored there, not honoured because the URL said so.
                mode,
                //   #874 The agreed price, by reference. Never the figure.
                offerId,
            );

            if (result.success ) {
                // Redirect to Paystack for payment
                if (result.data?.authorizationUrl) {
                    window.location.href = result.data.authorizationUrl;
                } else {
                    setError("Failed to initialize payment: No authorization URL");
                    setSubmitting(false);
                }
            } else {
                setError(result.error || "Failed to initialize payment");
                setSubmitting(false);
            }
        } catch (error) {
            setError("An error occurred while processing your payment");
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-green-600 mx-auto mb-4" />
                    <p className="text-slate-600">Loading checkout...</p>
                </div>
            </div>
        );
    }

    /*
     *   #814 — BEFORE THE FORM, so it cannot be filled in by somebody who is
     *   going to be refused at the end of it.
     */
    if (membershipBlock !== null) {
        const isNotAMember = membershipBlock === "not-a-member";
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
                <div className="max-w-md text-center">
                    <AlertCircle
                        className={`w-16 h-16 mx-auto mb-4 ${isNotAMember ? "text-amber-600" : "text-red-600"}`}
                    />
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">
                        {isNotAMember
                            ? "Cooperative membership is required"
                            : "We could not check your membership"}
                    </h1>
                    <p className="text-slate-600 mb-6">
                        {isNotAMember
                            ? "Land on Farm Nation is sold to cooperative members. Join the "
                              + "cooperative and you can complete this purchase — the property "
                              + "stays where it is in the meantime."
                            : "Your membership could not be read just now, so we have not taken "
                              + "you any further. Nothing has been charged and nothing has been "
                              + "submitted. Please try again."}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        {isNotAMember ? (
                            <button
                                onClick={() => router.push("/cooperatives/onboarding")}
                                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl transition"
                            >
                                Join the cooperative
                            </button>
                        ) : (
                            <button
                                onClick={() => window.location.reload()}
                                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl transition"
                            >
                                Try again
                            </button>
                        )}
                        <button
                            onClick={() => router.push(`/farm-nation/property/${propertyId}`)}
                            className="px-6 py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl transition"
                        >
                            Back to property
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (error || !property) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
                <div className="max-w-md text-center">
                    <AlertCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Checkout Error</h1>
                    <p className="text-slate-600 mb-6">{error}</p>
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
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-6xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.push(`/farm-nation/property/${propertyId}`)}
                        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Property
                    </button>
                    <h1 className="text-4xl font-bold text-slate-900 mb-2">Checkout</h1>
                    <p className="text-slate-600">Complete your purchase request</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Form */}
                    <div className="lg:col-span-2">
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Buyer Information */}
                            <div className="bg-white rounded-2xl p-6 elevation-2">
                                <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                    <User className="w-6 h-6" />
                                    Your Information
                                </h2>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            Full Name *
                                        </label>
                                        <input
                                            type="text"
                                            value={buyerInfo.name}
                                            onChange={(e) => setBuyerInfo({ ...buyerInfo, name: e.target.value })}
                                            className="w-full px-4 py-3 border border-slate-300 bg-white text-slate-900 rounded-xl focus:ring-2 focus:ring-green-600"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            Email Address *
                                        </label>
                                        <input
                                            type="email"
                                            value={buyerInfo.email}
                                            onChange={(e) => setBuyerInfo({ ...buyerInfo, email: e.target.value })}
                                            className="w-full px-4 py-3 border border-slate-300 bg-white text-slate-900 rounded-xl focus:ring-2 focus:ring-green-600"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            Phone Number *
                                        </label>
                                        <input
                                            type="tel"
                                            value={buyerInfo.phone}
                                            onChange={(e) => setBuyerInfo({ ...buyerInfo, phone: e.target.value })}
                                            placeholder="e.g., +234 801 234 5678"
                                            className="w-full px-4 py-3 border border-slate-300 bg-white text-slate-900 rounded-xl focus:ring-2 focus:ring-green-600"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            Intended Use / Purpose *
                                        </label>
                                        <textarea
                                            value={buyerInfo.purpose}
                                            onChange={(e) => setBuyerInfo({ ...buyerInfo, purpose: e.target.value })}
                                            rows={4}
                                            placeholder="Briefly describe how you plan to use this land (e.g., rice farming, livestock grazing, commercial agriculture)..."
                                            className="w-full px-4 py-3 border border-slate-300 bg-white text-slate-900 rounded-xl focus:ring-2 focus:ring-green-600 resize-none"
                                            required
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Escrow Information */}
                            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
                                <div className="flex items-start gap-4">
                                    <Shield className="w-12 h-12 text-blue-600 shrink-0" />
                                    <div>
                                        <h3 className="text-lg font-bold text-blue-900 mb-2">
                                            Escrow Protection Enabled
                                        </h3>
                                        <p className="text-sm text-blue-800 mb-3">
                                            Your payment will be held securely in escrow until the transaction is completed.
                                        </p>
                                        <ul className="text-sm text-blue-700 space-y-1">
                                            <li>✓ Funds released only after successful property transfer</li>
                                            <li>✓ Full refund if seller fails to deliver</li>
                                            <li>✓ Dispute resolution available if needed</li>
                                            <li>✓ Admin oversight for your protection</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            {/* Terms & Conditions */}
                            <div className="bg-white rounded-2xl p-6 elevation-2">
                                <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                                    <FileText className="w-5 h-5" />
                                    Terms & Conditions
                                </h2>

                                <div className="bg-slate-50 rounded-xl p-4 max-h-48 overflow-y-auto mb-4 text-sm text-slate-600 space-y-2">
                                    <p><strong>1. Payment:</strong> Full payment is required to proceed with the purchase.</p>
                                    <p><strong>2. Escrow:</strong> Funds will be held in escrow until property transfer is verified.</p>
                                    <p><strong>3. Verification:</strong> You agree to conduct due diligence and verify property documents.</p>
                                    <p><strong>4. Transfer:</strong> Seller is responsible for providing all necessary documents for title transfer.</p>
                                    <p><strong>5. Inspection:</strong> You have the right to inspect the property before completing the purchase.</p>
                                    <p><strong>6. Cancellation:</strong> Cancellation terms are subject to mutual agreement and platform policy.</p>
                                    <p><strong>7. Disputes:</strong> Any disputes will be resolved through the platform's mediation process.</p>
                                </div>

                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={agreed}
                                        onChange={(e) => setAgreed(e.target.checked)}
                                        className="w-5 h-5 mt-0.5 rounded border-slate-300 text-green-600 focus:ring-2 focus:ring-green-600"
                                    />
                                    <span className="text-sm text-slate-900">
                                        I agree to the terms and conditions and confirm that I have read and understood the escrow policy.
                                    </span>
                                </label>
                            </div>

                            {/* Error Display */}
                            {error && (
                                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                                    <p className="text-red-800">{error}</p>
                                </div>
                            )}

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={submitting || !agreed}
                                className="w-full px-6 py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <ShoppingCart className="w-5 h-5" />
                                        Proceed to Payment
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                    {/* Order Summary */}
                    <div className="lg:col-span-1">
                        <div className="bg-white rounded-2xl p-6 elevation-2 sticky top-24">
                            <h2 className="text-xl font-bold text-slate-900 mb-4">Order Summary</h2>

                            {/* Property Preview */}
                            {firstImageSrc(property.images) && (
                                <div className="relative aspect-video rounded-xl overflow-hidden mb-4">
                                    <Image
                                        src={firstImageSrc(property.images)!}
                                        alt={property.title}
                                        fill
                                        className="object-cover"
                                    />
                                </div>
                            )}

                            <h3 className="font-bold text-slate-900 mb-3">{property.title}</h3>

                            <div className="space-y-3 mb-6">
                                <div className="flex items-center gap-2 text-sm text-slate-600">
                                    <MapPin className="w-4 h-4" />
                                    <span>
                                        {/* #689 One rule for four shapes — see lib/land-location.ts. */}
                                        {landLocationText(property) || "Nigeria"}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-slate-600">
                                    <Maximize className="w-4 h-4" />
                                    <span>{property.size} acres</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                    <span className={`px-3 py-1 rounded-lg font-semibold ${
                                        mode === "rent" ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                                    }`}>
                                        {mode === "rent" ? 'Lease / Rental' : 'Purchase'}
                                    </span>
                                </div>
                            </div>

                            <div className="border-t border-slate-200 pt-4 space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">
                                        {mode === "rent" ? 'Lease Price' : 'Property Price'}
                                    </span>
                                    <span className="font-semibold text-slate-900">
                                        ₦{Number(chargedPrice || 0).toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">Platform Fee</span>
                                    <span className="font-semibold text-slate-900">₦0</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">Escrow Service</span>
                                    <span className="font-semibold text-green-600">Included</span>
                                </div>
                                <div className="border-t border-slate-200 pt-3 flex justify-between">
                                    <span className="font-bold text-slate-900">Total Amount</span>
                                    <span className="text-2xl font-bold text-green-600">
                                        ₦{Number(chargedPrice || 0).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
