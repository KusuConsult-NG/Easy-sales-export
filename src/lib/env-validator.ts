/**
 * Environment Variable Validator
 * Checks for required environment variables on application startup
 */

interface EnvValidationResult {
    valid: boolean;
    missing: string[];
    warnings: string[];
    /**
     * Set on the value logEnvValidation returns: the FATAL_ENV_VARS that are
     * absent. Empty means the container can at least answer requests.
     */
    fatalMissing?: string[];
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
/**
 *   #450 THE VARIABLES WITHOUT WHICH THE PLATFORM CANNOT SERVE A SINGLE
 *        REQUEST. A production boot missing one of these EXITS.
 *
 *        From a real Railway container log, deployed with no configuration at
 *        all:
 *
 *            ❌ Environment validation failed!
 *            Missing required variables: [ ...fifteen names... ]
 *            ✓ Ready in 0ms
 *            [auth][error] MissingSecret: Please define a `secret`.
 *                at /app/.next/server/src/middleware.js
 *
 *        It printed the failure and SERVED ANYWAY. Every request then died in
 *        the middleware on MissingSecret — so the platform accepted traffic it
 *        could not answer, and the deploy counted as a success. Railway keeps
 *        the previous container when a new one exits; booting instead replaced
 *        a working site with a broken one.
 *
 *        These four are the ones that were PROVEN fatal by that log, not a
 *        guess: no NEXTAUTH_SECRET and the middleware rejects everything; no
 *        Supabase URL/keys and there is no data layer to answer with. A missing
 *        RESEND_API_KEY breaks email, which is a broken feature on a working
 *        platform — that stays a loud error, not an exit.
 */
const FATAL_ENV_VARS = [
    'NEXTAUTH_SECRET',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const REQUIRED_ENV_VARS = [
    'NEXTAUTH_URL',
    'NEXTAUTH_SECRET',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
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

/**
 * What actually stops working when a NON-fatal variable is missing.
 *
 * #457. The startup log named thirteen variables and refused to start over
 * four, without saying they were different lists — so every one of the thirteen
 * read as a blocker. A name alone does not tell an operator whether to hunt for
 * a key now or after the site is up; what it costs does.
 *
 * Every name in REQUIRED_ENV_VARS and PRODUCTION_REQUIRED_ENV_VARS that is not
 * in FATAL_ENV_VARS appears here — a test asserts it, so a variable added to
 * either list cannot arrive without an explanation.
 */
const WHAT_BREAKS: Record<string, string> = {
    NEXTAUTH_URL: 'sign-in callbacks resolve against the wrong host',
    NEXT_PUBLIC_URL: 'links in emails and Paystack callbacks fall back to a guessed host',
    RESEND_API_KEY: 'no email leaves the platform — verification, receipts, invitations',
    PAYSTACK_SECRET_KEY: 'no payment can be initialised or verified',
    MFA_SECRET_KEY: 'multi-factor enrolment and verification fail',
    QR_ENCRYPTION_KEY: 'QR codes cannot be issued or read',
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: 'every upload fails — marketplace media, certificates, export documents',
    CLOUDINARY_API_KEY: 'every upload fails — marketplace media, certificates, export documents',
    CLOUDINARY_API_SECRET: 'every upload fails — marketplace media, certificates, export documents',
};

const RECOMMENDED_ENV_VARS = [
    /**
     *   #450 QOREID_CLIENT_ID and QOREID_SECRET_KEY WERE REQUIRED, AND THAT
     *        REPEATED THE MISTAKE THE NOTE ABOVE RECORDS.
     *
     *        The comment on REQUIRED_ENV_VARS explains that six FIREBASE_*
     *        names were removed because requiring variables nothing reads made
     *        startup print "❌ Environment validation failed!" on every
     *        correctly configured deploy, "which buried the entries that
     *        genuinely matter". QoreID had taken over that job: the module is
     *        parked by owner decision, so the keys are unset, so EVERY deploy
     *        printed the failure banner — and a container with NOTHING
     *        configured looked exactly like a healthy one.
     *
     *        lib/qoreid.ts reads them at call time and throws a message naming
     *        them, so an unset key breaks identity verification at the moment
     *        it is used and nothing else. That is a per-request failure with a
     *        clear cause, which is what it should be.
     */
    'QOREID_CLIENT_ID',
    'QOREID_SECRET_KEY',
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
 * Tell the operator WHICH KIND of misconfiguration this is.
 *
 *   #461 "WHICH VARIABLE DID I MISS" IS THE WRONG QUESTION WHEN THE ANSWER IS
 *   "ALL OF THEM", AND THE LOG COULD NOT TELL THE TWO APART.
 *
 *   Three deploys in a row printed the same list of thirteen names. Each time
 *   the reasonable reading was that some variables had been set and some had
 *   been missed — so the next move was hunting for the missing ones, which do
 *   not exist, because NONE of them had arrived.
 *
 *   The evidence was in the log and took a Dockerfile to interpret. The image
 *   sets `ENV PORT=3000`; the container reported listening on 8080. Only the
 *   platform sets PORT, so injection was working and the service simply had no
 *   user variables on it — set on a different service, a different environment,
 *   or defined as shared variables and never linked. That is a completely
 *   different fix from "add the one you forgot", and nothing in the output said
 *   so.
 *
 *   The container can see that for itself. Railway stamps every container with
 *   RAILWAY_* markers, so those present alongside none of ours is conclusive.
 *
 *   NAMES ONLY, NEVER VALUES, and only names this file already lists or that
 *   the platform defines — an environment dump into a log is how a secret ends
 *   up somewhere it cannot be recalled from.
 */
function whyNothingArrived(): string[] {
    const wanted = [...REQUIRED_ENV_VARS, ...PRODUCTION_REQUIRED_ENV_VARS];
    const present = new Set(wanted.filter((key) => process.env[key]));
    const platformMarkers = Object.keys(process.env).filter((k) => k.startsWith('RAILWAY_'));

    if (present.size > 0) {
        // Some arrived, some did not — the ordinary "you missed one" case, and
        // the list above is the answer.
        return [];
    }

    return [
        'NOT ONE of the variables this application defines is present, which is',
        'not the same as having missed a few. The deployment platform IS setting',
        platformMarkers.length > 0
            ? `variables here — ${platformMarkers.length} RAILWAY_* marker(s) arrived — so injection works`
            : 'the container up, so injection is expected to work',
        'and this service has no variables of its own.',
        '',
        ...whereThisIs(),
        'Open EXACTLY that service and environment and set the variables there.',
        'Shared or project-level variables must be LINKED into a service; defining',
        'them alongside one does not put them in it.',
        '',
    ];
}

/**
 * Name the service and environment this container is actually running as.
 *
 *   #462 "CHECK YOU ARE LOOKING AT THE SAME SERVICE" IS ADVICE NOBODY CAN ACT
 *   ON, AND THE CONTAINER KNEW THE ANSWER THE WHOLE TIME.
 *
 *   #461 proved the fault was an empty service rather than a forgotten key, and
 *   then asked the operator to go and confirm which service they were editing —
 *   the one thing a dashboard with several services and environments makes hard.
 *   Meanwhile Railway had stamped the answer into the container: among those 23
 *   markers are RAILWAY_PROJECT_NAME, RAILWAY_ENVIRONMENT_NAME and
 *   RAILWAY_SERVICE_NAME.
 *
 *   Printing them turns "check that you are looking at the same one" into an
 *   address. A diagnosis that names the fault but not the place is where an
 *   operator gives up, and this one had already cost four deploys.
 *
 *   THESE ARE DISPLAY NAMES, NOT CREDENTIALS — the same words shown in the
 *   dashboard's own breadcrumb. Nothing else from the environment is printed,
 *   and the ids are deliberately left out: a name is what the operator can
 *   match by eye, and a UUID is only noise.
 */
function whereThisIs(): string[] {
    const project = process.env.RAILWAY_PROJECT_NAME;
    const environment = process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.RAILWAY_ENVIRONMENT;
    const service = process.env.RAILWAY_SERVICE_NAME;

    if (!project && !environment && !service) return [];

    return [
        'THIS CONTAINER IS RUNNING AS:',
        `  project      ${project ?? '(not reported)'}`,
        `  environment  ${environment ?? '(not reported)'}`,
        `  service      ${service ?? '(not reported)'}`,
        '',
    ];
}

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

    /**
     *   #457 THE STARTUP LOG PRINTED THIRTEEN NAMES AND THEN REFUSED TO START
     *        OVER FOUR, WITHOUT SAYING THEY WERE DIFFERENT LISTS.
     *
     *        An operator reading
     *
     *            ❌ Environment validation failed!
     *            Missing required variables: [ 13 names ]
     *            🛑 REFUSING TO START.  ...  - 4 names
     *
     *        reasonably concludes the container needs all thirteen, and goes
     *        looking for a Cloudinary key before it can see the site come up.
     *        It needs FOUR. The other nine each break one feature on a platform
     *        that is otherwise serving — which is the whole distinction #450
     *        drew, and then did not print.
     *
     *        Saying which is which turns a wall into a short list.
     */
    if (!result.valid) {
        const fatal = result.missing.filter((k) => (FATAL_ENV_VARS as readonly string[]).includes(k));
        const degrades = result.missing.filter((k) => !(FATAL_ENV_VARS as readonly string[]).includes(k));

        console.error('❌ Environment validation failed!');
        if (fatal.length > 0) {
            console.error(
                `   ${fatal.length} that STOP THE CONTAINER STARTING: ${fatal.join(', ')}`,
            );
        }
        if (degrades.length > 0) {
            console.error(
                `   ${degrades.length} that break one feature each, but still serve: ${degrades.join(', ')}`,
            );
            for (const key of degrades) {
                console.error(`     - ${key}: ${WHAT_BREAKS[key] ?? 'the feature that reads it'}`);
            }
        }
    }

    /**
     *   #450 A PRODUCTION BOOT MISSING A FATAL VARIABLE STOPS HERE.
     *
     *        This function printed the failure and returned, and the caller
     *        carried on booting. The result, observed on Railway: a container
     *        that reported "✓ Ready", accepted traffic, and died in the
     *        middleware on every single request with MissingSecret.
     *
     *        Exiting is the kinder failure. Railway keeps the previous
     *        container when a new one exits, so a misconfigured deploy leaves
     *        the working site up instead of replacing it. Booting broken
     *        converts a configuration mistake into an outage.
     *
     *        Production only. In development a missing key should stop the one
     *        thing that needs it, not the server you are debugging with.
     */
    const fatalMissing = FATAL_ENV_VARS.filter((key) => !process.env[key]);
    if (fatalMissing.length > 0 && process.env.NODE_ENV === 'production') {
        console.error(
            [
                '',
                '🛑 REFUSING TO START.',
                '',
                'These variables are not set, and without them this container',
                'cannot answer a single request:',
                ...fatalMissing.map((k) => `  - ${k}`),
                '',
                ...whyNothingArrived(),
                'Set them on the deployment platform and redeploy. The previous',
                'container keeps serving until this one starts cleanly.',
                '',
            ].join('\n'),
        );
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

    // #450. REPORTED HERE, ACTED ON AT THE BOOT.
    //
    // My first version called process.exit(1) right here, and a suite that
    // calls this function for an unrelated reason had its jest worker killed
    // mid-run. A library function that terminates the process is hostile to
    // every caller that is not a boot sequence — and it is instrumentation.ts
    // that owns the decision to start or not. The finding is reported; the
    // refusal happens where refusing means something.
    return { ...result, fatalMissing };
}
