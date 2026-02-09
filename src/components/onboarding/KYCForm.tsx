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
    { value: "drivers_license", label: "Driver's License" },
    { value: "international_passport", label: "International Passport" },
    { value: "voters_card", label: "Voter's Card" },
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
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Full Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        value={formData.fullName || ""}
                        onChange={(e) => handleChange("fullName", e.target.value)}
                        placeholder="Enter your full name"
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Date of Birth */}
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Date of Birth <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="date"
                        value={formData.dateOfBirth || ""}
                        onChange={(e) => handleChange("dateOfBirth", e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Phone Number */}
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Phone Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="tel"
                        value={formData.phoneNumber || ""}
                        onChange={(e) => handleChange("phoneNumber", e.target.value)}
                        placeholder="+234 800 000 0000"
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Address */}
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Street Address <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <MapPin className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                    <textarea
                        value={formData.address || ""}
                        onChange={(e) => handleChange("address", e.target.value)}
                        placeholder="Enter your street address"
                        rows={3}
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
                    />
                </div>
            </div>

            {/* City and State */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* City */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        City <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.city || ""}
                        onChange={(e) => handleChange("city", e.target.value)}
                        placeholder="e.g., Lagos"
                        className="w-full px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>

                {/* State */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        State <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={formData.state || ""}
                        onChange={(e) => handleChange("state", e.target.value)}
                        className="w-full px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
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
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
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
                        className="w-full px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
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
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        ID Type <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={formData.idType || ""}
                        onChange={(e) => handleChange("idType", e.target.value as KYCData["idType"])}
                        className="w-full px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    >
                        <option value="">Select ID type</option>
                        {ID_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                                {type.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* ID Number */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        ID Number <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.idNumber || ""}
                        onChange={(e) => handleChange("idNumber", e.target.value)}
                        placeholder="Enter ID number"
                        className="w-full px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
            </div>
        </div>
    );
}
