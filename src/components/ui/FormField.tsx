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

import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode, useId } from 'react';

// ─── Shared class tokens ──────────────────────────────────────────────────────

/**
 *   #923 Everything about a field that is NOT its accent colour, written once.
 *
 *   INPUT_BASE and INPUT_EMERALD were two full copies of these five lines,
 *   differing only in `focus:ring-*` and `focus:border-*`. They agreed — which is
 *   exactly when this is worth folding, before a padding or a disabled style is
 *   changed in one and not the other. The exported values are unchanged, byte for
 *   byte, and a test asserts that rather than trusting the refactor.
 */
const INPUT_SHELL =
    'w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white ' +
    'text-slate-900 placeholder-slate-400 ' +
    'focus:outline-none focus:ring-2 ';

const INPUT_TAIL =
    ' ' +
    'transition-colors duration-150 ' +
    'disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed';

/*
 *   THE ACCENT CLASSES STAY WHOLE LITERALS, and that is not a style choice.
 *
 *   The first version of this fold built them with `focus:ring-${colour}`. That
 *   compiles, typechecks and renders the right string at runtime — and Tailwind
 *   would have generated NEITHER utility, because its scanner reads the SOURCE
 *   text for complete class names and `focus:ring-orange-500` no longer appeared
 *   in it. The focus ring on every field in five onboarding forms would have
 *   disappeared, silently, with no error anywhere. Only the joining is dynamic.
 *
 *   EXPORTED AND UNUSED OUTSIDE THIS FILE — measured: `grep -rn INPUT_BASE src`
 *   finds only FormField itself. Kept exported rather than narrowed; nothing is
 *   gained by removing a name.
 */
export const INPUT_BASE =
    `${INPUT_SHELL}focus:ring-orange-500 focus:border-orange-500${INPUT_TAIL}`;

export const INPUT_ERROR = 'border-red-400 focus:ring-red-400 focus:border-red-400';

export const INPUT_EMERALD =
    `${INPUT_SHELL}focus:ring-emerald-600 focus:border-emerald-600${INPUT_TAIL}`;

// ─── Base Field Contract ──────────────────────────────────────────────────────
export interface BaseFieldProps {
    label?: string;
    required?: boolean;
    optional?: boolean;
    hint?: string;
    error?: string;
    labelRight?: ReactNode; // Useful for badges, counters, etc.
}

// ─── FormField wrapper ────────────────────────────────────────────────────────
// No max-width here — sizing is controlled by the parent grid column.

export interface FormFieldProps extends BaseFieldProps {
    id?: string;
    children: (inputId: string, errorId: string) => ReactNode;
}

export function FormField({
    label,
    required,
    optional,
    hint,
    error,
    labelRight,
    id: providedId,
    children,
}: FormFieldProps) {
    const generatedId = useId();
    const id = providedId || generatedId;
    const errorId = `${id}-error`;

    return (
        <div className="w-full">
            {label && (
                <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor={id} className="block text-sm font-medium text-slate-900">
                        {label}
                        {required && <span className="text-red-500 ml-0.5">*</span>}
                        {optional && <span className="text-slate-400 font-normal text-xs ml-1">(Optional)</span>}
                    </label>
                    {labelRight && <div>{labelRight}</div>}
                </div>
            )}
            
            <div className="relative">
                {children(id, errorId)}
            </div>

            {error ? (
                <p id={errorId} className="mt-1 text-xs text-red-600">{error}</p>
            ) : hint ? (
                <p id={errorId} className="mt-1 text-xs text-slate-400">{hint}</p>
            ) : null}
        </div>
    );
}

// ─── FormInput ────────────────────────────────────────────────────────────────

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement>, BaseFieldProps {
    accentColor?: 'orange' | 'emerald';
}

export function FormInput({
    label,
    required,
    optional,
    hint,
    error,
    labelRight,
    accentColor = 'orange',
    className,
    id: providedId,
    ...rest
}: FormInputProps) {
    const base = accentColor === 'emerald' ? INPUT_EMERALD : INPUT_BASE;
    const err = error ? INPUT_ERROR : '';

    return (
        <FormField label={label} required={required} optional={optional} hint={hint} error={error} labelRight={labelRight} id={providedId}>
            {(id, errorId) => (
                <input
                    {...rest}
                    id={id}
                    required={required}
                    //   #923 The platform already decided how to say "this field
                    //   is wrong" to a screen reader — ComboBox does exactly
                    //   this, and it was the ONLY place in the tree that did.
                    //   Five onboarding and KYC forms go through these three
                    //   inputs, and they announced the description without ever
                    //   announcing the error state.
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby={error || hint ? errorId : undefined}
                    className={`${base} ${err} ${className ?? ''}`}
                />
            )}
        </FormField>
    );
}

// ─── FormSelect ───────────────────────────────────────────────────────────────

interface FormSelectProps extends SelectHTMLAttributes<HTMLSelectElement>, BaseFieldProps {
    accentColor?: 'orange' | 'emerald';
    children: ReactNode;
}

export function FormSelect({
    label,
    required,
    optional,
    hint,
    error,
    labelRight,
    accentColor = 'orange',
    className,
    children,
    id: providedId,
    ...rest
}: FormSelectProps) {
    const base = accentColor === 'emerald' ? INPUT_EMERALD : INPUT_BASE;
    const err = error ? INPUT_ERROR : '';

    return (
        <FormField label={label} required={required} optional={optional} hint={hint} error={error} labelRight={labelRight} id={providedId}>
            {(id, errorId) => (
                <select
                    {...rest}
                    id={id}
                    required={required}
                    //   #923 The platform already decided how to say "this field
                    //   is wrong" to a screen reader — ComboBox does exactly
                    //   this, and it was the ONLY place in the tree that did.
                    //   Five onboarding and KYC forms go through these three
                    //   inputs, and they announced the description without ever
                    //   announcing the error state.
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby={error || hint ? errorId : undefined}
                    className={`${base} ${err} ${className ?? ''}`}
                >
                    {children}
                </select>
            )}
        </FormField>
    );
}

// ─── FormTextarea ─────────────────────────────────────────────────────────────

interface FormTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, BaseFieldProps {
}

export function FormTextarea({
    label,
    required,
    optional,
    hint,
    error,
    labelRight,
    className,
    id: providedId,
    ...rest
}: FormTextareaProps) {
    const err = error ? INPUT_ERROR : '';

    return (
        <FormField label={label} required={required} optional={optional} hint={hint} error={error} labelRight={labelRight} id={providedId}>
            {(id, errorId) => (
                <textarea
                    {...rest}
                    id={id}
                    required={required}
                    //   #923 The platform already decided how to say "this field
                    //   is wrong" to a screen reader — ComboBox does exactly
                    //   this, and it was the ONLY place in the tree that did.
                    //   Five onboarding and KYC forms go through these three
                    //   inputs, and they announced the description without ever
                    //   announcing the error state.
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby={error || hint ? errorId : undefined}
                    className={`${INPUT_BASE} resize-none ${err} ${className ?? ''}`}
                />
            )}
        </FormField>
    );
}
