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
import { FormField, BaseFieldProps } from './FormField';

interface IdInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>, BaseFieldProps {
    value: string;
    onChange: (value: string) => void;
    /** Strip non-digit characters on input (for NIN / BVN) */
    digitsOnly?: boolean;
    /** Show character count (e.g. "7 / 11") */
    showCount?: boolean;
    /** Controlled suffix element — e.g. a Verify button or status badge */
    suffix?: React.ReactNode;
    accentColor?: 'orange' | 'emerald' | 'blue' | 'purple';
}

const RING: Record<string, string> = {
    orange:  'focus:ring-orange-500 focus:border-orange-500',
    emerald: 'focus:ring-emerald-600 focus:border-emerald-600',
    blue:    'focus:ring-blue-500 focus:border-blue-500',
    purple:  'focus:ring-purple-600 focus:border-purple-600',
};

// ❌ Do NOT wrap this component in a <label>
// It already renders its own label and accessibility bindings via <FormField>

export function IdInput({
    label,
    value,
    onChange,
    hint,
    error,
    required,
    optional,
    labelRight,
    digitsOnly,
    showCount,
    suffix,
    accentColor = 'orange',
    disabled,
    maxLength,
    placeholder,
    ...rest
}: IdInputProps) {
    function handleChange(raw: string) {
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

    // Built-in showCount logic as an addition to labelRight
    const countElement = showCount && maxLength ? (
        <span className={`text-xs tabular-nums ml-3 ${value.length === maxLength ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}>
            {value.length} / {maxLength}
        </span>
    ) : null;

    const combinedLabelRight = (
        <div className="flex items-center gap-2">
            {labelRight}
            {countElement}
        </div>
    );

    return (
        <FormField 
            label={label} 
            required={required} 
            optional={optional} 
            hint={hint} 
            error={error} 
            labelRight={labelRight || countElement ? combinedLabelRight : undefined}
        >
            {(id, errorId) => (
                <div className="flex gap-2 items-center">
                    <input
                        {...rest}
                        id={id}
                        type="text"
                        inputMode={digitsOnly ? 'numeric' : 'text'}
                        value={value}
                        onChange={(e) => handleChange(e.target.value)}
                        disabled={disabled}
                        maxLength={maxLength}
                        placeholder={placeholder}
                        style={inputStyle}
                        aria-describedby={error || hint ? errorId : undefined}
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
            )}
        </FormField>
    );
}
