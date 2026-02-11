/**
 * Bank Account Step
 * 
 * Third step - link bank account for settlements
 */

"use client";

import { useState } from "react";
import {
    BankAccountVerification,
    BankAccountData,
} from "@/components/onboarding/BankAccountVerification";
import { useToast } from "@/contexts/ToastContext";

interface BankAccountStepProps {
    onNext: (data: any) => void;
    onBack: () => void;
    initialData?: BankAccountData;
}

export function BankAccountStep({
    onNext,
    onBack,
    initialData,
}: BankAccountStepProps) {
    const [bankData, setBankData] = useState<BankAccountData | null>(
        initialData || null
    );
    const { showToast } = useToast();

    const handleVerified = (data: BankAccountData) => {
        setBankData(data);
    };

    const handleSubmit = () => {
        if (!bankData || !bankData.verified) {
            showToast("Please verify your bank account to continue", "error");
            return;
        }

        onNext({
            bank: bankData,
        });
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 md:p-8">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                    Link Bank Account
                </h2>
                <p className="text-slate-600 dark:text-slate-400">
                    Add your bank account for investment settlements and returns
                </p>
            </div>

            <div className="space-y-6">
                {/* Bank Account Verification */}
                <BankAccountVerification
                    onVerified={handleVerified}
                    initialData={initialData}
                />

                {/* Info Section */}
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <h4 className="font-semibold text-green-900 dark:text-green-100 mb-2">
                        How it works
                    </h4>
                    <ul className="text-sm text-green-800 dark:text-green-200 space-y-1">
                        <li>• Your investment returns will be paid to this account</li>
                        <li>• You can withdraw funds directly to this account</li>
                        <li>• Account details are encrypted and secure</li>
                        <li>• You can update your account details later in settings</li>
                    </ul>
                </div>

                {/* Navigation Buttons */}
                <div className="flex justify-between pt-4">
                    <button
                        onClick={onBack}
                        className="px-6 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors font-semibold"
                    >
                        Back
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!bankData?.verified}
                        className="px-8 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
                    >
                        Continue to Terms
                    </button>
                </div>
            </div>
        </div>
    );
}
