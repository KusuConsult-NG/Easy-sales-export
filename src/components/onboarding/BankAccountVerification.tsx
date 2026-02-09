/**
 * Bank Account Verification Component
 * 
 * Component for collecting and verifying bank account information
 */

"use client";

import { useState } from "react";
import { Building2, CheckCircle, Loader2, AlertCircle } from "lucide-react";

interface BankAccountVerificationProps {
    onVerified: (accountData: BankAccountData) => void;
    initialData?: Partial<BankAccountData>;
}

export interface BankAccountData {
    bankName: string;
    accountNumber: string;
    accountName: string;
    verified: boolean;
}

const NIGERIAN_BANKS = [
    "Access Bank",
    "First Bank of Nigeria",
    "Guaranty Trust Bank (GTB)",
    "United Bank for Africa (UBA)",
    "Zenith Bank",
    "Ecobank Nigeria",
    "Fidelity Bank",
    "Union Bank",
    "Sterling Bank",
    "Stanbic IBTC",
    "Keystone Bank",
    "Polaris Bank",
    "Wema Bank",
    "Unity Bank",
    "Providus Bank",
    "Jaiz Bank",
    "Kuda Bank",
    "Opay",
    "Palmpay",
    "Moniepoint",
];

export function BankAccountVerification({ onVerified, initialData }: BankAccountVerificationProps) {
    const [bankName, setBankName] = useState(initialData?.bankName || "");
    const [accountNumber, setAccountNumber] = useState(initialData?.accountNumber || "");
    const [accountName, setAccountName] = useState(initialData?.accountName || "");
    const [verifying, setVerifying] = useState(false);
    const [verified, setVerified] = useState(initialData?.verified || false);
    const [error, setError] = useState("");

    const handleVerify = async () => {
        if (!bankName || !accountNumber) {
            setError("Please fill in all fields");
            return;
        }

        if (accountNumber.length !== 10) {
            setError("Account number must be 10 digits");
            return;
        }

        setVerifying(true);
        setError("");

        try {
            // Simulate API call to verify account
            // In production, this would call Paystack, Flutterwave, or bank API
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Mock account name retrieval
            const mockAccountName = "John Doe"; // This would come from the API

            setAccountName(mockAccountName);
            setVerified(true);

            onVerified({
                bankName,
                accountNumber,
                accountName: mockAccountName,
                verified: true,
            });
        } catch (err) {
            setError("Failed to verify account. Please try again.");
            setVerified(false);
        } finally {
            setVerifying(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Bank Selection */}
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Bank Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <select
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        disabled={verified}
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <option value="">Select your bank</option>
                        {NIGERIAN_BANKS.map((bank) => (
                            <option key={bank} value={bank}>
                                {bank}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Account Number */}
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Account Number <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, "").slice(0, 10);
                        setAccountNumber(value);
                    }}
                    disabled={verified}
                    placeholder="0123456789"
                    maxLength={10}
                    className="w-full px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="text-xs text-slate-500 mt-1">
                    Enter your 10-digit account number
                </p>
            </div>

            {/* Account Name (Auto-filled after verification) */}
            {accountName && (
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Account Name
                    </label>
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <span className="font-medium text-green-900 dark:text-green-100">
                            {accountName}
                        </span>
                    </div>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300">
                    <AlertCircle className="w-5 h-5" />
                    <span className="text-sm">{error}</span>
                </div>
            )}

            {/* Verify Button */}
            {!verified && (
                <button
                    onClick={handleVerify}
                    disabled={verifying || !bankName || !accountNumber}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                    {verifying ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Verifying Account...
                        </>
                    ) : (
                        "Verify Account"
                    )}
                </button>
            )}

            {/* Success Message */}
            {verified && (
                <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                    <div>
                        <p className="font-medium text-green-900 dark:text-green-100">
                            Account Verified
                        </p>
                        <p className="text-sm text-green-700 dark:text-green-300">
                            Your bank account has been successfully verified
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
