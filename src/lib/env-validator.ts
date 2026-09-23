/**
 * Environment Variable Validator
 * Checks for required environment variables on application startup
 */

//   #771 The enforcement date and its grace test, so this file can say what a
//   missing MFA_SECRET_KEY costs TODAY rather than what it cost when the
//   description was written. One definition of the deadline, in mfa-policy.
import { graceActive, MFA_ADMIN_ENFORCE_FROM } from '@/lib/mfa-policy';

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
    /*
     *   #779 Without this, a NIN or BVN is stored ONLY as a SHA-256 digest and
     *   can never be read back — which is the defect #779 is about, and it is
     *   not retroactively fixable. Listed here so the gap is visible BEFORE a
     *   year of applications is collected unreadably, rather than after.
     *
     *   Its absence is not fatal: submissions still succeed and the duplicate
     *   check still works. See lib/kyc-identity-store for why failing safe
     *   matters more than failing loudly here.
     */
    'KYC_ENCRYPTION_KEY',
    /*
     *   #836 WITHOUT THIS, EVERY DEPLOY BREAKS THE FORMS THAT ARE OPEN AT THE
     *   TIME — and nothing anywhere said so.
     *
     *   From the owner's production log, twice in one window, either side of a
     *   container restart, for the SAME action id:
     *
     *       Error: Failed to find Server Action "60931022d677bb63baf…".
     *       This request might be from an older or newer deployment.
     *
     *   Next's own guide for this version names the cause exactly:
     *
     *       "By default, a unique encryption key is generated for each build.
     *        When running multiple server instances, all instances must use the
     *        same encryption key. Otherwise, a Server Function encrypted by one
     *        instance cannot be decrypted by another, causing 'Failed to find
     *        Server Action' errors."
     *       — node_modules/next/dist/docs/01-app/02-guides/self-hosting.md
     *
     *   This platform deploys as containers and the log shows "Starting
     *   Container" twice inside the same window, so that is not a hypothetical
     *   multi-instance setup — it is this one, every time it redeploys.
     *
     *   WHAT IT COSTS A MEMBER. A Server Action is what every form on this
     *   platform submits through. Somebody part-way through a WAVE application,
     *   a withdrawal or a product listing when a deploy lands does not get an
     *   error she can act on: the submit fails, and the sibling
     *   "destination stream closed early" in the same log is that request's
     *   response being torn down mid-flight.
     *
     *   LISTED HERE BECAUSE NOTHING KNEW THE VARIABLE EXISTED. It appeared in
     *   no config, no validator and no deploy note, so a fresh key was minted on
     *   every build and the breakage looked like random flakiness. That is the
     *   same shape as KYC_ENCRYPTION_KEY above: absent, feature-breaking, and
     *   unreported.
     *
     *   IT IS READ AT BUILD TIME, not at runtime. Next embeds it in the build
     *   output, so setting it only on the running service changes nothing — it
     *   has to be present in the environment `next build` runs in.
     */
    'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
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
    /*
     *   #771 THIS DESCRIPTION EXPIRES ON 26 SEPTEMBER 2026.
     *
     *   "multi-factor enrolment and verification fail" is true today and files
     *   this key under the tier the startup log calls "break one feature each,
     *   BUT STILL SERVE". From MFA_ADMIN_ENFORCE_FROM that sentence stops being
     *   true, and the honest one is much worse. The chain, read end to end:
     *
     *     mfa-policy.ts   MFA_ADMIN_ENFORCE_FROM = 2026-09-26. After it,
     *                     adminMfaVerdict returns `enrol` for any admin without
     *                     mfaEnabled — a redirect on a page, a refusal on an
     *                     API route.
     *     that file also  "NOT ONE ADMINISTRATOR ACCOUNT HAS MFA TODAY."
     *     api/auth/mfa/setup  returns 500 "Service configuration error" when
     *                     this variable is unset.
     *
     *   So on that date, with this key missing, every administrator is sent to
     *   enrol and enrolment fails — nobody can reach /admin, and nobody can fix
     *   it from inside the product. "One feature" is the wrong tier for that.
     *
     *   IT IS STILL NOT FATAL, DELIBERATELY. Refusing to boot would take the
     *   whole platform down — every member, every module — because a key the
     *   ADMIN area needs is absent. That trades a bad outcome for a worse one.
     *   What changes is that the log stops describing it as survivable, before
     *   the date rather than after.
     *
     *   The text is date-aware rather than rewritten once, so it is right on
     *   both sides of the deadline without anyone remembering to come back.
     */
    MFA_SECRET_KEY: 'multi-factor enrolment and verification fail',
    QR_ENCRYPTION_KEY: 'QR codes cannot be issued or read',
    KYC_ENCRYPTION_KEY: 'NIN and BVN are stored hashed only — admins and CSV exports cannot read them back, and this cannot be undone later',
    //   #836 Phrased as what a member loses, not as what the framework does.
    //   "Server Action encryption key" means nothing to the person reading a
    //   deploy log at the moment it matters.
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: 'every deploy breaks the forms that are open at the time — a member mid-application, mid-withdrawal or mid-listing has her submit fail with "Failed to find Server Action". Must be set in the BUILD environment, not just on the running service',
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: 'every upload fails — marketplace media, certificates, export documents',
    CLOUDINARY_API_KEY: 'every upload fails — marketplace media, certificates, export documents',
    CLOUDINARY_API_SECRET: 'every upload fails — marketplace media, certificates, export documents',
    IMAGEKIT_PRIVATE_KEY: 'every upload fails — marketplace media, certificates, export documents',
};

