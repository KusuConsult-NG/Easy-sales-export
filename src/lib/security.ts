import crypto from 'crypto';

/**
 * Password Validation Utility
 * Enforces complexity requirements based on environment variables
 */

interface PasswordValidationResult {
    isValid: boolean;
    errors: string[];
}

interface PasswordRequirements {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumber: boolean;
    requireSpecial: boolean;
}

export function getPasswordRequirements(): PasswordRequirements {
    return {
        minLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '8', 10),
        requireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE === 'true',
        requireLowercase: process.env.PASSWORD_REQUIRE_LOWERCASE === 'true',
        requireNumber: process.env.PASSWORD_REQUIRE_NUMBER === 'true',
        requireSpecial: process.env.PASSWORD_REQUIRE_SPECIAL === 'true',
    };
}

export function validatePassword(password: string): PasswordValidationResult {
    const errors: string[] = [];
    const requirements = getPasswordRequirements();

    // Length check
    if (password.length < requirements.minLength) {
        errors.push(`Password must be at least ${requirements.minLength} characters long`);
    }

    // Uppercase check
    if (requirements.requireUppercase && !/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }

    // Lowercase check
    if (requirements.requireLowercase && !/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }

    // Number check
    if (requirements.requireNumber && !/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }

    // Special character check
    if (requirements.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * Rate Limiting Configuration
 */
export const rateLimitConfig = {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
};

/**
 * Session Configuration
 */
export const sessionConfig = {
    timeoutMinutes: parseInt(process.env.SESSION_TIMEOUT_MINUTES || '60', 10),
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
};

/**
 * Generate secure random token
 */
export function generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encryptData(data: string, secretKey: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        Buffer.from(secretKey.padEnd(32, '0').substring(0, 32)),
        iv
    );

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decryptData(encryptedData: string, secretKey: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(secretKey.padEnd(32, '0').substring(0, 32)),
        iv
    );

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Hash sensitive data (one-way)
 */
export function hashData(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Sanitize user input to prevent XSS
 */
export function sanitizeInput(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validate phone number (Nigerian format)
 */
export function isValidNigerianPhone(phone: string): boolean {
    // Accepts formats: 08012345678, 2348012345678, +2348012345678
    const phoneRegex = /^(\+?234|0)[789]\d{9}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
}

/**
 * Generate OTP code
 */
export function generateOTP(length: number = 6): string {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
        otp += digits[Math.floor(Math.random() * digits.length)];
    }
    return otp;
}

/**
 * Check if OTP is expired
 */
export function isOTPExpired(createdAt: Date, expiryMinutes: number = 10): boolean {
    const now = new Date();
    const diffMs = now.getTime() - createdAt.getTime();
    const diffMinutes = diffMs / 1000 / 60;
    return diffMinutes > expiryMinutes;
}
