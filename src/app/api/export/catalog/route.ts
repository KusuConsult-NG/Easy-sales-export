import { NextResponse } from "next/server";
import { readPublicExportCatalog } from "@/lib/export-catalog-reader";

export const dynamic = 'force-dynamic';

/**
 * The public product list.
 *
 * The body of this handler — including the allow-list that keeps a seller's
 * internal id and whatever else the document happens to hold out of a public
 * response — moved to lib/export-catalog-reader in #578, so that /export/buyer
 * can read the catalogue on the SERVER instead of fetching this route from the
 * browser. One definition, two callers.
 */
export async function GET() {
    try {
        const products = await readPublicExportCatalog();

        return NextResponse.json({
            success: true,
            products
        });
    } catch (error) {
        console.error("Export catalog fetch error:", error);
        return NextResponse.json({
            success: false,
            error: "Failed to fetch export catalog"
        }, { status: 500 });
    }
}
