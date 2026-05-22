/**
 * /api/id-card/pdf
 *
 * Generates the Cooperative Membership ID card as a high-resolution PNG.
 *
 * WHY PNG NOT PDF:
 *   - PDF with a tiny (86×54mm) page renders with a large dark canvas in
 *     Android/iOS PDF viewers — looks broken even when the PDF is correct.
 *   - PNG downloads directly to gallery/files on every device with no viewer chrome.
 *   - Sharp (already installed) converts SVG → PNG server-side with zero DOM/CSS.
 *
 * APPROACH: Build an SVG string (pure text, no DOM), composite the passport
 * photo on top with sharp, then return a 900×567px PNG (≈ CR80 at 264dpi).
 */

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";

// ── Constants ────────────────────────────────────────────────────────────────
// CR80 card: 86mm × 54mm at 264 dpi → 893×561px. Round to 900×567 for clean scaling.
const W = 900;
const H = 567;

// Proportional layout (px, origin top-left)
const PAD = 40;
const HEADER_H = 100;
const FOOTER_H = 80;
const BODY_TOP = HEADER_H + 8;
const BODY_H = H - HEADER_H - FOOTER_H - 8;
const PHOTO_W = 170;
const PHOTO_H = BODY_H;
const PHOTO_X = PAD;
const PHOTO_Y = BODY_TOP;
const DETAIL_X = PHOTO_X + PHOTO_W + 24;
const DETAIL_W = W - DETAIL_X - PAD;
const BADGE_W = 130;
const BADGE_H = 44;

