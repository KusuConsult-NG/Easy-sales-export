"use client";

import { useState } from "react";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { NIGERIAN_LOCATIONS } from "@/lib/locations";
import { FormInput, FormSelect } from "@/components/ui/FormField";
import { IdInput } from "@/components/ui/IdInput";
import { isObviouslyFakeId, fakeIdErrorMessage } from "@/lib/kyc-validators";

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
    "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
    "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi",
    "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
    "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT"
];

interface ProfileStepProps {
    onNext: (data: any) => void;
    onBack: () => void;
    initialData?: any;
    onChange?: (data: any) => void;
}

export default function ProfileStep({ onNext, onBack, onChange, initialData }: ProfileStepProps) {
    const [formData, setFormData] = useState({
        firstName: initialData?.firstName || (initialData?.fullName ? initialData.fullName.split(' ')[0] : '') || "",
        lastName: initialData?.lastName || (initialData?.fullName ? initialData.fullName.split(' ').slice(1).join(' ') : '') || "",
        otherName: initialData?.otherName || "",
        phone: initialData?.phone || "",
        businessName: initialData?.businessName || "",
        state: initialData?.state || "",
        lga: initialData?.lga || "",
        address: initialData?.address || "",
        /**
         *   #865 THE FORM NAMED AN IDENTITY DOCUMENT IT NEVER ASKED FOR.
         *
         *   THE OWNER: "add field NIN/BVN but should pass without QoreID
         *   verification."
         *
         *   This screen already told the applicant "Enter your name exactly as
         *   it appears on your NIN/BVN", and hinted the same on two more
         *   fields — three references to a document the form did not collect.
         *   So a Farm Nation seller was asked to spell their name to match a
         *   number nobody ever saw, and the KYC notice was advice about
         *   nothing.
         */
        nin: initialData?.nin || "",
        bvn: initialData?.bvn || "",
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const set = (field: string, value: string) => {
        setFormData(prev => {
            const next = { ...prev, [field]: value, ...(field === 'state' ? { lga: '' } : {}) };
            onChange?.({ profile: next });
            return next;
        });
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
    };

    const validate = () => {
        const e: Record<string, string> = {};
        if (!formData.firstName.trim()) e.firstName = "First name is required";
        if (!formData.lastName.trim()) e.lastName = "Last name is required";
        if (!formData.phone.trim()) e.phone = "Phone number is required";
        if (!formData.state) e.state = "State is required";
        if (!formData.lga.trim()) e.lga = "LGA is required";
        if (!formData.address.trim()) e.address = "Address is required";

        /*
         *   #865 FORMAT AND PLAUSIBILITY, AND NOTHING ELSE.
         *
         *   "should pass without QoreID verification" — nothing here contacts
         *   any provider, and #487 settled what that means platform-wide:
         *   "PASS means do not require an external check... a well-formed
         *   number is accepted and recorded as self_declared".
         *
         *   The rules come from lib/kyc-validators rather than being written
         *   out here, because #501's finding was this exact rule reaching one
         *   submission path out of five. The server applies the same module to
         *   the same values; this only saves a round trip.
         */
        for (const [key, label] of [["nin", "NIN"], ["bvn", "BVN"]] as const) {
            const value = formData[key].trim();
            if (!value) e[key] = `${label} is required`;
            else if (!/^\d{11}$/.test(value)) e[key] = `${label} must be exactly 11 digits`;
            else if (isObviouslyFakeId(value)) e[key] = fakeIdErrorMessage(label);
        }

        setErrors(e);
        return Object.keys(e).length === 0;
    };

    function handleSubmit(ev: React.FormEvent) {
        ev.preventDefault();
        if (validate()) {
            const fullName = [formData.firstName, formData.otherName, formData.lastName]
                .filter(Boolean).join(" ").trim();
            onNext({ profile: { ...formData, fullName } });
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-1">Profile & Location</h2>
                <p className="text-sm text-slate-600">Help us connect you with the right properties in your area</p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3">
                <span className="text-amber-500 text-base shrink-0 mt-0.5">⚠️</span>
                <p className="text-sm text-amber-800">
                    <strong>KYC Notice:</strong> Enter your name exactly as it appears on your NIN/BVN.
                </p>
            </div>

            {/* Row 1: First Name + Last Name */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormInput label="First Name" required
                    value={formData.firstName} onChange={e => set('firstName', e.target.value)}
                    placeholder="e.g. Amina" error={errors.firstName} hint="As on your NIN/BVN"
                    accentColor="emerald" />
                <FormInput label="Last Name" required
                    value={formData.lastName} onChange={e => set('lastName', e.target.value)}
                    placeholder="e.g. Ibrahim" error={errors.lastName} hint="As on your NIN/BVN"
                    accentColor="emerald" />
            </div>

            {/* Row 1b: NIN + BVN — #865, the numbers the notice above refers to. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <IdInput label="NIN" required digitsOnly showCount maxLength={11}
                    value={formData.nin} onChange={v => set('nin', v)}
                    placeholder="11 digits" error={errors.nin}
                    hint="Your National Identification Number"
                    accentColor="emerald" />
                <IdInput label="BVN" required digitsOnly showCount maxLength={11}
                    value={formData.bvn} onChange={v => set('bvn', v)}
                    placeholder="11 digits" error={errors.bvn}
                    hint="Your Bank Verification Number"
                    accentColor="emerald" />
            </div>

            {/* Row 2: Other Name + Phone */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormInput label="Other Name" optional
                    value={formData.otherName} onChange={e => set('otherName', e.target.value)}
                    placeholder="e.g. Fatima" accentColor="emerald" />
                <FormInput label="Phone Number" required type="tel"
                    value={formData.phone} onChange={e => set('phone', e.target.value)}
                    placeholder="08012345678" error={errors.phone} accentColor="emerald" />
            </div>

            {/* Row 3: State + LGA */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormSelect label="State" required
                    value={formData.state} onChange={e => set('state', e.target.value)}
                    error={errors.state} accentColor="emerald">
                    <option value="">Select State</option>
                    {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </FormSelect>
                <FormSelect label="LGA" required
                    value={formData.lga} onChange={e => set('lga', e.target.value)}
                    disabled={!formData.state} error={errors.lga} accentColor="emerald">
                    <option value="">Select LGA</option>
                    {formData.state && NIGERIAN_LOCATIONS[formData.state]?.map(l => (
                        <option key={l} value={l}>{l}</option>
                    ))}
                </FormSelect>
            </div>

            {/* Row 4: Business Name + Address spans full */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormInput label="Business Name" optional
                    value={formData.businessName} onChange={e => set('businessName', e.target.value)}
                    placeholder="Agro Ventures Ltd" accentColor="emerald" />
                <div /> {/* spacer */}
            </div>

            <FormInput label="Address" required
                value={formData.address} onChange={e => set('address', e.target.value)}
                placeholder="123 Main Street" error={errors.address} accentColor="emerald" />

            <div className="flex justify-between pt-2">
                <button type="button" onClick={onBack}
                    className="px-5 py-2.5 text-sm border-2 border-slate-300 text-slate-900 rounded-lg font-bold hover:bg-slate-50 transition-colors flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button type="submit"
                    className="px-6 py-2.5 text-sm bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700 transition-colors flex items-center gap-2">
                    Continue <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </form>
    );
}
