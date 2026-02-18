/**
 * Step 1: Personal Identification (Section A)
 * Collects comprehensive personal details from the beneficiary
 */

"use client";

import { useState } from "react";
import { CheckCircle, AlertCircle } from "lucide-react";
import type { WaveApplicationData } from "../page";

interface Props {
    data: WaveApplicationData;
    updateData: (data: Partial<WaveApplicationData>) => void;
    onNext: () => void;
}

import { NIGERIAN_LOCATIONS, STATES, getWards, getPollingUnits } from "@/lib/locations";

import { useToast } from "@/contexts/ToastContext";

export default function PersonalDetailsStep({ data, updateData, onNext }: Props) {
    const { showToast } = useToast();
    const [errors, setErrors] = useState<Record<string, string>>({});

    const calculateAge = (dobString: string): number => {
        if (!dobString) return 0;
        const dob = new Date(dobString);
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
            age--;
        }
        return age;
    };

    const handleDateChange = (dobString: string) => {
        const age = calculateAge(dobString);
        updateData({ dateOfBirth: dobString, age });
    };

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!data.surname.trim()) newErrors.surname = "Surname is required";
        if (!data.firstName.trim()) newErrors.firstName = "First name is required";
        // Phone validation: Strict 11 digits
        if (!data.phone.trim()) {
            newErrors.phone = "Phone number is required";
        } else if (data.phone.length !== 11) {
            newErrors.phone = "Phone number must be exactly 11 digits";
        } else if (!/^0[789][01]\d{8}$/.test(data.phone)) {
            // Basic Nigerian phone format check (starts with 07/08/09 + digit)
            newErrors.phone = "Please enter a valid Nigerian phone number";
        }

        if (!data.dateOfBirth) {
            if (!data.dateOfBirth) {
                newErrors.dateOfBirth = "Date of birth is required";
            } else if (data.age < 18 || data.age > 100) {
                newErrors.dateOfBirth = "You must be between 18 and 100 years old";
            }
            if (!data.residentialAddress.trim()) newErrors.residentialAddress = "Residential address is required";
            if (!data.stateOfOrigin) newErrors.stateOfOrigin = "State of origin is required";
            if (!data.lgaOfOrigin.trim()) newErrors.lgaOfOrigin = "LGA of origin is required";
            if (!data.stateOfResidence) newErrors.stateOfResidence = "State of residence is required";
            if (!data.lgaOfResidence.trim()) newErrors.lgaOfResidence = "LGA of residence is required";
            if (!data.maritalStatus) newErrors.maritalStatus = "Marital status is required";
            if (!data.nextOfKinName.trim()) newErrors.nextOfKinName = "Next of kin name is required";
            if (!data.nextOfKinPhone.trim()) newErrors.nextOfKinPhone = "Next of kin phone is required";
            if (!data.nextOfKinRelationship.trim()) newErrors.nextOfKinRelationship = "Relationship is required";

            setErrors(newErrors);
            return Object.keys(newErrors).length === 0;
        };

        const handleNext = () => {
            if (validateForm()) {
                onNext();
            } else {
                showToast("Please correct the errors in the form", "error");
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        };

        return (
            <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    Section A: Personal Identification
                </h2>
                <p className="text-slate-600 mb-8">
                    Please provide your personal details as they appear on your National ID (NIN)
                </p>

                <div className="space-y-6">
                    {/* Name Fields */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Surname (as on NIN) *
                            </label>
                            <input
                                type="text"
                                value={data.surname}
                                onChange={(e) => updateData({ surname: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                                placeholder="Surname"
                            />
                            {errors.surname && (
                                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.surname}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                First Name (as on NIN) *
                            </label>
                            <input
                                type="text"
                                value={data.firstName}
                                onChange={(e) => updateData({ firstName: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                                placeholder="First Name"
                            />
                            {errors.firstName && (
                                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.firstName}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Other Names
                            </label>
                            <input
                                type="text"
                                value={data.otherNames}
                                onChange={(e) => updateData({ otherNames: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                                placeholder="Middle name (optional)"
                            />
                        </div>
                    </div>

                    {/* Date of Birth & Age */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Date of Birth *
                            </label>
                            <input
                                type="date"
                                value={data.dateOfBirth}
                                onChange={(e) => handleDateChange(e.target.value)}
                                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            />
                            {errors.dateOfBirth && (
                                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.dateOfBirth}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Age
                            </label>
                            <input
                                type="number"
                                value={data.age || ""}
                                readOnly
                                className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-slate-100 cursor-not-allowed"
                                placeholder="Auto-calculated"
                            />
                        </div>
                    </div>

                    {/* Contact Information */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Phone Number (Primary) *
                            </label>
                            <input
                                type="tel"
                                value={data.phone}
                                onChange={(e) => {
                                    const val = e.target.value.replace(/\D/g, "").slice(0, 11);
                                    updateData({ phone: val });
                                }}
                                maxLength={11}
                                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                                placeholder="08012345678"
                            />
                            {errors.phone && (
                                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.phone}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Alternative Phone Number
                            </label>
                            <input
                                type="tel"
                                value={data.alternativePhone}
                                onChange={(e) => updateData({ alternativePhone: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                                placeholder="08098765432 (optional)"
                            />
                        </div>
                    </div>

                    {/* Email Address */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Email Address (if available)
                        </label>
                        <input
                            type="email"
                            value={data.email}
                            onChange={(e) => updateData({ email: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            placeholder="youremail@example.com (optional)"
                        />
                    </div>

                    {/* Residential Address */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Residential Address *
                        </label>
                        <textarea
                            value={data.residentialAddress}
                            onChange={(e) => updateData({ residentialAddress: e.target.value })}
                            rows={3}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 resize-none"
                            placeholder="Your current residential address"
                        />
                        {errors.residentialAddress && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.residentialAddress}
                            </p>
                        )}
                    </div>

                    {/* State of Origin & LGA */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                State of Origin *
                            </label>
                            <select
                                value={data.stateOfOrigin}
                                onChange={(e) => updateData({ stateOfOrigin: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            >
                                <option value="">Select state</option>
                                {STATES.map((state) => (
                                    <option key={state} value={state}>
                                        {state}
                                    </option>
                                ))}
                            </select>
                            {errors.stateOfOrigin && (
                                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.stateOfOrigin}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Local Government Area (LGA) *
                            </label>
                        </label>
                        <select
                            value={data.lgaOfOrigin}
                            onChange={(e) => updateData({ lgaOfOrigin: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            disabled={!data.stateOfOrigin}
                        >
                            <option value="">Select LGA</option>
                            {data.stateOfOrigin && NIGERIAN_LOCATIONS[data.stateOfOrigin]?.map((lga) => (
                                <option key={lga} value={lga}>{lga}</option>
                            )) || []}
                        </select>
                        {errors.lgaOfOrigin && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.lgaOfOrigin}
                            </p>
                        )}
                    </div>
                </div>

                {/* State of Residence & LGA */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            State of Residence *
                        </label>
                        <select
                            value={data.stateOfResidence}
                            onChange={(e) => updateData({ stateOfResidence: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                        >
                            <option value="">Select state</option>
                            {STATES.map((state) => (
                                <option key={state} value={state}>
                                    {state}
                                </option>
                            ))}
                        </select>
                        {errors.stateOfResidence && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.stateOfResidence}
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Local Government of Residence *
                        </label>
                    </label>
                    <select
                        value={data.lgaOfResidence}
                        onChange={(e) => updateData({ lgaOfResidence: e.target.value })}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                        disabled={!data.stateOfResidence}
                    >
                        <option value="">Select LGA</option>
                        {data.stateOfResidence && NIGERIAN_LOCATIONS[data.stateOfResidence]?.map((lga) => (
                            <option key={lga} value={lga}>{lga}</option>
                        )) || []}
                    </select>
                    {errors.lgaOfResidence && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.lgaOfResidence}
                        </p>
                    )}
                </div>
            </div>

                {/* Marital Status */ }
        <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
                Marital Status *
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { value: "single", label: "Single" },
                    { value: "married", label: "Married" },
                    { value: "widowed", label: "Widowed" },
                    { value: "divorced", label: "Divorced" },
                ].map((status) => (
                    <label
                        key={status.value}
                        className={`flex items-center gap-2 px-4 py-3 border rounded-xl cursor-pointer transition-all ${data.maritalStatus === status.value
                            ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                            : "border-slate-300 hover:bg-slate-50"
                            }`}
                    >
                        <input
                            type="radio"
                            name="maritalStatus"
                            value={status.value}
                            checked={data.maritalStatus === status.value}
                            onChange={(e) => updateData({ maritalStatus: e.target.value as any })}
                            className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="font-medium">{status.label}</span>
                    </label>
                ))}
            </div>
            {errors.maritalStatus && (
                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.maritalStatus}
                </p>
            )}
        </div>

        {/* Next of Kin Details */ }
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
                Next of Kin Information
            </h3>
            <div className="space-y-6">
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Next of Kin Name *
                    </label>
                    <input
                        type="text"
                        value={data.nextOfKinName}
                        onChange={(e) => updateData({ nextOfKinName: e.target.value })}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                        placeholder="Full name of next of kin"
                    />
                    {errors.nextOfKinName && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.nextOfKinName}
                        </p>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Next of Kin Phone Number *
                        </label>
                        <input
                            type="tel"
                            value={data.nextOfKinPhone}
                            onChange={(e) => updateData({ nextOfKinPhone: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            placeholder="08012345678"
                        />
                        {errors.nextOfKinPhone && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.nextOfKinPhone}
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Relationship with Next of Kin *
                        </label>
                        <input
                            type="text"
                            value={data.nextOfKinRelationship}
                            onChange={(e) => updateData({ nextOfKinRelationship: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            placeholder="e.g., Spouse, Parent, Sibling"
                        />
                        {errors.nextOfKinRelationship && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.nextOfKinRelationship}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* Next Button */ }
        <div className="mt-8">
            <button
                onClick={handleNext}
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2"
            >
                Continue to Civic Status
                <CheckCircle className="w-5 h-5" />
            </button>
        </div>
    </div >
    );
}
