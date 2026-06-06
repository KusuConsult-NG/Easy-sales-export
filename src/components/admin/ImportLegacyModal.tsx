"use client";

import { useState } from "react";
import {
    Loader2,
    CheckCircle,
    GraduationCap,
    ShieldCheck,
    User,
    MapPin,
    CreditCard,
    FileText,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";
import Modal from "@/components/ui/Modal";
import MasterUploader from "@/components/shared/MasterUploader";
import { onboardLegacyMemberAction } from "@/app/actions/admin";
import { ACADEMY_CONFIG, CURRENCY_CONFIG } from "@/lib/constants";

interface ImportLegacyModalProps {
    module: "academy" | "export" | "wave" | "farmNation" | "cooperative";
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
    "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
    "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
    "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun",
    "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
];


const STEPS = ["Identity", "Location", "Next of Kin", "Documents", "Financial", "Module Details"] as const;
type Step = (typeof STEPS)[number];

export default function ImportLegacyModal({ isOpen, onClose, onSuccess, module }: ImportLegacyModalProps) {
    const [step, setStep] = useState<number>(0);
    const [formData, setFormData] = useState({
        // Step 1 – Identity
        fullName: "",
        email: "",
        phone: "",
        gender: "" as "" | "Male" | "Female",
        dateOfBirth: "",
        occupation: "",
        // Step 2 – Location
        state: "",
        lga: "",
        city: "",
        address: "",
        // Step 3 – Next of Kin
        nextOfKinName: "",
        nextOfKinPhone: "",
        nextOfKinRelationship: "",
        nextOfKinAddress: "",
        // Step 4 – Documents
        validIdUrl: "",
        passportPhotoUrl: "",
        proofOfAddressUrl: "",
        // Step 5 – Financial / KYC (all optional)
        accountNumber: "",
        accountName: "",
        bankName: "",
        bankCode: "",
        nin: "",
        bvn: "",
        // Step 6 – Services
        academyPlan: "foundation" as "foundation" | "standard" | "elite",
        // Module Specific
        exportCompanyName: "",
        exportRcNumber: "",
        exportYearEstablished: "",
        exportBusinessType: "sole_proprietorship",
        exportIndustry: "agriculture",
        waveSurname: "",
        waveResidentialState: "",
        farmNationRole: "farmer" as "farmer" | "buyer" | "seller" | "both",
        farmNationFarmSize: "",
        farmNationCropTypes: "",
        cooperativeAmount: "",
        services: {
            cooperative: module === "cooperative",
            academy: module === "academy",
            marketplace: false,
            export: module === "export",
            wave: module === "wave",
            farmNation: module === "farmNation",
        },
    });

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSuccess, setIsSuccess] = useState(false);

    // ── field helpers ────────────────────────────────────────────────────────
    function field<K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) {
        setFormData((prev) => ({ ...prev, [key]: value }));
    }

    function service(id: keyof typeof formData.services, checked: boolean) {
        setFormData((prev) => ({
            ...prev,
            services: { ...prev.services, [id]: checked },
        }));
    }

    // ── step validation (lightweight client-side) ────────────────────────────
    function validateCurrentStep(): string | null {
        if (step === 0) {
            if (!formData.fullName.trim()) return "Full name is required.";
            if (!formData.email.trim()) return "Email is required.";
            if (!formData.phone.trim()) return "Phone number is required.";
        }
        if (step === 1) {
            if (!formData.state) return "State is required.";
            if (!formData.lga.trim()) return "LGA is required.";
            if (!formData.address.trim()) return "Residential address is required.";
        }
        return null;
    }

    function handleNext() {
        const err = validateCurrentStep();
        if (err) { setError(err); return; }
        setError(null);
        setStep((s) => s + 1);
    }

    function handleBack() {
        setError(null);
        setStep((s) => s - 1);
    }

    // ── submit ───────────────────────────────────────────────────────────────
    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const err = validateCurrentStep();
        if (err) { setError(err); return; }
        setError(null);
        setIsLoading(true);

        const roles: string[] = ["general_user"];
        if (formData.services.cooperative) roles.push("cooperative_member");
        if (formData.services.academy) roles.push("academy_participant");
        if (formData.services.marketplace) roles.push("marketplace_buyer");
        if (formData.services.export) roles.push("export_participant");
        if (formData.services.wave) roles.push("wave_participant");
        if (formData.services.farmNation) roles.push("farmer");

        
        const payload: any = {
            fullName: formData.fullName,
            email: formData.email,
            phone: formData.phone,
            gender: formData.gender || undefined,
            dateOfBirth: formData.dateOfBirth || undefined,
            occupation: formData.occupation || undefined,
            roles,
            state: formData.state,
            lga: formData.lga,
            city: formData.city || undefined,
            address: formData.address,
            ...(formData.nextOfKinName ? { nextOfKinName: formData.nextOfKinName } : {}),
            ...(formData.nextOfKinPhone ? { nextOfKinPhone: formData.nextOfKinPhone } : {}),
            ...(formData.nextOfKinRelationship ? { nextOfKinRelationship: formData.nextOfKinRelationship } : {}),
            ...(formData.nextOfKinAddress ? { nextOfKinAddress: formData.nextOfKinAddress } : {}),
            ...(formData.validIdUrl ? { validIdUrl: formData.validIdUrl } : {}),
            ...(formData.passportPhotoUrl ? { passportPhotoUrl: formData.passportPhotoUrl } : {}),
            ...(formData.proofOfAddressUrl ? { proofOfAddressUrl: formData.proofOfAddressUrl } : {}),
            ...(formData.accountNumber ? { accountNumber: formData.accountNumber } : {}),
            ...(formData.accountName ? { accountName: formData.accountName } : {}),
            ...(formData.bankName ? { bankName: formData.bankName } : {}),
            ...(formData.bankCode ? { bankCode: formData.bankCode } : {}),
            ...(formData.nin ? { nin: formData.nin } : {}),
            ...(formData.bvn ? { bvn: formData.bvn } : {}),
            services: {
                cooperative: formData.services.cooperative,
                academy: formData.services.academy,
                marketplace: formData.services.marketplace,
                export: formData.services.export,
                wave: formData.services.wave,
                farmNation: formData.services.farmNation,
            },
        };

        if (module === "academy") {
            payload.academyPlan = formData.academyPlan;
        } else if (module === "export") {
            payload.exportInfo = {
                companyName: formData.exportCompanyName || undefined,
                rcNumber: formData.exportRcNumber || undefined,
                yearEstablished: formData.exportYearEstablished || undefined,
                businessType: formData.exportBusinessType || undefined,
                industry: formData.exportIndustry || undefined,
            };
        } else if (module === "wave") {
            payload.waveInfo = {
                surname: formData.waveSurname || undefined,
                residentialState: formData.waveResidentialState || undefined,
            };
        } else if (module === "farmNation") {
            payload.farmNationInfo = {
                role: formData.farmNationRole || undefined,
                farmSize: formData.farmNationFarmSize || undefined,
                cropTypes: formData.farmNationCropTypes ? formData.farmNationCropTypes.split(",") : undefined,
            };
        } else if (module === "cooperative") {
            payload.cooperativeInfo = {
                amount: formData.cooperativeAmount ? Number(formData.cooperativeAmount) : undefined,
            };
        }


        const result = await onboardLegacyMemberAction(payload);
        setIsLoading(false);

        if (result.success) {
            setIsSuccess(true);
            onSuccess();
        } else {
            setError(result.error || "Failed to onboard member.");
        }
    }

    // ── reset / close ────────────────────────────────────────────────────────
    function handleClose() {
                setFormData({
            fullName: "", email: "", phone: "", gender: "",
            dateOfBirth: "", occupation: "", state: "", lga: "",
            city: "", address: "", nextOfKinName: "", nextOfKinPhone: "",
            nextOfKinRelationship: "", nextOfKinAddress: "", validIdUrl: "",
            passportPhotoUrl: "", proofOfAddressUrl: "", accountNumber: "",
            accountName: "", bankName: "", bankCode: "", nin: "", bvn: "",
            academyPlan: "foundation" as "foundation" | "standard" | "elite",
            exportCompanyName: "", exportRcNumber: "", exportYearEstablished: "",
            exportBusinessType: "sole_proprietorship", exportIndustry: "agriculture",
            waveSurname: "", waveResidentialState: "",
            farmNationRole: "farmer" as "farmer" | "buyer" | "seller" | "both",
            farmNationFarmSize: "", farmNationCropTypes: "",
            cooperativeAmount: "",
            services: {
                cooperative: module === "cooperative",
                academy: module === "academy",
                marketplace: false,
                export: module === "export",
                wave: module === "wave",
                farmNation: module === "farmNation",
            },
        });
        setStep(0);
        setIsSuccess(false);
        setError(null);
        onClose();
    }

    // ── shared input class ───────────────────────────────────────────────────
    const inputCls = "w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm";
    const labelCls = "block text-sm font-medium text-slate-700 mb-1";
    const reqStar = <span className="text-red-500">*</span>;

    // ── step indicator ───────────────────────────────────────────────────────
    function renderStepIndicator() {
        return (
            <div className="flex items-center gap-2 mb-6">
                {STEPS.map((s, i) => (
                    <div key={s} className="flex items-center gap-2 flex-1">
                        <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0 transition-colors
                            ${i < step ? "bg-green-500 text-white" : i === step ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`}>
                            {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
                        </div>
                        <span className={`text-xs font-semibold hidden sm:block ${i === step ? "text-blue-700" : "text-slate-400"}`}>{s}</span>
                        {i < STEPS.length - 1 && (
                            <div className={`flex-1 h-0.5 ${i < step ? "bg-green-400" : "bg-slate-200"}`} />
                        )}
                    </div>
                ))}
            </div>
        );
    }

    // ── step panels ──────────────────────────────────────────────────────────
    function renderStepIdentity() {
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    <User className="w-3.5 h-3.5" /> Personal Identity
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                        <label className={labelCls}>Full Name {reqStar}</label>
                        <input type="text" required value={formData.fullName}
                            onChange={(e) => field("fullName", e.target.value)}
                            className={inputCls} placeholder="e.g. Ada Obi Johnson" />
                    </div>
                    <div>
                        <label className={labelCls}>Email Address {reqStar}</label>
                        <input type="email" required value={formData.email}
                            onChange={(e) => field("email", e.target.value)}
                            className={inputCls} placeholder="member@example.com" />
                    </div>
                    <div>
                        <label className={labelCls}>Phone Number {reqStar}</label>
                        <input type="tel" required value={formData.phone}
                            onChange={(e) => field("phone", e.target.value)}
                            className={inputCls} placeholder="+2348012345678" />
                    </div>
                    <div>
                        <label className={labelCls}>Gender</label>
                        <select value={formData.gender}
                            onChange={(e) => field("gender", e.target.value as "" | "Male" | "Female")}
                            className={inputCls}>
                            <option value="">Select gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Date of Birth</label>
                        <input type="date" value={formData.dateOfBirth}
                            onChange={(e) => field("dateOfBirth", e.target.value)}
                            className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Occupation</label>
                        <input type="text" value={formData.occupation}
                            onChange={(e) => field("occupation", e.target.value)}
                            className={inputCls} placeholder="e.g. Farmer, Trader" />
                    </div>
                </div>
            </div>
        );
    }

    function renderStepLocation() {
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    <MapPin className="w-3.5 h-3.5" /> Residential Information
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>State {reqStar}</label>
                        <select required value={formData.state}
                            onChange={(e) => field("state", e.target.value)}
                            className={inputCls}>
                            <option value="">Select state</option>
                            {NIGERIAN_STATES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>LGA {reqStar}</label>
                        <input type="text" required value={formData.lga}
                            onChange={(e) => field("lga", e.target.value)}
                            className={inputCls} placeholder="e.g. Ikeja" />
                    </div>
                    <div>
                        <label className={labelCls}>City / Town</label>
                        <input type="text" value={formData.city}
                            onChange={(e) => field("city", e.target.value)}
                            className={inputCls} placeholder="e.g. Lagos Island" />
                    </div>
                    <div className="sm:col-span-2">
                        <label className={labelCls}>Residential Address {reqStar}</label>
                        <input type="text" required value={formData.address}
                            onChange={(e) => field("address", e.target.value)}
                            className={inputCls} placeholder="e.g. 12 Broad Street, Lagos" />
                    </div>
                </div>
            </div>
        );
    }

    function renderStepNextOfKin() {
        const RELATIONSHIPS = ["Spouse", "Parent", "Sibling", "Child", "Friend", "Other"];
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    <User className="w-3.5 h-3.5" /> Next of Kin
                    <span className="ml-1 font-normal normal-case text-slate-400">(optional)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                        <label className={labelCls}>Full Name</label>
                        <input type="text" value={formData.nextOfKinName}
                            onChange={(e) => field("nextOfKinName", e.target.value)}
                            className={inputCls} placeholder="e.g. Emeka Obi" />
                    </div>
                    <div>
                        <label className={labelCls}>Phone Number</label>
                        <input type="tel" value={formData.nextOfKinPhone}
                            onChange={(e) => field("nextOfKinPhone", e.target.value)}
                            className={inputCls} placeholder="+2348012345678" />
                    </div>
                    <div>
                        <label className={labelCls}>Relationship</label>
                        <select value={formData.nextOfKinRelationship}
                            onChange={(e) => field("nextOfKinRelationship", e.target.value)}
                            className={inputCls}>
                            <option value="">Select relationship</option>
                            {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>
                    <div className="sm:col-span-2">
                        <label className={labelCls}>Address</label>
                        <input type="text" value={formData.nextOfKinAddress}
                            onChange={(e) => field("nextOfKinAddress", e.target.value)}
                            className={inputCls} placeholder="Next of kin residential address" />
                    </div>
                </div>
            </div>
        );
    }

    function renderStepDocuments() {
        return (
            <div className="space-y-5">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    <FileText className="w-3.5 h-3.5" /> Verification Documents
                    <span className="ml-1 font-normal normal-case text-slate-400">(optional but recommended)</span>
                </div>
                <p className="text-xs text-slate-500 -mt-2 mb-3">
                    Upload the member&apos;s documents for admin records. Files are uploaded to Cloudinary and stored securely.
                    Accepted formats: JPG, PNG, PDF — Max 5MB each.
                </p>

                <MasterUploader
                    label="Valid Government ID"
                    folder="cooperative/legacy-documents"
                    moduleId="cooperative"
                    accept="image/*,application/pdf"
                    maxSize={5}
                    description="NIN slip, Driver's License, International Passport, or Voter's Card"
                    onComplete={(res) => field("validIdUrl", res.url)}
                />
                {formData.validIdUrl && (
                    <p className="text-xs text-green-600 font-semibold -mt-2">✓ Valid ID uploaded</p>
                )}

                <MasterUploader
                    label="Passport Photo"
                    folder="cooperative/legacy-documents"
                    moduleId="cooperative"
                    accept="image/*"
                    maxSize={5}
                    description="Recent passport-sized photograph"
                    onComplete={(res) => field("passportPhotoUrl", res.url)}
                />
                {formData.passportPhotoUrl && (
                    <p className="text-xs text-green-600 font-semibold -mt-2">✓ Passport photo uploaded</p>
                )}

                <MasterUploader
                    label="Proof of Address (Optional)"
                    folder="cooperative/legacy-documents"
                    moduleId="cooperative"
                    accept="image/*,application/pdf"
                    maxSize={5}
                    description="Utility bill, bank statement, or tenancy agreement"
                    onComplete={(res) => field("proofOfAddressUrl", res.url)}
                />
                {formData.proofOfAddressUrl && (
                    <p className="text-xs text-green-600 font-semibold -mt-2">✓ Proof of address uploaded</p>
                )}
            </div>
        );
    }

    function renderStepFinancial() {
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    <CreditCard className="w-3.5 h-3.5" /> Financial & KYC Details
                    <span className="ml-1 text-xs text-slate-400 font-normal normal-case">(optional)</span>
                </div>
                <p className="text-xs text-slate-500 -mt-2 mb-2">
                    Providing bank details allows instant payouts for marketplace / cooperative transactions.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>Bank Name</label>
                        <input type="text" value={formData.bankName}
                            onChange={(e) => field("bankName", e.target.value)}
                            className={inputCls} placeholder="e.g. Zenith Bank" />
                    </div>
                    <div>
                        <label className={labelCls}>Account Number</label>
                        <input type="text" maxLength={10} value={formData.accountNumber}
                            onChange={(e) => field("accountNumber", e.target.value.replace(/\D/g, ""))}
                            className={inputCls} placeholder="10-digit NUBAN" />
                    </div>
                    <div className="sm:col-span-2">
                        <label className={labelCls}>Account Name</label>
                        <input type="text" value={formData.accountName}
                            onChange={(e) => field("accountName", e.target.value)}
                            className={inputCls} placeholder="As it appears on your bank statement" />
                    </div>

                    <div className="sm:col-span-2 pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                            <ShieldCheck className="w-3.5 h-3.5" /> KYC Information
                            <span className="ml-1 font-normal normal-case text-slate-400">(optional)</span>
                        </div>
                    </div>
                    <div>
                        <label className={labelCls}>NIN</label>
                        <input type="text" maxLength={11} value={formData.nin}
                            onChange={(e) => field("nin", e.target.value.replace(/\D/g, ""))}
                            className={inputCls} placeholder="11-digit NIN" />
                    </div>
                    <div>
                        <label className={labelCls}>BVN</label>
                        <input type="text" maxLength={11} value={formData.bvn}
                            onChange={(e) => field("bvn", e.target.value.replace(/\D/g, ""))}
                            className={inputCls} placeholder="11-digit BVN" />
                    </div>
                </div>
            </div>
        );
    }

    function renderStepServices() {
        const serviceList: { id: keyof typeof formData.services; label: string }[] = [
            { id: "cooperative", label: "Cooperative" },
            { id: "marketplace", label: "Marketplace" },
            { id: "export", label: "Export Hub" },
            { id: "wave", label: "WAVE" },
            { id: "farmNation", label: "Farm Nation" },
        ];

        return (
            <div className="space-y-5">
                {/* Academy */}
                <div>
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                        <GraduationCap className="w-3.5 h-3.5" /> Academy Access
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-4">
                        <div className="flex items-center gap-3">
                            <input type="checkbox" id="service-academy"
                                checked={formData.services.academy}
                                onChange={(e) => service("academy", e.target.checked)}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                            <label htmlFor="service-academy" className="text-sm font-semibold text-slate-700">
                                Enable Academy Enrollment
                            </label>
                        </div>
                        {formData.services.academy && (
                            <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Academy Tier</label>
                                <select value={formData.academyPlan}
                                    onChange={(e) => field("academyPlan", e.target.value as "foundation" | "standard" | "elite")}
                                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                                    {Object.values(ACADEMY_CONFIG.plans).map((plan) => (
                                        <option key={plan.id} value={plan.id}>
                                            {plan.name} ({CURRENCY_CONFIG.symbol}{plan.fee.toLocaleString()} Value)
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* Other Services */}
                <div>
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                        <ShieldCheck className="w-3.5 h-3.5" /> Other Services
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {serviceList.map((svc) => (
                            <div key={svc.id}
                                className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-100">
                                <input type="checkbox" id={`service-${svc.id}`}
                                    checked={formData.services[svc.id]}
                                    onChange={(e) => service(svc.id, e.target.checked)}
                                    className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500" />
                                <label htmlFor={`service-${svc.id}`}
                                    className="text-xs font-medium text-slate-600">
                                    {svc.label}
                                </label>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    const stepPanels = [renderStepIdentity(), renderStepLocation(), renderStepNextOfKin(), renderStepDocuments(), renderStepFinancial(), renderStepServices()];

    // ── render ───────────────────────────────────────────────────────────────
    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Onboard Legacy Member" maxWidth="lg">
            {!isSuccess ? (
                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Info Banner */}
                    <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                        <p className="text-sm text-indigo-800">
                            Fill in the member&apos;s complete profile below. Their account will be created immediately with full
                            access to the selected services, and a welcome email containing a secure{" "}
                            <strong>password setup link</strong> will be sent directly to them.
                        </p>
                    </div>

                    {/* Step indicator */}
                    {renderStepIndicator()}

                    {/* Error */}
                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm break-all">
                            {error}
                        </div>
                    )}

                    {/* Step panel */}
                    {stepPanels[step]}

                    {/* Navigation */}
                    <div className="flex gap-3 pt-4 border-t border-slate-200">
                        {step > 0 && (
                            <button type="button" onClick={handleBack}
                                className="flex items-center gap-1.5 px-4 py-2.5 text-slate-600 bg-slate-100 hover:bg-slate-200 font-semibold rounded-xl transition text-sm">
                                <ChevronLeft className="w-4 h-4" /> Back
                            </button>
                        )}
                        <div className="flex-1" />
                        {step < STEPS.length - 1 ? (
                            <button type="button" onClick={handleNext}
                                className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition text-sm">
                                Next <ChevronRight className="w-4 h-4" />
                            </button>
                        ) : (
                            <button type="submit" disabled={isLoading}
                                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition disabled:opacity-50 shadow-lg shadow-blue-200 text-sm">
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                Complete Onboarding
                            </button>
                        )}
                    </div>
                </form>
            ) : (
                <div className="text-center py-8">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-10 h-10 text-green-600" />
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900 mb-2">Successfully Onboarded!</h3>
                    <p className="text-slate-600 mb-8 max-w-sm mx-auto">
                        <strong>{formData.fullName}</strong> has been onboarded as a legacy member with a complete profile and
                        full platform access. A welcome email with a secure <strong>password setup link</strong> has been sent
                        to <strong>{formData.email}</strong>.
                    </p>
                    <button onClick={handleClose}
                        className="w-full max-w-xs px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-xl shadow-blue-100">
                        Return to Dashboard
                    </button>
                </div>
            )}
        </Modal>
    );
}
