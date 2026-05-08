"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Map, MapPin, ArrowLeft, Loader2, Save } from "lucide-react";
import Link from "next/link";
import { updateLandListing } from "@/app/actions/land-actions";
import { getPropertyByIdAction } from "@/app/actions/land-listings";
import { useToast } from "@/contexts/ToastContext";

interface EditPropertyPageProps {
    params: Promise<{ id: string }>;
}

export default function EditPropertyPage(props: EditPropertyPageProps) {
    const params = use(props.params);
    const router = useRouter();
    const { data: session } = useSession();
    const { showToast } = useToast();
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [formData, setFormData] = useState({
        title: "",
        description: "",
        state: "",
        lga: "",
        address: "",
        price: 0,
        size: 0,
        category: "",
        features: [] as string[],
    });

    const nigerianStates = [
        "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
        "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo",
        "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
        "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers",
        "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT"
    ];

    const propertyTypes = [
        { value: "farmland", label: "Farmland", icon: "🌾" },
        { value: "ranch", label: "Ranch", icon: "🐄" },
        { value: "commercial_farm", label: "Commercial Farm", icon: "🏭" },
        { value: "agricultural_land", label: "Agricultural Land", icon: "🌻" }
    ];

    useEffect(() => {
        async function loadProperty() {
            if (!session?.user) return;

            try {
                const result = await getPropertyByIdAction(params.id);
                if (result.success && result.data) {
                    const prop = result.data;
                    const location = prop.location || { state: "", lga: "", address: "" };
                    setFormData({
                        title: prop.title || "",
                        description: prop.description || "",
                        state: location.state || "",
                        lga: location.lga || (location as any).city || "",
                        address: location.address || "",
                        price: prop.price || 0,
                        size: prop.size || 0,
                        category: prop.category || "farmland",
                        features: (prop as any).features || [],
                    });
                } else {
                    showToast(result.error || "Property not found", "error");
                    router.push("/farm-nation/my-properties");
                }
            } catch (error) {
                showToast("Failed to load property", "error");
            } finally {
                setIsLoading(false);
            }
        }

        loadProperty();
    }, [params.id, session, router, showToast]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!session?.user) {
            showToast("Please login to continue", "error");
            return;
        }

        setIsSubmitting(true);

        try {
            const result = await updateLandListing({
                listingId: params.id,
                title: formData.title,
                description: formData.description,
                location: {
                    address: formData.address,
                    state: formData.state,
                    lga: formData.lga,
                    city: formData.lga, 
                    lat: 0, // Preserve original lat/lng if updating dynamically later via Maps
                    lng: 0,
                },
                price: formData.price,
                size: formData.size,
                features: formData.features,
            });

            if (result.success) {
                showToast("Property updated successfully", "success");
                router.push("/farm-nation/my-properties");
            } else {
                showToast(result.error || "Failed to update property", "error");
            }
        } catch (error: any) {
            showToast(error.message || "An error occurred", "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-5xl mx-auto px-4">
                <Link
                    href="/farm-nation/my-properties"
                    className="inline-flex items-center gap-2 text-primary hover:underline mb-6"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to My Properties
                </Link>

                <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                    <div className="bg-linear-to-r from-green-600 to-emerald-600 p-8 text-white">
                        <h1 className="text-3xl font-bold mb-2">Edit Land Listing</h1>
                        <p className="text-green-100">
                            Update your property details on Farm Nation
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="p-8 space-y-8">
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <Map className="w-6 h-6" />
                                Property Information
                            </h2>

                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Land Title *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Category *
                                    </label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        {propertyTypes.map((type) => (
                                            <button
                                                key={type.value}
                                                type="button"
                                                onClick={() => setFormData({ ...formData, category: type.value })}
                                                className={`p-4 border-2 rounded-lg transition-all text-left ${formData.category === type.value
                                                    ? "border-green-600 bg-green-50"
                                                    : "border-slate-200 hover:border-green-400"
                                                    }`}
                                            >
                                                <div className="text-2xl mb-2">{type.icon}</div>
                                                <p className="text-sm font-semibold text-slate-900">
                                                    {type.label}
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
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        rows={5}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        required
                                    />
                                </div>
                            </div>
                        </section>

                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <MapPin className="w-6 h-6" />
                                Location
                            </h2>

                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            State *
                                        </label>
                                        <select
                                            value={formData.state}
                                            onChange={(e) => setFormData({ ...formData, state: e.target.value })}
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
                                            LGA / City *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.lga}
                                            onChange={(e) => setFormData({ ...formData, lga: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Address *
                                    </label>
                                    <textarea
                                        value={formData.address}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                        rows={2}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        required
                                    />
                                </div>
                            </div>
                        </section>

                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                Size & Pricing
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Size (acres) *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.size}
                                        onChange={(e) => setFormData({ ...formData, size: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        min="0"
                                        step="0.1"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Total Price (₦) *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.price}
                                        onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        min="0"
                                        step="1000"
                                        required
                                    />
                                </div>
                            </div>
                        </section>

                        <div className="flex gap-4 pt-4">
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="flex-1 px-8 py-4 bg-linear-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Updating...
                                    </>
                                ) : (
                                    <>
                                        <Save className="w-5 h-5" />
                                        Save Changes
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
