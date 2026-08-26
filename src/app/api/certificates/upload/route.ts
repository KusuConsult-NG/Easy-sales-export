export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { rateLimit } from "@/lib/rate-limiter";
import { rateLimitConfig } from "@/lib/rate-limits.config";
import { uploadFileToStorage, detectFileType } from "@/lib/storage-admin";

/**
 * What a certificate may be.
 *
 * "image/jpg" is deliberately absent: it is not a MIME type, and JPEG content
 * is detected as image/jpeg. Keeping it in the list only made the list look
 * more permissive than the check.
 */
const ALLOWED_CERTIFICATE_TYPES = ["application/pdf", "image/jpeg", "image/png"];

/**
 *   #273 The same limit actions/certificates.ts already applied. That action
 *        reads MAX_CERTIFICATE_SIZE_MB and refuses anything larger; this route
 *        — the live path, as its own comment about #144 says — read nothing.
 *        Twice now on the same pair of files, for two different rules.
 */
function certificateSizeLimitBytes(): number {
    return parseInt(process.env.MAX_CERTIFICATE_SIZE_MB || "10", 10) * 1024 * 1024;
}

/**
 *   #274 rateLimitConfig.fileUpload — 20 per hour — was declared and read by
 *        nothing. The third configured control this audit found switched off by
 *        never being wired up. An unmetered upload endpoint is how one account
 *        turns a size limit into a throughput problem instead.
 */
const uploadLimiter = rateLimit(rateLimitConfig.fileUpload);
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";

/**
 * POST - Upload certificate
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        // #274 Keyed on the account, not the address: the caller is
        // authenticated here, so the account is what is being spent.
        const limit = await uploadLimiter.check(`certificate-upload:${session.user.id}`);
        if (!limit.success) {
            return NextResponse.json(
                { success: false, error: "Too many uploads. Please try again later." },
                { status: 429 }
            );
        }

        const contentType = request.headers.get("content-type") || "";
        let fileUrl = "";
        let fileName = "";
        let fileType = "";
        let storagePath = "";

        if (contentType.includes("application/json")) {
            const body = await request.json();
            fileUrl = body.fileUrl;
            fileName = body.fileName;
            fileType = body.fileType;

            if (!fileUrl || !fileName || !fileType) {
                return NextResponse.json(
                    { success: false, error: "Missing required JSON fields (fileUrl, fileName, fileType)" },
                    { status: 400 }
                );
            }

            // The host check is necessary and was not sufficient.
            //
            // res.cloudinary.com is Cloudinary's SHARED delivery domain: every
            // Cloudinary customer serves from it, under
            // /<cloud_name>/<resource>. So allowing the hostname allowed any
            // file hosted by anyone on Cloudinary, not files belonging to this
            // platform — a check that reads like a restriction and is close to
            // none.
            //
            // The cloud name is pinned as well now, so the URL has to name THIS
            // account.
            const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
            if (!cloudName) {
                logger.error("[certificates/upload] NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME is not set");
                return NextResponse.json(
                    { success: false, error: "Upload service is not configured" },
                    { status: 500 }
                );
            }

            try {
                const parsedUrl = new URL(fileUrl);
                const hostname = parsedUrl.hostname.toLowerCase();
                const hostAllowed = hostname === "res.cloudinary.com" || hostname.endsWith(".res.cloudinary.com");
                // Path is /<cloud_name>/<type>/<delivery>/... — the first
                // segment is the account.
                const firstSegment = parsedUrl.pathname.split("/").filter(Boolean)[0];

                if (!hostAllowed || firstSegment !== cloudName) {
                    return NextResponse.json(
                        { success: false, error: "Unauthorized file hosting domain" },
                        { status: 400 }
                    );
                }
            } catch (e) {
                return NextResponse.json(
                    { success: false, error: "Invalid URL format for fileUrl" },
                    { status: 400 }
                );
            }

            // No file to inspect on this branch, so the declared type is all
            // there is — but it can at least be one of the types this endpoint
            // accepts rather than arbitrary text stored as fact.
            if (!ALLOWED_CERTIFICATE_TYPES.includes(fileType)) {
                return NextResponse.json(
                    { success: false, error: "Invalid file type" },
                    { status: 400 }
                );
            }
        } else {
            const formData = await request.formData();
            const file = formData.get("file") as File;

            if (!file) {
                return NextResponse.json(
                    { success: false, error: "No file provided" },
                    { status: 400 }
                );
            }

            // #273 Before arrayBuffer() below, which materialises the whole
            // upload in the process heap.
            const maxBytes = certificateSizeLimitBytes();
            if (!Number.isFinite(file.size) || file.size > maxBytes) {
                return NextResponse.json(
                    { success: false, error: `File is too large. Maximum allowed size is ${Math.round(maxBytes / (1024 * 1024))}MB.` },
                    { status: 413 }
                );
            }

            // The type is decided by the file's CONTENT.
            //
            // This checked `file.type`, a string the client sends. #144 fixed
            // the identical line in uploadCertificateAction — but that action
            // has no callers, and THIS route is what /dashboard/certificates
            // posts to, so the live path kept the defect while the audited one
            // was corrected.
            //
            // uploadFileToStorage does sniff magic bytes, against a broader list
            // that also permits video and Word documents. So an MP4 declared as
            // application/pdf satisfied this check, then satisfied that one, and
            // was stored with `fileType: "application/pdf"` recorded against it.
            const buffer = Buffer.from(await file.arrayBuffer());
            const detectedType = await detectFileType(buffer, file.name);
            if (!detectedType || !ALLOWED_CERTIFICATE_TYPES.includes(detectedType)) {
                return NextResponse.json(
                    { success: false, error: "Invalid file type" },
                    { status: 400 }
                );
            }

            // Upload to Firebase Storage (Admin SDK)
            fileName = file.name;
            fileType = detectedType;
            const uniqueFileName = `${Date.now()}_${file.name}`;
            storagePath = `certificates/${session.user.id}/${uniqueFileName}`;
            // Upload via the shared server-side uploader (Cloudinary).
            // The firebase-admin/storage shim used here before stored nothing
            // and had no makePublic(), so certificate uploads always threw.
            fileUrl = await uploadFileToStorage(file, storagePath);
        }

        // Save metadata to Firestore (Admin SDK)
        await db.collection(COLLECTIONS.USER_CERTIFICATES).add({
            userId: session.user.id,
            fileName,
            fileUrl,
            storagePath,
            fileType,
            uploadedBy: session.user.id,
            uploadedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({
            success: true,
            message: "Certificate uploaded successfully",
        });
    } catch (error: any) {
        logger.error("Upload error:", error);
        return NextResponse.json(
            { success: false, error: "Upload failed" },
            { status: 500 }
        );
    }
}
