"use client";

import { useState, useEffect } from "react";
import { Building2, CheckCircle, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { getBankList } from "@/app/actions/paystack";

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
    const [isInitialized, setIsInitialized] = useState(false);

    // Load bank list on mount
    useEffect(() => {
        loadBankList();
    }, []);

    // Sync initialData changes
    useEffect(() => {
        if (initialData && !isInitialized) {
            const hasData = initialData.bankName || initialData.accountNumber || initialData.accountName || initialData.verified;
            if (hasData) {
                if (initialData.bankName) setBankName(initialData.bankName);
                if (initialData.accountNumber) setAccountNumber(initialData.accountNumber);
                if (initialData.accountName) setAccountName(initialData.accountName);
                if (initialData.verified !== undefined) setVerified(initialData.verified);
                if (initialData.bvn) setBvn(initialData.bvn);
                if (initialData.bvnVerified !== undefined) setBvnVerified(initialData.bvnVerified);
                setIsInitialized(true);
            }
        }
    }, [initialData, isInitialized]);

    // Auto-propagate changes to parent
    useEffect(() => {
        if (bankName && accountNumber && accountNumber.length === 10 && accountName) {
            onVerified({
                bankName,
                accountNumber,
                accountName,
                verified: true,
                bvn: bvn || undefined,
                bvnVerified: bvnVerified || undefined
            });
        }
    }, [bankName, accountNumber, accountName, bvn, bvnVerified, onVerified]);

    async function loadBankList() {
        setLoadingBanks(true);
        setBanksError("");

        try {
            const result = await getBankList();

            if (result.success && result.data?.banks) {
                setBanks(result.data.banks);
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

    async function handleVerify() {
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
            /**
             *   #284 THE SECOND COPY OF THE SAME STUB.
             *
             *        This component verifies a BVN through /api/kyc/verify-bvn,
             *        which made it LOOK like the verified one of the pair — and
             *        the account-name resolution beside it was the same
             *        simulation as components/shared/BankAccountVerification:
             *
             *            // SIMULATED VERIFICATION (Requested for demo/testing)
             *            await new Promise(r => setTimeout(r, 1000));
             *            const newAccountName = accountName || "SIMULATED ACCOUNT NAME";
             *            setVerified(true);
             *
             *        Worse than the other one in a small way: `accountName ||`
             *        means whatever the applicant TYPED was accepted as the
             *        resolved name, so an export member could name the account
             *        anything and the form recorded it as verified.
             *
             *        Found by the ratchet in bank-verification-is-real.test.ts
             *        rather than by me — I had checked that this component
             *        called a real KYC endpoint and concluded it was the sound
             *        one, which was only half true.
             */
            const bankCode = banks.find((b) => b.name === bankName)?.code;

            if (!bankCode) {
                setError("Bank list is still loading. Please try again in a moment.");
                setVerified(false);
                return;
            }

            const response = await fetch("/api/kyc/verify-bank-account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accountNumber, bankCode }),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok || !data?.success || !data?.accountName) {
                setError(
                    data?.error || "We could not confirm that account. Check the number and bank and try again.",
                );
                setVerified(false);
                return;
            }

            const newAccountName: string = data.accountName;
            setAccountName(newAccountName);
            setVerified(true);
            setError("");

            onVerified({ 
                bankName, 
                accountNumber, 
                accountName: newAccountName, 
                verified: true 
            });
        } catch (err) {
            console.error('Bank verification error:', err);
            setError("An unexpected error occurred. Please try again.");
            setVerified(false);
        } finally {
            setVerifying(false);
        }
    };

    function handleRetry() {
        setError("");
        setVerified(false);
        setAccountName("");
    };

    function handleEditAccount() {
        setVerified(false);
        setAccountName("");
        setError("");
        
        onVerified({
            bankName,
            accountNumber,
            accountName: "",
            verified: false,
            bvn: bvn || undefined,
            bvnVerified: bvnVerified || undefined
        });
    };

    async function handleVerifyBvn() {
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

            {/* Account Name (Editable if not verified, read-only if verified) */}
            {verified ? (
                accountName && (
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
                )
            ) : (
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        Account Name
                    </label>
                    <input
                        type="text"
                        value={accountName}
                        onChange={(e) => {
                            setAccountName(e.target.value);
                            setError("");
                        }}
                        disabled={verifying}
                        placeholder="Enter your account name"
                        className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                        Enter the name associated with this account
                    </p>
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
                                {bvnVerified
                                    ? "Bank account & BVN both verified ✓"
                                    : "Your bank account has been successfully verified"}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleEditAccount}
                        className="text-xs text-slate-500 underline hover:text-slate-700 hover:no-underline shrink-0"
                        title="Change bank details only"
                    >
                        ✎ Edit Account
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
