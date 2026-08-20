/**
 * Environment Variable Validator
 * Checks for required environment variables on application startup
 */

interface EnvValidationResult {
    valid: boolean;
    missing: string[];
    warnings: string[];
    /**
     * Findings that must be seen in production, kept apart from `warnings`.
     *
     * The weak-secret check below runs ONLY when NODE_ENV === 'production', and
     * logEnvValidation printed warnings ONLY when NODE_ENV !== 'production'. So
     * the one check on this platform that looks for a demo NEXTAUTH_SECRET,
     * MFA_SECRET_KEY or QR_ENCRYPTION_KEY on a live deploy was computed and
     * then thrown away, every time, by construction. Splitting the two lists is
     * what lets the noisy half stay quiet in production while this half does
     * not.
     */
    securityWarnings: string[];
}

// NOTE: the six FIREBASE_* / NEXT_PUBLIC_FIREBASE_* variables that used to be
// listed here have been removed. Firebase is shimmed to Supabase (see
// src/lib/shims), so those variables are read by nothing. Requiring them made
// startup print "❌ Environment validation failed!" on every correctly
// configured deploy, which buried the entries that genuinely matter — most
// importantly SUPABASE_SERVICE_ROLE_KEY.
const REQUIRED_ENV_VARS = [
    'NEXTAUTH_URL',
    'NEXTAUTH_SECRET',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'QOREID_CLIENT_ID',
    'QOREID_SECRET_KEY',
] as const;

const PRODUCTION_REQUIRED_ENV_VARS = [
    'NEXT_PUBLIC_URL',
    'RESEND_API_KEY',
    'PAYSTACK_SECRET_KEY',
    'MFA_SECRET_KEY',
    'QR_ENCRYPTION_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    // Server-side uploads (marketplace media, certificates, export documents)
    // go to Cloudinary — without these every upload fails at request time.
    'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
] as const;

const RECOMMENDED_ENV_VARS = [
    'EMAIL_FROM',
    'OPENAI_API_KEY',
    // Read at 32 sites. Recommended rather than required, deliberately: every
    // one of those reads now has a fallback, and getBaseUrl() prefers the
    // request host anyway. But several fallbacks are the APEX domain, which is
    // a redirector that answers POST with 405 (see the note in server-utils),
    // so leaving it unset makes the platform depend on those fallbacks being
    // the right host. Two Paystack callbacks read it bare, with no fallback at
    // all, until they were moved onto getBaseUrl().
    'NEXT_PUBLIC_APP_URL',
] as const;

/**
 * Validate environment variables
 */
export function validateEnv(): EnvValidationResult {
    const missing: string[] = [];
    const warnings: string[] = [];
    const securityWarnings: string[] = [];
    const isProduction = process.env.NODE_ENV === 'production';

    // Check required vars
    for (const envVar of REQUIRED_ENV_VARS) {
        if (!process.env[envVar]) {
            missing.push(envVar);
        }
    }

    // Check production-required vars
    if (isProduction) {
        for (const envVar of PRODUCTION_REQUIRED_ENV_VARS) {
            if (!process.env[envVar]) {
                missing.push(envVar);
            }
        }
    }

    // Check recommended vars
    for (const envVar of RECOMMENDED_ENV_VARS) {
        if (!process.env[envVar]) {
            warnings.push(`${envVar} not set (recommended)`);
        }
    }

    // Check for weak secrets in production
    if (isProduction) {
        const weakPatterns = ['demo', 'test', 'change', 'replace', 'example'];
        const secretVars = ['NEXTAUTH_SECRET', 'MFA_SECRET_KEY', 'QR_ENCRYPTION_KEY'];

        for (const secretVar of secretVars) {
            const value = process.env[secretVar]?.toLowerCase() || '';
            if (weakPatterns.some(pattern => value.includes(pattern))) {
                securityWarnings.push(`${secretVar} appears to contain a weak/demo value`);
            }
        }
    }

    return {
        valid: missing.length === 0,
        missing,
        warnings,
        securityWarnings,
    };
}

/**
 * Log validation results
 */
export function logEnvValidation() {
    const result = validateEnv();

    if (!result.valid) {
        console.error('❌ Environment validation failed!');
        console.error('Missing required variables:', result.missing);
    }

    // Printed EVERYWHERE, production included. These only ever populate in
    // production — that is the condition the weak-secret check runs under — so
    // suppressing them outside development guaranteed nobody would ever read
    // one. A demo NEXTAUTH_SECRET on a live deploy is exactly the finding that
    // must not be silent.
    if (result.securityWarnings.length > 0) {
        console.error('🔒 Environment security warnings:', result.securityWarnings);
    }

    if (result.warnings.length > 0 && process.env.NODE_ENV !== 'production') {
        console.warn('⚠️  Environment warnings:', result.warnings);
    }

    if (result.valid && result.warnings.length === 0 && result.securityWarnings.length === 0) {
        if (process.env.NODE_ENV !== 'production') {
            console.log('✅ Environment variables validated');
        }
    }

    return result;
}