/**
 * What a missing variable costs, as of now.
 *
 *   #771 A FUNCTION, because one of these answers changes with the date. See
 *   the note on MFA_SECRET_KEY above. Every other key returns its fixed text,
 *   and an unknown key returns the same fallback the call site used to inline.
 */
export function whatBreaks(
    key: string,
    env: NodeJS.ProcessEnv = process.env,
    now: number = Date.now(),
): string {
    if (key === 'MFA_SECRET_KEY' && !graceActive(env, now)) {
        return 'EVERY ADMINISTRATOR IS LOCKED OUT — admin two-factor is mandatory '
            + 'and enrolment cannot complete without this key';
    }
    return WHAT_BREAKS[key] ?? 'the feature that reads it';
}

const RECOMMENDED_ENV_VARS = [
    /**
     *   #485 THE EXTERNAL IDENTITY PROVIDER'S TWO KEYS ARE GONE FROM THIS LIST.
     *
     *        #450 moved them from REQUIRED to RECOMMENDED, because requiring
     *        keys nothing reads printed "❌ Environment validation failed!" on
     *        every correctly configured deploy and buried the entries that
     *        genuinely matter. The provider is now out of service entirely and
     *        no runtime file reads either key, so RECOMMENDING them repeats the
     *        same mistake one notch quieter: an operator setting up a container
     *        would go looking for credentials to a service that is switched off.
     *
     *        The parked module still reads them at call time if it is ever
     *        restored, and restoring it means putting these back here.
     */
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

export type EnvVarSeverity = 'fatal' | 'required' | 'production' | 'recommended';

export interface EnvVarStatus {
    name: string;
    present: boolean;
    severity: EnvVarSeverity;
    /** What stops working when it is absent. */
    breaks: string;
}

/**
 * The same four lists above, rendered one variable at a time.
 *
 *   #511. /api/auth/health is the endpoint an operator opens when the site is
 *   down, and it kept its OWN list of what auth needs — six FIREBASE_* names.
 *   #450 removed those names from this file and from security-checks.ts,
 *   because Firebase is shimmed to Supabase and nothing reads them; it did not
 *   reach the health endpoint, which is the one place a person LOOKS.
 *
 *   Exporting the lists is what stops a fourth copy being written. A caller
 *   that wants to show an operator which variables are set asks here, and
 *   gains anything added to FATAL/REQUIRED/PRODUCTION/RECOMMENDED for free.
 *
 *   NAMES AND PRESENCE ONLY — never values. That rule is why whyNothingArrived
 *   prints names too, and it holds the same way for an HTTP response.
 */
export function envVarStatuses(): EnvVarStatus[] {
    const fatal = new Set<string>(FATAL_ENV_VARS);
    const seen = new Set<string>();
    const out: EnvVarStatus[] = [];

    const add = (name: string, severity: EnvVarSeverity, breaks: string) => {
        if (seen.has(name)) return;
        seen.add(name);
        out.push({ name, present: !!process.env[name], severity, breaks });
    };

    const CANNOT_SERVE = 'the platform cannot serve a request';

    for (const name of FATAL_ENV_VARS) add(name, 'fatal', CANNOT_SERVE);
    for (const name of REQUIRED_ENV_VARS) {
        add(name, fatal.has(name) ? 'fatal' : 'required', WHAT_BREAKS[name] ?? '');
    }
    for (const name of PRODUCTION_REQUIRED_ENV_VARS) {
        add(name, fatal.has(name) ? 'fatal' : 'production', WHAT_BREAKS[name] ?? '');
    }
    for (const name of RECOMMENDED_ENV_VARS) {
        add(name, 'recommended', 'nothing — every read of it has a fallback');
    }

    return out;
}

/**
 * Which data layer this container is pointed at, by name, for a diagnostic.
 *
 * The Supabase project ref is the first label of NEXT_PUBLIC_SUPABASE_URL — a
 * NEXT_PUBLIC_ value, already served to every browser, so naming it here
 * exposes nothing. The keys are never touched.
 */
export function dataLayerTarget(): string {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return '(not set)';
    try {
        return new URL(url).hostname.split('.')[0] || '(unparseable)';
    } catch {
        return '(unparseable)';
    }
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
        const imageKitConfigured = Boolean(
            process.env.IMAGEKIT_PRIVATE_KEY &&
            (process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY || process.env.IMAGEKIT_PUBLIC_KEY) &&
            (process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT || process.env.IMAGEKIT_URL_ENDPOINT)
        );

        for (const envVar of PRODUCTION_REQUIRED_ENV_VARS) {
            // When ImageKit is configured, Cloudinary keys are not required for uploads
            if (imageKitConfigured && (
                envVar === 'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME' ||
                envVar === 'CLOUDINARY_API_KEY' ||
                envVar === 'CLOUDINARY_API_SECRET'
            )) {
                continue;
            }
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

        /*
         *   #828 THE HEADLINE SAID "FAILED" ON A DEPLOY THAT SUCCEEDED.
         *
         *   The owner, pasting a real startup log:
         *
         *       ❌ Environment validation failed!
         *          1 that break one feature each, but still serve: KYC_ENCRYPTION_KEY
         *
         *   Nothing fatal was missing. The container started, served, and
         *   answered every request — and the first line told its operator the
         *   deploy had failed. Reproduced exactly, by running this function
         *   with every fatal key set and that one absent.
         *
         *   #457's note sits directly above and describes this harm precisely:
         *   an operator reading "❌ Environment validation failed!" reasonably
         *   concludes the container needs everything named. #457 then split the
         *   BODY into the two tiers and left the HEADLINE undifferentiated —
         *   "a correct rule applied to some of the places it names", which is
         *   the shape this audit has found more often than any other.
         *
         *   A red ❌ that appears on a working deploy is also how a red ❌ stops
         *   being read. The one that matters is the one below it.
         */
        if (fatal.length > 0) {
            console.error('❌ Environment validation failed!');
            console.error(
                `   ${fatal.length} that STOP THE CONTAINER STARTING: ${fatal.join(', ')}`,
            );
        } else {
            console.error('⚠️  Environment incomplete — THE CONTAINER IS STARTING NORMALLY.');
            console.error(
                '   Nothing required to serve a request is missing. What follows costs a '
                + 'feature each, not the deploy.',
            );
        }
        if (degrades.length > 0) {
            console.error(
                `   ${degrades.length} that break one feature each, but still serve: ${degrades.join(', ')}`,
            );
            for (const key of degrades) {
                console.error(`     - ${key}: ${whatBreaks(key)}`);
            }

            /*
             *   #771 The one that is not "one feature", said where it cannot be
             *   scrolled past. See the note on MFA_SECRET_KEY above for the
             *   chain; the short version is that after MFA_ADMIN_ENFORCE_FROM
             *   this key missing means no administrator can reach /admin and
             *   none of them can fix it from inside the product.
             */
            /*
             *   #828 AND THE ONE WHOSE DAMAGE IS PERMANENT AND ACCRUES.
             *
             *   Same reasoning #771 applied to MFA_SECRET_KEY, applied to the
             *   key it was not applied to. That note says "'One feature' is the
             *   wrong tier for that" — and it is the wrong tier for this one
             *   too, for a different and worse reason.
             *
             *   Every other name in this list describes something that STOPS
             *   working and starts again the moment the key is set. No email
             *   goes out; set RESEND_API_KEY and email goes out. Uploads fail;
             *   set the Cloudinary keys and uploads work.
             *
             *   THIS ONE IS NOT LIKE THAT. Verified by reading the write path:
             *   with no key, lib/kyc-identity-store writes NO ciphertext at all
             *   — only the SHA-256 digest the duplicate check needs. The
             *   submission succeeds, the applicant is told nothing is wrong,
             *   and her NIN and BVN are unreadable BY ANYONE, FOREVER. Setting
             *   the key later fixes the next application and cannot recover a
             *   single earlier one.
             *
             *   So the cost is not a feature that is off. It is a quantity of
             *   permanently unreviewable KYC records that grows every day the
             *   key stays unset, on a programme whose whole approval step is a
             *   human comparing that number against a document.
             *
             *   Said where it cannot be scrolled past, and said in the tense
             *   that is true: this is not "will break", it is "is being lost".
             */
            if (degrades.includes('KYC_ENCRYPTION_KEY')) {
                console.error('');
                console.error(
                    '   🚨 KYC_ENCRYPTION_KEY IS MISSING AND THE LOSS IS PERMANENT AND ONGOING. '
                    + 'Every NIN and BVN submitted while this is unset is stored as a one-way '
                    + 'digest and nothing can ever read it back — not an administrator, not a '
                    + 'CSV export, not a later fix. Registration keeps working and applicants '
                    + 'see no error, so this is silent from every side except this line. '
                    + 'Setting the key repairs the NEXT application and none of the previous '
                    + 'ones. Set it before the next intake, not after.',
                );
                console.error('');
            }

            if (degrades.includes('MFA_SECRET_KEY')) {
                console.error('');
                console.error(
                    graceActive()
                        ? `   ⏳ MFA_SECRET_KEY: administrator two-factor becomes MANDATORY on `
                          + `${MFA_ADMIN_ENFORCE_FROM.slice(0, 10)}. From that date every admin is sent `
                          + `to enrol, and enrolment returns 500 without this key — locking every `
                          + `administrator out of /admin. Set it before then.`
                        : `   🚨 MFA_SECRET_KEY IS MISSING AND ADMIN TWO-FACTOR IS NOW MANDATORY `
                          + `(since ${MFA_ADMIN_ENFORCE_FROM.slice(0, 10)}). Every administrator is being sent `
                          + `to enrol and enrolment CANNOT SUCCEED. Set this variable, or set `
                          + `MFA_ADMIN_GRACE_UNTIL to a future date to reopen the window.`,
                );
                console.error('');
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

    /**
     *   #851 A BUILD-TIME REQUIREMENT CANNOT BE CHECKED AT RUNTIME, AND THIS
     *   FILE HAD BEEN TRYING TO FOR FIFTEEN COMMITS.
     *
     *   `whatBreaks` says of NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, correctly:
     *
     *       "Must be set in the BUILD environment, not just on the running
     *        service"
     *
     *   — and everything above tests `process.env`, which is the RUNNING
     *   service. The owner set the variable on the service, so the check passed
     *   and the build went on baking a random key into every image. The advice
     *   was right, the check could not enforce it, and nothing said so.
     *
     *   `ACTIONS_KEY_AT_BUILD` is stamped by next.config during `next build`, so
     *   it reports the BUILD's view rather than this container's. The two
     *   genuinely differ, and the difference is the defect.
     *
     *   NOT ON /api/health, deliberately. That route is unauthenticated —
     *   Railway's own health check calls it — and lib/deployment-facts states
     *   the rule it lives by: only facts already public in the repository. "The
     *   action payloads on this deployment are encrypted with a throwaway key"
     *   is not one of those. It goes in the boot log, which the owner reads and
     *   nobody else can.
     */
    if (process.env.NODE_ENV === 'production'
        && process.env.ACTIONS_KEY_AT_BUILD === 'absent') {
        console.error(
            [
                '',
                '⚠️  SERVER ACTIONS: this image was BUILT without',
                '   NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, so Next generated a random',
                '   one for this build alone.',
                '',
                '   Every deploy therefore breaks the forms that are open at the',
                '   time: a member mid-application, mid-withdrawal or mid-listing',
                '   gets "Failed to find Server Action" when she submits.',
                '',
                '   Setting it on the SERVICE is not enough — a Docker build does',
                '   not inherit the service environment. It must be declared as an',
                '   ARG in the Dockerfile (it is, since #851) AND set on the',
                '   platform so the build receives it.',
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
