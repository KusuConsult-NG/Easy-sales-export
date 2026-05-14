import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { isAdmin } from "@/lib/admin-permissions";
import { previewBroadcastAction } from "@/app/actions/broadcast";

export const maxDuration = 300; // 5 min timeout

export async function POST(req: NextRequest) {
    try {
        const { session } = await requireSession();
        if (!session?.user || !isAdmin(session.user.roles)) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
        }

        const filters = await req.json();
        const { getCleanBroadcastList } = await import("@/lib/broadcast-logic");
        const listResult = await getCleanBroadcastList(filters);

        if (!listResult.success || !listResult.data) {
            return NextResponse.json({ success: false, error: listResult.error || "Failed to estimate recipients" }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            data: {
                count: listResult.data.count,
                totalMatches: listResult.data.originalDocCount,
                sample: listResult.data.recipients.slice(0, 5).map(r => ({ name: r.name, email: r.email })),
                moduleStats: listResult.data.moduleStats
            }
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
