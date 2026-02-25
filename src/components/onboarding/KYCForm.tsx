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
    bvnVerified?: boolean;
    bvnError?: string;
    bvnVerifying?: boolean;
    idType?: "nin" | "drivers_license" | "international_passport" | "voters_card";
    idNumber?: string;
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
    { value: "nin", label: "Virtual NIN (vNIN)" },
];

// Max digit length per ID type
const ID_MAX_LENGTH: Record<string, number> = {
    nin: 16,            // QoreID requires 16-digit Virtual NIN (vNIN)
    drivers_license: 12,
    international_passport: 9,
    voters_card: 19,
};

// Helper hint per ID type (shown when no error)
const ID_HINTS: Record<string, string> = {
    nin: "Enter your 16-digit Virtual NIN (vNIN) — not the standard 11-digit NIN.",
    drivers_license: "Enter your 12-character licence number (e.g. ABC123456789).",
    international_passport: "Enter your 9-character passport number.",
    voters_card: "Enter your Voter Identification Number (VIN) as printed on your PVC.",
};

// Shown when user has typed exactly 11 digits into the NIN field
const NIN_ELEVEN_DIGIT_TIP = "This looks like your standard 11-digit NIN. To verify, you need the 16-digit Virtual NIN (vNIN). Dial *346*1*[YOUR NIN]# from your registered phone or use the NIMC Mobile App to generate it.";

// Returns true only if the ID number is ready for API verification
function isIdReadyToVerify(idType: string | undefined, idNumber: string | undefined): boolean {
    if (!idType || !idNumber) return false;
    const digits = idNumber.replace(/\D/g, "");
    if (idType === "nin") return digits.length === 16;
    return digits.length >= 5; // relax for other types
}

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

            {/* BVN */}
            {includeBVN && (
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        Bank Verification Number (BVN) <span className="text-red-500">*</span>
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={formData.bvn || ""}
                            onChange={(e) => {
                                const value = e.target.value.replace(/\D/g, "").slice(0, 11);
                                handleChange("bvn", value);
                                handleChange("bvnVerified", false);
                                handleChange("bvnError", "");
                            }}
                            placeholder="12345678901"
                            maxLength={11}
                            className="flex-1 px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        />
                        <button
                            type="button"
                            disabled={formData.bvnVerified || formData.bvnVerifying || (formData.bvn || "").length !== 11}
                            onClick={async () => {
                                if (!formData.bvn || formData.bvn.length !== 11) {
                                    handleChange("bvnError", "Please enter your 11-digit BVN");
                                    return;
                                }
                                handleChange("bvnVerifying", true);
                                handleChange("bvnError", "");
                                try {
                                    const res = await fetch('/api/kyc/verify-id', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            idType: 'bvn',
                                            idNumber: formData.bvn,
                                            firstName: formData.fullName?.split(' ')[0] || '',
                                            lastName: formData.fullName?.split(' ').slice(1).join(' ') || ''
                                        })
                                    });
                                    const data = await res.json();
                                    if (data.success && data.isMatch) {
                                        handleChange("bvnVerified", true);
                                        handleChange("bvnError", "");
                                    } else {
                                        handleChange("bvnVerified", false);
                                        handleChange("bvnError", data.error || "BVN verification failed. Please check your details.");
                                    }
                                } catch {
                                    handleChange("bvnVerified", false);
                                    handleChange("bvnError", "Network error during verification. Please try again.");
                                } finally {
                                    handleChange("bvnVerifying", false);
                                }
                            }}
                            className={`px-4 py-2.5 rounded-lg font-medium whitespace-nowrap transition-colors ${formData.bvnVerified
                                ? "bg-green-100 text-green-700 cursor-default"
                                : formData.bvnVerifying
                                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                    : (formData.bvn || "").length !== 11
                                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                        : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                                }`}
                        >
                            {formData.bvnVerifying ? "Verifying..." : formData.bvnVerified ? "Verified ✓" : "Verify BVN"}
                        </button>
                    </div>
                    {formData.bvnError && (
                        <p className="mt-1 text-xs text-red-600">{formData.bvnError}</p>
                    )}
                    {!formData.bvnError && !formData.bvnVerified && (
                        <p className="mt-1 text-xs text-slate-500">Enter your 11-digit BVN to verify your identity.</p>
                    )}
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

                {/* ID Number — collect only, no API verification */}
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        ID Number <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.idNumber || ""}
                        onChange={(e) => handleChange("idNumber", e.target.value)}
                        placeholder="Enter ID number"
                        className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* KYC Reminder */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-blue-700">
                    <strong>Complete your KYC later:</strong> Fields like BVN and bank account details are needed for full identity verification. You can update them anytime from your <strong>Profile → Identity Verification</strong> settings.
                </p>
            </div>
        </div>
    );
}
