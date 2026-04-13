import { InputHTMLAttributes, forwardRef } from "react";
import { FormField, BaseFieldProps } from "./FormField";

interface PhoneInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>, BaseFieldProps {
}

// ❌ Do NOT wrap this component in a <label>
// It already renders its own label and accessibility bindings via <FormField>

/**
 * Secure Phone Number Input Component
 * - Only accepts numeric input
 * - Validates Nigerian phone numbers (11 digits)
 * - Auto-formats with country code
 * - Prevents alphabet input
 */
const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
    ({ error, label, required, optional, hint, labelRight, className = "", value, onChange, ...props }, ref) => {

        const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            // Only allow digits, spaces, +, (, ), and -
            const inputValue = e.target.value;

            // Remove all non-numeric characters except + at the start
            const cleaned = inputValue.replace(/[^\d+]/g, '');

            // Ensure + only appears at the start
            const formatted = cleaned.startsWith('+')
                ? '+' + cleaned.slice(1).replace(/\+/g, '')
                : cleaned.replace(/\+/g, '');

            // Create a new synthetic event with the cleaned value
            const syntheticEvent = {
                ...e,
                target: {
                    ...e.target,
                    value: formatted
                }
            } as React.ChangeEvent<HTMLInputElement>;

            // Pass the cleaned value to the parent onChange handler
            if (onChange) {
                onChange(syntheticEvent);
            }
        };

        // Prevent non-numeric key presses (except allowed characters)
        const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
            const allowedKeys = [
                'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
                'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
                'Home', 'End'
            ];

            const isNumber = /^[0-9]$/.test(e.key);
            const isPlus = e.key === '+' && (e.currentTarget.value === '' || e.currentTarget.selectionStart === 0);

            if (!isNumber && !isPlus && !allowedKeys.includes(e.key) && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
            }
        };

        return (
            <FormField 
                label={label} 
                required={required} 
                optional={optional} 
                hint={hint} 
                error={error} 
                labelRight={labelRight}
            >
                {(id, errorId) => (
                    <input
                        ref={ref}
                        id={id}
                        type="tel"
                        inputMode="numeric"
                        placeholder="+234XXXXXXXXXX or 08012345678"
                        pattern="^(\+?234|0)[0-9]{10}$"
                        value={value}
                        onChange={handlePhoneChange}
                        onKeyDown={handleKeyDown}
                        aria-describedby={error || hint ? errorId : undefined}
                        className={`
                            w-full px-4 py-3 
                            bg-slate-50 
                            border ${error ? 'border-red-500 text-red-900 focus:ring-red-500' : 'border-slate-200 text-slate-900 focus:ring-primary'}
                            rounded-xl 
                            placeholder:text-slate-400 
                            focus:outline-none focus:ring-2 
                            transition-all
                            ${className}
                        `}
                        {...props}
                    />
                )}
            </FormField>
        );
    }
);

PhoneInput.displayName = "PhoneInput";

export default PhoneInput;

// Helper function to validate Nigerian phone numbers
export function isValidNigerianPhone(phone: string): boolean {
    if (!phone) return false;

    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');

    if (cleaned.length === 11 && cleaned.startsWith('0')) {
        return /^0[789][01]\d{8}$/.test(cleaned);
    } else if (cleaned.length === 13 && cleaned.startsWith('234')) {
        return /^234[789][01]\d{8}$/.test(cleaned);
    } else if (cleaned.length === 10) {
        return /^[789][01]\d{8}$/.test(cleaned);
    }

    return false;
}

// Helper function to format phone number for display
export function formatPhoneNumber(phone: string): string {
    if (!phone) return '';

    const cleaned = phone.replace(/\D/g, '');

    if (cleaned.length === 11 && cleaned.startsWith('0')) {
        return `+234 ${cleaned.slice(1, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`;
    } else if (cleaned.length === 13 && cleaned.startsWith('234')) {
        return `+${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
    } else if (cleaned.length === 10) {
        return `+234 ${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
    }

    return phone;
}

// Helper function to normalize phone to international format for storage
export function normalizePhoneNumber(phone: string): string {
    if (!phone) return '';

    const cleaned = phone.replace(/\D/g, '');

    if (cleaned.startsWith('234')) {
        return `+${cleaned}`;
    } else if (cleaned.startsWith('0') && cleaned.length === 11) {
        return `+234${cleaned.slice(1)}`;
    } else if (cleaned.length === 10) {
        return `+234${cleaned}`;
    }

    return phone;
}
