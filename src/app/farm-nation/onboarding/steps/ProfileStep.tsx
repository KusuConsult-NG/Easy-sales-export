"use client";

import { useState } from "react";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { NIGERIAN_LOCATIONS } from "@/lib/locations";
import { FormInput, FormSelect } from "@/components/ui/FormField";

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
}

export default function ProfileStep({ onNext, onBack, initialData }: ProfileStepProps) {
    const [formData, setFormData] = useState({
        firstName: initialData?.firstName || (initialData?.fullName ? initialData.fullName.split(' ')[0] : '') || "",
        lastName: initialData?.lastName || (initialData?.fullName ? initialData.fullName.split(' ').slice(1).join(' ') : '') || "",
        otherName: initialData?.otherName || "",
        phone: initialData?.phone || "",
        businessName: initialData?.businessName || "",
        state: initialData?.state || "",
        lga: initialData?.lga || "",
        address: initialData?.address || "",
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const set = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value, ...(field === 'state' ? { lga: '' } : {}) }));
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
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleSubmit = (ev: React.FormEvent) => {
        ev.preventDefault();
        if (validate()) {
            const fullName = [formData.firstName, formData.otherName, formData.lastName]
                .filter(Boolean).join(" ").trim();
            onNext({ profile: { ...formData, fullName } });
        }
    };

    return (
        <form onSubmit={handleSubmit} className="max-w-xl mx-auto space-y-4">
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
            <div className="grid grid-cols-2 gap-4">
                <FormInput label="First Name" size="md" required
                    value={formData.firstName} onChange={e => set('firstName', e.target.value)}
                    placeholder="e.g. Amina" error={errors.firstName} hint="As on your NIN/BVN"
                    accentColor="emerald" />
                <FormInput label="Last Name" size="md" required
                    value={formData.lastName} onChange={e => set('lastName', e.target.value)}
                    placeholder="e.g. Ibrahim" error={errors.lastName} hint="As on your NIN/BVN"
                    accentColor="emerald" />
            </div>

            {/* Row 2: Other Name + Phone */}
            <div className="grid grid-cols-2 gap-4">
                <FormInput label="Other Name" size="md" optional
                    value={formData.otherName} onChange={e => set('otherName', e.target.value)}
                    placeholder="e.g. Fatima" accentColor="emerald" />
                <FormInput label="Phone Number" size="sm" required type="tel"
                    value={formData.phone} onChange={e => set('phone', e.target.value)}
                    placeholder="08012345678" error={errors.phone} accentColor="emerald" />
            </div>

            {/* Row 3: State + LGA */}
            <div className="grid grid-cols-2 gap-4">
                <FormSelect label="State" size="md" required
                    value={formData.state} onChange={e => set('state', e.target.value)}
                    error={errors.state} accentColor="emerald">
                    <option value="">Select State</option>
                    {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </FormSelect>
                <FormSelect label="LGA" size="md" required
                    value={formData.lga} onChange={e => set('lga', e.target.value)}
                    disabled={!formData.state} error={errors.lga} accentColor="emerald">
                    <option value="">Select LGA</option>
                    {formData.state && NIGERIAN_LOCATIONS[formData.state]?.map(l => (
                        <option key={l} value={l}>{l}</option>
                    ))}
                </FormSelect>
            </div>

            {/* Row 4: Business Name + Address spans full */}
            <div className="grid grid-cols-2 gap-4">
                <FormInput label="Business Name" size="md" optional
                    value={formData.businessName} onChange={e => set('businessName', e.target.value)}
                    placeholder="Agro Ventures Ltd" accentColor="emerald" />
                <div /> {/* spacer */}
            </div>

            <FormInput label="Address" size="full" required
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
