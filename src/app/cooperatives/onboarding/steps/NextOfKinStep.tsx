/**
 * Next of Kin Step — uses FormInput/FormSelect for consistent field sizing
 */
"use client";

import { useState } from "react";
import { isNigerianMobile } from "@/lib/phone";
import { useToast } from "@/contexts/ToastContext";
import { FormInput, FormSelect, FormTextarea } from "@/components/ui/FormField";

interface NextOfKinStepProps {
    data: { fullName: string; relationship: string; phone: string; address: string; };
    onChange: (data: any) => void;
    onNext: () => void;
    onBack: () => void;
}

const RELATIONSHIPS = ["Spouse", "Parent", "Sibling", "Child", "Relative", "Friend", "Other"];

export default function NextOfKinStep({ data, onChange, onNext, onBack }: NextOfKinStepProps) {
    const { showToast } = useToast();
    const [errors, setErrors] = useState<Record<string, string>>({});

    const set = (field: string, value: string) =>
        onChange({ ...data, [field]: value });

    const validate = () => {
        const e: Record<string, string> = {};
        if (!data.fullName.trim()) e.fullName = "Next of kin name is required";
        else if (data.fullName.trim().length < 2) e.fullName = "Next of kin name must be at least 2 characters";
        if (!data.relationship) e.relationship = "Please select relationship";
        if (!data.phone.trim()) e.phone = "Phone number is required";
            /*
             *   #923 THE PLATFORM'S ONE PHONE RULE, not a copy of it.
             *
             *   #919 consolidated the two functions called isValidNigerianPhone
             *   onto lib/phone's isNigerianMobile, whose header records WHY the
             *   middle digit matters: "Nigerian mobile prefixes are 070, 071,
             *   080, 081, 090 and 091 — so `[789][01]` is the real set."
             *
             *   THREE REGEXES SURVIVED THAT, and this was one of them. `/^0\d{10}$/` is barely a phone
             *   check at all: it accepts 0 followed by ANY ten digits, so
             *   01234567890 and 09912345678 both passed. isNigerianMobile
             *   refuses both, and also accepts the +234 and bare ten-digit
             *   spellings a person may paste.
             */
        else if (!isNigerianMobile(data.phone)) e.phone = "Enter a valid Nigerian mobile number, e.g. 08031234567";
        if (!data.address.trim()) e.address = "Address is required";
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    function handleContinue() {
        if (validate()) { onNext(); }
        else {
            showToast("Please provide all required next of kin details", "error");
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-2xl font-bold text-slate-900 mb-1">Next of Kin Information</h2>
                <p className="text-sm text-slate-600">Provide emergency contact details</p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                <p className="text-sm text-blue-800">
                    ℹ️ Your next of kin will be contacted in emergencies and will be the beneficiary of your savings.
                </p>
            </div>

            {/* Full Name + Relationship */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormInput label="Full Name" required
                    value={data.fullName} onChange={e => set("fullName", e.target.value)}
                    placeholder="Jane Doe" error={errors.fullName} />
                <FormSelect label="Relationship" required
                    value={data.relationship} onChange={e => set("relationship", e.target.value)}
                    error={errors.relationship}>
                    <option value="">Select relationship</option>
                    {RELATIONSHIPS.map(r => <option key={r} value={r.toLowerCase()}>{r}</option>)}
                </FormSelect>
            </div>

            {/* Phone */}
            <FormInput label="Phone Number" required type="tel"
                value={data.phone} onChange={e => set("phone", e.target.value)}
                placeholder="08012345678" error={errors.phone} />

            {/* Address */}
            <FormTextarea label="Address" required
                value={data.address} onChange={e => set("address", e.target.value)}
                placeholder="Full address including state" rows={3}
                error={errors.address} />

            {/* Navigation */}
            <div className="flex justify-between pt-2">
                <button onClick={onBack}
                    className="px-5 py-2.5 text-sm border-2 border-slate-300 text-slate-900 rounded-lg font-semibold hover:bg-slate-50 transition-all">
                    Back
                </button>
                <button onClick={handleContinue}
                    className="px-5 py-2.5 text-sm bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition-all">
                    Continue
                </button>
            </div>
        </div>
    );
}
