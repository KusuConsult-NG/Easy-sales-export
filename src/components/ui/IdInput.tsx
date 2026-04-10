/**
 * IdInput.tsx
 *
 * Standardised identity number input used across all 6 modules.
 * Width auto-sizes to the expected data length via CSS `ch` units:
 *   - maxLength={11}  → input is ~14ch wide (perfect for NIN / BVN)
 *   - maxLength={20}  → input is ~23ch wide (Voter's Card)
 *   - no maxLength    → fills available space (flex-1)
 */

'use client';

import { InputHTMLAttributes, CSSProperties } from 'react';

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

    // Size the input to exactly fit its max content + comfortable breathing room.
    // 1ch ≈ width of one character; +6ch covers padding, caret, and focus ring.
    const inputStyle: CSSProperties = maxLength
        ? { width: `${maxLength + 6}ch`, maxWidth: '100%' }
        : {};

    return (
        <div className={maxLength ? 'inline-block w-auto max-w-full' : 'w-full'}>
            {/* Label row */}
            <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-slate-900">
                    {label}
                    {required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                {showCount && maxLength && (
                    <span className={`text-xs tabular-nums ml-3 ${value.length === maxLength ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}>
                        {value.length} / {maxLength}
                    </span>
                )}
            </div>

            {/* Input + optional suffix (e.g. Verify button) */}
            <div className="flex gap-2 items-center">
                <input
                    {...rest}
                    type="text"
                    inputMode={digitsOnly ? 'numeric' : 'text'}
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    disabled={disabled}
                    maxLength={maxLength}
                    placeholder={placeholder}
                    style={inputStyle}
                    className={[
                        maxLength ? '' : 'flex-1',
                        'px-3.5 py-2.5 text-sm rounded-lg border',
                        'bg-white text-slate-900 placeholder-slate-400',
                        'transition-colors duration-150',
                        'focus:outline-none focus:ring-2',
                        ring,
                        border,
                        disabled ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : '',
                    ].filter(Boolean).join(' ')}
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