// ── Helpers ──────────────────────────────────────────────────────────────────
function esc(s: string): string {
    return (s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function capitalize(s: string): string {
    if (!s) return "Not specified";
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function fmtDate(iso: string): string {
    if (!iso) return "—";
    try {
        return new Intl.DateTimeFormat("en-NG", { year: "numeric", month: "short" }).format(new Date(iso));
    } catch {
        return iso;
    }
}

async function fetchAsBase64(url: string): Promise<{ b64: string; mime: string } | null> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        const mime = res.headers.get("content-type") || "image/jpeg";
        return { b64: Buffer.from(buf).toString("base64"), mime };
    } catch {
        return null;
    }
}

// ── SVG builder ──────────────────────────────────────────────────────────────
function buildSVG(opts: {
    fullName: string;
    memberNumber: string;
    gender: string;
    stateOfOrigin: string;
    joinedAt: string;
    validUntil: string;
    membershipTier: string;
    hasPhoto: boolean;
}): string {
    const { fullName, memberNumber, gender, stateOfOrigin, joinedAt, validUntil, membershipTier, hasPhoto } = opts;

    const rows: [string, string][] = [
        ["Gender",      capitalize(gender)],
        ["State",       esc(stateOfOrigin) || "—"],
        ["Issued",      fmtDate(joinedAt)],
        ["Valid Until", fmtDate(validUntil)],
    ];

    const ROW_H = 54;
    const rowsStartY = BODY_TOP + 110;

    let rowsSvg = "";
    rows.forEach(([label, value], i) => {
        const y = rowsStartY + i * ROW_H;
        rowsSvg += `
        <!-- Row: ${label} -->
        <text x="${DETAIL_X}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#a088d8">${esc(label)}</text>
        <text x="${W - PAD}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="bold" fill="#ffffff" text-anchor="end">${esc(value)}</text>`;
    });

    // Dots in footer
    let dotsSvg = "";
    const dotY = H - FOOTER_H + 38;
    for (let i = 0; i < 24; i++) {
        dotsSvg += `<circle cx="${PAD + i * 34}" cy="${dotY}" r="5" fill="rgba(255,255,255,0.22)"/>`;
    }

    // Photo placeholder (only shown when no photo — photo is composited by sharp)
    const photoPlaceholder = hasPhoto ? "" : `
        <rect x="${PHOTO_X}" y="${PHOTO_Y}" width="${PHOTO_W}" height="${PHOTO_H}" rx="10" fill="rgba(120,80,200,0.5)"/>
        <text x="${PHOTO_X + PHOTO_W / 2}" y="${PHOTO_Y + PHOTO_H / 2 - 10}" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="rgba(200,180,255,0.8)" text-anchor="middle">No</text>
        <text x="${PHOTO_X + PHOTO_W / 2}" y="${PHOTO_Y + PHOTO_H / 2 + 16}" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="rgba(200,180,255,0.8)" text-anchor="middle">Photo</text>`;

    // Format tier text and dynamically compute badge width to prevent text overflow
    const tierText = (membershipTier || "Member").replace(" Member", "").toUpperCase();
    const dynamicBadgeW = Math.max(130, tierText.length * 15 + 30);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="#6b21a8"/>
      <stop offset="40%"  stop-color="#7e22ce"/>
      <stop offset="100%" stop-color="#3730a3"/>
    </linearGradient>
    <linearGradient id="shimmer" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="rgba(255,255,255,0.6)"/>
      <stop offset="50%"  stop-color="rgba(255,255,255,0.1)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.0)"/>
    </linearGradient>
    <clipPath id="photoClip">
      <rect x="${PHOTO_X}" y="${PHOTO_Y}" width="${PHOTO_W}" height="${PHOTO_H}" rx="10"/>
    </clipPath>
  </defs>
 
  <!-- Background -->
  <rect width="${W}" height="${H}" rx="18" fill="url(#bg)"/>

  <!-- Shimmer strip (top) -->
  <rect width="${W}" height="10" rx="18" fill="url(#shimmer)" opacity="0.5"/>

  <!-- ── HEADER ── -->
  <!-- Company name -->
  <text x="${PAD}" y="58" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="bold" fill="#ffffff" letter-spacing="1">EASY SALES EXPORT LTD</text>
  <!-- Subtitle -->
  <text x="${PAD}" y="88" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="rgba(200,180,255,0.85)" letter-spacing="2">COOPERATIVE MEMBERSHIP</text>

  <!-- MEMBER badge -->
  <rect x="${W - PAD - dynamicBadgeW}" y="22" width="${dynamicBadgeW}" height="${BADGE_H}" rx="10" fill="rgba(196,181,253,1)"/>
  <text x="${W - PAD - dynamicBadgeW / 2}" y="${22 + BADGE_H * 0.68}" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" fill="#581c87" text-anchor="middle" letter-spacing="2">${esc(tierText)}</text>

  <!-- Header divider -->
  <line x1="${PAD}" y1="${HEADER_H}" x2="${W - PAD}" y2="${HEADER_H}" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>

  <!-- ── PHOTO AREA ── -->
  <!-- Photo border -->
  <rect x="${PHOTO_X - 3}" y="${PHOTO_Y - 3}" width="${PHOTO_W + 6}" height="${PHOTO_H + 6}" rx="12" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2.5"/>
  ${photoPlaceholder}
  <!-- Photo placeholder for compositing (transparent, sharp fills this) -->
  <rect x="${PHOTO_X}" y="${PHOTO_Y}" width="${PHOTO_W}" height="${PHOTO_H}" rx="10" fill="${hasPhoto ? "transparent" : "transparent"}" id="photo-slot"/>

  <!-- ── MEMBER DETAILS ── -->
  <!-- Full Name -->
  <text x="${DETAIL_X}" y="${BODY_TOP + 48}" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="bold" fill="#ffffff">${esc(fullName || "—")}</text>
  <!-- Member Number -->
  <text x="${DETAIL_X}" y="${BODY_TOP + 82}" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="rgba(180,150,240,0.9)">${esc(memberNumber || "—")}</text>

  <!-- Divider under member number -->
  <line x1="${DETAIL_X}" y1="${BODY_TOP + 96}" x2="${W - PAD}" y2="${BODY_TOP + 96}" stroke="rgba(255,255,255,0.2)" stroke-width="1.2"/>

  ${rowsSvg}

  <!-- ── FOOTER ── -->
  <line x1="${PAD}" y1="${H - FOOTER_H}" x2="${W - PAD}" y2="${H - FOOTER_H}" stroke="rgba(255,255,255,0.2)" stroke-width="1.2"/>
  ${dotsSvg}
  <text x="${W - PAD}" y="${H - FOOTER_H + 42}" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="rgba(160,140,210,0.9)" text-anchor="end">easysalesexport.com</text>
</svg>`;
}

// ── Route ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }

        const data = await req.json();
        const {
            fullName = "",
            memberNumber = "",
            membershipTier = "Member",
            gender = "",
            stateOfOrigin = "",
            joinedAt = "",
            validUntil = "",
            passportPhotoUrl = null,
        } = data;

        // Fetch passport photo as base64
        let photoData: { b64: string; mime: string } | null = null;
        if (passportPhotoUrl) {
            let finalPhotoUrl = passportPhotoUrl;
            if (!/^https?:\/\//i.test(passportPhotoUrl)) {
                try {
                    finalPhotoUrl = new URL(passportPhotoUrl, req.url).toString();
                } catch (e) {
                    logger.error("Failed to construct absolute URL for passport photo:", e);
                }
            }
            photoData = await fetchAsBase64(finalPhotoUrl);
        }

        // Build SVG (photo slot left transparent — will be composited)
        const svg = buildSVG({
            fullName, memberNumber, gender,
            stateOfOrigin, joinedAt, validUntil,
            membershipTier,
            hasPhoto: !!photoData,
        });

        // Convert SVG → PNG base using sharp with explicit CR80 print density
        let sharpPipeline = sharp(Buffer.from(svg)).withMetadata({ density: 267 }).png();

        // Composite photo on top if available
        if (photoData) {
            // Resize photo to fit the slot, rounded corners via a mask
            const photoBuffer = Buffer.from(photoData.b64, "base64");

            // Resize photo to slot dimensions with cover-fit
            const resizedPhoto = await sharp(photoBuffer)
                .resize(PHOTO_W, PHOTO_H, { fit: "cover", position: "top" })
                .png()
                .toBuffer();

            // Create a rounded-corner mask matching the slot
            const mask = Buffer.from(
                `<svg width="${PHOTO_W}" height="${PHOTO_H}">
                    <rect width="${PHOTO_W}" height="${PHOTO_H}" rx="10" fill="white"/>
                </svg>`
            );

            // Apply mask to photo
            const maskedPhoto = await sharp(resizedPhoto)
                .composite([{ input: mask, blend: "dest-in" }])
                .png()
                .toBuffer();

            // Composite masked photo onto the card at the correct position
            sharpPipeline = sharp(Buffer.from(svg))
                .composite([{
                    input: maskedPhoto,
                    left: PHOTO_X,
                    top: PHOTO_Y,
                    blend: "over",
                }])
                .withMetadata({ density: 267 })
                .png();
        }

        const pngBuffer = await sharpPipeline.toBuffer();

        const safeFileName = `ESE-CoopID-${(memberNumber || "card").replace(/[^a-zA-Z0-9-]/g, "")}.png`;

        return new NextResponse(new Uint8Array(pngBuffer), {
            status: 200,
            headers: {
                "Content-Type": "image/png",
                "Content-Disposition": `attachment; filename="${safeFileName}"`,
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        logger.error("[/api/id-card/pdf] ID card generation error:", error);
        return NextResponse.json({ error: "Failed to generate ID card" }, { status: 500 });
    }
}
