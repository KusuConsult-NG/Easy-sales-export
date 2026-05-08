import { requireAdmin } from "@/lib/require-admin";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";

/**
 * Admin Hard Reset API
 * 
 * Nukes the Next.js cache and Redis stats to force a fresh data fetch
 * across the entire administrative suite.
 */
export async function GET() {
    const authCheck = await requireAdmin();
    if ("error" in authCheck) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        // 1. Purge Next.js Layout Cache
        revalidatePath("/", "layout");
        
        // 2. Purge Redis Analytics Cache
        await invalidateAdminGlobalStats();

        return NextResponse.json({ 
            success: true, 
            message: "Global platform cache purged. All dashboards are now showing fresh data." 
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
