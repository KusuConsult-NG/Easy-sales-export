"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Users, Shield, DollarSign, CheckCircle, Loader2 } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";

export default function CooperativeRegisterPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const [step, setStep] = useState(1); // 1: Form, 2: Tier Selection, 3: Payment
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [formData, setFormData] = useState({
        // Personal Information
        firstName: "",
        middleName: "",
        lastName: "",
        dateOfBirth: "",
        gender: "male" as "male" | "female",
        email: "",
        phone: "",
        stateOfOrigin: "",
        lga: "",
        residentialAddress: "",
        occupation: "",

        // Next of Kin
        nextOfKin: {
            fullName: "",
            phone: "",
            residentialAddress: "",
        },

        // Membership Tier
        tier: "basic" as "basic" | "premium",
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateStep1 = () => {
        const newErrors: Record<string, string> = {};

        if (!formData.firstName.trim()) newErrors.firstName = "First name is required";
        if (!formData.lastName.trim()) newErrors.lastName = "Last name is required";
        if (!formData.dateOfBirth) newErrors.dateOfBirth = "Date of birth is required";
        if (!formData.email.trim()) newErrors.email = "Email is required";
        if (!formData.phone.trim()) newErrors.phone = "Phone number is required";
        if (!formData.stateOfOrigin.trim()) newErrors.stateOfOrigin = "State of origin is required";
        if (!formData.lga.trim()) newErrors.lga = "LGA is required";
        if (!formData.residentialAddress.trim()) newErrors.residentialAddress = "Address is required";
        if (!formData.occupation.trim()) newErrors.occupation = "Occupation is required";
        if (!formData.nextOfKin.fullName.trim()) newErrors.nextOfKinFullName = "Next of kin name is required";
        if (!formData.nextOfKin.phone.trim()) newErrors.nextOfKinPhone = "Next of kin phone is required";
        if (!formData.nextOfKin.residentialAddress.trim()) newErrors.nextOfKinAddress = "Next of kin address is required";

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNext = () => {
        if (step === 1 && validateStep1()) {
            setStep(2);
        }
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);

        try {
            const response = await fetch("/api/cooperatives/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });

            const data = await response.json();

            if (data.success && data.paymentUrl) {
                showToast("Redirecting to payment...", "success");
                window.location.href = data.paymentUrl;
            } else {
                showToast(data.error || "Registration failed", "error");
            }
        } catch (error) {
            showToast("An error occurred. Please try again.", "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    const tierPrice = formData.tier === "basic" ? 10000 : 20000;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <Link
                        href="/cooperatives"
                        className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                            Join Cooperative
                        </h1>
                        <p className="text-slate-600 dark:text-slate-400">
                            Register as a cooperative member
                        </p>
                    </div>
                </div>

                {/* Progress Steps */}
                <div className="flex items-center justify-center gap-4 mb-8">
                    <div className={`flex items-center gap-2 ${step >= 1 ? "text-green-600" : "text-slate-400"}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 1 ? "bg-green-600 text-white" : "bg-slate-200 dark:bg-slate-700"}`}>
                            {step > 1 ? <CheckCircle className="w-5 h-5" /> : "1"}
                        </div>
                        <span className="hidden sm:inline font-semibold">Personal Info</span>
                    </div>
                    <div className="w-12 h-0.5 bg-slate-200 dark:bg-slate-700" />
                    <div className={`flex items-center gap-2 ${step >= 2 ? "text-green-600" : "text-slate-400"}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 2 ? "bg-green-600 text-white" : "bg-slate-200 dark:bg-slate-700"}`}>
                            {step > 2 ? <CheckCircle className="w-5 h-5" /> : "2"}
                        </div>
                        <span className="hidden sm:inline font-semibold">Membership Tier</span>
                    </div>
                    <div className="w-12 h-0.5 bg-slate-200 dark:bg-slate-700" />
                    <div className={`flex items-center gap-2 ${step >= 3 ? "text-green-600" : "text-slate-400"}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 3 ? "bg-green-600 text-white" : "bg-slate-200 dark:bg-slate-700"}`}>
                            3
                        </div>
                        <span className="hidden sm:inline font-semibold">Payment</span>
                    </div>
                </div>

                {/* Step 1: Personal Information */}
                {step === 1 && (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 md:p-8 shadow-xl">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                            Personal Information
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* First Name */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    First Name *
                                </label>
                                <input
                                    type="text"
                                    value={formData.firstName}
                                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                    className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.firstName ? "border-red-400" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500`}
                                    placeholder="John"
                                />
                                {errors.firstName && <p className="text-red-400 text-sm mt-1">{errors.firstName}</p>}
                            </div>

                            {/* Middle Name */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Middle Name
                                </label>
                                <input
                                    type="text"
                                    value={formData.middleName}
                                    onChange={(e) => setFormData({ ...formData, middleName: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500"
                                    placeholder="Optional"
                                />
                            </div>

                            {/* Last Name */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Last Name *
                                </label>
                                <input
                                    type="text"
                                    value={formData.lastName}
                                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                    className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.lastName ? "border-red-400" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500`}
                                    placeholder="Doe"
                                />
                                {errors.lastName && <p className="text-red-400 text-sm mt-1">{errors.lastName}</p>}
                            </div>

                            {/* Date of Birth */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Date of Birth *
                                </label>
                                <input
                                    type="date"
                                    value={formData.dateOfBirth}
                                    onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                                    className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.dateOfBirth ? "border-red-400" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500`}
                                />
                                {errors.dateOfBirth && <p className="text-red-400 text-sm mt-1">{errors.dateOfBirth}</p>}
                            </div>

                            {/* Gender */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Gender *
                                </label>
                                <select
                                    value={formData.gender}
                                    onChange={(e) => setFormData({ ...formData, gender: e.target.value as "male" | "female" })}
                                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500"
                                >
                                    <option value="male">Male</option>
                                    <option value="female">Female</option>
                                </select>
                            </div>

                            {/* Email */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Email Address *
                                </label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.email ? "border-red-400" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500`}
                                    placeholder="john@example.com"
                                />
                                {errors.email && <p className="text-red-400 text-sm mt-1">{errors.email}</p>}
                            </div>

                            {/* Phone */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Phone Number *
                                </label>
                                <input
                                    type="tel"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.phone ? "border-red-400" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500`}
                                    placeholder="08012345678"
                                />
                                {errors.phone && <p className="text-red-400 text-sm mt-1">{errors.phone}</p>}
                            </div>

                            {/* State of Origin */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    State of Origin *
                                </label>
                                <input
                                    type="text"
                                    value={formData.stateOfOrigin}
                                    onChange={(e) => setFormData({ ...formData, stateOfOrigin: e.target.value })}
                                    className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.stateOfOrigin ? "border-red-400" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500`}
                                    placeholder="Plateau"
                                />
                                {errors.stateOfOrigin && <p className="text-red-400 text-sm mt-1">{errors.stateOfOrigin}</p>}
                            </div>

                            {/* LGA */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Local Government Area *
                                </label>
                                <input
                                    type="text"
                                    value={formData.lga}
                                    onChange={(e) => setFormData({ ...formData, lga: e.target.value })}
                                    className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.lga ? "border-red-400" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500`}
                                    placeholder="Jos North"
                                />
                                {errors.lga && <p className="text-red-400 text-sm mt-1">{errors.lga}</p>}
                            </div>

                            {/* Residential Address */}
                            <div className="md:col-span-2">
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Residential Address *
                                </label>
                                <textarea
                                    value={formData.residentialAddress}
                                    onChange={(e) => setFormData({ ...formData, residentialAddress: e.target.value })}
                                    className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.residentialAddress ? "border-red-400" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500`}
                                    rows={3}
                                    placeholder="Full residential address"
                                />
                                {errors.residentialAddress && <p className="text-red-400 text-sm mt-1">{errors.residentialAddress}</p>}
                            </div>

                            {/* Occupation */}
                            <div className="md:col-span-2">
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Occupation *
                                </label>
                                <input
                                    type="text"
                                    value={formData.occupation}
                                    onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
                                    className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.occupation ? "border-red-400" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500`}
                                    placeholder="Farmer, Trader, etc."
                                />
                                {errors.occupation && <p className="text-red-400 text-sm mt-1">{errors.occupation}</p>}
                            </div>
                        </div>

                        {/* Next of Kin Section */}
                        <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-700">
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">
                                Next of Kin Information
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Next of Kin Name */}
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Full Name *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.nextOfKin.fullName}
                                        onChange={(e) => setFormData({ ...formData, nextOfKin: { ...formData.nextOfKin, fullName: e.target.value } })}
                                        className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.nextOfKinFullName ? "border-red-400" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500`}
                                        placeholder="Next of kin full name"
                                    />
                                    {errors.nextOfKinFullName && <p className="text-red-400 text-sm mt-1">{errors.nextOfKinFullName}</p>}
                                </div>

                                {/* Next of Kin Phone */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Phone Number *
                                    </label>
                                    <input
                                        type="tel"
                                        value={formData.nextOfKin.phone}
                                        onChange={(e) => setFormData({ ...formData, nextOfKin: { ...formData.nextOfKin, phone: e.target.value } })}
                                        className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.nextOfKinPhone ? "border-red-400" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500`}
                                        placeholder="08012345678"
                                    />
                                    {errors.nextOfKinPhone && <p className="text-red-400 text-sm mt-1">{errors.nextOfKinPhone}</p>}
                                </div>

                                {/* Next of Kin Address */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Residential Address *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.nextOfKin.residentialAddress}
                                        onChange={(e) => setFormData({ ...formData, nextOfKin: { ...formData.nextOfKin, residentialAddress: e.target.value } })}
                                        className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.nextOfKinAddress ? "border-red-400" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500`}
                                        placeholder="Next of kin address"
                                    />
                                    {errors.nextOfKinAddress && <p className="text-red-400 text-sm mt-1">{errors.nextOfKinAddress}</p>}
                                </div>
                            </div>
                        </div>

                        {/* Next Button */}
                        <div className="mt-8 flex justify-end">
                            <button
                                onClick={handleNext}
                                className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition shadow-lg"
                            >
                                Continue to Tier Selection
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 2: Tier Selection */}
                {step === 2 && (
                    <div className="space-y-6">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                            Choose Membership Tier
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Basic Tier */}
                            <button
                                onClick={() => setFormData({ ...formData, tier: "basic" })}
                                className={`p-6 rounded-2xl border-2 transition ${formData.tier === "basic"
                                    ? "border-green-600 bg-green-50 dark:bg-green-900/20"
                                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                                    }`}
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <Shield className="w-8 h-8 text-green-600" />
                                    {formData.tier === "basic" && <CheckCircle className="w-6 h-6 text-green-600" />}
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                    Basic Membership
                                </h3>
                                <p className="text-3xl font-bold text-green-600 mb-4">
                                    ₦10,000
                                </p>
                                <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-2">
                                    <li>✓ Savings account</li>
                                    <li>✓ Loan eligibility</li>
                                    <li>✓ Member benefits</li>
                                    <li>✓ Basic support</li>
                                </ul>
                            </button>

                            {/* Premium Tier */}
                            <button
                                onClick={() => setFormData({ ...formData, tier: "premium" })}
                                className={`p-6 rounded-2xl border-2 transition ${formData.tier === "premium"
                                    ? "border-green-600 bg-green-50 dark:bg-green-900/20"
                                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                                    }`}
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <Users className="w-8 h-8 text-green-600" />
                                    {formData.tier === "premium" && <CheckCircle className="w-6 h-6 text-green-600" />}
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                    Premium Membership
                                </h3>
                                <p className="text-3xl font-bold text-green-600 mb-4">
                                    ₦20,000
                                </p>
                                <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-2">
                                    <li>✓ All Basic features</li>
                                    <li>✓ Higher loan limits</li>
                                    <li>✓ Priority support</li>
                                    <li>✓ Exclusive benefits</li>
                                </ul>
                            </button>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex justify-between">
                            <button
                                onClick={() => setStep(1)}
                                className="px-6 py-3 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-xl transition hover:bg-slate-300 dark:hover:bg-slate-600"
                            >
                                Back
                            </button>
                            <button
                                onClick={() => setStep(3)}
                                className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition shadow-lg"
                            >
                                Continue to Payment
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 3: Payment Confirmation */}
                {step === 3 && (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 md:p-8 shadow-xl">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                            Payment Summary
                        </h2>

                        <div className="space-y-4 mb-8">
                            <div className="flex justify-between items-center py-3 border-b border-slate-200 dark:border-slate-700">
                                <span className="text-slate-600 dark:text-slate-400">Membership Tier</span>
                                <span className="font-semibold text-slate-900 dark:text-white capitalize">
                                    {formData.tier}
                                </span>
                            </div>
                            <div className="flex justify-between items-center py-3 border-b border-slate-200 dark:border-slate-700">
                                <span className="text-slate-600 dark:text-slate-400">Registration Fee</span>
                                <span className="text-2xl font-bold text-green-600">
                                    ₦{tierPrice.toLocaleString()}
                                </span>
                            </div>
                        </div>

                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-8">
                            <p className="text-sm text-blue-800 dark:text-blue-200">
                                <DollarSign className="w-4 h-4 inline mr-1" />
                                After payment, your application will be reviewed by an administrator. You'll receive email notification once approved.
                            </p>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex justify-between">
                            <button
                                onClick={() => setStep(2)}
                                disabled={isSubmitting}
                                className="px-6 py-3 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-xl transition hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={isSubmitting}
                                className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition shadow-lg flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        Proceed to Payment
                                        <DollarSign className="w-5 h-5" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
