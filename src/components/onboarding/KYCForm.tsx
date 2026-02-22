/**
 * KYC Form Component
 * 
 * Reusable component for collecting KYC (Know Your Customer) information
 */

"use client";

import { useState } from "react";
import { User, MapPin, Phone, Calendar } from "lucide-react";

export interface KYCData {
    fullName: string;
    dateOfBirth: string;
    address: string;
    city: string;
    state: string;
    phoneNumber: string;
    bvn?: string;
    idType?: "nin" | "drivers_license" | "international_passport" | "voters_card";
    idNumber?: string;
    idVerified?: boolean;
    idError?: string;
    verifying?: boolean;
}

interface KYCFormProps {
    onDataChange: (data: Partial<KYCData>) => void;
    initialData?: Partial<KYCData>;
    includeBVN?: boolean;
}

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
    "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe",
    "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara",
    "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau",
    "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT"
];

const ID_TYPES = [
    { value: "nin", label: "National Identity Number (NIN)" },
];

export function KYCForm({ onDataChange, initialData, includeBVN = false }: KYCFormProps) {
    const [formData, setFormData] = useState<Partial<KYCData>>(initialData || {});

    const handleChange = (field: keyof KYCData, value: any) => {
        const updated = { ...formData, [field]: value };
        setFormData(updated);
        onDataChange(updated);
    };

    return (
        <div className="space-y-6">
            {/* Full Name */}
            <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                    Full Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        value={formData.fullName || ""}
                        onChange={(e) => handleChange("fullName", e.target.value)}
                        placeholder="Enter your full name"
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Date of Birth */}
            <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                    Date of Birth <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="date"
                        value={formData.dateOfBirth || ""}
                        onChange={(e) => handleChange("dateOfBirth", e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Phone Number */}
            <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                    Phone Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="tel"
                        value={formData.phoneNumber || ""}
                        onChange={(e) => handleChange("phoneNumber", e.target.value)}
                        placeholder="+234 800 000 0000"
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Address */}
            <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                    Street Address <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <MapPin className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                    <textarea
                        value={formData.address || ""}
                        onChange={(e) => handleChange("address", e.target.value)}
                        placeholder="Enter your street address"
                        rows={3}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
                    />
                </div>
            </div>

            {/* City and State */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* City */}
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        City <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.city || ""}
                        onChange={(e) => handleChange("city", e.target.value)}
                        placeholder="e.g., Lagos"
                        className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>

                {/* State */}
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        State <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={formData.state || ""}
                        onChange={(e) => handleChange("state", e.target.value)}
                        className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    >
                        <option value="">Select state</option>
                        {NIGERIAN_STATES.map((state) => (
                            <option key={state} value={state}>
                                {state}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* BVN (Optional) */}
            {includeBVN && (
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        Bank Verification Number (BVN) <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.bvn || ""}
                        onChange={(e) => {
                            const value = e.target.value.replace(/\D/g, "").slice(0, 11);
                            handleChange("bvn", value);
                        }}
                        placeholder="12345678901"
                        maxLength={11}
                        className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                        Enter your 11-digit BVN for verification
                    </p>
                </div>
            )}

            {/* ID Type and Number */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ID Type */}
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        ID Type <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={formData.idType || ""}
                        onChange={(e) => handleChange("idType", e.target.value as KYCData["idType"])}
                        className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    >
                        <option value="">Select ID type</option>
                        {ID_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                                {type.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* ID Number & Verification */}
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        ID Number <span className="text-red-500">*</span>
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={formData.idNumber || ""}
                            onChange={(e) => {
                                handleChange("idNumber", e.target.value);
                                handleChange("idVerified", false);
                            }}
                            placeholder="Enter ID number"
                            className="flex-1 px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        />
                        <button
                            type="button"
                            disabled={formData.idVerified || formData.verifying}
                            onClick={async () => {
                                if (!formData.idType || !formData.idNumber) {
                                    handleChange("idError", "Please enter ID type and ID number to verify");
                                    return;
                                }
                                handleChange("verifying", true);
                                try {
                                    const res = await fetch('/api/kyc/verify-id', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            idType: formData.idType,
                                            idNumber: formData.idNumber,
                                            firstName: formData.fullName?.split(' ')[0] || '',
                                            lastName: formData.fullName?.split(' ').slice(1).join(' ') || ''
                                        })
                                    });
                                    const data = await res.json();

                                    if (data.success && data.isMatch) {
                                        handleChange("idVerified", true);
                                        handleChange("idError", "");
                                    } else {
                                        handleChange("idVerified", false);
                                        handleChange("idError", data.error || "ID Verification failed");
                                    }
                                } catch (err) {
                                    handleChange("idVerified", false);
                                    handleChange("idError", "Network error during verification");
                                } finally {
                                    handleChange("verifying", false);
                                }
                            }}
                            className={`px-4 py-2.5 rounded-lg font-medium whitespace-nowrap transition-colors ${formData.idVerified
                                ? "bg-green-100 text-green-700 cursor-default"
                                : formData.verifying
                                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                    : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                                }`}
                        >
                            {formData.verifying ? "Verifying..." : formData.idVerified ? "Verified ✓" : "Verify ID"}
                        </button>
                    </div>
                    {formData.idError && (
                        <p className="mt-1 text-xs text-red-600">{(formData as any).idError}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
