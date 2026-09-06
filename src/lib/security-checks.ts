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
 * Report production secrets that are missing, too short, or a known-weak literal.
 *
 *   #441 THIS RETURNED VOID AND LOGGED, WHICH MADE IT UNTESTABLE AND LET THREE
 *   PLACES CLAIM IT ENFORCED SOMETHING.
 *
 * The non-throwing behaviour is CORRECT and is kept: this is called at module
 * scope in the root layout, so throwing would crash every Server Component
 * render with a cryptic error. What was wrong is that the findings went nowhere
 * a caller could read — so no test could assert on them, and two other modules
 * were left describing this as a boot failure it never performs.
 *
 * It returns the findings now. Callers still choose what to do; layout.tsx
 * logs, and the admin health report surfaces them to an operator who holds
 * audit:read. Nothing about when it runs, or its refusal to throw, has changed.
 *
 * The strings name the VARIABLE and the weakness, never the secret's value.
 */
export function validateProductionSecrets(): string[] {
    // Only enforce in production
    if (process.env.NODE_ENV !== 'production') {
        return [];
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
            'Update your environment variables on Railway → Variables.',
        ].join('\n');

        // NEVER throw here — this runs at module scope in the root layout and would
        // crash every single Server Component render with a cryptic production error.
        // Log prominently instead; the runtime fallbacks in mfa.ts / digital-id.ts
        // are sufficient to keep the app functional while the operator adds the vars.
        console.error(`\n[SECURITY] ${errorMessage}\n`);
    }

    return weakSecrets;
}

/**
 * Validate that all required environment variables are present.
 *
 *   #450 A SECOND LIST OF REQUIRED VARIABLES, WITH NO CALLERS, THAT WOULD HAVE
 *        FAILED EVERY CORRECT DEPLOY IF ANYONE HAD WIRED IT UP.
 *
 *        This threw a clear "MISSING REQUIRED ENVIRONMENT VARIABLES" and
 *        NOTHING CALLED IT — while a Railway container booted with no
 *        configuration at all, served traffic, and died on every request. The
 *        guard written for exactly that situation was connected to nothing.
 *
 *        And its list had drifted. It demanded NEXT_PUBLIC_FIREBASE_API_KEY and
 *        FIREBASE_PROJECT_ID, two names lib/env-validator.ts deliberately
 *        REMOVED — Firebase is shimmed to Supabase, nothing reads them — so
 *        connecting this function naively would have refused to start a
 *        correctly configured platform. It also demanded OPENAI_API_KEY and the
 *        two Upstash names, all three of which env-validator lists as
 *        RECOMMENDED because every read of them has a fallback.
 *
 *        Two lists, one dead and wrong, is the shape this audit has found some
 *        thirty times. There is one list now: env-validator's. This function
 *        keeps its name and its throwing contract — a caller may still want the
 *        exception rather than the exit — and reads the shared answer.
 */
export function validateRequiredEnvVars(): void {
    const { validateEnv } = require("./env-validator") as typeof import("./env-validator");
    const missing = validateEnv().missing;

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
