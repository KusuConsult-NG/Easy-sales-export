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
        const res = await previewBroadcastAction(filters);

        if (!res.success) {
            return NextResponse.json({ success: false, error: res.error }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            data: res.data
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
