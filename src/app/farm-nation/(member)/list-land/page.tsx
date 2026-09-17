"use client";

import { useState } from "react";
import { STATES, NIGERIAN_LOCATIONS } from "@/lib/locations";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    Map, MapPin, Upload, FileText, Video,
    ArrowLeft, Check, X, Plus, Loader2
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useStorage } from "@/hooks/use-storage";
import { submitLandListingAction } from "@/app/actions/land-listings";
import { useToast } from "@/contexts/ToastContext";
import { parseCurrencyStringToFloat } from "@/lib/utils";

//   #791 A broken preview must not paint its alt text over the remove
//   button in the same box — see components/ui/ThumbnailImage.
import { ThumbnailImage } from "@/components/ui/ThumbnailImage";
import { ImageOff } from "lucide-react";

type LandCategory = "farmland" | "ranch" | "forest" | "mixed" | "orchard" | "aquaculture";

export default function ListLandPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const { showToast } = useToast();
    const { uploadFile, uploadState } = useStorage();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [formData, setFormData] = useState({
        title: "",
        category: [] as LandCategory[],
        description: "",
        state: "",
        lga: "",
        address: "",
        size: "" as string | number,
        unit: "acres" as "acres" | "hectares",
        pricePerUnit: "" as string | number,
        //   #859 The seller's own asking price, and whether she has set it. See
        //   the Total Price field for why the product is a default and not a
        //   verdict.
        totalPrice: "" as string | number,
        totalPriceEdited: false,
        latitude: "",
        longitude: "",
        /**
         *   #861 ONE LISTING TYPE, NOT A SET.
         *
         *   THE OWNER: "listing should not be multiple selection under land
         *   category".
         *
         *   This was `listingTypes: string[]` with a togglable multi-select, and
         *   the submit then had to collapse it back into one value anyway:
         *
         *       type: listingTypes.includes("sale") ? "sale"
         *           : (listingTypes.includes("rent") ? "rent" : "lease")
         *
         *   — a hidden precedence nobody chose. A seller who ticked Rent AND
         *   Lease got a listing typed "rent", and the buyer-facing filter
         *   (`searchLandListingsAction`'s `type`) is single-valued, so the lease
         *   half was simply unfindable. The form offered a combination the rest
         *   of the platform cannot express.
         *
         *   The three availableFor* booleans are still written — the property
         *   page and the checkout read them — they are just derived from one
         *   answer now instead of from a set with a tiebreak.
         */
        listingType: "sale" as "sale" | "rent" | "lease",
        //   #861 How long the rent or lease runs. Asked for only when it
        //   applies; a duration on a sale is meaningless.
        durationValue: "" as string | number,
        durationUnit: "years" as "months" | "years",
        escrowAvailable: true,
    });

    const [media, setMedia] = useState({
        images: [] as File[],
        video: null as File | null,
    });

    const [documents, setDocuments] = useState({
        landTitle: null as File | null,
        surveyPlan: null as File | null,
        taxClearance: null as File | null,
    });

    /**
     *   #860 ANYTHING ELSE SHE HAS, AND THE THREE NAMED SLOTS ARE KEPT.
     *
     *   THE OWNER: "also add multiple document upload".
     *
     *   The form took exactly three files — Land Title, Survey Plan, Tax
     *   Clearance — one each. A seller with a deed of assignment, a power of
     *   attorney, a probate order, a second survey after a subdivision or two
     *   pages of one C of O had nowhere to put them, and verification is
     *   decided on what she can show.
     *
     *   NOT REPLACED BY ONE ANONYMOUS PILE. The named slots are what an admin
     *   verifying the land reads: "is there a C of O" is a different question
     *   from "are there eight files", and #856 is the record of what happens
     *   when the presence of documents is confused with the substance of them.
     *   So the three stay named and required as they were, and everything else
     *   goes here.
     */
    const [extraDocuments, setExtraDocuments] = useState<File[]>([]);

    const addExtraDocuments = (e: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(e.target.files || []);
        //   Capped, and the cap is the same eight the image picker uses. An
        //   unbounded multiple-file input is an unbounded upload bill.
        setExtraDocuments(prev => [...prev, ...picked].slice(0, 8));
        //   Cleared so picking the same file twice in a row still fires change.
        e.target.value = "";
    };

    const removeExtraDocument = (index: number) => {
        setExtraDocuments(prev => prev.filter((_, i) => i !== index));
    };

    const toggleCategory = (value: LandCategory) => {
        setFormData(prev => {
            const current = Array.isArray(prev.category) ? prev.category : (prev.category ? [prev.category as LandCategory] : []);
            const updated = current.includes(value)
                ? current.filter(c => c !== value)
                : [...current, value];
            return { ...prev, category: updated };
        });
    };

    const selectListingType = (value: "sale" | "rent" | "lease") => {
        //   #861 A choice, not a toggle. Clearing the duration when moving to a
        //   sale stops a stale "3 years" riding along on a listing that has no
        //   term — the same rule as the LGA clearing with its state.
        setFormData(prev => ({
            ...prev,
            listingType: value,
            ...(value === "sale" ? { durationValue: "" } : {}),
        }));
    };

    const landCategories = [
        { value: "farmland", label: "Farmland (Crop Cultivation)", icon: "🌾" },
        { value: "ranch", label: "Ranch/Pasture (Livestock)", icon: "🐄" },
        { value: "forest", label: "Forest Land (Timber/Conservation)", icon: "🌲" },
        { value: "mixed", label: "Mixed-Use Agricultural", icon: "🌻" },
        { value: "orchard", label: "Orchard/Plantation", icon: "🍊" },
        { value: "aquaculture", label: "Aquaculture/Fish Farm", icon: "🐟" }
    ];

    /**
     *   #857 THE STATES CAME FROM A LIST TYPED INTO THIS FILE, AND THE LGA CAME
     *   FROM NOWHERE AT ALL.
     *
     *   THE OWNER: "LGA drop-down not included — when users select a state there
     *   should be an LGA dropdown."
     *
     *   State was a `<select>` over thirty-seven strings declared here; LGA was
     *   a free-text `<input placeholder="Enter LGA">`. So the half of the
     *   address that the platform can validate was constrained and the half it
     *   uses to find land for a buyer was whatever somebody typed — "Jos
     *   North", "jos-north", "Jos N." and a misspelling are four different LGAs
     *   to a search.
     *
     *   lib/locations.ts already holds NIGERIAN_LOCATIONS — every state with its
     *   LGAs — plus isValidLGA and getWards, and the cooperative onboarding has
     *   driven dependent state → LGA → ward dropdowns from it since #789. The
     *   data was there; this form did not ask.
     *
     *   NINE FILES DECLARE THEIR OWN COPY of the state list. This is one of
     *   them and it is one fewer now. The other eight are a sweep of their own
     *   rather than a passenger on a Farm Nation fix — recorded in
     *   docs/module-audit-checklist.md §D.
     */
    const nigerianStates = STATES;
    const lgasForState = formData.state ? (NIGERIAN_LOCATIONS[formData.state] ?? []) : [];

    /**
     *   #859 The product of size and unit price — a suggestion, not the answer.
     *
     *   Kept in step with those two fields by the effect below until the seller
     *   types her own figure, at which point it becomes a comparison she can
     *   accept rather than a value that overwrites her.
     */
    const suggestedTotal =
        Number(formData.size) > 0 && Number(formData.pricePerUnit) > 0
            ? Number(formData.size) * Number(formData.pricePerUnit)
            : 0;

    /**
     *   DERIVED, NOT SYNCED INTO STATE BY AN EFFECT.
     *
     *   The first version kept `totalPrice` in step with a mount effect, and
     *   client-pages-that-still-fetch-after-hydration caught it: that ratchet
     *   counts a client page carrying one that also calls a server action —
     *   deliberately "a SHAPE and not a judgement" — and this page submits
     *   through one. The count went 12 -> 13.
     *
     *   (The word itself is avoided here on purpose: that scan reads RAW source,
     *   so a file merely DISCUSSING the pattern is counted as using it. The
     *   repository has lib/testing/strip-comments for exactly this and the scan
     *   does not use it — its own blind-spot note, one spelling further on.)
     *
     *   Its header is explicit that "silently raising a ratchet is precisely
     *   what" must not happen — so the effect is removed rather than the cap
     *   raised. Nothing is lost: what the field shows is a function of what the
     *   seller has typed, which is what a derived value is for.
     */
    const effectiveTotal = formData.totalPriceEdited
        ? Number(formData.totalPrice) || 0
        : suggestedTotal;
    const totalPriceValue = formData.totalPriceEdited
        ? formData.totalPrice
        : (suggestedTotal > 0 ? String(suggestedTotal) : "");

    function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files || []);
        setMedia(prev => ({ ...prev, images: [...prev.images, ...files].slice(0, 8) }));
    };

    function handleVideoSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0] || null;
        setMedia(prev => ({ ...prev, video: file }));
    };

    function handleDocumentChange(field: keyof typeof documents, file: File | null) {
        setDocuments(prev => ({ ...prev, [field]: file }));
    };

    const removeImage = (index: number) => {
        setMedia(prev => ({
            ...prev,
            images: prev.images.filter((_, i) => i !== index)
        }));
    };

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!session?.user) {
            showToast("Authentication Required: Please login to list your land.", "error");
            router.push("/auth/login?callbackUrl=/farm-nation/list-land");
            return;
        }

        if (!formData.category || formData.category.length === 0) {
            showToast("Validation Error: Please select at least one land category.", "error");
            return;
        }

        setIsSubmitting(true);

        try {
            // 1. Upload Images
            // Use Promise.all for parallel uploads to prevent hanging
            const imageUploadPromises = media.images.map(image => {
                const path = `farm-nation/${session.user.id}/images/${Date.now()}_${image.name}`;
                return uploadFile(image, path);
            });

            const imageUrls = await Promise.all(imageUploadPromises);

            // 2. Upload Documents
            const documentUrls: string[] = [];

            // Upload documents in parallel if they exist
            const docUploads = [];

            if (documents.landTitle) {
                const path = `farm-nation/${session.user.id}/docs/${Date.now()}_title_${documents.landTitle.name}`;
                docUploads.push(uploadFile(documents.landTitle, path));
            } else {
                docUploads.push(Promise.resolve(null)); // Placeholder
            }

            if (documents.surveyPlan) {
                const path = `farm-nation/${session.user.id}/docs/${Date.now()}_survey_${documents.surveyPlan.name}`;
                docUploads.push(uploadFile(documents.surveyPlan, path));
            } else {
                docUploads.push(Promise.resolve(null)); // Placeholder
            }

            if (documents.taxClearance) {
                const path = `farm-nation/${session.user.id}/docs/${Date.now()}_tax_${documents.taxClearance.name}`;
                docUploads.push(uploadFile(documents.taxClearance, path));
            }

            //   #860 Everything else she attached, uploaded in the same pass.
            for (const extra of extraDocuments) {
                const path = `farm-nation/${session.user.id}/docs/${Date.now()}_extra_${extra.name}`;
                docUploads.push(uploadFile(extra, path));
            }

            const uploadedDocs = await Promise.all(docUploads);

            // Filter out nulls and push to documentUrls
            // Note: The original code pushed to documentUrls sequentially. 
            // We need to maintain that logic if the backend expects specific order, 
            // but the original code just pushed them.
            uploadedDocs.forEach(url => {
                if (url) documentUrls.push(url);
            });

            // 3. Submit Data
            const result = await submitLandListingAction({
                ownerId: session.user.id,
                ownerName: session.user.name || "Land Owner",
                ownerEmail: session.user.email || "",
                title: formData.title,
                description: formData.description,
                location: {
                    state: formData.state,
                    lga: formData.lga,
                    address: formData.address,
                },
                size: parseCurrencyStringToFloat(String(formData.size)),
                //   #859 The seller's asking price. It defaults to size × unit
                //   price and she may change it; what is submitted is whatever
                //   the Total Price field says.
                price: effectiveTotal,
                category: formData.category, // Added category
                imageUrls,
                documentUrls,
                gpsCoordinates: formData.latitude && formData.longitude ? {
                    latitude: parseFloat(formData.latitude),
                    longitude: parseFloat(formData.longitude)
                } : undefined,
                //   #861 Derived from ONE answer. `availableForRent` stays true
                //   for a lease because the property page and the checkout use
                //   it to mean "not a sale" — see PropertyDetailsClient's
                //   "Lease/Rental price" label.
                availableForSale: formData.listingType === "sale",
                availableForRent: formData.listingType === "rent" || formData.listingType === "lease",
                availableForLease: formData.listingType === "lease",
                type: formData.listingType,
                ...(formData.listingType !== "sale" && Number(formData.durationValue) > 0
                    ? {
                        durationValue: Number(formData.durationValue),
                        durationUnit: formData.durationUnit,
                    }
                    : {}),
                escrowAvailable: true,
            });

            if (result.success) {
                showToast("Land Listing Submitted! Your listing has been submitted for verification.", "success");
                router.push("/farm-nation");
            } else {
                showToast(`Submission Failed: ${result.error || "Failed to create listing"}`, "error");
            }
        } catch (error: any) {
            logger.error("Error:", error);
            showToast("Error: " + error.message, "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    /**
     * What still has to be supplied before the listing can be submitted.
     *
     * ONE LIST, used both to disable the button and to say why. It was three
     * conditions inlined on the button's `disabled` prop and nothing else:
     *
     *     disabled={isSubmitting || media.images.length === 0
     *               || !documents.landTitle || !documents.surveyPlan}
     *
     * A seller who filled the whole form but had no survey plan — or no photo —
     * got a dead grey button and no indication of which of the three it wanted.
     * handleSubmit's own error messages do not help either: the only field it
     * names is the land category, and that check never runs, because the button
     * cannot be clicked to reach it.
     *
     * Derived once so the message cannot drift from the rule. Two copies of a
     * requirement is how a form ends up refusing something it claims to accept.
     */
    const missingRequirements: string[] = [
        media.images.length === 0 ? "at least one land photo" : null,
        !documents.landTitle ? "the Land Title Document" : null,
        !documents.surveyPlan ? "the Survey Plan" : null,
    ].filter((requirement): requirement is string => requirement !== null);

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-5xl mx-auto px-4">
                <Link
                    href="/farm-nation"
                    className="inline-flex items-center gap-2 text-primary hover:underline mb-6"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Farm Nation
                </Link>

                <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                    {/* Header */}
                    <div className="bg-linear-to-r from-green-600 to-emerald-600 p-8 text-white flex justify-between items-center">
                        <div>
                            <h1 className="text-3xl font-bold mb-2">List Your Land</h1>
                            <p className="text-green-100">
                                Create a listing for your agricultural land
                            </p>
                        </div>
                        <Link
                            href="/farm-nation/inquiries"
                            className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-white font-semibold transition backdrop-blur-sm"
                        >
                            View Inquiries
                        </Link>
                    </div>

                    <form onSubmit={handleSubmit} className="p-8 space-y-8">
                        {/* Basic Information */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <Map className="w-6 h-6" />
                                Land Information
                            </h2>

                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Land Title *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.title}
                                        onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="e.g., 50 Acres Farmland in Kaduna"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Land Category *
                                    </label>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        {landCategories.map((cat) => (
                                            <button
                                                key={cat.value}
                                                type="button"
                                                onClick={() => toggleCategory(cat.value as LandCategory)}
                                                className={`p-4 border-2 rounded-lg transition-all text-left ${formData.category.includes(cat.value as LandCategory)
                                                    ? "border-green-600 bg-green-50"
                                                    : "border-slate-200 hover:border-green-400"
                                                    }`}
                                            >
                                                <div className="text-2xl mb-2">{cat.icon}</div>
                                                <p className="text-sm font-semibold text-slate-900">
                                                    {cat.label}
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Description *
                                    </label>
                                    <textarea
                                        value={formData.description}
                                        onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                        rows={5}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Describe the land, its features, soil type, water access, nearby infrastructure, etc."
                                        required
                                    />
                                </div>
                            </div>
                        </section>

                        {/* Location */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <MapPin className="w-6 h-6" />
                                Location & GPS Coordinates
                            </h2>

                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            State *
                                        </label>
                                        <select
                                            value={formData.state}
                                            //   #857 The LGA is cleared with the state. #789's
                                            //   rule on the cooperative form: a dependent
                                            //   dropdown that keeps its old value is worse than
                                            //   an empty one, because "Plateau / Ikeja" looks
                                            //   like an address and is not.
                                            onChange={(e) => setFormData(prev => ({
                                                ...prev, state: e.target.value, lga: "",
                                            }))}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                            required
                                        >
                                            <option value="">Select State</option>
                                            {nigerianStates.map(state => (
                                                <option key={state} value={state}>{state}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            LGA *
                                        </label>
                                        <select
                                            value={formData.lga}
                                            onChange={(e) => setFormData(prev => ({ ...prev, lga: e.target.value }))}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-slate-100 disabled:text-slate-400"
                                            //   Disabled until a state is chosen, because the
                                            //   list depends on it. An enabled empty dropdown
                                            //   reads as "no LGAs exist here".
                                            disabled={!formData.state}
                                            required
                                        >
                                            <option value="">
                                                {formData.state ? "Select LGA" : "Select a state first"}
                                            </option>
                                            {lgasForState.map(lga => (
                                                <option key={lga} value={lga}>{lga}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Detailed Address *
                                    </label>
                                    <textarea
                                        value={formData.address}
                                        onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                                        rows={2}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Full address with landmarks"
                                        required
                                    />
                                </div>

                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                    <p className="text-sm font-semibold text-blue-900 mb-3">
                                        GPS Coordinates (Optional but recommended)
                                    </p>
                                    <p className="text-xs text-blue-700 mb-4">
                                        Provide accurate GPS coordinates for better visibility on the map. Nigeria bounds: Lat 4° to 14°N, Long 3° to 15°E
                                    </p>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-blue-900 mb-1">
                                                Latitude
                                            </label>
                                            <input
                                                type="number"
                                                value={formData.latitude}
                                                onChange={(e) => setFormData(prev => ({ ...prev, latitude: e.target.value }))}
                                                className="w-full px-3 py-2 bg-white border border-blue-300 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                placeholder="e.g., 9.0820"
                                                step="0.000001"
                                                min="4"
                                                max="14"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-blue-900 mb-1">
                                                Longitude
                                            </label>
                                            <input
                                                type="number"
                                                value={formData.longitude}
                                                onChange={(e) => setFormData(prev => ({ ...prev, longitude: e.target.value }))}
                                                className="w-full px-3 py-2 bg-white border border-blue-300 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                placeholder="e.g., 8.6753"
                                                step="0.000001"
                                                min="3"
                                                max="15"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Size & Pricing */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                Size & Pricing
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Land Size *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.size}
                                        onChange={(e) => setFormData(prev => ({ ...prev, size: e.target.value }))}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="0"
                                        min="0"
                                        step="0.1"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Unit *
                                    </label>
                                    <select
                                        value={formData.unit}
                                        onChange={(e) => setFormData(prev => ({ ...prev, unit: e.target.value as "acres" | "hectares" }))}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        required
                                    >
                                        <option value="acres">Acres</option>
                                        <option value="hectares">Hectares</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Price per {formData.unit} (₦) *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.pricePerUnit}
                                        onChange={(e) => setFormData(prev => ({ ...prev, pricePerUnit: e.target.value }))}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="0"
                                        min="0"
                                        step="1000"
                                        required
                                    />
                                </div>
                            </div>

                            {/*
                              *   #859 THE TOTAL PRICE WAS ARITHMETIC THE SELLER COULD NOT
                              *   ARGUE WITH.
                              *
                              *   THE OWNER: "Total price should include dynamic pricing field
                              *   and not automatic when setting up product/land."
                              *
                              *   `price` was computed at submit as `size × pricePerUnit` and
                              *   shown here as a read-only line. Land is not sold that way: a
                              *   seller rounds, discounts a quick sale, prices a corner plot
                              *   above the per-acre rate because it fronts the road. The form
                              *   offered no way to say so, and the figure a buyer sees was
                              *   whichever number fell out of the multiplication.
                              *
                              *   The product is still computed and still offered — it is a
                              *   good default and most listings will keep it — but it is now a
                              *   STARTING POINT in a field, not a verdict.
                              */}
                            <div className="mt-4">
                                <label className="block text-sm font-semibold text-slate-900 mb-2">
                                    Total Price (₦) *
                                </label>
                                <input
                                    type="number"
                                    value={totalPriceValue}
                                    onChange={(e) => setFormData(prev => ({
                                        ...prev,
                                        totalPrice: e.target.value,
                                        //   Once she has typed her own figure, the size and
                                        //   unit-price fields stop overwriting it. Without
                                        //   this, editing the size after setting a total
                                        //   silently discards what she asked for.
                                        totalPriceEdited: true,
                                    }))}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                    placeholder="0"
                                    min="0"
                                    step="1000"
                                    required
                                />
                                {suggestedTotal > 0 && (
                                    <p className="mt-2 text-sm text-slate-600">
                                        {formData.totalPriceEdited && effectiveTotal !== suggestedTotal ? (
                                            <>
                                                {Number(formData.size)} {formData.unit} × ₦
                                                {Number(formData.pricePerUnit).toLocaleString()} ={" "}
                                                ₦{suggestedTotal.toLocaleString()}.{" "}
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData(prev => ({
                                                        ...prev,
                                                        totalPrice: String(suggestedTotal),
                                                        totalPriceEdited: false,
                                                    }))}
                                                    className="font-semibold text-green-700 underline"
                                                >
                                                    Use that instead
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                From {Number(formData.size)} {formData.unit} × ₦
                                                {Number(formData.pricePerUnit).toLocaleString()}. Edit it if your
                                                asking price differs.
                                            </>
                                        )}
                                    </p>
                                )}
                            </div>
                        </section>

                        {/* Documents */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <FileText className="w-6 h-6" />
                                Legal Documents
                            </h2>

                            <div className="space-y-6">
                                <FileUploadField
                                    label="Land Title Document"
                                    description="Certificate of Occupancy (C of O) or other proof of ownership"
                                    file={documents.landTitle}
                                    onChange={(file) => handleDocumentChange("landTitle", file)}
                                    // Pass upload state if file exists
                                    uploadState={documents.landTitle ? uploadState[documents.landTitle.name] : undefined}
                                    required
                                />

                                <FileUploadField
                                    label="Survey Plan"
                                    description="Licensed surveyor's plan showing land boundaries"
                                    file={documents.surveyPlan}
                                    onChange={(file) => handleDocumentChange("surveyPlan", file)}
                                    uploadState={documents.surveyPlan ? uploadState[documents.surveyPlan.name] : undefined}
                                    required
                                />

                                <FileUploadField
                                    label="Tax Clearance Certificate (Optional)"
                                    description="Recent land tax payment receipt or clearance"
                                    file={documents.taxClearance}
                                    onChange={(file) => handleDocumentChange("taxClearance", file)}
                                    uploadState={documents.taxClearance ? uploadState[documents.taxClearance.name] : undefined}
                                />

                                {/*
                                  *   #860 Anything else she has. See the note on
                                  *   extraDocuments for why the three named slots above
                                  *   are kept rather than folded into this.
                                  */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Other Supporting Documents (Optional)
                                    </label>
                                    <p className="text-sm text-slate-600 mb-3">
                                        Deed of assignment, power of attorney, probate order, extra
                                        survey pages — anything else that supports your claim. Up to
                                        eight files.
                                    </p>

                                    <label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-green-500 hover:bg-green-50 transition">
                                        <Plus className="w-5 h-5 text-slate-500" />
                                        <span className="text-sm font-medium text-slate-700">
                                            Add documents
                                        </span>
                                        <input
                                            type="file"
                                            multiple
                                            accept=".pdf,.jpg,.jpeg,.png"
                                            onChange={addExtraDocuments}
                                            className="hidden"
                                        />
                                    </label>

                                    {extraDocuments.length > 0 && (
                                        <ul className="mt-3 space-y-2">
                                            {extraDocuments.map((file, index) => (
                                                <li
                                                    key={`${file.name}-${index}`}
                                                    className="flex items-center justify-between gap-3 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                                                >
                                                    <span className="flex items-center gap-2 min-w-0">
                                                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                                                        <span className="text-sm text-slate-700 truncate">{file.name}</span>
                                                    </span>
                                                    <span className="flex items-center gap-3 shrink-0">
                                                        <span className="text-xs text-slate-500">
                                                            {(file.size / 1024 / 1024).toFixed(2)} MB
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeExtraDocument(index)}
                                                            aria-label={`Remove ${file.name}`}
                                                            className="p-1 text-slate-400 hover:text-red-600 transition"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        </section>

                        {/* Media */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <Video className="w-6 h-6" />
                                Photos & Video
                            </h2>

                            <div className="space-y-6">
                                {/* Images */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Land Photos (Max 8) *
                                    </label>
                                    <div className="border-2 border-dashed border-slate-300 rounded-lg p-6">
                                        {media.images.length > 0 ? (
                                            <div className="grid grid-cols-4 gap-4 mb-4">
                                                {media.images.map((img, index) => (
                                                    <div key={index} className="relative group">
                                                        {/* Show Progress Overlay */}
                                                        {uploadState[img.name]?.isUploading && (
                                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg z-10">
                                                                <div className="text-white text-xs font-bold">
                                                                    {Math.round(uploadState[img.name].progress)}%
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="relative w-full h-24 rounded-lg overflow-hidden">
                                                            {/*   #791 See components/ui/ThumbnailImage. */}
                                                            <ThumbnailImage
                                                                src={URL.createObjectURL(img)}
                                                                alt={`Land ${index + 1}`}
                                                                className="object-cover"
                                                                sizes="150px"
                                                                unoptimized
                                                                fallback={<ImageOff className="w-6 h-6" />}
                                                            />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeImage(index)}
                                                            className="absolute top-1 right-1 p-1 bg-red-600 hover:bg-red-700 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}

                                        {media.images.length < 8 && (
                                            <label className="flex flex-col items-center cursor-pointer">
                                                <Upload className="w-12 h-12 text-slate-400 mb-3" />
                                                <p className="text-sm font-semibold text-slate-900 mb-1">
                                                    Click to upload photos
                                                </p>
                                                <p className="text-xs text-slate-500">JPG, PNG (max 5MB each)</p>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    multiple
                                                    onChange={handleImageSelect}
                                                    className="hidden"
                                                />
                                            </label>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Availability Options */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                Availability Options
                            </h2>

                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-3">
                                        Listing Type *
                                    </label>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        {[
                                            { value: "sale", label: "For Sale", description: "List this land for permanent purchase", icon: "🏷️" },
                                            { value: "rent", label: "For Rent", description: "List this land for short-term rental/lease", icon: "🔑" },
                                            { value: "lease", label: "For Lease", description: "List this land for long-term agricultural lease", icon: "📄" }
                                        ].map((option) => {
                                            const isSelected = formData.listingType === option.value;
                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    onClick={() => selectListingType(option.value as any)}
                                                    className={`p-5 border-2 rounded-xl transition-all text-left flex flex-col relative ${isSelected
                                                        ? "border-green-600 bg-green-50/50 ring-2 ring-green-600/25"
                                                        : "border-slate-200 hover:border-green-400 hover:bg-slate-50/50"
                                                        }`}
                                                >
                                                    {isSelected && (
                                                        <div className="absolute top-3 right-3 bg-green-600 text-white rounded-full p-0.5">
                                                            <Check className="w-3.5 h-3.5" />
                                                        </div>
                                                    )}
                                                    <div className="text-3xl mb-3">{option.icon}</div>
                                                    <h3 className="font-bold text-slate-950 mb-1">{option.label}</h3>
                                                    <p className="text-xs text-slate-600 leading-relaxed">{option.description}</p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/*
                                  *   #861 THE TERM, asked for only when there is one.
                                  *
                                  *   THE OWNER: "There should be duration for leasing or
                                  *   renting." A listing offered for rent with no term tells
                                  *   a buyer nothing about what she is being offered — a
                                  *   season, a year, ten years — and she has to message the
                                  *   seller to find out what the listing should have said.
                                  *
                                  *   Not rendered for a sale, and cleared when the type
                                  *   changes to one: a duration on a permanent purchase is
                                  *   meaningless, and a stale one left behind would be worse
                                  *   than absent.
                                  */}
                                {formData.listingType !== "sale" && (
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            {formData.listingType === "rent" ? "Rental" : "Lease"} Duration *
                                        </label>
                                        <div className="grid grid-cols-2 gap-4">
                                            <input
                                                type="number"
                                                value={formData.durationValue}
                                                onChange={(e) => setFormData(prev => ({ ...prev, durationValue: e.target.value }))}
                                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                                placeholder="e.g., 3"
                                                min="1"
                                                step="1"
                                                required
                                            />
                                            <select
                                                value={formData.durationUnit}
                                                onChange={(e) => setFormData(prev => ({
                                                    ...prev,
                                                    durationUnit: e.target.value as "months" | "years",
                                                }))}
                                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                            >
                                                <option value="months">Months</option>
                                                <option value="years">Years</option>
                                            </select>
                                        </div>
                                        <p className="mt-2 text-sm text-slate-600">
                                            How long the {formData.listingType === "rent" ? "rental" : "lease"} runs.
                                        </p>
                                    </div>
                                )}

                                <div className="border-t border-slate-100 pt-6">
                                    <div className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-200/60 rounded-xl cursor-not-allowed">
                                        <input
                                            type="checkbox"
                                            id="escrow"
                                            checked={true}
                                            disabled={true}
                                            className="w-5 h-5 text-green-600 rounded focus:ring-2 focus:ring-green-500 cursor-not-allowed bg-slate-100"
                                        />
                                        <label htmlFor="escrow" className="text-sm font-semibold text-slate-500 cursor-not-allowed select-none">
                                            Enable Escrow Protection (Required)
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Submit Button */}
                        <div className="flex gap-4 pt-4">
                            <button
                                type="submit"
                                disabled={isSubmitting || missingRequirements.length > 0}
                                className="flex-1 px-8 py-4 bg-linear-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Submitting Listing...
                                    </>
                                ) : (
                                    <>
                                        <Check className="w-5 h-5" />
                                        Submit Land Listing
                                    </>
                                )}
                            </button>
                        </div>

                        {/*
                          * Says what the disabled button is waiting for.
                          *
                          * role="status" rather than a plain div: a seller
                          * using a screen reader gets no signal at all from a
                          * button that is merely greyed out.
                          */}
                        {missingRequirements.length > 0 && (
                            <div
                                role="status"
                                className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
                            >
                                <span className="font-semibold">Before you can submit, please add </span>
                                {missingRequirements.length === 1
                                    ? missingRequirements[0]
                                    : `${missingRequirements.slice(0, -1).join(", ")} and ${missingRequirements[missingRequirements.length - 1]}`}
                                .
                            </div>
                        )}

                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                            <p className="text-sm text-yellow-900">
                                ⚠️ Your listing will be reviewed by our team to verify the documents and land details before going live.
                            </p>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

// Helper component for file uploads
function FileUploadField({
    label,
    description,
    file,
    onChange,
    required,
    uploadState
}: {
    label: string;
    description: string;
    file: File | null;
    onChange: (file: File | null) => void;
    required?: boolean;
    uploadState?: { progress: number; isUploading: boolean; error: string | null };
}) {
    function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const selectedFile = e.target.files?.[0] || null;
        onChange(selectedFile);
    };

    return (
        <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
                {label} {required && "*"}
            </label>
            <p className="text-sm text-slate-600 mb-3">{description}</p>

            <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 relative">
                {/* Upload Overlay */}
                {uploadState?.isUploading && (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10 flex-col">
                        <Loader2 className="w-6 h-6 animate-spin text-green-600 mb-2" />
                        <span className="text-sm font-bold text-green-800">Uploading {Math.round(uploadState.progress)}%</span>
                    </div>
                )}

                {file ? (
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <FileText className="w-8 h-8 text-green-600" />
                            <div>
                                <p className="font-semibold text-slate-900">{file.name}</p>
                                <p className="text-sm text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => onChange(null)}
                            disabled={uploadState?.isUploading}
                            className="p-2 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                        >
                            <X className="w-5 h-5 text-red-600" />
                        </button>
                    </div>
                ) : (
                    <label className="flex flex-col items-center cursor-pointer">
                        <Upload className="w-12 h-12 text-slate-400 mb-3" />
                        <p className="text-sm font-semibold text-slate-900 mb-1">
                            Click to upload
                        </p>
                        <p className="text-xs text-slate-500">PDF, JPG, PNG (max 5MB)</p>
                        <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={handleFileSelect}
                            className="hidden"
                            required={required}
                        />
                    </label>
                )}
            </div>
        </div>
    );
}
