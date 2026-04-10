/**
 * IdInput.tsx
 *
 * Standardised identity number input used across all 6 modules.
 * Enforces consistent sizing, focus ring, digit-only filtering,
 * and maxLength across NIN, BVN, Voter's Card, and similar fields.
 *
 * Usage:
 *   <IdInput
 *     label="NIN"
 *     value={nin}
 *     onChange={setNin}
 *     maxLength={11}
 *     placeholder="11-digit NIN"
 *     hint="Dial *346# to retrieve your NIN"
 *     required
 *     digitsOnly
 *   />
 */

'use client';

import { InputHTMLAttributes } from 'react';

interface IdInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
    label: string;
    value: string;
    onChange: (value: string) => void;
    hint?: string;
    error?: string;
    required?: boolean;
    /** Strip non-digit characters on input (for NIN / BVN) */
    digitsOnly?: boolean;
    /** Show character count (e.g. "7 / 11") */
    showCount?: boolean;
    /** Controlled suffix element — e.g. a Verify button or status badge */
    suffix?: React.ReactNode;
    accentColor?: 'orange' | 'emerald' | 'blue';
}

const RING: Record<string, string> = {
    orange:  'focus:ring-orange-500 focus:border-orange-500',
    emerald: 'focus:ring-emerald-600 focus:border-emerald-600',
    blue:    'focus:ring-blue-500 focus:border-blue-500',
};

export function IdInput({
    label,
    value,
    onChange,
    hint,
    error,
    required,
    digitsOnly,
    showCount,
    suffix,
    accentColor = 'orange',
    disabled,
    maxLength,
    placeholder,
    ...rest
}: IdInputProps) {
    const handleChange = (raw: string) => {
        let val = digitsOnly ? raw.replace(/\D/g, '') : raw.toUpperCase();
        if (maxLength) val = val.slice(0, maxLength);
        onChange(val);
    };

    const ring = RING[accentColor];
    const border = error ? 'border-red-400' : 'border-slate-300';

    return (
        <div className="w-full">
            {/* Label row */}
            <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-slate-900">
                    {label}
                    {required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                {showCount && maxLength && (
                    <span className={`text-xs tabular-nums ${value.length === maxLength ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}>
                        {value.length} / {maxLength}
                    </span>
                )}
            </div>

            {/* Input + optional suffix (e.g. Verify button) */}
            <div className="flex gap-2">
                <input
                    {...rest}
                    type="text"
                    inputMode={digitsOnly ? 'numeric' : 'text'}
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    disabled={disabled}
                    maxLength={maxLength}
                    placeholder={placeholder}
                    className={[
                        // Standardised sizing across all modules
                        'flex-1 px-3.5 py-2.5 text-sm rounded-lg border',
                        'bg-white text-slate-900 placeholder-slate-400',
                        'transition-colors duration-150',
                        'focus:outline-none focus:ring-2',
                        ring,
                        border,
                        disabled ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : '',
                    ].join(' ')}
                />
                {suffix}
            </div>

            {/* Error or hint */}
            {error ? (
                <p className="mt-1 text-xs text-red-600">{error}</p>
            ) : hint ? (
                <p className="mt-1 text-xs text-slate-400">{hint}</p>
            ) : null}
        </div>
    );
}
