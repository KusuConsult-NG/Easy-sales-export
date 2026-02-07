"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    Store, MapPin, FileText, CreditCard,
    ArrowLeft, ArrowRight, Check, Upload, X
} from "lucide-react";
import Link from "next/link";

type VerificationStep = 1 | 2 | 3 | 4;

export default function SellerVerificationPage() {
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState<VerificationStep>(1);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [formData, setFormData] = useState({
        businessName: "",
        businessType: "individual" as "individual" | "company" | "cooperative",
        businessDescription: "",
        phone: "",
        email: "",
        address: "",
        state: "",
        lga: "",
        bankName: "",
        accountNumber: "",
        accountName: "",
    });

    const [documents, setDocuments] = useState({
        businessDoc: null as File | null,
        idDoc: null as File | null,
        addressProof: null as File | null,
    });

    const nigerianStates = [
        "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
        "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo",
        "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
        "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers",
        "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT"
    ];

    const handleFileChange = (field: keyof typeof documents, file: File | null) => {
        setDocuments(prev => ({ ...prev, [field]: file }));
    };

    const handleNext = () => {
        if (currentStep < 4) {
            setCurrentStep((currentStep + 1) as VerificationStep);
        }
    };

    const handleBack = () => {
        if (currentStep > 1) {
            setCurrentStep((currentStep - 1) as VerificationStep);
        }
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            // Create FormData for file uploads
            const submitData = new FormData();

            // Add form fields
            Object.entries(formData).forEach(([key, value]) => {
                submitData.append(key, value);
            });

            // Add files
            if (documents.businessDoc) submitData.append("businessDoc", documents.businessDoc);
            if (documents.idDoc) submitData.append("idDoc", documents.idDoc);
            if (documents.addressProof) submitData.append("addressProof", documents.addressProof);

            const response = await fetch("/api/marketplace/submit-verification", {
                method: "POST",
                body: submitData,
            });

            const data = await response.json();

            if (data.success) {
                alert("Verification submitted successfully! Our team will review your application.");
                router.push("/marketplace/sell");
            } else {
                alert(data.message || "Failed to submit verification");
            }
        } catch (error) {
            alert("An error occurred while submitting your verification");
        } finally {
            setIsSubmitting(false);
        }
    };

    const steps = [
        { number: 1, title: "Business Info", icon: Store },
        { number: 2, title: "Location", icon: MapPin },
        { number: 3, title: "Documents", icon: FileText },
        { number: 4, title: "Bank Details", icon: CreditCard },
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-4xl mx-auto px-4">
                <Link
                    href="/marketplace/sell"
                    className="inline-flex items-center gap-2 text-primary hover:underline mb-6"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </Link>

                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl overflow-hidden">
                    {/* Header */}
                    <div className="bg-linear-to-r from-green-600 to-emerald-600 p-8 text-white">
                        <h1 className="text-3xl font-bold mb-2">Seller Verification</h1>
                        <p className="text-green-100">
                            Complete the verification process to start selling on our marketplace
                        </p>
                    </div>

                    {/* Progress Steps */}
                    <div className="p-8 border-b border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                            {steps.map((step, index) => {
                                const Icon = step.icon;
                                const isActive = currentStep === step.number;
                                const isCompleted = currentStep > step.number;

                                return (
                                    <div key={step.number} className="flex items-center flex-1">
                                        <div className="flex flex-col items-center flex-1">
                                            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 transition-all ${isCompleted
                                                    ? "bg-green-600 text-white"
                                                    : isActive
                                                        ? "bg-primary text-white"
                                                        : "bg-slate-200 dark:bg-slate-700 text-slate-400"
                                                }`}>
                                                {isCompleted ? (
                                                    <Check className="w-6 h-6" />
                                                ) : (
                                                    <Icon className="w-6 h-6" />
                                                )}
                                            </div>
                                            <p className={`text-sm font-semibold ${isActive ? "text-primary" : "text-slate-600 dark:text-slate-400"
                                                }`}>
                                                {step.title}
                                            </p>
                                        </div>
                                        {index < steps.length - 1 && (
                                            <div className={`h-1 flex-1 mx-2 ${isCompleted ? "bg-green-600" : "bg-slate-200 dark:bg-slate-700"
                                                }`} />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Form Content */}
                    <div className="p-8">
                        {/* Step 1: Business Information */}
                        {currentStep === 1 && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                    Business Information
                                </h2>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Business Name *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.businessName}
                                        onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Enter your business name"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Business Type *
                                    </label>
                                    <select
                                        value={formData.businessType}
                                        onChange={(e) => setFormData({ ...formData, businessType: e.target.value as any })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                    >
                                        <option value="individual">Individual/Sole Proprietor</option>
                                        <option value="company">Registered Company</option>
                                        <option value="cooperative">Cooperative Society</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Business Description *
                                    </label>
                                    <textarea
                                        value={formData.businessDescription}
                                        onChange={(e) => setFormData({ ...formData, businessDescription: e.target.value })}
                                        rows={4}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Describe your business and the products you'll be selling..."
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        {/* Step 2: Location */}
                        {currentStep === 2 && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                    Contact & Location
                                </h2>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Phone Number *
                                    </label>
                                    <input
                                        type="tel"
                                        value={formData.phone}
                                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="08012345678"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Email Address *
                                    </label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="you@example.com"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Business Address *
                                    </label>
                                    <textarea
                                        value={formData.address}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                        rows={3}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Enter your full business address"
                                        required
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                            State *
                                        </label>
                                        <select
                                            value={formData.state}
                                            onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                            required
                                        >
                                            <option value="">Select State</option>
                                            {nigerianStates.map(state => (
                                                <option key={state} value={state}>{state}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                            LGA *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.lga}
                                            onChange={(e) => setFormData({ ...formData, lga: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                            placeholder="Enter LGA"
                                            required
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 3: Documents */}
                        {currentStep === 3 && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                    Upload Documents
                                </h2>

                                <FileUploadField
                                    label="Business Registration/CAC Document"
                                    description="Upload CAC certificate, business permit, or cooperative registration"
                                    file={documents.businessDoc}
                                    onChange={(file) => handleFileChange("businessDoc", file)}
                                    required
                                />

                                <FileUploadField
                                    label="Valid ID Card"
                                    description="Upload National ID, Driver's License, or International Passport"
                                    file={documents.idDoc}
                                    onChange={(file) => handleFileChange("idDoc", file)}
                                    required
                                />

                                <FileUploadField
                                    label="Proof of Address"
                                    description="Upload utility bill, bank statement, or tenancy agreement (not older than 3 months)"
                                    file={documents.addressProof}
                                    onChange={(file) => handleFileChange("addressProof", file)}
                                    required
                                />
                            </div>
                        )}

                        {/* Step 4: Bank Details */}
                        {currentStep === 4 && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                    Bank Account Details
                                </h2>

                                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
                                    <p className="text-sm text-blue-900 dark:text-blue-100">
                                        💡 Your bank account will be used for receiving payments from sales. Ensure the account name matches your business name.
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Bank Name *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.bankName}
                                        onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="e.g., First Bank of Nigeria"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Account Number *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.accountNumber}
                                        onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="1234567890"
                                        maxLength={10}
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Account Name *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.accountName}
                                        onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Account name as per bank records"
                                        required
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Navigation Buttons */}
                    <div className="p-8 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                        <button
                            onClick={handleBack}
                            disabled={currentStep === 1}
                            className="px-6 py-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <ArrowLeft className="w-5 h-5" />
                            Back
                        </button>

                        {currentStep < 4 ? (
                            <button
                                onClick={handleNext}
                                className="px-6 py-3 bg-linear-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold rounded-xl transition-all flex items-center gap-2"
                            >
                                Next
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        ) : (
                            <button
                                onClick={handleSubmit}
                                disabled={isSubmitting}
                                className="px-6 py-3 bg-linear-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    <>
                                        <Check className="w-5 h-5" />
                                        Submit Verification
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Helper component for file uploads
function FileUploadField({
    label,
    description,
    file,
    onChange,
    required
}: {
    label: string;
    description: string;
    file: File | null;
    onChange: (file: File | null) => void;
    required?: boolean;
}) {
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0] || null;
        onChange(selectedFile);
    };

    return (
        <div>
            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                {label} {required && "*"}
            </label>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{description}</p>

            <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6">
                {file ? (
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <FileText className="w-8 h-8 text-green-600" />
                            <div>
                                <p className="font-semibold text-slate-900 dark:text-white">{file.name}</p>
                                <p className="text-sm text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                        </div>
                        <button
                            onClick={() => onChange(null)}
                            className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-red-600" />
                        </button>
                    </div>
                ) : (
                    <label className="flex flex-col items-center cursor-pointer">
                        <Upload className="w-12 h-12 text-slate-400 mb-3" />
                        <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                            Click to upload
                        </p>
                        <p className="text-xs text-slate-500">PDF, JPG, PNG (max 5MB)</p>
                        <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={handleFileSelect}
                            className="hidden"
                            required={required}
                        />
                    </label>
                )}
            </div>
        </div>
    );
}
