"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Map, MapPin, ArrowLeft, Loader2, Save } from "lucide-react";
import Link from "next/link";
import { updatePropertyAction, getPropertiesAction } from "@/app/actions/farm-nation";
import { useToast } from "@/contexts/ToastContext";

interface EditPropertyPageProps {
    params: Promise<{ id: string }>;
}

type PropertyType = "farmland" | "ranch" | "commercial_farm" | "agricultural_land";

export default function EditPropertyPage(props: EditPropertyPageProps) {
    const params = use(props.params);
    const router = useRouter();
    const { data: session } = useSession();
    const { showToast } = useToast();
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [formData, setFormData] = useState({
        name: "",
        description: "",
        state: "",
        lga: "",
        address: "",
        pricePerAcre: 0,
        size: 0,
        propertyType: "" as PropertyType | "",
        category: "",
        features: [] as string[],
        leaseDuration: 0,
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
                const result = await getPropertiesAction();
                if (result.success && result.properties) {
                    const prop: any = result.properties.find(p => p.id === params.id);
                    if (prop) {
                        const location = typeof prop.location === 'string' ? { state: "", lga: "", address: prop.location } : prop.location;
                        setFormData({
                            name: prop.name || "",
                            description: prop.description || "",
                            state: location?.state || "",
                            lga: location?.lga || "",
                            address: location?.address || "",
                            pricePerAcre: prop.pricePerAcre || prop.price || 0,
                            size: prop.size || 0,
                            propertyType: prop.propertyType || prop.type || "",
                            category: prop.category || "",
                            features: prop.features || [],
                            leaseDuration: prop.leaseDuration || 0,
                        });
                    } else {
                        showToast("Property not found", "error");
                        router.push("/farm-nation/my-properties");
                    }
                } else {
                    showToast("Failed to load properties", "error");
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!session?.user) {
            showToast("Please login to continue", "error");
            return;
        }

        setIsSubmitting(true);

        try {
            const result = await updatePropertyAction(params.id, {
                name: formData.name,
                description: formData.description,
                location: formData.address,
                state: formData.state,
                lga: formData.lga,
                price: formData.pricePerAcre * formData.size,
                size: formData.size,
                category: formData.category,
                features: formData.features,
                leaseDuration: formData.leaseDuration,
            } as Parameters<typeof updatePropertyAction>[1]);

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
                    {/* Header */}
                    <div className="bg-linear-to-r from-green-600 to-emerald-600 p-8 text-white">
                        <h1 className="text-3xl font-bold mb-2">Edit Property</h1>
                        <p className="text-green-100">
                            Update your property details
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="p-8 space-y-8">
                        {/* Basic Information */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <Map className="w-6 h-6" />
                                Property Information
                            </h2>

                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Property Name *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Property Type *
                                    </label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        {propertyTypes.map((type) => (
                                            <button
                                                key={type.value}
                                                type="button"
                                                onClick={() => setFormData({ ...formData, propertyType: type.value as PropertyType })}
                                                className={`p-4 border-2 rounded-lg transition-all text-left ${formData.propertyType === type.value
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

                        {/* Location */}
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
                                            LGA *
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

                        {/* Size & Pricing */}
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
                                        Price per Acre (₦) *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.pricePerAcre}
                                        onChange={(e) => setFormData({ ...formData, pricePerAcre: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        min="0"
                                        step="1000"
                                        required
                                    />
                                </div>
                            </div>

                            {formData.size > 0 && formData.pricePerAcre > 0 && (
                                <div className="mt-4 p-4 bg-green-50 rounded-lg">
                                    <p className="text-sm text-green-900">
                                        <span className="font-semibold">Total Price: </span>
                                        ₦{(formData.size * formData.pricePerAcre).toLocaleString()}
                                    </p>
                                </div>
                            )}
                        </section>

                        {/* Submit Button */}
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
