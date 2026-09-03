/**
 * KYC Form Component
 *
 * Reusable component for collecting KYC information for manual identity verification.
 */

'use client';

import { useState } from 'react';
import { User, MapPin, Phone, Calendar, CheckCircle2, AlertCircle, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { verifyBVNAction, verifyNINAction, verifyVotersCardAction } from '@/app/actions/kyc';
import { isObviouslyFakeId } from '@/lib/kyc-validators';
import { IdInput } from '@/components/ui/IdInput';
import PhoneInput from '@/components/ui/PhoneInput';
import { FormField, FormInput, FormSelect, FormTextarea } from '@/components/ui/FormField';

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
    /**
     *   #349 #285's DEFECT SURVIVED, FOUR LINES ABOVE #285's OWN FIX.
     *
     *        This initialiser read:
     *
     *            const initial = { ...initialData };
     *            if (initial.nin) initial.ninVerified = true;
     *            if (initial.bvn) initial.bvnVerified = true;
     *
     *        — the presence of a NUMBER asserted as a verification, which is
     *        exactly what #285 removed from handleChange. The badge states
     *        immediately below were corrected by #285 and read the FLAGS, so
     *        the screen showed "not verified" while the DATA said verified, and
     *        it is the data that onDataChange propagates and the export step
     *        gates its Continue button on.
     *
     *        #285's ratchet could not see it: it filters on the last verify
     *        handler appearing before the other assignments, and this sits in a
     *        useState initialiser above every handler in the file.
     *
     *        A saved verification comes back on `ninVerified` / `bvnVerified`,
     *        which the caller persists. A saved NUMBER is a saved number.
     */
    const [formData, setFormData] = useState<Partial<KYCData>>(() => ({ ...initialData }));
    // #285 These read `initialData?.bvn` / `?.nin` — the presence of a NUMBER —
    // and so showed "Verified" for any saved value. The voters-card line below
    // always read the verified FLAG; these two now match it.
    const [bvnState, setBvnState] = useState<VerifyState>(initialData?.bvnVerified ? 'verified' : 'idle');
    const [ninState, setNinState] = useState<VerifyState>(initialData?.ninVerified ? 'verified' : 'idle');
    const [votersCardState, setVotersCardState] = useState<VerifyState>(initialData?.votersCardVerified ? 'verified' : 'idle');
    const [bvnError, setBvnError] = useState<string>('');
    const [ninError, setNinError] = useState<string>('');
    const [votersCardError, setVotersCardError] = useState<string>('');
    // Confirmation checkbox — user must explicitly confirm digits are correct
    const [ninConfirmed, setNinConfirmed] = useState(false);
    const [bvnConfirmed, setBvnConfirmed] = useState(false);

    function handleChange(field: keyof KYCData, value: string | boolean) {
        const updated = { ...formData, [field]: value };
        /**
         *   #285 TYPING A BVN OR NIN MARKED IT VERIFIED.
         *
         *        The comment below says "Reset verify state when the field
         *        changes", and the voters-card branch does exactly that. These
         *        two did the opposite:
         *
         *            setBvnState(value ? 'verified' : 'idle');
         *            setBvnConfirmed(!!value);
         *            updated.bvnVerified = !!value;
         *
         *        So entering eleven digits showed the green "Verified" badge,
         *        ticked the "I confirm my digits are correct" box on the
         *        member's behalf, and set bvnVerified on the data the step
         *        persists — with no call to verifyBVNAction at all.
         *
         *        AND IT DISARMED A REAL GATE. KYCVerificationStep refuses to
         *        continue while `kycData.bvn` is set and `kycData.bvnVerified`
         *        is not. That check was written correctly and could never fire,
         *        because the form handed it a flag that was true by
         *        construction — #274's shape, in the identity form.
         *
         *        The confirmation checkbox was defeated the same way: the
         *        `if (!bvnConfirmed)` guard in handleVerifyBVN exists to make
         *        the member confirm the digits, and auto-ticking it meant the
         *        guard could never refuse either.
         *
         *        Only verifyBVNAction/verifyNINAction returning isMatch may set
         *        these now, which is what the three handlers below already do.
         */
        // Reset verify state when the field changes
        if (field === 'bvn') {
            setBvnState('idle');
            setBvnError('');
            setBvnConfirmed(false);
            updated.bvnVerified = false;
        }
        if (field === 'nin') {
            setNinState('idle');
            setNinError('');
            setNinConfirmed(false);
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

    async function handleVerifyBVN() {
        const { bvn, firstName, lastName } = formData;
        if (!bvn || bvn.length !== 11) {
            setBvnError('Enter your full 11-digit BVN before verifying.');
            return;
        }
        if (!firstName || !lastName) {
            setBvnError('Enter your first name and last name before verifying BVN.');
            return;
        }
        if (!bvnConfirmed) {
            setBvnError('Please confirm that your BVN digits are correct before verifying.');
            return;
        }

        setBvnState('loading');
        setBvnError('');

        try {
            const result = await verifyBVNAction({ bvn, firstName, lastName });

            if (result.success && result.data?.isMatch) {
                setBvnState('verified');
                const updated = { ...formData, bvnVerified: true };
                setFormData(updated);
                onDataChange(updated);
            } else if (result.success && !result.data?.isMatch) {
                setBvnState('mismatch');
                setBvnError(result.error || "BVN name mismatch. Please check the name on your BVN record.");
            } else {
                setBvnState('error');
                setBvnError(result.error || "BVN verification failed. Please try again.");
            }
        } catch (error) {
            setBvnState('error');
            setBvnError('Network error or server timeout. Please try again later.');
        }
    };

    async function handleVerifyNIN() {
        const { nin, firstName, lastName } = formData;
        if (!nin || nin.length !== 11) {
            setNinError('Enter your full 11-digit NIN before verifying.');
            return;
        }
        if (!firstName || !lastName) {
            setNinError('Enter your first name and last name before verifying NIN.');
            return;
        }
        if (!ninConfirmed) {
            setNinError('Please confirm that your NIN digits are correct before verifying.');
            return;
        }

        setNinState('loading');
        setNinError('');

        try {
            const result = await verifyNINAction({ nin, firstName, lastName });

            if (result.success && result.data?.isMatch) {
                setNinState('verified');
                const updated = { ...formData, ninVerified: true };
                setFormData(updated);
                onDataChange(updated);
            } else if (result.success && !result.data?.isMatch) {
                setNinState('mismatch');
                setNinError(result.error || "NIN name mismatch. Please check the name on your NIN record.");
            } else {
                setNinState('error');
                setNinError(result.error || "NIN verification failed. Please try again.");
            }
        } catch (error) {
            setNinState('error');
            setNinError('Network error or server timeout. Please try again later.');
        }
    };

    async function handleVerifyVotersCard() {
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

        try {
            const result = await verifyVotersCardAction({ votersCardNumber: votersCard, firstName, lastName });

            if (result.success && result.data?.isMatch) {
                setVotersCardState('verified');
                const updated = { ...formData, votersCardVerified: true };
                setFormData(updated);
                onDataChange(updated);
            } else if (result.success && !result.data?.isMatch) {
                setVotersCardState('mismatch');
                setVotersCardError(result.error || "Name mismatch. Please check the name on your Voter's Card record.");
            } else {
                setVotersCardState('error');
                setVotersCardError(result.error || "Voter's Card verification failed. Please try again.");
            }
        } catch (error) {
            setVotersCardState('error');
            setVotersCardError('Network error or server timeout. Please try again later.');
        }
    };

    return (
        <div className="space-y-6">

            {/* ⚠️ Verification Warning — prominent ban notice */}
            <div className="bg-red-50 border-2 border-red-300 rounded-xl px-4 py-4 flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
                <div>
                    <p className="text-sm font-bold text-red-900">⚠️ Important — Read Before Verifying</p>
                    <ul className="mt-1.5 space-y-1 text-xs text-red-800 list-disc list-inside">
                        <li>Enter your <strong>exact NIN / BVN digits</strong>. Even one wrong digit will fail.</li>
                        <li>Your name below <strong>must match exactly</strong> as it appears on your NIN/BVN record.</li>
                        <li><strong className="text-red-700">Submitting incorrect or fake details may result in your account being permanently banned.</strong></li>
                        <li>Dial <strong>*346#</strong> to get your NIN &nbsp;|&nbsp; Dial <strong>*565*0#</strong> to get your BVN.</li>
                    </ul>
                </div>
            </div>

            {/* Names */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="First Name" required hint="As it appears on your NIN/BVN">
                    {(id, errorId) => (
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                id={id}
                                aria-describedby={errorId}
                                type="text"
                                value={formData.firstName || ''}
                                onChange={(e) => handleChange('firstName', e.target.value)}
                                placeholder="e.g. John"
                                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            />
                        </div>
                    )}
                </FormField>
                
                <FormField label="Last Name" required hint="As it appears on your NIN/BVN">
                    {(id, errorId) => (
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                id={id}
                                aria-describedby={errorId}
                                type="text"
                                value={formData.lastName || ''}
                                onChange={(e) => handleChange('lastName', e.target.value)}
                                placeholder="e.g. Doe"
                                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            />
                        </div>
                    )}
                </FormField>
            </div>
            
            <FormField label="Other Names" optional>
                {(id, errorId) => (
                    <div>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                id={id}
                                aria-describedby={errorId}
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
                )}
            </FormField>

            {/* Date of Birth */}
            <FormField label="Date of Birth" required>
                {(id, errorId) => (
                    <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            id={id}
                            aria-describedby={errorId}
                            type="date"
                            value={formData.dateOfBirth || ''}
                            onChange={(e) => handleChange('dateOfBirth', e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        />
                    </div>
                )}
            </FormField>

            {/* Phone Number */}
            <PhoneInput 
                label="Phone Number"
                required
                value={formData.phoneNumber || ''}
                onChange={(e) => handleChange('phoneNumber', e.target.value)}
            />

            {/* Address */}
            <FormField label="Street Address" required>
                {(id, errorId) => (
                    <div className="relative">
                        <MapPin className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                        <textarea
                            id={id}
                            aria-describedby={errorId}
                            value={formData.address || ''}
                            onChange={(e) => handleChange('address', e.target.value)}
                            placeholder="Enter your street address"
                            rows={3}
                            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
                        />
                    </div>
                )}
            </FormField>

            {/* City and State */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormInput
                    label="City"
                    required
                    value={formData.city || ''}
                    onChange={(e) => handleChange('city', e.target.value)}
                    placeholder="e.g., Lagos"
                />
                
                <FormSelect
                    label="State"
                    required
                    value={formData.state || ''}
                    onChange={(e) => handleChange('state', e.target.value)}
                >
                    <option value="">Select state</option>
                    {NIGERIAN_STATES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </FormSelect>
            </div>

            {/* ── NIN — live verification ─────────────────────────────────── */}
            <div>
                <IdInput
                    label="NIN (National Identity Number)"
                    optional
                    value={formData.nin || ''}
                    onChange={(v) => handleChange('nin', v)}
                    digitsOnly
                    showCount
                    maxLength={11}
                    placeholder="11-digit NIN"
                    error={ninError}
                    hint="Dial *346# to retrieve your NIN. Your name must match your NIN record exactly."
                    accentColor="orange"
                    /* #349 THE VERIFY BUTTON. handleVerifyNIN, handleVerifyBVN,
                       handleVerifyVotersCard and the VerifyBadge component were
                       all UNREACHABLE: IdInput takes a `suffix` for exactly
                       this ("a Verify button or status badge", its own doc) and
                       no call site passed one, and there was no <button> in the
                       file at all. So the three states never left 'idle', the
                       badge never rendered, and the only way the export step's
                       "Please verify your NIN before continuing" could be
                       satisfied was the initialiser defect above. */
                    suffix={
                        ninState === 'verified'
                            ? <VerifyBadge state={ninState} />
                            : (
                                <button
                                    type="button"
                                    onClick={handleVerifyNIN}
                                    disabled={ninState === 'loading'}
                                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                >
                                    {ninState === 'loading' ? 'Verifying…' : 'Verify'}
                                </button>
                            )
                    }
                />
                {/* #349 THE CONFIRMATION CHECKBOX, WHICH ALSO DID NOT EXIST.
                    handleVerifyNIN refuses while `ninConfirmed` is false, and
                    #285's write-up calls it "a real gate" — but setNinConfirmed
                    and setBvnConfirmed were never called from anywhere in this
                    file, so with the Verify button wired the handler would have
                    refused every time with "Please confirm that your digits are
                    correct". Three halves of one control had been built and
                    none of them rendered. handleChange already clears it when
                    the number is edited. */}
                {ninState !== 'verified' && (
                    <label className="mt-2 flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={ninConfirmed}
                            onChange={(e) => setNinConfirmed(e.target.checked)}
                            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                        />
                        <span>I confirm the NIN digits above are correct.</span>
                    </label>
                )}
            </div>

            {/* ── Voter's Card — collect number only, no verification required ── */}
            <div className="pt-4 border-t border-slate-100">
                <IdInput
                    label="Voter's Card Number (PVC / VIN)"
                    value={formData.votersCard || ''}
                    onChange={(v) => handleChange('votersCard', v)}
                    maxLength={19}
                    showCount
                    placeholder="e.g. 90F5B123456789012345"
                    hint="The Voter Identification Number (VIN) as printed on your Permanent Voter Card."
                    accentColor="orange"
                    error={votersCardError}
                    suffix={
                        votersCardState === 'verified'
                            ? <VerifyBadge state={votersCardState} />
                            : (
                                <button
                                    type="button"
                                    onClick={handleVerifyVotersCard}
                                    disabled={votersCardState === 'loading'}
                                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                >
                                    {votersCardState === 'loading' ? 'Verifying…' : 'Verify'}
                                </button>
                            )
                    }
                />
            </div>

            {/* ── BVN — live verification (optional, shown when includeBVN=true) ── */}
            {includeBVN && (
                <div>
                    <IdInput
                        label="BVN (Bank Verification Number)"
                        optional
                        value={formData.bvn || ''}
                        onChange={(v) => handleChange('bvn', v)}
                        digitsOnly
                        showCount
                        maxLength={11}
                        placeholder="11-digit BVN"
                        error={bvnError}
                        hint="Dial *565*0# to retrieve your BVN. Your name must match your BVN record exactly."
                        accentColor="orange"
                        suffix={
                            bvnState === 'verified'
                                ? <VerifyBadge state={bvnState} />
                                : (
                                    <button
                                        type="button"
                                        onClick={handleVerifyBVN}
                                        disabled={bvnState === 'loading'}
                                        className="px-4 py-2 text-sm font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                    >
                                        {bvnState === 'loading' ? 'Verifying…' : 'Verify'}
                                    </button>
                                )
                        }
                    />
                    {bvnState !== 'verified' && (
                        <label className="mt-2 flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={bvnConfirmed}
                                onChange={(e) => setBvnConfirmed(e.target.checked)}
                                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                            />
                            <span>I confirm the BVN digits above are correct.</span>
                        </label>
                    )}
                </div>
            )}

            {/* Other ID type — for additional document collection (no live verify) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormSelect
                    label="Additional ID Type"
                    value={formData.idType || ''}
                    onChange={(e) => handleChange('idType', e.target.value)}
                >
                    <option value="">Select ID type (optional)</option>
                    {ID_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                </FormSelect>
                
                <FormInput
                    label="ID Number"
                    type="text"
                    value={formData.idNumber || ''}
                    onChange={(e) => handleChange('idNumber', e.target.value)}
                    placeholder="Enter ID number"
                />
            </div>

            {/* Info banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-blue-700">
                    Your identity details have been submitted for manual verification. This usually takes 24-48 hours. Data is encrypted in transit and stored securely. You can update your KYC anytime from <strong>Profile → Identity Verification</strong>.
                </p>
            </div>
        </div>
    );
}
