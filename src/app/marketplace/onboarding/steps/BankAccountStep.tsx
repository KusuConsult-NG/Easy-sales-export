/**
 * Step 6: Bank Account (Sellers Only)
 * 
 * Links bank account for receiving payments
 */

"use client";

import BankAccountVerification from "@/components/shared/BankAccountVerification";

interface BankAccountData {
    bankName: string;
    accountNumber: string;
    accountName: string;
}

interface BankAccountStepProps {
    data?: BankAccountData;
    onChange: (data: BankAccountData) => void;
    onNext: () => void;
    onBack: () => void;
}

export default function BankAccountStep({ data, onChange, onNext, onBack }: BankAccountStepProps) {
    const handleVerified = (accountData: { bankName: string; accountNumber: string; accountName: string }) => {
        onChange(accountData);
    };

    const handleContinue = () => {
        if (data?.accountName) {
            onNext();
        }
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                    Bank Account
                </h2>
                <p className="text-lg text-slate-600 dark:text-slate-400">
                    Link your account to receive payments
                </p>
            </div>

            <div className="max-w-2xl mx-auto">
                {/* Info Banner */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6">
                    <div className="flex items-start gap-3">
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-white text-sm">ℹ</span>
                        </div>
                        <div className="text-sm">
                            <p className="font-semibold text-blue-900 dark:text-blue-200 mb-1">
                                Payment Information
                            </p>
                            <p className="text-blue-800 dark:text-blue-300">
                                Your bank account will be used to receive payments from sales. Payments are processed
                                automatically after order completion via escrow system. Funds typically arrive within 2-3 business days.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Bank Account Verification Component */}
                <BankAccountVerification
                    onVerified={handleVerified}
                    initialData={data}
                />

                {/* Payment Schedule Info */}
                <div className="mt-8 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl p-6">
                    <h4 className="font-bold text-slate-900 dark:text-white mb-3">
                        Payment Schedule
                    </h4>
                    <div className="space-y-3 text-sm text-slate-900 dark:text-white">
                        <div className="flex justify-between items-center">
                            <span>Payment frequency</span>
                            <span className="font-semibold">Per completed order</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span>Processing time</span>
                            <span className="font-semibold">2-3 business days</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span>Platform fee</span>
                            <span className="font-semibold">2.5% per transaction</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span>Withdrawal limit</span>
                            <span className="font-semibold">No limit</span>
                        </div>
                    </div>
                </div>

                {/* Security Notice */}
                <div className="mt-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <div className="text-sm">
                            <p className="font-semibold text-green-900 dark:text-green-200 mb-1">
                                Your account is secure
                            </p>
                            <p className="text-green-800 dark:text-green-300">
                                Bank details are encrypted and never shared with buyers. We only use this information
                                for payment processing.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6">
                <button
                    onClick={onBack}
                    className="px-8 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                    Back
                </button>
                <button
                    onClick={handleContinue}
                    disabled={!data?.accountName}
                    className="px-8 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                >
                    Complete Registration
                </button>
            </div>
        </div>
    );
}
