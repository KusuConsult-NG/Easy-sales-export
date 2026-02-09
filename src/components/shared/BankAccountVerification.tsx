"use client";

import { useState, useEffect } from "react";
import { Building2, CheckCircle, AlertCircle } from "lucide-react";

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

    const handleVerify = async () => {
        if (!bankName || !accountNumber || accountNumber.length < 10) {
            return;
        }

        setIsVerifying(true);
        setVerificationStatus("idle");

        try {
            // TODO: Implement actual Paystack bank verification
            // const response = await verifyBankAccount(bankName, accountNumber);

            // Mock verification for now
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Simulate success
            const mockName = "John Doe Business Account";
            setResolvedName(mockName);
            setVerificationStatus("success");

            // Call both callbacks for different use cases
            onVerify?.(true, mockName);
            onVerified?.({ bankName, accountNumber, accountName: mockName });
        } catch (error) {
            setVerificationStatus("error");
            onVerify?.(false);
        } finally {
            setIsVerifying(false);
        }
    };

    return (
        <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-green-600" />
                </div>
                <div className="flex-1">
                    <h4 className="font-semibold text-slate-900 dark:text-white mb-1">
                        Bank Account Verification
                    </h4>

                    {verificationStatus === "idle" && (
                        <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                                Verify your bank account details to enable withdrawals
                            </p>
                            <button
                                type="button"
                                onClick={handleVerify}
                                disabled={isVerifying || !bankName || accountNumber.length < 10}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isVerifying ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Verifying...
                                    </>
                                ) : (
                                    "Verify Account"
                                )}
                            </button>
                        </div>
                    )}

                    {verificationStatus === "success" && (
                        <div className="flex items-start gap-2">
                            <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                                    Account Verified
                                </p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    {resolvedName}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                    {bankName} • {accountNumber}
                                </p>
                            </div>
                        </div>
                    )}

                    {verificationStatus === "error" && (
                        <div className="flex items-start gap-2">
                            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                                    Verification Failed
                                </p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Could not verify account. Please check your details and try again.
                                </p>
                                <button
                                    type="button"
                                    onClick={handleVerify}
                                    className="mt-2 text-sm text-green-600 hover:text-green-700 font-semibold"
                                >
                                    Try Again
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
