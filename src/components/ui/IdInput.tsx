/**
 * IdInput.tsx
 *
 * Standardised identity number input used across all 6 modules.
 * Width auto-sizes to the expected data length via CSS `ch` units:
 *   - maxLength={11}  → input is ~14ch wide (perfect for NIN / BVN)
 *   - no maxLength    → fills available space (flex-1)
 *
 *   #628 THE SECOND EXAMPLE USED TO READ `maxLength={20}` → Voter's Card, and
 *        it is gone rather than corrected to 19, because BOTH numbers are
 *        wrong for that field: a voter's card must have NO ceiling here.
 *
 *        kyc-validators settled it and wrote down why — "the platform does not
 *        agree with itself about how long a voter's card is, there is no live
 *        database to settle it, and a rule that refuses a real member is worse
 *        than the defect it fixes." Both call sites capped it at 19 anyway,
 *        against a placeholder of twenty characters, so the field could not
 *        accept its own example.
 *
 *        This comment is what somebody reads when adding the next identity
 *        field, so leaving a length in it that nothing should use is how the
 *        cap would come back.
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
