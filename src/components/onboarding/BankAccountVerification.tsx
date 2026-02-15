"use client";

import { useState, useEffect } from "react";
import { Building2, CheckCircle, Loader2, AlertCircle, RefreshCw } from "lucide-react";

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

interface Bank {
    id: number;
    name: string;
    code: string;
    slug: string;
}

export function BankAccountVerification({ onVerified, initialData }: BankAccountVerificationProps) {
    const [bankName, setBankName] = useState(initialData?.bankName || "");
    const [accountNumber, setAccountNumber] = useState(initialData?.accountNumber || "");
    const [accountName, setAccountName] = useState(initialData?.accountName || "");
    const [verifying, setVerifying] = useState(false);
    const [verified, setVerified] = useState(initialData?.verified || false);
    const [error, setError] = useState("");
    const [banks, setBanks] = useState<Bank[]>([]);
    const [loadingBanks, setLoadingBanks] = useState(true);
    const [banksError, setBanksError] = useState("");

    // Load bank list on mount
    useEffect(() => {
        loadBankList();
    }, []);

    const loadBankList = async () => {
        setLoadingBanks(true);
        setBanksError("");

        try {
            const { getBankList } = await import('@/app/actions/paystack');
            const result = await getBankList();

            if (result.success && result.banks) {
                setBanks(result.banks);
            } else {
                setBanksError(result.error || 'Failed to load bank list');
            }
        } catch (err) {
            console.error('Error loading banks:', err);
            setBanksError('Failed to load bank list. Please refresh the page.');
        } finally {
            setLoadingBanks(false);
        }
    };

    const handleVerify = async () => {
        if (!bankName || !accountNumber) {
            setError("Please fill in all fields");
            return;
        }

        if (accountNumber.length !== 10) {
            setError("Account number must be exactly 10 digits");
            return;
        }

        setVerifying(true);
        setError("");

        try {
            // Import Paystack actions
            const { verifyBankAccount } = await import('@/app/actions/paystack');

            // Find the selected bank's code
            const selectedBank = banks.find(
                bank => bank.name === bankName
            );

            if (!selectedBank) {
                setError(`Bank "${bankName}" not found. Please select from the dropdown.`);
                setVerifying(false);
                return;
            }

            // Verify account using Paystack API
            const result = await verifyBankAccount(accountNumber, selectedBank.code);

            if (!result.success || !result.accountName) {
                setError(result.error || "Failed to verify account. Please check your details.");
                setVerified(false);
                setVerifying(false);
                return;
            }

            // Success - account verified
            setAccountName(result.accountName);
            setVerified(true);
            setError("");

            onVerified({
                bankName,
                accountNumber,
                accountName: result.accountName,
                verified: true,
            });
        } catch (err) {
            console.error('Bank verification error:', err);
            setError("An unexpected error occurred. Please try again.");
            setVerified(false);
        } finally {
            setVerifying(false);
        }
    };

    const handleRetry = () => {
        setError("");
        setVerified(false);
        setAccountName("");
    };

    return (
        <div className="space-y-4">
            {/* Bank Selection */}
            <div>
                <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
                    Bank Name <span className="text-red-500">*</span>
                </label>

                {/* Banks loading error alert */}
                {banksError && (
                    <div className="mb-3 flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-yellow-700 dark:text-yellow-300">
                        <AlertCircle className="w-5 h-5" />
                        <div className="flex-1">
                            <span className="text-sm">{banksError}</span>
                        </div>
                        <button
                            onClick={loadBankList}
                            className="p-1 hover:bg-yellow-100 dark:hover:bg-yellow-800 rounded"
                            title="Retry loading banks"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                )}

                <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <select
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        disabled={verified || loadingBanks}
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <option value="">
                            {loadingBanks ? 'Loading banks...' : 'Select your bank'}
                        </option>
                        {banks.map((bank) => (
                            <option key={bank.code} value={bank.name}>
                                {bank.name}
                            </option>
                        ))}
                    </select>
                    {loadingBanks && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 animate-spin" />
                    )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                    {loadingBanks ? 'Please wait...' : `${banks.length} banks available`}
                </p>
            </div>

            {/* Account Number */}
            <div>
                <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
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
                    <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
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
                <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300">
                    <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <span className="text-sm block">{error}</span>
                        {verified && (
                            <button
                                onClick={handleRetry}
                                className="text-sm underline mt-1 hover:no-underline"
                            >
                                Try a different account
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Verify Button */}
            {!verified && (
                <button
                    onClick={handleVerify}
                    disabled={verifying || !bankName || !accountNumber || loadingBanks}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                    {verifying ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Verifying Account...
                        </>
                    ) : (
                        <>
                            <CheckCircle className="w-5 h-5" />
                            Verify Account
                        </>
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
