/**
 * KYC Verification Step
 *
 * Second step — identity verification with document upload.
 * Personal info is saved to Firestore via saveKYCProfileAction.
 * BVN / NIN are verified inline in KYCForm, results persist automatically.
 */

'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { KYCForm, KYCData } from '@/components/onboarding/KYCForm';
import { DocumentUpload } from '@/components/onboarding/DocumentUpload';
import { useToast } from '@/contexts/ToastContext';
import { saveKYCProfileAction } from '@/app/actions/kyc';

interface KYCVerificationStepProps {
    onNext: (data: any) => void;
    onBack: () => void;
    initialData?: any;
}

export function KYCVerificationStep({
    onNext,
    onBack,
    initialData,
}: KYCVerificationStepProps) {
    const [kycData, setKycData] = useState<Partial<KYCData>>(initialData?.kycData || {});
    const [idDocument, setIdDocument] = useState<File | null>(null);
    const [proofOfAddress, setProofOfAddress] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);
    const { showToast } = useToast();

    const handleSubmit = async () => {
        // Validate required personal info fields
        if (
            !kycData.fullName ||
            !kycData.dateOfBirth ||
            !kycData.phoneNumber ||
            !kycData.address ||
            !kycData.city ||
            !kycData.state
        ) {
            showToast('Please fill in all required fields', 'error');
            return;
        }

        // Require at least one verified ID (NIN is primary)
        if (!kycData.ninVerified && !kycData.bvnVerified) {
            showToast('Please verify your NIN (or BVN) before continuing', 'error');
            return;
        }

        // Validate documents
        if (!idDocument) {
            showToast('Please upload your government-issued ID', 'error');
            return;
        }

        if (!proofOfAddress) {
            showToast('Please upload proof of address', 'error');
            return;
        }

        setSaving(true);

        // Persist KYC profile fields to Firestore
        const saveResult = await saveKYCProfileAction({
            fullName: kycData.fullName!,
            dateOfBirth: kycData.dateOfBirth!,
            phoneNumber: kycData.phoneNumber!,
            address: kycData.address!,
            city: kycData.city!,
            state: kycData.state!,
            idType: kycData.idType,
            idNumber: kycData.idNumber,
        });

        setSaving(false);

        if (!saveResult.success) {
            showToast(saveResult.error || 'Failed to save KYC data. Please try again.', 'error');
            return;
        }

        onNext({
            kyc: {
                kycData,
                documents: {
                    idDocument,
                    proofOfAddress,
                },
            },
        });
    };

    return (
        <div className="bg-white rounded-lg p-6 md:p-8">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    Identity Verification
                </h2>
                <p className="text-slate-600">
                    Verify your identity to ensure secure transactions
                </p>
            </div>

            <div className="space-y-8">
                {/* KYC Form with live BVN/NIN verification */}
                <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">
                        Personal Information
                    </h3>
                    <KYCForm
                        onDataChange={setKycData}
                        initialData={kycData}
                        includeBVN={true}
                    />
                </div>

                {/* Document Uploads */}
                <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">
                        Document Verification
                    </h3>
                    <div className="space-y-6">
                        <DocumentUpload
                            label="Government-Issued ID"
                            description="Upload a clear photo of your NIN slip, Driver's License, or International Passport"
                            accept="image/*,.pdf"
                            required
                            onChange={(file) => setIdDocument(file)}
                            preview
                        />

                        <DocumentUpload
                            label="Proof of Address"
                            description="Upload a recent utility bill, bank statement, or tenancy agreement (not older than 3 months)"
                            accept="image/*,.pdf"
                            required
                            onChange={(file) => setProofOfAddress(file)}
                            preview
                        />
                    </div>
                </div>

                {/* Navigation Buttons */}
                <div className="flex justify-between pt-4">
                    <button
                        onClick={onBack}
                        disabled={saving}
                        className="px-6 py-3 border-2 border-slate-300 text-slate-900 rounded-lg hover:bg-slate-100 transition-colors font-semibold disabled:opacity-50"
                    >
                        Back
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className="px-8 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold disabled:opacity-60 flex items-center gap-2"
                    >
                        {saving ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                        ) : (
                            'Continue to Bank Account'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
