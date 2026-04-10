/**
 * FormField.tsx
 *
 * Universal form input component used across all 6 modules.
 * Enforces consistent, proportional field widths based on the
 * type of data expected — so no input is ever wider than its content.
 *
 * Size guide:
 *   xs   → ~120px  – years, codes, short numbers
 *   sm   → ~170px  – phone, date, gender, age
 *   md   → ~230px  – first name, last name, LGA, city
 *   lg   → ~320px  – email, business name, occupation
 *   full → 100%    – address, bio, textarea
 *
 * Usage:
 *   <FormField label="Phone" size="sm" required>
 *     <input type="tel" ... />
 *   </FormField>
 *
 *   <FormInput label="First Name" size="md" value={...} onChange={...} required />
 */

'use client';

import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';

// ─── Size map ────────────────────────────────────────────────────────────────

type FieldSize = 'xs' | 'sm' | 'md' | 'lg' | 'full';

const SIZE_MAX: Record<FieldSize, string> = {
    xs:   'max-w-[120px]',
    sm:   'max-w-[170px]',
    md:   'max-w-[230px]',
    lg:   'max-w-[320px]',
    full: 'w-full',
};

// ─── Shared class tokens ──────────────────────────────────────────────────────

export const INPUT_BASE =
    'w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white ' +
    'text-slate-900 placeholder-slate-400 ' +
    'focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ' +
    'transition-colors duration-150 ' +
    'disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed';

export const INPUT_ERROR = 'border-red-400 focus:ring-red-400 focus:border-red-400';

export const INPUT_EMERALD =
    'w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white ' +
    'text-slate-900 placeholder-slate-400 ' +
    'focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 ' +
    'transition-colors duration-150 ' +
    'disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed';

// ─── FormField wrapper ────────────────────────────────────────────────────────

interface FormFieldProps {
    label: string;
    size?: FieldSize;
    required?: boolean;
    optional?: boolean;
    hint?: string;
    error?: string;
    children: ReactNode;
}

export function FormField({
    label,
    size = 'full',
    required,
    optional,
    hint,
    error,
    children,
}: FormFieldProps) {
    return (
        <div className={`${size === 'full' ? 'w-full' : SIZE_MAX[size]}`}>
            <label className="block text-sm font-medium text-slate-900 mb-1.5">
                {label}
                {required && <span className="text-red-500 ml-0.5">*</span>}
                {optional && <span className="text-slate-400 font-normal text-xs ml-1">(Optional)</span>}
            </label>
            {children}
            {error ? (
                <p className="mt-1 text-xs text-red-600">{error}</p>
            ) : hint ? (
                <p className="mt-1 text-xs text-slate-400">{hint}</p>
            ) : null}
        </div>
    );
}

// ─── FormInput ────────────────────────────────────────────────────────────────

interface FormInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
    label: string;
    size?: FieldSize;
    required?: boolean;
    optional?: boolean;
    hint?: string;
    error?: string;
    accentColor?: 'orange' | 'emerald';
}

export function FormInput({
    label,
    size = 'full',
    required,
    optional,
    hint,
    error,
    accentColor = 'orange',
    className,
    ...rest
}: FormInputProps) {
    const base = accentColor === 'emerald' ? INPUT_EMERALD : INPUT_BASE;
    const err = error ? INPUT_ERROR : '';

    return (
        <FormField label={label} size={size} required={required} optional={optional} hint={hint} error={error}>
            <input
                {...rest}
                className={`${base} ${err} ${className ?? ''}`}
            />
        </FormField>
    );
}

// ─── FormSelect ───────────────────────────────────────────────────────────────

interface FormSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
    label: string;
    size?: FieldSize;
    required?: boolean;
    optional?: boolean;
    hint?: string;
    error?: string;
    accentColor?: 'orange' | 'emerald';
    children: ReactNode;
}

export function FormSelect({
    label,
    size = 'full',
    required,
    optional,
    hint,
    error,
    accentColor = 'orange',
    className,
    children,
    ...rest
}: FormSelectProps) {
    const base = accentColor === 'emerald' ? INPUT_EMERALD : INPUT_BASE;
    const err = error ? INPUT_ERROR : '';

    return (
        <FormField label={label} size={size} required={required} optional={optional} hint={hint} error={error}>
            <select
                {...rest}
                className={`${base} ${err} ${className ?? ''}`}
            >
                {children}
            </select>
        </FormField>
    );
}

// ─── FormTextarea ─────────────────────────────────────────────────────────────

interface FormTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
    label: string;
    required?: boolean;
    optional?: boolean;
    hint?: string;
    error?: string;
}

export function FormTextarea({
    label,
    required,
    optional,
    hint,
    error,
    className,
    ...rest
}: FormTextareaProps) {
    const err = error ? INPUT_ERROR : '';

    return (
        <FormField label={label} size="full" required={required} optional={optional} hint={hint} error={error}>
            <textarea
                {...rest}
                className={`${INPUT_BASE} resize-none ${err} ${className ?? ''}`}
            />
        </FormField>
    );
}
