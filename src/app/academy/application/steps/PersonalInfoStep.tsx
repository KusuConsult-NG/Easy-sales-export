"use client";

import { NIGERIAN_LOCATIONS, STATES } from "@/lib/locations";
import { FormInput, FormSelect } from "@/components/ui/FormField";

interface PersonalInfoData {
    firstName: string;
    lastName: string;
    otherName?: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    gender: string;
    state: string;
    lga: string;
    occupation: string;
}

interface PersonalInfoStepProps {
    data: PersonalInfoData;
    onChange: (data: PersonalInfoData) => void;
    errors: Record<string, string>;
}

export default function PersonalInfoStep({ data, onChange, errors }: PersonalInfoStepProps) {
    const set = (field: keyof PersonalInfoData, value: string) => {
        onChange({ ...(data || {} as PersonalInfoData), [field]: value, ...(field === "state" ? { lga: "" } : {}) });
    };

    const stateValue = data?.state || "";

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-1">Personal Information</h2>
                <p className="text-sm text-slate-600">Please provide your basic information to get started with the Academy.</p>
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
                    value={data?.firstName || ""} onChange={e => set("firstName", e.target.value)}
                    placeholder="e.g. Amina" error={errors.firstName} hint="As on your NIN/BVN" />
                <FormInput label="Last Name" required
                    value={data?.lastName || ""} onChange={e => set("lastName", e.target.value)}
                    placeholder="e.g. Ibrahim" error={errors.lastName} hint="As on your NIN/BVN" />
            </div>

            {/* Row 2: Other Name + Phone */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormInput label="Other Name" optional
                    value={data?.otherName || ""} onChange={e => set("otherName", e.target.value)}
                    placeholder="e.g. Fatima" />
                <FormInput label="Phone Number" required type="tel" maxLength={11}
                    value={data?.phone || ""} onChange={e => set("phone", e.target.value)}
                    placeholder="08012345678" error={errors.phone} />
            </div>

            {/* Row 3: Date of Birth + Gender */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormInput label="Date of Birth" required type="date"
                    value={data?.dateOfBirth || ""} onChange={e => set("dateOfBirth", e.target.value)}
                    error={errors.dateOfBirth} />
                <FormSelect label="Gender" required
                    value={data?.gender || ""} onChange={e => set("gender", e.target.value)}
                    error={errors.gender}>
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                </FormSelect>
            </div>

            {/* Row 4: Email + Occupation */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormInput label="Email Address" required type="email"
                    value={data?.email || ""} onChange={e => set("email", e.target.value)}
                    placeholder="you@example.com" error={errors.email} />
                <FormInput label="Current Occupation" required
                    value={data?.occupation || ""} onChange={e => set("occupation", e.target.value)}
                    placeholder="e.g. Farmer, Student" error={errors.occupation} />
            </div>

            {/* Row 5: State + LGA */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormSelect label="State of Residence" required
                    value={stateValue} onChange={e => set("state", e.target.value)}
                    error={errors.state}>
                    <option value="">Select your state</option>
                    {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </FormSelect>
                <FormSelect label="Local Government Area" required
                    value={data?.lga || ""} onChange={e => set("lga", e.target.value)}
                    disabled={!stateValue} error={errors.lga}>
                    <option value="">Select LGA</option>
                    {stateValue && NIGERIAN_LOCATIONS[stateValue]?.map(l => (
                        <option key={l} value={l}>{l}</option>
                    ))}
                </FormSelect>
            </div>
        </div>
    );
}
