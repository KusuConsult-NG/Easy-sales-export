/**
 * Document Upload Step
 *
 * Collects verification documents. BVN/NIN real-time verification removed.
 * Documents are reviewed manually by the admin team.
 */

"use client";

import { useState } from "react";
import { Upload, FileText, Image, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { uploadDocumentAction } from "@/app/actions/upload";
import { useToast } from "@/contexts/ToastContext";
import { IdInput } from "@/components/ui/IdInput";

interface DocumentUploadStepProps {
    data: {
        validId?: { name: string; url: string };
        passportPhoto?: { name: string; url: string };
        proofOfAddress?: { name: string; url: string };
        bvn?: string;
    };
    onChange: (data: any) => void;
    onNext: () => void;
    onBack: () => void;
}

interface UploadState {
    uploading: boolean;
    progress: number;
    error?: string;
}

export default function DocumentUploadStep({ data, onChange, onNext, onBack }: DocumentUploadStepProps) {
    const { showToast } = useToast();
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [torAgreed, setTorAgreed] = useState(false);
    const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({
        validId: { uploading: false, progress: 0 },
        passportPhoto: { uploading: false, progress: 0 },
        proofOfAddress: { uploading: false, progress: 0 },
    });

    const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];

    const handleFileUpload = async (field: string, file: File | null) => {
        if (!file) return;

        if (!ALLOWED_TYPES.includes(file.type)) {
            setErrors(prev => ({ ...prev, [field]: 'Invalid file type. Only JPG, PNG, PDF allowed.' }));
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            setErrors(prev => ({ ...prev, [field]: 'File too large. Max 5MB.' }));
            return;
        }

        setErrors(prev => ({ ...prev, [field]: '' }));
        setUploadStates(prev => ({ ...prev, [field]: { uploading: true, progress: 10 } }));

        try {
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });

            setUploadStates(prev => ({ ...prev, [field]: { uploading: true, progress: 40 } }));

            const result = await uploadDocumentAction(base64, file.name, file.type, field);

            if (!result.success || !result.url) {
                throw new Error(result.error || 'Upload failed');
            }

            onChange({ ...data, [field]: { name: file.name, url: result.url } });
            setUploadStates(prev => ({ ...prev, [field]: { uploading: false, progress: 100 } }));
            showToast('File uploaded successfully', 'success');

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Upload failed';
            setErrors(prev => ({ ...prev, [field]: errorMessage }));
            setUploadStates(prev => ({ ...prev, [field]: { uploading: false, progress: 0, error: errorMessage } }));
            showToast(errorMessage, 'error');
        }
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};

        if (!data.validId) {
            newErrors.validId = "Valid ID is required";
        }

        if (!data.passportPhoto) {
            newErrors.passportPhoto = "Passport photo is required";
        }

        // BVN format check - now required
        if (!data.bvn || !/^\d{11}$/.test(data.bvn)) {
            newErrors.bvn = "A valid 11-digit BVN is required";
        }

        if (!torAgreed) {
            newErrors.torAgreed = "You must read and agree to the Terms of Reference";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleContinue = () => {
        if (validate()) {
            onNext();
        } else {
            showToast("Please correct the errors in the form", "error");
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-900 mb-3">
                    Document Upload
                </h2>
                <p className="text-lg text-slate-600">
                    Upload your verification documents
                </p>
            </div>

            {/* Info Banner */}
            <div className="max-w-2xl mx-auto bg-orange-50 border border-orange-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-orange-900 mb-1">
                            Document Requirements
                        </p>
                        <ul className="text-sm text-orange-800 space-y-1">
                            <li>• All documents must be clear and readable</li>
                            <li>• Accepted formats: JPG, PNG, PDF (Max 5MB each)</li>
                            <li>• Documents will be verified by our team within 24-48 hours</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Form */}
            <div className="max-w-2xl mx-auto space-y-6">
                {/* Valid ID */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Valid ID <span className="text-red-500">*</span>
                    </label>
                    <p className="text-sm text-slate-600 mb-3">
                        Government-issued ID (NIN slip, Driver's License, International Passport)
                    </p>
                    <div className={`border-2 border-dashed rounded-lg p-6 text-center ${errors.validId ? "border-red-500 bg-red-50" : "border-slate-300 bg-slate-50"}`}>
                        {uploadStates.validId.uploading ? (
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                                <p className="text-slate-900 font-medium">Uploading... {Math.round(uploadStates.validId.progress)}%</p>
                                <div className="w-full bg-slate-200 rounded-full h-2">
                                    <div className="bg-purple-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadStates.validId.progress}%` }} />
                                </div>
                            </div>
                        ) : data.validId ? (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <CheckCircle className="w-6 h-6 text-green-600" />
                                    <span className="text-slate-900 font-medium">{data.validId.name}</span>
                                </div>
                                <button onClick={() => onChange({ ...data, validId: undefined })} className="text-red-600 hover:text-red-700 text-sm font-semibold">
                                    Remove
                                </button>
                            </div>
                        ) : (
                            <label className="cursor-pointer">
                                <input
                                    type="file"
                                    accept="image/*,.pdf"
                                    onChange={(e) => handleFileUpload("validId", e.target.files?.[0] || null)}
                                    className="hidden"
                                />
                                <FileText className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                                <p className="text-slate-600 font-medium">Click to upload ID document</p>
                                <p className="text-sm text-slate-500 mt-1">JPG, PNG, PDF (Max 5MB)</p>
                            </label>
                        )}
                    </div>
                    {data.validId && (
                        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                            <p className="text-sm text-green-700">✓ ID uploaded — our team will verify it within 24-48 hours.</p>
                        </div>
                    )}
                    {errors.validId && <p className="text-sm text-red-600 mt-1">{errors.validId}</p>}
                </div>

                {/* Passport Photo */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Passport Photo <span className="text-red-500">*</span>
                    </label>
                    <p className="text-sm text-slate-600 mb-3">Recent passport-sized photograph</p>
                    <div className={`border-2 border-dashed rounded-lg p-6 text-center ${errors.passportPhoto ? "border-red-500 bg-red-50" : "border-slate-300 bg-slate-50"}`}>
                        {uploadStates.passportPhoto.uploading ? (
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                                <p className="text-slate-900 font-medium">Uploading... {Math.round(uploadStates.passportPhoto.progress)}%</p>
                                <div className="w-full bg-slate-200 rounded-full h-2">
                                    <div className="bg-purple-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadStates.passportPhoto.progress}%` }} />
                                </div>
                            </div>
                        ) : data.passportPhoto ? (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <CheckCircle className="w-6 h-6 text-green-600" />
                                    <span className="text-slate-900 font-medium">{data.passportPhoto.name}</span>
                                </div>
                                <button onClick={() => onChange({ ...data, passportPhoto: undefined })} className="text-red-600 hover:text-red-700 text-sm font-semibold">
                                    Remove
                                </button>
                            </div>
                        ) : (
                            <label className="cursor-pointer">
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => handleFileUpload("passportPhoto", e.target.files?.[0] || null)}
                                    className="hidden"
                                />
                                <Image className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                                <p className="text-slate-600 font-medium">Click to upload passport photo</p>
                                <p className="text-sm text-slate-500 mt-1">JPG, PNG (Max 5MB)</p>
                            </label>
                        )}
                    </div>
                    {errors.passportPhoto && <p className="text-sm text-red-600 mt-1">{errors.passportPhoto}</p>}
                </div>

                {/* Proof of Address (Optional) */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Proof of Address <span className="text-slate-500">(Optional)</span>
                    </label>
                    <p className="text-sm text-slate-600 mb-3">Utility bill, bank statement, or tenancy agreement</p>
                    <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center bg-slate-50">
                        {uploadStates.proofOfAddress.uploading ? (
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                                <p className="text-slate-900 font-medium">Uploading... {Math.round(uploadStates.proofOfAddress.progress)}%</p>
                                <div className="w-full bg-slate-200 rounded-full h-2">
                                    <div className="bg-purple-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadStates.proofOfAddress.progress}%` }} />
                                </div>
                            </div>
                        ) : data.proofOfAddress ? (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <CheckCircle className="w-6 h-6 text-green-600" />
                                    <span className="text-slate-900 font-medium">{data.proofOfAddress.name}</span>
                                </div>
                                <button onClick={() => onChange({ ...data, proofOfAddress: undefined })} className="text-red-600 hover:text-red-700 text-sm font-semibold">
                                    Remove
                                </button>
                            </div>
                        ) : (
                            <label className="cursor-pointer">
                                <input
                                    type="file"
                                    accept="image/*,.pdf"
                                    onChange={(e) => handleFileUpload("proofOfAddress", e.target.files?.[0] || null)}
                                    className="hidden"
                                />
                                <Upload className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                                <p className="text-slate-600 font-medium">Click to upload proof of address</p>
                                <p className="text-sm text-slate-500 mt-1">JPG, PNG, PDF (Max 5MB)</p>
                            </label>
                        )}
                    </div>
                </div>

                {/* BVN — required via IdInput standardize */}
                <div className="pt-4 border-t border-slate-100">
                    <IdInput
                        label="Bank Verification Number (BVN)"
                        required
                        value={data.bvn || ""}
                        onChange={(v) => onChange({ ...data, bvn: v })}
                        digitsOnly
                        showCount
                        maxLength={11}
                        placeholder="11-digit BVN"
                        hint="Your 11-digit BVN — used for identity checks during admin review. 📞 Dial *565*0# to retrieve your BVN."
                        accentColor="purple"
                        error={errors.bvn}
                    />
                </div>

                {/* Terms of Reference */}
                <div className="space-y-4">
                    <label className="block text-sm font-semibold text-slate-900">
                        Terms of Reference <span className="text-red-500">*</span>
                    </label>

                    <div className="h-64 overflow-y-auto border border-slate-200 rounded-lg p-4 bg-slate-50 text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                        {TERMS_OF_REFERENCE}
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <input
                                type="checkbox"
                                id="torAgreed"
                                checked={torAgreed}
                                onChange={(e) => setTorAgreed(e.target.checked)}
                                className="mt-1 w-4 h-4 text-purple-600 rounded focus:ring-2 focus:ring-purple-500"
                            />
                            <label htmlFor="torAgreed" className="flex-1 text-sm text-slate-900 font-medium cursor-pointer">
                                I have read and agree to the Terms of Reference for the Easy Sales Cooperative Society.
                            </label>
                        </div>
                        {errors.torAgreed && (
                            <p className="text-sm text-red-600 mt-2 ml-7">{errors.torAgreed}</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6">
                <button
                    onClick={onBack}
                    className="px-8 py-3 border-2 border-slate-300 text-slate-900 rounded-lg font-semibold hover:bg-slate-50 transition-all"
                >
                    ← Back
                </button>
                <button
                    onClick={handleContinue}
                    className="px-8 py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition-all flex items-center gap-2"
                >
                    Continue →
                </button>
            </div>
        </div>
    );
}

const TERMS_OF_REFERENCE = `TERMS OF REFERENCE (ToR)
FOR THE EASY SALES COOPERATIVE SOCIETY

1. INTRODUCTION
This document sets out the Terms of Reference (ToR) to guide the establishment, governance, and operation of Easy Sales Cooperative Society, promoted by Easy Sales Export LTD, as part of its women empowerment and agricultural development initiative, expressed under the banner of Women Agro Value Expansion (W.A.V.E.) Program.

The Cooperative is designed to provide a structured savings platform for women participating in the W.A.V.E. project, enhance financial inclusion, promote economic self-reliance, and support sustainable livelihoods.

The Cooperative shall operate in accordance with the principles of cooperative societies and all applicable Laws of the Federal Republic of Nigeria.

2. NAME AND LEGAL STATUS
The Cooperative shall be registered as a Cooperative Society under the relevant Cooperative Laws of Nigeria, and shall operate as a member-owned, democratic, and non-profit-oriented entity.

3. OBJECTIVES OF THE COOPERATIVE
The objectives of the Cooperative shall include:
1. To encourage a culture of regular savings among women engaged in the W.A.V.E. project.
2. To promote financial inclusion and economic empowerment of women farmers engaged in the project.
3. To mobilize savings for the collective benefit and financial stability of members.
4. To provide a secure and transparent savings platform for women participants.
5. To support sustainable agricultural livelihoods through disciplined financial practices.
6. To strengthen cooperation, solidarity, and mutual support among women farmers.

4. MEMBERSHIP
4.1 Eligibility
Membership shall be open to:
• Women participating in the W.A.V. E. project;
• Other women from the public who meet the Cooperative's criteria;
• Persons who are at least 18 years of age and have legal capacity;
• Individuals who agree to abide by the Cooperative's bylaws and policies.

4.2 Admission Procedure
• Interested persons shall complete a membership application form.
• Payment of the prescribed registration fee and minimum savings contribution shall be required.
• Admission shall be subject to approval by the Management of Easy Sales Export LTD.

4.3 Rights of Members
Members shall have the right to:
• Participate in Cooperative activities;
• Attend and vote at General Meetings;
• Access information on their savings and Cooperative performance;
• Enjoy benefits arising from the Cooperative's activities, subject to rules.

4.4 Obligations of Members
Members shall:
• Make regular savings contributions as prescribed;
• Comply with the Cooperative's rules and decisions;
• Promote the objectives and good image of the Cooperative.

5. GOVERNANCE STRUCTURE
5.1 General Meeting
The General Meeting of members shall be the supreme authority of the Cooperative and shall be responsible for major policy decisions.

5.2 Management Committee
• The Cooperative shall be administered by a Management Committee elected by members at the General Meeting, but subject to approval by the CEO Easy Sales Export LTD.
• The Committee shall consist of a Chairperson, Secretary, Treasurer, and other members as may be determined.
• Members of the Committee shall serve for a tenure as specified in the Cooperative's by-laws.

5.3 Role of the Promoting Organization
• Easy sales Export LTD shall act as the Promoter of the Cooperative.
• Easy sales Export LTD may provide technical guidance, capacity building, and oversight support, especially at the formative stage.
• The Cooperative shall remain autonomous and member-driven in its operations.

6. FINANCIAL MANAGEMENT
6.1 Sources of Funds
The funds of the Cooperative shall be derived from:
• Members' savings contributions;
• Registration and administrative fees;
• Grants, donations, or support linked to the W.A.V.E. project;
• Other lawful sources approved by the General Meeting.

6.2 Application of Funds
Funds shall be applied strictly towards the achievement of the objectives of the Cooperative. No part of the funds shall be distributed for personal profit, except as may be permitted under cooperative surplus distribution principles.

6.3 Banking and Signatories
• The Cooperative shall operate one or more bank accounts in its registered name.
• Withdrawals shall require joint authorization by approved signatories.

7. SAVINGS OPERATIONS
1. Members shall make minimum savings contributions as determined by the Cooperative.
2. Savings records shall be maintained accurately and communicated periodically to members.
3. Withdrawal of savings shall be subject to conditions and notice periods approved by the General Meeting.

8. RECORD KEEPING AND AUDIT
• Proper books of accounts and membership records shall be maintained.
• Periodic financial reports shall be prepared for members.
• Accounts shall be audited in accordance with applicable laws and best practices.

9. DISCIPLINE AND SANCTIONS
• Members who violate Cooperative rules may be warned, suspended, or expelled in accordance with due process.
• Sanctions shall be fair, transparent, and aimed at protecting the Cooperative.

10. AMENDMENT OF TERMS
These Terms of Reference may be amended by a resolution passed at a General Meeting, subject to compliance with applicable laws.

11. FUTURE GROWTH PATHWAY
The Cooperative shall adopt a phased growth approach to ensure sustainability and risk control. Subject to Management approval and regulatory compliance, the following pathways may be developed over time:
1. Phase I – Savings Consolidation: Strengthening regular savings culture, accurate record-keeping, and member education.
2. Phase II – Agricultural Inputs Support: Collective procurement or facilitation of access to farming inputs such as seeds, fertilizers, tools, and extension services to support members' productivity.
3. Phase III – Credit and Support Services: Introduction of carefully structured member support or credit services, subject to the Cooperative's financial strength, approved policies, and applicable laws.

PLEASE NOTE:
Any expansion into additional services shall be approved by the General Meeting and documented in the Cooperative's by-laws and operational policies.

12. DISSOLUTION
In the event of dissolution, the assets of the Cooperative shall be disposed of in accordance with the Cooperative Laws of Nigeria after settlement of all liabilities.

12. ADOPTION
These Terms of Reference were approved by the Management of Easy Sales Export LTD. February, 2026`;
