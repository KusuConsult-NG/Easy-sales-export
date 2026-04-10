"use client";

import { useState } from "react";
import { NIGERIAN_LOCATIONS, STATES } from "@/lib/locations";
import { useToast } from "@/contexts/ToastContext";
import { FormInput, FormSelect, FormField } from "@/components/ui/FormField";

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
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-2xl font-bold text-slate-900 mb-1">Personal Information</h2>
                <p className="text-sm text-slate-600">Tell us about yourself</p>
            </div>

            {/* KYC Notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3">
                <span className="text-amber-500 text-base shrink-0 mt-0.5">⚠️</span>
                <p className="text-sm text-amber-800">
                    <strong>KYC Notice:</strong> Enter your name exactly as it appears on your NIN/BVN to avoid identity verification failure.
                </p>
            </div>

            {/* Form */}
            <div className="space-y-6">

                {/* First Name + Last Name */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput
                        label="First Name"
                       
                        required
                        value={data.firstName}
                        onChange={(e) => onChange({ ...data, firstName: e.target.value })}
                        placeholder="e.g. Amina"
                        error={errors.firstName}
                        hint="As on your NIN/BVN"
                    />
                    <FormInput
                        label="Last Name"
                       
                        required
                        value={data.lastName}
                        onChange={(e) => onChange({ ...data, lastName: e.target.value })}
                        placeholder="e.g. Ibrahim"
                        error={errors.lastName}
                        hint="As on your NIN/BVN"
                    />
                </div>

                {/* Other Name + Date of Birth */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput
                        label="Other Name"
                       
                        optional
                        value={data.otherName || ""}
                        onChange={(e) => onChange({ ...data, otherName: e.target.value })}
                        placeholder="e.g. Fatima"
                    />
                    <FormInput
                        label="Date of Birth"
                       
                        type="date"
                        value={data.dateOfBirth}
                        onChange={(e) => onChange({ ...data, dateOfBirth: e.target.value })}
                    />
                </div>

                {/* Phone + Email */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput
                        label="Phone Number"
                       
                        required
                        type="tel"
                        value={data.phone}
                        onChange={(e) => onChange({ ...data, phone: e.target.value })}
                        placeholder="08012345678"
                        error={errors.phone}
                    />
                    <FormInput
                        label="Email Address"
                       
                        required
                        type="email"
                        value={data.email}
                        onChange={(e) => onChange({ ...data, email: e.target.value })}
                        placeholder="you@email.com"
                        error={errors.email}
                    />
                </div>

                {/* Gender + Occupation */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormSelect
                        label="Gender"
                       
                        required
                        value={data.gender}
                        onChange={(e) => onChange({ ...data, gender: e.target.value })}
                        error={errors.gender}
                    >
                        <option value="">Select gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                    </FormSelect>
                    <FormInput
                        label="Occupation"
                       
                        required
                        value={data.occupation}
                        onChange={(e) => onChange({ ...data, occupation: e.target.value })}
                        placeholder="e.g. Farmer, Trader"
                        error={errors.occupation}
                    />
                </div>

                {/* State + LGA */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormSelect
                        label="State"
                       
                        required
                        value={data.address.state}
                        onChange={(e) => onChange({ ...data, address: { ...data.address, state: e.target.value, lga: "" } })}
                        error={errors.state}
                    >
                        <option value="">Select state</option>
                        {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </FormSelect>
                    <FormSelect
                        label="LGA"
                       
                        required
                        value={data.address.lga}
                        onChange={(e) => onChange({ ...data, address: { ...data.address, lga: e.target.value } })}
                        disabled={!data.address.state}
                        error={errors.lga}
                    >
                        <option value="">Select LGA</option>
                        {data.address.state && NIGERIAN_LOCATIONS[data.address.state]?.map((lga) => (
                            <option key={lga} value={lga}>{lga}</option>
                        ))}
                    </FormSelect>
                </div>

                {/* Street Address — full width is appropriate here */}
                <FormInput
                    label="Street Address"
                   
                    required
                    value={data.address.street}
                    onChange={(e) => onChange({ ...data, address: { ...data.address, street: e.target.value } })}
                    placeholder="123 Main Street, Area"
                    error={errors.street}
                />

                {/* Navigation */}
                <div className="flex gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onBack}
                        className="px-5 py-2.5 text-sm border border-slate-200 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition"
                    >
                        ← Back
                    </button>
                    <button
                        type="button"
                        onClick={handleContinue}
                        className="flex-1 py-2.5 px-5 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold transition"
                    >
                        Continue →
                    </button>
                </div>
            </div>
        </div>
    );
}
