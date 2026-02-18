"use client";

import { useState } from "react";
import { User, Phone, MapPin, Building, ArrowRight, ArrowLeft } from "lucide-react";
import { NIGERIAN_LOCATIONS } from "@/lib/locations";

interface ProfileStepProps {
    onNext: (data: any) => void;
    onBack: () => void;
    initialData?: any;
}

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
    "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
    "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi",
    "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
    "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT"
];

export default function ProfileStep({ onNext, onBack, initialData }: ProfileStepProps) {
    const [formData, setFormData] = useState({
        fullName: initialData?.fullName || "",
        phone: initialData?.phone || "",
        businessName: initialData?.businessName || "",
        state: initialData?.state || "",
        lga: initialData?.lga || "",
        address: initialData?.address || "",
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        if (name === "state") {
            // Reset LGA when state changes
            setFormData((prev) => ({ ...prev, state: value, lga: "" }));
        } else {
            setFormData((prev) => ({ ...prev, [name]: value }));
        }
        // Clear error when user starts typing
        if (errors[name]) {
            setErrors((prev) => ({ ...prev, [name]: "" }));
        }
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};

        if (!formData.fullName.trim()) newErrors.fullName = "Full name is required";
        if (!formData.phone.trim()) newErrors.phone = "Phone number is required";
        if (!formData.state) newErrors.state = "State is required";
        if (!formData.lga.trim()) newErrors.lga = "LGA is required";
        if (!formData.address.trim()) newErrors.address = "Address is required";

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (validate()) {
            onNext({ profile: formData });
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div>
                <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">
                    Profile & Location
                </h2>
                <p className="text-slate-600">
                    Help us connect you with the right properties in your area
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Full Name */}
                <div className="col-span-full">
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Full Name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            name="fullName"
                            value={formData.fullName}
                            onChange={handleChange}
                            className={`w-full pl-11 pr-4 py-3 bg-slate-50 border ${errors.fullName ? "border-red-500" : "border-slate-200"
                                } rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all`}
                            placeholder="John Doe"
                        />
                    </div>
                    {errors.fullName && (
                        <p className="mt-1 text-sm text-red-500">{errors.fullName}</p>
                    )}
                </div>

                {/* Phone */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Phone Number <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="tel"
                            name="phone"
                            value={formData.phone}
                            onChange={handleChange}
                            className={`w-full pl-11 pr-4 py-3 bg-slate-50 border ${errors.phone ? "border-red-500" : "border-slate-200"
                                } rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all`}
                            placeholder="0801 234 5678"
                        />
                    </div>
                    {errors.phone && <p className="mt-1 text-sm text-red-500">{errors.phone}</p>}
                </div>

                {/* Business Name (Optional) */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Business Name <span className="text-slate-400">(Optional)</span>
                    </label>
                    <div className="relative">
                        <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            name="businessName"
                            value={formData.businessName}
                            onChange={handleChange}
                            className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
                            placeholder="Agro Ventures Ltd"
                        />
                    </div>
                </div>

                {/* State */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        State <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <select
                            name="state"
                            value={formData.state}
                            onChange={handleChange}
                            className={`w-full pl-11 pr-4 py-3 bg-slate-50 border ${errors.state ? "border-red-500" : "border-slate-200"
                                } rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all`}
                        >
                            <option value="">Select State</option>
                            {NIGERIAN_STATES.map((state) => (
                                <option key={state} value={state}>
                                    {state}
                                </option>
                            ))}
                        </select>
                    </div>
                    {errors.state && <p className="mt-1 text-sm text-red-500">{errors.state}</p>}
                </div>

                {/* LGA */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Local Government Area <span className="text-red-500">*</span>
                    </label>
                    <select
                        name="lga"
                        value={formData.lga}
                        onChange={handleChange}
                        disabled={!formData.state}
                        className={`w-full px-4 py-3 bg-slate-50 border ${errors.lga ? "border-red-500" : "border-slate-200"
                            } rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all disabled:opacity-50`}
                    >
                        <option value="">Select LGA</option>
                        {formData.state && NIGERIAN_LOCATIONS[formData.state]?.map((lga) => (
                            <option key={lga} value={lga}>{lga}</option>
                        ))}
                    </select>
                    {errors.lga && <p className="mt-1 text-sm text-red-500">{errors.lga}</p>}
                </div>

                {/* Address */}
                <div className="col-span-full">
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Address <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        name="address"
                        value={formData.address}
                        onChange={handleChange}
                        className={`w-full px-4 py-3 bg-slate-50 border ${errors.address ? "border-red-500" : "border-slate-200"
                            } rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all`}
                        placeholder="123 Main Street"
                    />
                    {errors.address && <p className="mt-1 text-sm text-red-500">{errors.address}</p>}
                </div>
            </div>

            <div className="flex justify-between pt-4">
                <button
                    type="button"
                    onClick={onBack}
                    className="px-6 py-3 border-2 border-slate-300 text-slate-900 rounded-xl font-bold hover:bg-slate-50 transition-colors flex items-center gap-2"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </button>
                <button
                    type="submit"
                    className="px-8 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 transition-colors flex items-center gap-2"
                >
                    Continue
                    <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </form>
    );
}
