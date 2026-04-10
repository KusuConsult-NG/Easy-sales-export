/**
 * FormField.tsx
 *
 * Shared styled wrapper for form inputs across all 6 modules.
 * Provides consistent label/error/hint rendering.
 *
 * Layout sizing is handled by the PARENT GRID — inputs use w-full
 * to fill their grid column naturally. This avoids distortion from
 * applying max-width to cells inside a grid layout.
 *
 * Only identity fields (NIN, BVN, VIN) use the separate IdInput component
 * which applies ch-unit sizing for those specific short fixed-length values.
 */

'use client';

import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';

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
// No max-width here — sizing is controlled by the parent grid column.

interface FormFieldProps {
    label: string;
    required?: boolean;
    optional?: boolean;
    hint?: string;
    error?: string;
    children: ReactNode;
}

export function FormField({
    label,
    required,
    optional,
    hint,
    error,
    children,
}: FormFieldProps) {
    return (
        <div className="w-full">
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

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
    label: string;
    required?: boolean;
    optional?: boolean;
    hint?: string;
    error?: string;
    accentColor?: 'orange' | 'emerald';
}

export function FormInput({
    label,
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
        <FormField label={label} required={required} optional={optional} hint={hint} error={error}>
            <input
                {...rest}
                className={`${base} ${err} ${className ?? ''}`}
            />
        </FormField>
    );
}

// ─── FormSelect ───────────────────────────────────────────────────────────────

interface FormSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    label: string;
    required?: boolean;
    optional?: boolean;
    hint?: string;
    error?: string;
    accentColor?: 'orange' | 'emerald';
    children: ReactNode;
}

export function FormSelect({
    label,
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
        <FormField label={label} required={required} optional={optional} hint={hint} error={error}>
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

interface FormTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
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
        <FormField label={label} required={required} optional={optional} hint={hint} error={error}>
            <textarea
                {...rest}
                className={`${INPUT_BASE} resize-none ${err} ${className ?? ''}`}
            />
        </FormField>
    );
}
