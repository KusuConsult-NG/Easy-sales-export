/**
 * KYC Verification Step
 * 
 * Second step - identity verification with document upload
 */

"use client";

import { useState } from "react";
import { KYCForm, KYCData } from "@/components/onboarding/KYCForm";
import { DocumentUpload } from "@/components/onboarding/DocumentUpload";
import { useToast } from "@/contexts/ToastContext";

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
    const { showToast } = useToast();

    const handleSubmit = () => {
        // Validate KYC data
        if (
            !kycData.fullName ||
            !kycData.dateOfBirth ||
            !kycData.phoneNumber ||
            !kycData.address ||
            !kycData.city ||
            !kycData.state ||
            !kycData.bvn ||
            !kycData.idType ||
            !kycData.idNumber
        ) {
            showToast("Please fill in all required fields", "error");
            return;
        }

        // Validate documents
        if (!idDocument) {
            showToast("Please upload your government-issued ID", "error");
            return;
        }

        if (!proofOfAddress) {
            showToast("Please upload proof of address", "error");
            return;
        }

        onNext({
            kyc: {
                kycData,
                documents: {
                    idDocument: idDocument.name, // In production, upload to storage and save URL
                    proofOfAddress: proofOfAddress.name,
                },
            },
        });
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 md:p-8">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                    Identity Verification
                </h2>
                <p className="text-slate-600 dark:text-slate-400">
                    Verify your identity to ensure secure transactions
                </p>
            </div>

            <div className="space-y-8">
                {/* KYC Form */}
                <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
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
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                        Document Verification
                    </h3>
                    <div className="space-y-6">
                        <DocumentUpload
                            label="Government-Issued ID"
                            description="Upload a clear photo of your NIN, Driver's License, or International Passport"
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

                {/* Info Banner */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <p className="text-sm text-blue-900 dark:text-blue-100">
                        <strong>Why do we need this?</strong> Your information is used to comply with
                        financial regulations and protect you from fraud. All data is encrypted and
                        stored securely.
                    </p>
                </div>

                {/* Navigation Buttons */}
                <div className="flex justify-between pt-4">
                    <button
                        onClick={onBack}
                        className="px-6 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors font-semibold"
                    >
                        Back
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="px-8 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold"
                    >
                        Continue to Bank Account
                    </button>
                </div>
            </div>
        </div>
    );
}
