"use client";

import { useState, useEffect } from "react";
import { Building2, CheckCircle, AlertCircle, Loader2, RefreshCw } from "lucide-react";

interface Bank {
    id: number;
    name: string;
    code: string;
}

interface BankAccountVerificationProps {
    bankName?: string;
    accountNumber?: string;
    accountName?: string;
    onVerify?: (isValid: boolean, accountName?: string) => void;
    onVerified?: (accountData: { bankName: string; accountNumber: string; accountName: string }) => void;
    initialData?: {
        bankName: string;
        accountNumber: string;
        accountName: string;
    };
}

export default function BankAccountVerification({
    bankName: propBankName,
    accountNumber: propAccountNumber,
    accountName: propAccountName,
    onVerify,
    onVerified,
    initialData
}: BankAccountVerificationProps) {
    const [isVerifying, setIsVerifying] = useState(false);
    const [verificationStatus, setVerificationStatus] = useState<"idle" | "success" | "error">("idle");
    const [resolvedName, setResolvedName] = useState(propAccountName || initialData?.accountName || "");
    const [bankName, setBankName] = useState(propBankName || initialData?.bankName || "");
    const [accountNumber, setAccountNumber] = useState(propAccountNumber || initialData?.accountNumber || "");
    
    const [banks, setBanks] = useState<Bank[]>([]);
    const [loadingBanks, setLoadingBanks] = useState(false);
    const [banksError, setBanksError] = useState("");

    useEffect(() => {
        if (initialData) {
            setBankName(initialData.bankName);
            setAccountNumber(initialData.accountNumber);
            if (initialData.accountName) {
                setResolvedName(initialData.accountName);
                setVerificationStatus("success");
            }
        }
    }, [initialData]);

    useEffect(() => {
        loadBanks();
    }, []);

    async function loadBanks() {
        setLoadingBanks(true);
        setBanksError("");
        try {
            const { getBankList } = await import('@/app/actions/paystack');
            const result = await getBankList();
            if (result.success && result.data?.banks) {
                setBanks(result.data.banks);
            } else {
                setBanksError(result.error || "Failed to load banks");
            }
        } catch (err) {
            setBanksError("Connection error. Could not load bank list.");
        } finally {
            setLoadingBanks(false);
        }
    }

    async function handleVerify() {
        if (!bankName || !accountNumber || accountNumber.length !== 10) {
            return;
        }

        setIsVerifying(true);
        setVerificationStatus("idle");

        try {
            // SIMULATED VERIFICATION (Requested for demo/testing)
            await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network lag
            
            const simulatedName = "SIMULATED ACCOUNT NAME";
            setResolvedName(simulatedName);
            setVerificationStatus("success");

            onVerify?.(true, simulatedName);
            onVerified?.({ bankName, accountNumber, accountName: simulatedName });
        } catch (error) {
            console.error('Bank verification error:', error);
            setVerificationStatus("error");
            onVerify?.(false);
        } finally {
            setIsVerifying(false);
        }
    };

    return (
        <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
            <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-6 h-6 text-green-600" />
                </div>
                <div className="flex-1 space-y-4">
                    <div>
                        <h4 className="text-lg font-semibold text-slate-900 mb-1">
                            Bank Account Verification
                        </h4>
                        <p className="text-sm text-slate-600">
                            Enter your details to verify and enable withdrawals
                        </p>
                    </div>

                    {verificationStatus !== "success" && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Bank Selection */}
                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-slate-700">
                                    Select Bank
                                </label>
                                <div className="relative">
                                    <select
                                        value={bankName}
                                        onChange={(e) => setBankName(e.target.value)}
                                        disabled={loadingBanks || isVerifying}
                                        className="w-full pl-3 pr-10 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm disabled:opacity-50"
                                    >
                                        <option value="">{loadingBanks ? "Loading..." : "Select Bank"}</option>
                                        {banks.map((bank) => (
                                            <option key={bank.code} value={bank.name}>
                                                {bank.name}
                                            </option>
                                        ))}
                                    </select>
                                    {loadingBanks && (
                                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
                                    )}
                                </div>
                                {banksError && (
                                    <button onClick={loadBanks} className="text-xs text-red-500 hover:underline flex items-center gap-1">
                                        <RefreshCw className="w-3 h-3" /> Retry loading banks
                                    </button>
                                )}
                            </div>

                            {/* Account Number */}
                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-slate-700">
                                    Account Number
                                </label>
                                <input
                                    type="text"
                                    value={accountNumber}
                                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                                    placeholder="10-digit number"
                                    disabled={isVerifying}
                                    maxLength={10}
                                    className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm disabled:opacity-50"
                                />
                            </div>
                        </div>
                    )}

                    {verificationStatus === "idle" && (
                        <button
                            type="button"
                            onClick={handleVerify}
                            disabled={isVerifying || !bankName || accountNumber.length !== 10}
                            className="w-full md:w-auto px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all shadow-sm"
                        >
                            {isVerifying ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Verifying...
                                </>
                            ) : (
                                <>
                                    <CheckCircle className="w-4 h-4" />
                                    Verify Account
                                </>
                            )}
                        </button>
                    )}

                    {verificationStatus === "success" && (
                        <div className="p-4 bg-green-50 border border-green-200 rounded-xl flex items-start gap-3">
                            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
                            <div className="flex-1">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-bold text-green-900">
                                        Account Verified
                                    </p>
                                    <button 
                                        onClick={() => setVerificationStatus("idle")}
                                        className="text-xs text-slate-500 hover:text-green-600 underline"
                                    >
                                        Edit
                                    </button>
                                </div>
                                <p className="text-sm text-slate-700 font-medium mt-1">
                                    {resolvedName}
                                </p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    {bankName} • {accountNumber}
                                </p>
                            </div>
                        </div>
                    )}

                    {verificationStatus === "error" && (
                        <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
                            <div className="flex items-start gap-2">
                                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="text-sm font-semibold text-red-700">
                                        Verification Failed
                                    </p>
                                    <p className="text-xs text-slate-600">
                                        Could not verify account. Please check your details and try again.
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handleVerify}
                                className="w-full py-2 bg-white border border-red-200 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-50 transition-colors"
                            >
                                Try Again
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
