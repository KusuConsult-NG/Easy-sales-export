/**
 * KYC Form Component
 *
 * Reusable component for collecting KYC information with live
 * BVN and NIN verification via QoreID.
 */

'use client';

import { useState } from 'react';
import { User, MapPin, Phone, Calendar, CheckCircle2, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { verifyBVNAction, verifyNINAction, verifyVotersCardAction } from '@/app/actions/kyc';

export interface KYCData {
    firstName: string;
    lastName: string;
    otherNames?: string;
    dateOfBirth: string;
    address: string;
    city: string;
    state: string;
    phoneNumber: string;
    bvn?: string;
    nin?: string;
    votersCard?: string;
    bvnVerified?: boolean;
    ninVerified?: boolean;
    votersCardVerified?: boolean;
    idType?: 'nin' | 'drivers_license' | 'international_passport' | 'voters_card';
    idNumber?: string;
}

interface KYCFormProps {
    onDataChange: (data: Partial<KYCData>) => void;
    initialData?: Partial<KYCData>;
    includeBVN?: boolean;
}

type VerifyState = 'idle' | 'loading' | 'verified' | 'mismatch' | 'error';

const NIGERIAN_STATES = [
    'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
    'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe',
    'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
    'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau',
    'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara', 'FCT',
];

const ID_TYPES = [
    { value: 'nin', label: 'NIN (National Identity Number)' },
    { value: 'drivers_license', label: "Driver's License" },
    { value: 'international_passport', label: 'International Passport' },
    { value: 'voters_card', label: "Voter's Card" },
];

function VerifyBadge({ state, message }: { state: VerifyState; message?: string }) {
    if (state === 'verified') {
        return (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2 py-1 rounded-full border border-green-200">
                <CheckCircle2 className="w-3 h-3" /> Verified
            </span>
        );
    }
    if (state === 'mismatch' || state === 'error') {
        return (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2 py-1 rounded-full border border-red-200">
                <AlertCircle className="w-3 h-3" /> {state === 'mismatch' ? 'Name mismatch' : 'Failed'}
            </span>
        );
    }
    return null;
}

export function KYCForm({ onDataChange, initialData, includeBVN = false }: KYCFormProps) {
    const [formData, setFormData] = useState<Partial<KYCData>>(initialData || {});
    const [bvnState, setBvnState] = useState<VerifyState>(initialData?.bvnVerified ? 'verified' : 'idle');
    const [ninState, setNinState] = useState<VerifyState>(initialData?.ninVerified ? 'verified' : 'idle');
    const [votersCardState, setVotersCardState] = useState<VerifyState>(initialData?.votersCardVerified ? 'verified' : 'idle');
    const [bvnError, setBvnError] = useState<string>('');
    const [ninError, setNinError] = useState<string>('');
    const [votersCardError, setVotersCardError] = useState<string>('');

    const handleChange = (field: keyof KYCData, value: string | boolean) => {
        const updated = { ...formData, [field]: value };
        // Reset verify state when the field changes
        if (field === 'bvn') {
            setBvnState('idle');
            setBvnError('');
            updated.bvnVerified = false;
        }
        if (field === 'nin') {
            setNinState('idle');
            setNinError('');
            updated.ninVerified = false;
        }
        if (field === 'votersCard') {
            setVotersCardState('idle');
            setVotersCardError('');
            updated.votersCardVerified = false;
        }
        setFormData(updated);
        onDataChange(updated);
    };

    const handleVerifyBVN = async () => {
        const { bvn, firstName, lastName } = formData;
        if (!bvn || bvn.length !== 11) {
            setBvnError('Enter your full 11-digit BVN before verifying.');
            return;
        }
        if (!firstName || !lastName) {
            setBvnError('Enter your first name and last name before verifying BVN.');
            return;
        }

        setBvnState('loading');
        setBvnError('');

        const result = await verifyBVNAction({ bvn, firstName, lastName });

        if (result.success && result.isMatch) {
            setBvnState('verified');
            const updated = { ...formData, bvnVerified: true };
            setFormData(updated);
            onDataChange(updated);
        } else if (result.success && !result.isMatch) {
            setBvnState('mismatch');
            setBvnError(result.error || 'Name mismatch. Please check the name on your BVN record.');
        } else {
            setBvnState('error');
            setBvnError(result.error || 'BVN verification failed. Please try again.');
        }
    };

    const handleVerifyNIN = async () => {
        const { nin, firstName, lastName } = formData;
        if (!nin || nin.length !== 11) {
            setNinError('Enter your full 11-digit NIN before verifying.');
            return;
        }
        if (!firstName || !lastName) {
            setNinError('Enter your first name and last name before verifying NIN.');
            return;
        }

        setNinState('loading');
        setNinError('');

        const result = await verifyNINAction({ nin, firstName, lastName });

        if (result.success && result.isMatch) {
            setNinState('verified');
            const updated = { ...formData, ninVerified: true };
            setFormData(updated);
            onDataChange(updated);
        } else if (result.success && !result.isMatch) {
            setNinState('mismatch');
            setNinError(result.error || 'Name mismatch. Please check the name on your NIN record.');
        } else {
            setNinState('error');
            setNinError(result.error || 'NIN verification failed. Please try again.');
        }
    };

    const handleVerifyVotersCard = async () => {
        const { votersCard, firstName, lastName } = formData;
        if (!votersCard) {
            setVotersCardError("Enter your Voter's Card Number before verifying.");
            return;
        }
        if (!firstName || !lastName) {
            setVotersCardError("Enter your first name and last name before verifying Voter's Card.");
            return;
        }

        setVotersCardState('loading');
        setVotersCardError('');

        const result = await verifyVotersCardAction({ votersCardNumber: votersCard, firstName, lastName });

        if (result.success && result.isMatch) {
            setVotersCardState('verified');
            const updated = { ...formData, votersCardVerified: true };
            setFormData(updated);
            onDataChange(updated);
        } else if (result.success && !result.isMatch) {
            setVotersCardState('mismatch');
            setVotersCardError(result.error || "Name mismatch. Please check the name on your Voter's Card record.");
        } else {
            setVotersCardState('error');
            setVotersCardError(result.error || "Voter's Card verification failed. Please try again.");
        }
    };

    return (
        <div className="space-y-6">

            {/* KYC Notice Banner */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
                <span className="text-amber-500 text-base shrink-0 mt-0.5">⚠️</span>
                <div>
                    <p className="text-sm font-bold text-amber-900">Important — KYC Verification Notice</p>
                    <p className="text-xs text-amber-800 mt-0.5">
                        Enter your name <strong>exactly as it appears on your NIN/BVN</strong>. Any mismatch will cause verification to fail and may delay your application.
                    </p>
                </div>
            </div>

            {/* Names */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        First Name <span className="text-red-500">*</span>
                        <span className="block text-xs font-normal text-slate-500 mt-0.5">As it appears on your NIN/BVN</span>
                    </label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={formData.firstName || ''}
                            onChange={(e) => handleChange('firstName', e.target.value)}
                            placeholder="e.g. John"
                            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        Last Name <span className="text-red-500">*</span>
                        <span className="block text-xs font-normal text-slate-500 mt-0.5">As it appears on your NIN/BVN</span>
                    </label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={formData.lastName || ''}
                            onChange={(e) => handleChange('lastName', e.target.value)}
                            placeholder="e.g. Doe"
                            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        />
                    </div>
                </div>
            </div>
            
            <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                    Other Names <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        value={formData.otherNames || ''}
                        onChange={(e) => handleChange('otherNames', e.target.value)}
                        placeholder="e.g. Chukwudi"
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
                <p className="mt-1 text-xs text-amber-700 font-medium">
                    ⚠️ Provide names exactly as they appear on your NIN/BVN — mismatch will fail verification.
                </p>
            </div>

            {/* Date of Birth */}
            <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                    Date of Birth <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="date"
                        value={formData.dateOfBirth || ''}
                        onChange={(e) => handleChange('dateOfBirth', e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Phone Number */}
            <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                    Phone Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="tel"
                        value={formData.phoneNumber || ''}
                        onChange={(e) => handleChange('phoneNumber', e.target.value)}
                        placeholder="+234 800 000 0000"
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Address */}
            <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                    Street Address <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <MapPin className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                    <textarea
                        value={formData.address || ''}
                        onChange={(e) => handleChange('address', e.target.value)}
                        placeholder="Enter your street address"
                        rows={3}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
                    />
                </div>
            </div>

            {/* City and State */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        City <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.city || ''}
                        onChange={(e) => handleChange('city', e.target.value)}
                        placeholder="e.g., Lagos"
                        className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">
                        State <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={formData.state || ''}
                        onChange={(e) => handleChange('state', e.target.value)}
                        className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    >
                        <option value="">Select state</option>
                        {NIGERIAN_STATES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* ── NIN — live verification ─────────────────────────────────── */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-900">
                        NIN (National Identity Number) <span className="text-red-500">*</span>
                    </label>
                    <VerifyBadge state={ninState} />
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        inputMode="numeric"
                        value={formData.nin || ''}
                        onChange={(e) => handleChange('nin', e.target.value.replace(/\D/g, '').slice(0, 11))}
                        placeholder="11-digit NIN"
                        maxLength={11}
                        disabled={ninState === 'verified'}
                        className="flex-1 px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-400"
                    />
                    <button
                        type="button"
                        onClick={handleVerifyNIN}
                        disabled={ninState === 'loading' || ninState === 'verified' || !formData.nin || formData.nin.length !== 11}
                        className="px-4 py-2.5 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 whitespace-nowrap"
                    >
                        {ninState === 'loading' ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                        ) : ninState === 'verified' ? (
                            <><ShieldCheck className="w-4 h-4" /> Verified</>
                        ) : (
                            'Verify NIN'
                        )}
                    </button>
                </div>
                {ninError && (
                    <p className="mt-1.5 text-xs text-red-600 flex items-start gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        {ninError}
                    </p>
                )}
                <p className="mt-1 text-xs text-slate-400">Dial *346# to retrieve your NIN. Your name above must match your NIN record exactly.</p>
            </div>

            {/* ── Voter's Card — live verification (optional alternative) ── */}
            <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-900">
                        Voter's Card (Optional)
                    </label>
                    <VerifyBadge state={votersCardState} />
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={formData.votersCard || ''}
                        onChange={(e) => handleChange('votersCard', e.target.value)}
                        placeholder="Enter Voter's Card Number (VIN)"
                        disabled={votersCardState === 'verified'}
                        className="flex-1 px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-400"
                    />
                    <button
                        type="button"
                        onClick={handleVerifyVotersCard}
                        disabled={votersCardState === 'loading' || votersCardState === 'verified' || !formData.votersCard}
                        className="px-4 py-2.5 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 whitespace-nowrap"
                    >
                        {votersCardState === 'loading' ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                        ) : votersCardState === 'verified' ? (
                            <><ShieldCheck className="w-4 h-4" /> Verified</>
                        ) : (
                            'Verify Card'
                        )}
                    </button>
                </div>
                {votersCardError && (
                    <p className="mt-1.5 text-xs text-red-600 flex items-start gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        {votersCardError}
                    </p>
                )}
            </div>

            {/* ── BVN — live verification (optional, shown when includeBVN=true) ── */}
            {includeBVN && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-slate-900">
                            BVN (Bank Verification Number) <span className="text-red-500">*</span>
                        </label>
                        <VerifyBadge state={bvnState} />
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            inputMode="numeric"
                            value={formData.bvn || ''}
                            onChange={(e) => handleChange('bvn', e.target.value.replace(/\D/g, '').slice(0, 11))}
                            placeholder="11-digit BVN"
                            maxLength={11}
                            disabled={bvnState === 'verified'}
                            className="flex-1 px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-400"
                        />
                        <button
                            type="button"
                            onClick={handleVerifyBVN}
                            disabled={bvnState === 'loading' || bvnState === 'verified' || !formData.bvn || formData.bvn.length !== 11}
                            className="px-4 py-2.5 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 whitespace-nowrap"
                        >
                            {bvnState === 'loading' ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                            ) : bvnState === 'verified' ? (
                                <><ShieldCheck className="w-4 h-4" /> Verified</>
                            ) : (
                                'Verify BVN'
                            )}
                        </button>
                    </div>
                    {bvnError && (
                        <p className="mt-1.5 text-xs text-red-600 flex items-start gap-1">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            {bvnError}
                        </p>
                    )}
                    <p className="mt-1 text-xs text-slate-400">Dial *565*0# to retrieve your BVN. Your name above must match your BVN record exactly.</p>
                </div>
            )}

            {/* Other ID type — for additional document collection (no live verify) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">Additional ID Type</label>
                    <select
                        value={formData.idType || ''}
                        onChange={(e) => handleChange('idType', e.target.value)}
                        className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    >
                        <option value="">Select ID type (optional)</option>
                        {ID_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">ID Number</label>
                    <input
                        type="text"
                        value={formData.idNumber || ''}
                        onChange={(e) => handleChange('idNumber', e.target.value)}
                        placeholder="Enter ID number"
                        className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Info banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-blue-700">
                    Your identity is verified instantly via QoreID. Data is encrypted in transit and stored securely. You can update your KYC anytime from <strong>Profile → Identity Verification</strong>.
                </p>
            </div>
        </div>
    );
}
