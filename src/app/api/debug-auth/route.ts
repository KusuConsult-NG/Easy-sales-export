import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";

export const dynamic = "force-dynamic";

export const GET = async () => {
    try {
        const session = await auth();
        const cookieStore = await cookies();
        const headersList = await headers();

        return NextResponse.json({
            hasSession: !!session,
            user: session?.user ? {
                id: session.user.id,
                email: session.user.email,
                roles: session.user.roles
            } : null,
            cookies: cookieStore.getAll().map(c => c.name),
            authHeader: headersList.get("authorization") || "none",
            host: headersList.get("host")
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
