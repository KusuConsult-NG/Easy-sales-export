/**
 * Security Validation Utilities
 * Runtime checks to prevent weak secrets in production
 */

const WEAK_SECRET_PATTERNS = [
    'demo-secret-key',
    'demo_secret',
    'placeholder',
    'your-key-here',
    'your_key_here',
    'generate_',
    'replace-in-production',
    'change-in-prod',
    'example',
    'test-secret',
];

/**
 * Validate that production secrets are cryptographically secure
 * Throws an error if weak patterns are detected in production mode
 */
export function validateProductionSecrets(): void {
    // Only enforce in production
    if (process.env.NODE_ENV !== 'production') {
        return;
    }

    const criticalSecrets = {
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
        MFA_SECRET_KEY: process.env.MFA_SECRET_KEY,
        QR_ENCRYPTION_KEY: process.env.QR_ENCRYPTION_KEY,
    };

    const weakSecrets: string[] = [];

    Object.entries(criticalSecrets).forEach(([name, value]) => {
        if (!value) {
            weakSecrets.push(`${name} is not set`);
            return;
        }

        // Check if secret is too short
        if (value.length < 32) {
            weakSecrets.push(`${name} is too short (minimum 32 characters)`);
        }

        // Check for weak patterns
        const lowerValue = value.toLowerCase();
        for (const pattern of WEAK_SECRET_PATTERNS) {
            if (lowerValue.includes(pattern)) {
                weakSecrets.push(`${name} contains weak pattern: "${pattern}"`);
                break;
            }
        }
    });

    if (weakSecrets.length > 0) {
        const errorMessage = [
            '❌ WEAK SECRETS DETECTED IN PRODUCTION',
            '',
            'The following security issues were found:',
            ...weakSecrets.map(s => `  - ${s}`),
            '',
            'Generate secure secrets using: openssl rand -base64 48',
            'Update your environment variables before deploying.',
        ].join('\n');

        // During build (NEXT_PHASE=phase-production-build), log instead of throwing
        // so the build can succeed. These secrets are only needed at runtime.
        if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.CI === 'true') {
            console.warn(`\n[WARN] Security checks skipped during build:\n${errorMessage}\n`);
            return;
        }

        throw new Error(errorMessage);
    }
}

/**
 * Validate that all required environment variables are present
 */
export function validateRequiredEnvVars(): void {
    const required = [
        'NEXTAUTH_URL',
        'NEXTAUTH_SECRET',
        'NEXT_PUBLIC_FIREBASE_API_KEY',
        'FIREBASE_PROJECT_ID',
        'PAYSTACK_SECRET_KEY',
        'RESEND_API_KEY',
        'OPENAI_API_KEY',
        'UPSTASH_REDIS_REST_URL',
        'UPSTASH_REDIS_REST_TOKEN',
    ];

    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        const errorMessage = [
            '❌ MISSING REQUIRED ENVIRONMENT VARIABLES',
            '',
            'The following variables are required but not set:',
            ...missing.map(s => `  - ${s}`),
            '',
            'Check your .env.local file or deployment platform configuration.',
        ].join('\n');

        throw new Error(errorMessage);
    }
}

/**
 * Check if sensitive keys are exposed in development
 * Logs warnings but doesn't throw
 */
export function checkForExposedKeys(): void {
    if (process.env.NODE_ENV === 'production') {
        return;
    }

    const warnings: string[] = [];

    // Check if OpenAI key looks like a real key (starts with sk-)
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey && openaiKey.startsWith('sk-')) {
        warnings.push('OpenAI API key detected  - ensure .env.local is in .gitignore');
    }

    // Check Firebase private key
    const firebaseKey = process.env.FIREBASE_PRIVATE_KEY;
    if (firebaseKey && firebaseKey.includes('BEGIN PRIVATE KEY')) {
        warnings.push('Firebase private key detected - ensure .env.local is in .gitignore');
    }

    if (warnings.length > 0) {
        console.warn('\n⚠️  SECURITY WARNING:\n');
        warnings.forEach(w => console.warn(`  - ${w}`));
        console.warn('\n  Run: git check-ignore .env.local');
        console.warn('  Expected output: .env.local\n');
    }
}
