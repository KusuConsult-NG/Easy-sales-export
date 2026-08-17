import { logger } from "@/lib/logger";

/**
 * One definition of "where does an uploaded file go".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The rule for choosing between Cloudinary and a local disk write was written
 * out THREE times, and the copies had drifted:
 *
 *   src/app/api/upload/route.ts   Cloudinary, else local disk in development
 *   src/app/actions/upload.ts     the same rule, copied
 *   src/lib/storage-admin.ts      no local branch at all — a hard throw
 *
 * The cost was paid twice over. The comment in actions/upload.ts already
 * records the first time: /api/upload was fixed and the Server Action was not,
 * so the loan wizard could not upload anything locally. Then the e2e suite moved
 * to a production build, `NODE_ENV !== "production"` stopped being true, and the
 * gate closed again — in the route (fixed) and in the action (missed, because it
 * was a separate copy). The third site was never fixed at all, which is why
 * certificates, marketplace product images and seller onboarding could not
 * upload locally either.
 *
 * Two copies of one rule is the duplication pattern this audit keeps finding.
 * This is the single copy. src/__tests__/unit/storage-backend-single-rule.test.ts
 * fails if a fourth appears.
 */

/** Cloudinary is usable only with all three credentials. */
export function isCloudinaryConfigured(): boolean {
    return !!(
        process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
}

/**
 * Is the whole stack local?
 *
 * The discriminator is the database this process is pointed at, and it is
 * chosen because it cannot be set by accident on a real deployment: no
 * production deployment of this app has NEXT_PUBLIC_SUPABASE_URL on loopback.
 *
 * NOT a flag such as ALLOW_LOCAL_UPLOADS. A flag is harmless until somebody
 * copies a .env into a deploy config, and then customer uploads land on an
 * ephemeral container filesystem, look like they worked, and vanish at the next
 * deploy. scripts/seed-local.ts already draws exactly this line — it refuses to
 * seed any host that is not localhost — so this is the codebase's existing
 * definition of "local", not a new concept.
 */
export function isLocalStack(): boolean {
    return /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i
        .test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
}

/**
 * Write to local disk instead of Cloudinary?
 *
 * Only ever when Cloudinary is ABSENT — a configured Cloudinary always wins, in
 * every environment. A real deployment that loses its credentials still fails
 * loudly, which is the behaviour that matters: silently writing customer files
 * to a container disk is worse than refusing the upload.
 *
 * The NODE_ENV term covers `next dev` and jest. The isLocalStack term covers a
 * PRODUCTION BUILD pointed at a local database, which is what the e2e suite runs
 * — that combination is why this needed widening.
 */
export function shouldUseLocalDiskStorage(): boolean {
    if (isCloudinaryConfigured()) return false;
    return process.env.NODE_ENV !== "production" || isLocalStack();
}

/**
 * Write a file to public/uploads/local and return an ABSOLUTE url.
 *
 * Absolute on purpose. A relative "/uploads/..." satisfies an <img src> but
 * fails z.string().url(), which loanApplicationSchema applies to every
 * document — the file uploaded, the form field was set, and the wizard still
 * refused to advance. The local backend has to honour the same contract as
 * Cloudinary's secure_url, not merely produce something that renders.
 *
 * Both `next dev` and `next start` serve public/ at request time rather than
 * baking it into the build, so a file written after the build is still served.
 *
 * @param publicId Already sanitised by the caller to [a-zA-Z0-9-] per segment,
 *                 so it cannot traverse out of the directory below.
 */
export async function writeToLocalDisk(publicId: string, buffer: Buffer): Promise<string> {
    const { writeFile, mkdir } = await import("fs/promises");
    const path = await import("path");

    const relative = path.posix.join("uploads", "local", publicId);
    const absolute = path.join(process.cwd(), "public", relative);

    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);

    const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const url = `${base}/${relative}`;
    logger.info(`[storage] Wrote to local disk (no Cloudinary configured): ${url}`);
    return url;
}
