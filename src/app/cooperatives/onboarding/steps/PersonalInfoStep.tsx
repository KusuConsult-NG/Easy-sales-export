"use client";

import { useState } from "react";
import { NIGERIAN_LOCATIONS, STATES } from "@/lib/locations";
import { useToast } from "@/contexts/ToastContext";

interface PersonalInfoData {
    firstName: string;
    lastName: string;
    otherName?: string;
    phone: string;
    email: string;
    dateOfBirth: string;
    gender: string;
    occupation: string;
    address: {
        state: string;
        lga: string;
        street: string;
    };
}

interface PersonalInfoStepProps {
    data: PersonalInfoData;
    onChange: (data: PersonalInfoData) => void;
    onNext: () => void;
    onBack: () => void;
}

export default function PersonalInfoStep({ data, onChange, onNext, onBack }: PersonalInfoStepProps) {
    const { showToast } = useToast();
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validate = () => {
        const newErrors: Record<string, string> = {};
        if (!data.firstName.trim()) newErrors.firstName = "First name is required";
        if (!data.lastName.trim()) newErrors.lastName = "Last name is required";
        if (!data.phone.trim()) newErrors.phone = "Phone number is required";
        if (!data.email.trim()) newErrors.email = "Email address is required";
        if (!data.gender) newErrors.gender = "Gender is required";
        if (!data.occupation.trim()) newErrors.occupation = "Occupation is required";
        if (!data.address.state) newErrors.state = "State is required";
        if (!data.address.lga) newErrors.lga = "LGA is required";
        if (!data.address.street.trim()) newErrors.street = "Street address is required";

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleContinue = () => {
        if (validate()) {
            onNext();
        } else {
            showToast("Please provide all required personal information", "error");
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-900 mb-3">
                    Personal Information
                </h2>
                <p className="text-lg text-slate-600">
                    Tell us about yourself
                </p>
            </div>

            {/* KYC Notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
                <span className="text-amber-500 text-lg shrink-0 mt-0.5">⚠️</span>
                <p className="text-sm text-amber-800 font-medium">
                    <strong>KYC Notice:</strong> Enter your name exactly as it appears on your NIN/BVN to avoid identity verification failure.
                </p>
            </div>

            {/* Form */}
            <div className="max-w-2xl mx-auto space-y-6">
                {/* First Name + Last Name */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            First Name <span className="text-red-500">*</span>
                            <span className="block text-xs font-normal text-slate-500 mt-0.5">As it appears on your NIN/BVN</span>
                        </label>
                        <input
                            type="text"
                            value={data.firstName}
                            onChange={(e) => onChange({ ...data, firstName: e.target.value })}
                            placeholder="e.g. Amina"
                            className={`w-full px-4 py-3 border rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.firstName ? "border-red-500" : "border-slate-300"}`}
                        />
                        {errors.firstName && <p className="text-sm text-red-600 mt-1">{errors.firstName}</p>}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Last Name <span className="text-red-500">*</span>
                            <span className="block text-xs font-normal text-slate-500 mt-0.5">As it appears on your NIN/BVN</span>
                        </label>
                        <input
                            type="text"
                            value={data.lastName}
                            onChange={(e) => onChange({ ...data, lastName: e.target.value })}
                            placeholder="e.g. Ibrahim"
                            className={`w-full px-4 py-3 border rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.lastName ? "border-red-500" : "border-slate-300"}`}
                        />
                        {errors.lastName && <p className="text-sm text-red-600 mt-1">{errors.lastName}</p>}
                    </div>
                </div>

                {/* Other Name - Optional */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Other Name <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                        <span className="block text-xs font-normal text-slate-500 mt-0.5">Middle name or additional name</span>
                    </label>
                    <input
                        type="text"
                        value={data.otherName || ""}
                        onChange={(e) => onChange({ ...data, otherName: e.target.value })}
                        placeholder="e.g. Fatima"
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                </div>

                {/* Phone and Email */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Phone Number <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="tel"
                            value={data.phone}
                            onChange={(e) => onChange({ ...data, phone: e.target.value })}
                            placeholder="08012345678"
                            className={`w-full px-4 py-3 border rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.phone ? "border-red-500" : "border-slate-300"}`}
                        />
                        {errors.phone && <p className="text-sm text-red-600 mt-1">{errors.phone}</p>}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Email Address <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="email"
                            value={data.email}
                            onChange={(e) => onChange({ ...data, email: e.target.value })}
                            placeholder="you@email.com"
                            className={`w-full px-4 py-3 border rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.email ? "border-red-500" : "border-slate-300"}`}
                        />
                        {errors.email && <p className="text-sm text-red-600 mt-1">{errors.email}</p>}
                    </div>
                </div>

                {/* Date of Birth + Gender */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Date of Birth
                        </label>
                        <input
                            type="date"
                            value={data.dateOfBirth}
                            onChange={(e) => onChange({ ...data, dateOfBirth: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Gender <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={data.gender}
                            onChange={(e) => onChange({ ...data, gender: e.target.value })}
                            className={`w-full px-4 py-3 border rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.gender ? "border-red-500" : "border-slate-300"}`}
                        >
                            <option value="">Select gender</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                        </select>
                        {errors.gender && <p className="text-sm text-red-600 mt-1">{errors.gender}</p>}
                    </div>
                </div>

                {/* Occupation */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Occupation <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={data.occupation}
                        onChange={(e) => onChange({ ...data, occupation: e.target.value })}
                        placeholder="e.g., Farmer, Trader, Student"
                        className={`w-full px-4 py-3 border rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.occupation ? "border-red-500" : "border-slate-300"}`}
                    />
                    {errors.occupation && <p className="text-sm text-red-600 mt-1">{errors.occupation}</p>}
                </div>

                {/* State + LGA */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            State <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={data.address.state}
                            onChange={(e) => onChange({ ...data, address: { ...data.address, state: e.target.value, lga: "" } })}
                            className={`w-full px-4 py-3 border rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.state ? "border-red-500" : "border-slate-300"}`}
                        >
                            <option value="">Select state</option>
                            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {errors.state && <p className="text-sm text-red-600 mt-1">{errors.state}</p>}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            LGA <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={data.address.lga}
                            onChange={(e) => onChange({ ...data, address: { ...data.address, lga: e.target.value } })}
                            disabled={!data.address.state}
                            className={`w-full px-4 py-3 border rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50 ${errors.lga ? "border-red-500" : "border-slate-300"}`}
                        >
                            <option value="">Select LGA</option>
                            {data.address.state && NIGERIAN_LOCATIONS[data.address.state]?.map((lga) => (
                                <option key={lga} value={lga}>{lga}</option>
                            ))}
                        </select>
                        {errors.lga && <p className="text-sm text-red-600 mt-1">{errors.lga}</p>}
                    </div>
                </div>

                {/* Street */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Street Address <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={data.address.street}
                        onChange={(e) => onChange({ ...data, address: { ...data.address, street: e.target.value } })}
                        placeholder="123 Main Street"
                        className={`w-full px-4 py-3 border rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.street ? "border-red-500" : "border-slate-300"}`}
                    />
                    {errors.street && <p className="text-sm text-red-600 mt-1">{errors.street}</p>}
                </div>

                {/* Navigation */}
                <div className="flex gap-4 pt-2">
                    <button
                        type="button"
                        onClick={onBack}
                        className="px-6 py-3 border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition"
                    >
                        ← Back
                    </button>
                    <button
                        type="button"
                        onClick={handleContinue}
                        className="flex-1 py-3 px-6 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold transition"
                    >
                        Continue →
                    </button>
                </div>
            </div>
        </div>
    );
}
