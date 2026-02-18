import { InputHTMLAttributes, forwardRef } from "react";
import { AlertCircle } from "lucide-react";

interface PhoneInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    error?: string;
    label?: string;
}

/**
 * Secure Phone Number Input Component
 * - Only accepts numeric input
 * - Validates Nigerian phone numbers (11 digits)
 * - Auto-formats with country code
 * - Prevents alphabet input
 */
const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
    ({ error, label, className = "", value, onChange, ...props }, ref) => {

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
            <div className="w-full">
                {label && (
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        {label}
                    </label>
                )}
                <input
                    ref={ref}
                    type="tel"
                    inputMode="numeric"
                    placeholder="+234XXXXXXXXXX or 08012345678"
                    pattern="^(\+?234|0)[0-9]{10}$"
                    value={value}
                    onChange={handlePhoneChange}
                    onKeyDown={handleKeyDown}
                    className={`
                        w-full px-4 py-3 
                        bg-slate-50 
                        border ${error ? 'border-red-500' : 'border-slate-200'}
                        rounded-xl 
                        text-slate-900 
                        placeholder:text-slate-400 
                        focus:outline-none focus:ring-2 
                        ${error ? 'focus:ring-red-500' : 'focus:ring-primary'}
                        transition-all
                        ${className}
                    `}
                    {...props}
                />
                {error && (
                    <div className="mt-2 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                        <p className="text-sm text-red-600">{error}</p>
                    </div>
                )}
            </div>
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

    // Check for valid Nigerian phone formats:
    // - 11 digits starting with 0 (e.g., 08012345678)
    // - 13 digits starting with 234 (e.g., 2348012345678)
    // - 10 digits (without leading 0, e.g., 8012345678)

    if (cleaned.length === 11 && cleaned.startsWith('0')) {
        // Valid: 08012345678
        return /^0[789][01]\d{8}$/.test(cleaned);
    } else if (cleaned.length === 13 && cleaned.startsWith('234')) {
        // Valid: 2348012345678
        return /^234[789][01]\d{8}$/.test(cleaned);
    } else if (cleaned.length === 10) {
        // Valid: 8012345678
        return /^[789][01]\d{8}$/.test(cleaned);
    }

    return false;
}

// Helper function to format phone number for display
export function formatPhoneNumber(phone: string): string {
    if (!phone) return '';

    const cleaned = phone.replace(/\D/g, '');

    // Format as +234 XXX XXX XXXX
    if (cleaned.length === 11 && cleaned.startsWith('0')) {
        // Convert 08012345678 to +234 801 234 5678
        return `+234 ${cleaned.slice(1, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`;
    } else if (cleaned.length === 13 && cleaned.startsWith('234')) {
        // 2348012345678 to +234 801 234 5678
        return `+${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
    } else if (cleaned.length === 10) {
        // 8012345678 to +234 801 234 5678
        return `+234 ${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
    }

    return phone; // Return as-is if format not recognized
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
