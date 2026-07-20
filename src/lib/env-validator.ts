/**
 * Environment Variable Validator
 * Checks for required environment variables on application startup
 */

interface EnvValidationResult {
    valid: boolean;
    missing: string[];
    warnings: string[];
}

const REQUIRED_ENV_VARS = [
    'NEXTAUTH_URL',
    'NEXTAUTH_SECRET',
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
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
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PROJECT_ID',
    'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const RECOMMENDED_ENV_VARS = [
    'EMAIL_FROM',
    'OPENAI_API_KEY',
] as const;

/**
 * Validate environment variables
 */
export function validateEnv(): EnvValidationResult {
    const missing: string[] = [];
    const warnings: string[] = [];
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
                warnings.push(`${secretVar} appears to contain a weak/demo value`);
            }
        }
    }

    return {
        valid: missing.length === 0,
        missing,
        warnings,
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

    if (result.warnings.length > 0 && process.env.NODE_ENV !== 'production') {
        console.warn('⚠️  Environment warnings:', result.warnings);
    }

    if (result.valid && result.warnings.length === 0) {
        if (process.env.NODE_ENV !== 'production') {
            console.log('✅ Environment variables validated');
        }
    }

    return result;
}
