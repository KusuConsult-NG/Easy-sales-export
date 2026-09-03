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

const PROPERTY_TYPES = [
    "Cropland",
    "Pasture/Rangeland",
    "Fish Pond",
    "Poultry Farm",
    "Mixed Farm",
    "Orchard",
    "Greenhouse",
    "Livestock Farm",
];

const STEPS = ["Identity", "Location", "Next of Kin", "Documents", "Financial", "Module Details"] as const;
type Step = (typeof STEPS)[number];

const LOCAL_ACADEMY_PLANS = [
    { id: "foundation", name: "Foundation Program", fee: 45000 },
    { id: "standard", name: "Standard Program", fee: 90000 },
    { id: "elite", name: "Elite Program", fee: 270000 },
];

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
        farmNationPropertyTypes: [] as string[],
        farmNationListingTypes: [] as string[],
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

    /**
     *   #290 WHAT ACTUALLY HAPPENED, WHICH THIS SCREEN USED TO INVENT.
     *
     *        onboardLegacyMemberAction distinguishes three outcomes and this
     *        component read `result.success` and threw the rest away, then
     *        printed one hardcoded sentence for all three.
     */
    const [outcome, setOutcome] = useState<{
        isNewUser: boolean;
        emailSent: boolean;
        temporaryPassword: string | null;
    } | null>(null);

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
                cropTypes: formData.farmNationCropTypes ? formData.farmNationCropTypes.split(",").map(c => c.trim()).filter(Boolean) : undefined,
                propertyTypes: formData.farmNationPropertyTypes.length > 0 ? formData.farmNationPropertyTypes : undefined,
                listingTypes: formData.farmNationListingTypes.length > 0 ? formData.farmNationListingTypes : undefined,
            };
        } else if (module === "cooperative") {
            payload.cooperativeInfo = {
                amount: formData.cooperativeAmount ? Number(formData.cooperativeAmount) : undefined,
            };
        }


        try {
            const result = await onboardLegacyMemberAction(payload);
            setIsLoading(false);

            if (result.success) {
                // #290. Defaults describe the OLD claim, so a server that
                // stopped reporting these fields degrades to what the screen
                // used to say rather than to something new and equally
                // unfounded. The success panel below still labels it as
                // unconfirmed in that case.
                const r = result as Record<string, any>;
                setOutcome({
                    isNewUser: r.isNewUser !== false,
                    emailSent: r.emailSent === true,
                    temporaryPassword: typeof r.temporaryPassword === "string" ? r.temporaryPassword : null,
                });
                setIsSuccess(true);
                onSuccess();
            } else {
                setError(result.error || "Failed to onboard member.");
            }
        } catch (e: any) {
            setIsLoading(false);
            setError(e?.message || "An unexpected error occurred during onboarding.");
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
            farmNationPropertyTypes: [] as string[],
            farmNationListingTypes: [] as string[],
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
        setOutcome(null);
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
                        <label htmlFor="legacy-fullName" className={labelCls}>Full Name {reqStar}</label>
                        <input type="text" id="legacy-fullName" name="fullName" autoComplete="name" required value={formData.fullName}
                            onChange={(e) => field("fullName", e.target.value)}
                            className={inputCls} placeholder="e.g. Ada Obi Johnson" />
                    </div>
                    <div>
                        <label htmlFor="legacy-email" className={labelCls}>Email Address {reqStar}</label>
                        <input type="email" id="legacy-email" name="email" autoComplete="email" required value={formData.email}
                            onChange={(e) => field("email", e.target.value)}
                            className={inputCls} placeholder="member@example.com" />
                    </div>
                    <div>
                        <label htmlFor="legacy-phone" className={labelCls}>Phone Number {reqStar}</label>
                        <input type="tel" id="legacy-phone" name="phone" autoComplete="tel" required value={formData.phone}
                            onChange={(e) => field("phone", e.target.value)}
                            className={inputCls} placeholder="+2348012345678" />
                    </div>
                    <div>
                        <label htmlFor="legacy-gender" className={labelCls}>Gender</label>
                        <select id="legacy-gender" name="gender" value={formData.gender}
                            onChange={(e) => field("gender", e.target.value as "" | "Male" | "Female")}
                            className={inputCls}>
                            <option value="">Select gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="legacy-dateOfBirth" className={labelCls}>Date of Birth</label>
                        <input type="date" id="legacy-dateOfBirth" name="dateOfBirth" value={formData.dateOfBirth}
                            onChange={(e) => field("dateOfBirth", e.target.value)}
                            className={inputCls} />
                    </div>
                    <div>
                        <label htmlFor="legacy-occupation" className={labelCls}>Occupation</label>
                        <input type="text" id="legacy-occupation" name="occupation" value={formData.occupation}
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
                        <label htmlFor="legacy-state" className={labelCls}>State {reqStar}</label>
                        <select id="legacy-state" name="state" required value={formData.state}
                            onChange={(e) => field("state", e.target.value)}
                            className={inputCls}>
                            <option value="">Select state</option>
                            {NIGERIAN_STATES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="legacy-lga" className={labelCls}>LGA {reqStar}</label>
                        <input type="text" id="legacy-lga" name="lga" required value={formData.lga}
                            onChange={(e) => field("lga", e.target.value)}
                            className={inputCls} placeholder="e.g. Ikeja" />
                    </div>
                    <div>
                        <label htmlFor="legacy-city" className={labelCls}>City / Town</label>
                        <input type="text" id="legacy-city" name="city" value={formData.city}
                            onChange={(e) => field("city", e.target.value)}
                            className={inputCls} placeholder="e.g. Lagos Island" />
                    </div>
                    <div className="sm:col-span-2">
                        <label htmlFor="legacy-address" className={labelCls}>Residential Address {reqStar}</label>
                        <input type="text" id="legacy-address" name="address" autoComplete="street-address" required value={formData.address}
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
                        <label htmlFor="legacy-nextOfKinName" className={labelCls}>Full Name</label>
                        <input type="text" id="legacy-nextOfKinName" name="nextOfKinName" autoComplete="off" value={formData.nextOfKinName}
                            onChange={(e) => field("nextOfKinName", e.target.value)}
                            className={inputCls} placeholder="e.g. Emeka Obi" />
                    </div>
                    <div>
                        <label htmlFor="legacy-nextOfKinPhone" className={labelCls}>Phone Number</label>
                        <input type="tel" id="legacy-nextOfKinPhone" name="nextOfKinPhone" autoComplete="off" value={formData.nextOfKinPhone}
                            onChange={(e) => field("nextOfKinPhone", e.target.value)}
                            className={inputCls} placeholder="+2348012345678" />
                    </div>
                    <div>
                        <label htmlFor="legacy-nextOfKinRelationship" className={labelCls}>Relationship</label>
                        <select id="legacy-nextOfKinRelationship" name="nextOfKinRelationship" value={formData.nextOfKinRelationship}
                            onChange={(e) => field("nextOfKinRelationship", e.target.value)}
                            className={inputCls}>
                            <option value="">Select relationship</option>
                            {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>
                    <div className="sm:col-span-2">
                        <label htmlFor="legacy-nextOfKinAddress" className={labelCls}>Address</label>
                        <input type="text" id="legacy-nextOfKinAddress" name="nextOfKinAddress" autoComplete="off" value={formData.nextOfKinAddress}
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
                        <label htmlFor="legacy-bankName" className={labelCls}>Bank Name</label>
                        <input type="text" id="legacy-bankName" name="bankName" value={formData.bankName}
                            onChange={(e) => field("bankName", e.target.value)}
                            className={inputCls} placeholder="e.g. Zenith Bank" />
                    </div>
                    <div>
                        <label htmlFor="legacy-accountNumber" className={labelCls}>Account Number</label>
                        <input type="text" id="legacy-accountNumber" name="accountNumber" maxLength={10} value={formData.accountNumber}
                            onChange={(e) => field("accountNumber", e.target.value.replace(/\D/g, ""))}
                            className={inputCls} placeholder="10-digit NUBAN" />
                    </div>
                    <div className="sm:col-span-2">
                        <label htmlFor="legacy-accountName" className={labelCls}>Account Name</label>
                        <input type="text" id="legacy-accountName" name="accountName" value={formData.accountName}
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
                        <label htmlFor="legacy-nin" className={labelCls}>NIN</label>
                        <input type="text" id="legacy-nin" name="nin" maxLength={11} value={formData.nin}
                            onChange={(e) => field("nin", e.target.value.replace(/\D/g, ""))}
                            className={inputCls} placeholder="11-digit NIN" />
                    </div>
                    <div>
                        <label htmlFor="legacy-bvn" className={labelCls}>BVN</label>
                        <input type="text" id="legacy-bvn" name="bvn" maxLength={11} value={formData.bvn}
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

        const academyPlans = (ACADEMY_CONFIG && ACADEMY_CONFIG.plans)
            ? Object.values(ACADEMY_CONFIG.plans)
            : LOCAL_ACADEMY_PLANS;

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
                                    {academyPlans.map((plan) => (
                                        <option key={plan.id} value={plan.id}>
                                            {plan.name} ({CURRENCY_CONFIG?.symbol || "₦"}{(plan.fee || 0).toLocaleString()} Value)
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
                    <div className="grid grid-cols-2 gap-2 mb-4">
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

                    {/* Cooperative Service Details */}
                    {formData.services.cooperative && (
                        <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-2xl space-y-2 mb-3 animate-in fade-in slide-in-from-top-2 duration-200">
                            <label htmlFor="coop-amount" className="block text-xs font-bold text-slate-500 uppercase">Membership Share Amount (₦)</label>
                            <input
                                type="number"
                                id="coop-amount"
                                value={formData.cooperativeAmount}
                                onChange={(e) => field("cooperativeAmount", e.target.value)}
                                className={inputCls}
                                placeholder="e.g. 50000"
                            />
                        </div>
                    )}

                    {/* Export Hub Service Details */}
                    {formData.services.export && (
                        <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-2xl space-y-3 mb-3 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="text-xs font-bold text-slate-500 uppercase">Export Hub Details</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="export-companyName" className="block text-[11px] font-semibold text-slate-600 mb-1">Company Name</label>
                                    <input type="text" id="export-companyName" value={formData.exportCompanyName} onChange={(e) => field("exportCompanyName", e.target.value)} className={inputCls} placeholder="e.g. AgriExport Ltd" />
                                </div>
                                <div>
                                    <label htmlFor="export-rcNumber" className="block text-[11px] font-semibold text-slate-600 mb-1">RC Number</label>
                                    <input type="text" id="export-rcNumber" value={formData.exportRcNumber} onChange={(e) => field("exportRcNumber", e.target.value)} className={inputCls} placeholder="e.g. RC123456" />
                                </div>
                                <div>
                                    <label htmlFor="export-year" className="block text-[11px] font-semibold text-slate-600 mb-1">Year Established</label>
                                    <input type="text" id="export-year" value={formData.exportYearEstablished} onChange={(e) => field("exportYearEstablished", e.target.value)} className={inputCls} placeholder="e.g. 2020" />
                                </div>
                                <div>
                                    <label htmlFor="export-businessType" className="block text-[11px] font-semibold text-slate-600 mb-1">Business Type</label>
                                    <select id="export-businessType" value={formData.exportBusinessType} onChange={(e) => field("exportBusinessType", e.target.value)} className={inputCls}>
                                        <option value="sole_proprietorship">Sole Proprietorship</option>
                                        <option value="partnership">Partnership</option>
                                        <option value="limited_liability_company">Limited Liability Company</option>
                                        <option value="cooperative">Cooperative</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label htmlFor="export-industry" className="block text-[11px] font-semibold text-slate-600 mb-1">Industry</label>
                                <select id="export-industry" value={formData.exportIndustry} onChange={(e) => field("exportIndustry", e.target.value)} className={inputCls}>
                                    <option value="agriculture">Agriculture</option>
                                    <option value="manufacturing">Manufacturing</option>
                                    <option value="services">Services</option>
                                    <option value="tech">Technology</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {/* WAVE Service Details */}
                    {formData.services.wave && (
                        <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-2xl space-y-3 mb-3 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="text-xs font-bold text-slate-500 uppercase">WAVE Details</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="wave-surname" className="block text-[11px] font-semibold text-slate-600 mb-1">WAVE Surname</label>
                                    <input type="text" id="wave-surname" value={formData.waveSurname} onChange={(e) => field("waveSurname", e.target.value)} className={inputCls} placeholder="e.g. Johnson" />
                                </div>
                                <div>
                                    <label htmlFor="wave-state" className="block text-[11px] font-semibold text-slate-600 mb-1">Residential State</label>
                                    <select id="wave-state" value={formData.waveResidentialState} onChange={(e) => field("waveResidentialState", e.target.value)} className={inputCls}>
                                        <option value="">Select State</option>
                                        {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Farm Nation Service Details */}
                    {formData.services.farmNation && (
                        <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-2xl space-y-3 mb-3 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="text-xs font-bold text-slate-500 uppercase">Farm Nation Details</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="farmNation-role" className="block text-[11px] font-semibold text-slate-600 mb-1">Farm Nation Role</label>
                                    <select id="farmNation-role" value={formData.farmNationRole} onChange={(e) => field("farmNationRole", e.target.value as any)} className={inputCls}>
                                        <option value="farmer">Farmer</option>
                                        <option value="buyer">Buyer / Investor</option>
                                        <option value="seller">Land Seller</option>
                                        <option value="both">Both (Buyer & Seller)</option>
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="farmNation-size" className="block text-[11px] font-semibold text-slate-600 mb-1">Farm/Land Size (Acres)</label>
                                    <input type="text" id="farmNation-size" value={formData.farmNationFarmSize} onChange={(e) => field("farmNationFarmSize", e.target.value)} className={inputCls} placeholder="e.g. 10 acres" />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="farmNation-crops" className="block text-[11px] font-semibold text-slate-600 mb-1">Crop Types (comma-separated)</label>
                                <input type="text" id="farmNation-crops" value={formData.farmNationCropTypes} onChange={(e) => field("farmNationCropTypes", e.target.value)} className={inputCls} placeholder="e.g. Maize, Cassava, Yam" />
                            </div>

                            {/* Property Types */}
                            {(formData.farmNationRole === "seller" || formData.farmNationRole === "both" || formData.farmNationRole === "farmer") && (
                                <div className="space-y-1.5">
                                    <label className="block text-[11px] font-semibold text-slate-600">Property Types to List</label>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {PROPERTY_TYPES.map((type) => {
                                            const isSelected = formData.farmNationPropertyTypes.includes(type);
                                            return (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => {
                                                        const current = formData.farmNationPropertyTypes;
                                                        const updated = isSelected ? current.filter(t => t !== type) : [...current, type];
                                                        field("farmNationPropertyTypes", updated);
                                                    }}
                                                    className={`px-2 py-1.5 rounded-lg border text-xs font-semibold text-center transition-all ${
                                                        isSelected ? "border-emerald-600 bg-emerald-100 text-emerald-900" : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300"
                                                    }`}
                                                >
                                                    {type}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Listing Types */}
                            {(formData.farmNationRole === "seller" || formData.farmNationRole === "both") && (
                                <div className="space-y-1.5">
                                    <label className="block text-[11px] font-semibold text-slate-600">Listing/Transaction Types Offered</label>
                                    <div className="flex gap-2">
                                        {[
                                            { value: "sale", label: "For Sale" },
                                            { value: "rent", label: "For Rent" },
                                            { value: "lease", label: "For Lease" }
                                        ].map((opt) => {
                                            const isSelected = formData.farmNationListingTypes.includes(opt.value);
                                            return (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => {
                                                        const current = formData.farmNationListingTypes;
                                                        const updated = isSelected ? current.filter(t => t !== opt.value) : [...current, opt.value];
                                                        field("farmNationListingTypes", updated);
                                                    }}
                                                    className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold text-center transition-all ${
                                                        isSelected ? "border-emerald-600 bg-emerald-100 text-emerald-900" : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300"
                                                    }`}
                                                >
                                                    {opt.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    function renderStepContent() {
        try {
            switch (step) {
                case 0: return renderStepIdentity();
                case 1: return renderStepLocation();
                case 2: return renderStepNextOfKin();
                case 3: return renderStepDocuments();
                case 4: return renderStepFinancial();
                case 5: return renderStepServices();
                default: return null;
            }
        } catch (error) {
            console.error("Error rendering step content:", error);
            return (
                <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-sm space-y-2">
                    <p className="font-bold">Failed to render this step.</p>
                    <p className="text-xs text-red-600">{(error as Error)?.message || "Unknown rendering exception occurred."}</p>
                    <p className="text-xs text-slate-500 font-medium">Please check if the required configuration or profile data fields are complete.</p>
                </div>
            );
        }
    }

    // ── render ───────────────────────────────────────────────────────────────
    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Onboard Legacy Member" maxWidth="lg">
            {!isSuccess ? (
                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Info Banner */}
                    <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                        {/*
                          * #290. Said "a secure password setup link". It is a
                          * six-digit temporary PIN, and it is sent only when the
                          * account is new — see the success panel below.
                          */}
                        <p className="text-sm text-indigo-800">
                            Fill in the member&apos;s complete profile below. Their account will be created immediately with full
                            access to the selected services, and a welcome email containing a{" "}
                            <strong>temporary PIN</strong> will be sent to them. They set their own password the first time they
                            sign in. If the member already has an account, this updates their profile and sends nothing.
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
                    {renderStepContent()}

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
                    <h3 className="text-2xl font-bold text-slate-900 mb-2">
                        {outcome && !outcome.isNewUser ? "Profile Updated" : "Successfully Onboarded!"}
                    </h3>

                    {/*
                      *   #290 THREE OUTCOMES, ONE SENTENCE.
                      *
                      *        This panel used to say, unconditionally:
                      *
                      *            "A welcome email with a secure password setup
                      *             link has been sent to {email}."
                      *
                      *        Three things were wrong with that.
                      *
                      *        1. IT IS A TEMPORARY PIN, NOT A SETUP LINK.
                      *           sendLegacyMemberWelcomeEmail sends a six-digit
                      *           PIN the member signs in with, and
                      *           getPostLoginRedirect then forces them through
                      *           /auth/reset-legacy-password. An admin reading
                      *           "setup link" tells the member to look for
                      *           something that will never arrive.
                      *
                      *        2. FOR AN EXISTING MEMBER NO EMAIL IS SENT AT
                      *           ALL. The action guards the send with
                      *           `if (isNewUser)`, so re-running the import
                      *           against somebody who already has an account
                      *           updates their profile silently — and this
                      *           screen said an email had gone out.
                      *
                      *        3. WHEN THE SEND FAILED, THE PIN WAS DESTROYED.
                      *           The action still returns success (the member
                      *           DOES exist, which is why) and hands back the
                      *           temporary PIN with "please share it manually".
                      *           This component discarded that, printed the
                      *           sentence above, and the only credential for
                      *           the new account was gone. The member cannot
                      *           sign in; the admin has no idea.
                      */}
                    {outcome && !outcome.isNewUser ? (
                        <p className="text-slate-600 mb-8 max-w-sm mx-auto">
                            <strong>{formData.fullName}</strong> already had an account, so their profile and service access
                            were updated. Their existing password is unchanged and <strong>no email was sent</strong>.
                        </p>
                    ) : outcome && outcome.emailSent ? (
                        <p className="text-slate-600 mb-8 max-w-sm mx-auto">
                            <strong>{formData.fullName}</strong> has been onboarded as a legacy member with a complete profile
                            and full platform access. A welcome email containing their <strong>temporary PIN</strong> has been
                            sent to <strong>{formData.email}</strong>. They will be asked to set a password the first time they
                            sign in.
                        </p>
                    ) : (
                        <div className="mb-8 max-w-sm mx-auto space-y-4 text-left">
                            <p className="text-slate-600 text-center">
                                <strong>{formData.fullName}</strong> has been onboarded and their account exists.
                            </p>
                            <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                                <p className="font-bold">The welcome email did NOT send.</p>
                                <p className="mt-1">
                                    Give <strong>{formData.fullName}</strong> the temporary PIN below yourself — it is the only
                                    way into the account, and it is not shown again after you close this.
                                </p>
                                {outcome?.temporaryPassword ? (
                                    <p className="mt-3 rounded-lg bg-white px-3 py-2 text-center font-mono text-lg font-bold tracking-widest text-slate-900">
                                        {outcome.temporaryPassword}
                                    </p>
                                ) : (
                                    <p className="mt-3">
                                        The PIN was not returned. Use the password reset flow for{" "}
                                        <strong>{formData.email}</strong> to give them a way in.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    <button onClick={handleClose}
                        className="w-full max-w-xs px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-xl shadow-blue-100">
                        Return to Dashboard
                    </button>
                </div>
            )}
        </Modal>
    );
}
