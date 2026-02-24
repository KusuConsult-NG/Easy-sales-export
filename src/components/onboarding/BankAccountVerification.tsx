"use client";

import { useState, useEffect } from "react";
import { Building2, CheckCircle, Loader2, AlertCircle, RefreshCw } from "lucide-react";

interface BankAccountVerificationProps {
    onVerified: (accountData: BankAccountData) => void;
    initialData?: Partial<BankAccountData>;
}

export interface BankAccountData {
    bvn?: string;
    bvnVerified?: boolean;
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
    const [bvn, setBvn] = useState(initialData?.bvn || "");
    const [verifyingBvn, setVerifyingBvn] = useState(false);
    const [bvnVerified, setBvnVerified] = useState(initialData?.bvnVerified || false);
    const [bvnError, setBvnError] = useState("");

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
                bvn: bvnVerified ? bvn : undefined,
                bvnVerified: bvnVerified,
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

    const handleVerifyBvn = async () => {
        if (!bvn || bvn.length !== 11) {
            setBvnError("Please enter a valid 11-digit BVN");
            return;
        }

        // We need a first name and last name to verify the BVN against.
        // Assuming the Bank verification is done first, we can use the account Name. Or vice-versa.
        // If they do Bank Verification first, we have `accountName`.
        if (!verified || !accountName) {
            setBvnError("Please verify your bank account first so we can match the names.");
            return;
        }

        const nameParts = accountName.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts[nameParts.length - 1] || '';

        setVerifyingBvn(true);
        setBvnError("");

        try {
            const response = await fetch('/api/kyc/verify-bvn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bvn: bvn,
                    firstName: firstName,
                    lastName: lastName
                })
            });

            const result = await response.json();

            if (result.success && result.isMatch) {
                setBvnVerified(true);
                setBvnError("");

                // Update parent with the verified BVN
                onVerified({
                    bvn: bvn,
                    bvnVerified: true,
                    bankName,
                    accountNumber,
                    accountName: accountName,
                    verified: true,
                });
            } else {
                setBvnVerified(false);
                setBvnError(result.error || result.details || "Verification failed");
            }
        } catch (error) {
            setBvnError("An unexpected error occurred during verification");
        } finally {
            setVerifyingBvn(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Bank Selection */}
            <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                    Bank Name <span className="text-red-500">*</span>
                </label>

                {/* Banks loading error alert */}
                {banksError && (
                    <div className="mb-3 flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700">
                        <AlertCircle className="w-5 h-5" />
                        <div className="flex-1">
                            <span className="text-sm">{banksError}</span>
                        </div>
                        <button
                            onClick={loadBankList}
                            className="p-1 hover:bg-yellow-100 rounded"
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
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
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
                <label className="block text-sm font-medium text-slate-900 mb-2">
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
                    className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="text-xs text-slate-500 mt-1">
                    Enter your 10-digit account number
                </p>
            </div>

            {/* Account Name (Auto-filled after verification) */}
            {accountName && (
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        Account Name
                    </label>
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <span className="font-medium text-green-900">
                            {accountName}
                        </span>
                    </div>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
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
                <div className="flex items-center justify-between gap-2 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2">
                        <CheckCircle className="w-6 h-6 text-green-600" />
                        <div>
                            <p className="font-medium text-green-900">
                                Account Verified
                            </p>
                            <p className="text-sm text-green-700">
                                Your bank account has been successfully verified
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            setVerified(false);
                            setBvnVerified(false);
                            setAccountName("");
                            setBvn("");
                            setError("");
                            setBvnError("");
                        }}
                        className="text-xs text-slate-500 underline hover:text-slate-700 hover:no-underline shrink-0"
                        title="Change bank details"
                    >
                        ✎ Edit Details
                    </button>
                </div>
            )}
            {/* BVN Verification (Only shown after successful bank verification) */}
            {verified && (
                <div className="mt-8 pt-6 border-t border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Identity Verification</h3>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        Bank Verification Number (BVN) <span className="text-red-500">*</span>
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={bvn}
                            onChange={(e) => {
                                setBvn(e.target.value.replace(/\D/g, "").slice(0, 11));
                                setBvnVerified(false);
                                setBvnError("");
                            }}
                            disabled={bvnVerified}
                            placeholder="11-digit BVN"
                            maxLength={11}
                            className={`flex-1 px-4 py-2.5 bg-white border rounded-lg focus:ring-2 disabled:bg-slate-100 disabled:text-slate-500 ${bvnVerified ? "border-green-500 focus:ring-green-500" : "border-slate-300 focus:ring-orange-500 focus:border-transparent"} disabled:opacity-50`}
                        />
                        <button
                            onClick={handleVerifyBvn}
                            disabled={verifyingBvn || !bvn || bvn.length !== 11 || bvnVerified}
                            className="px-6 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium min-w-[120px]"
                        >
                            {verifyingBvn ? (
                                <><Loader2 className="w-5 h-5 animate-spin" /> Verifying</>
                            ) : bvnVerified ? (
                                <><CheckCircle className="w-5 h-5 text-green-600" /> Verified</>
                            ) : (
                                "Verify BVN"
                            )}
                        </button>
                    </div>
                    {bvnError && (
                        <div className="flex items-start gap-2 mt-2 text-red-600">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span className="text-sm">{bvnError}</span>
                        </div>
                    )}
                    {bvnVerified && (
                        <div className="flex items-center justify-between mt-2">
                            <div className="flex items-center gap-2 text-green-600">
                                <CheckCircle className="w-4 h-4 shrink-0" />
                                <span className="text-sm font-medium">BVN Verified against account name successfully</span>
                            </div>
                            <button
                                onClick={() => { setBvnVerified(false); setBvn(""); setBvnError(""); }}
                                className="text-xs text-slate-500 underline hover:text-slate-700 ml-2"
                            >
                                Edit BVN
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
