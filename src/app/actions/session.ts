"use server";

import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

/**
 * Switch Active Module Context
 * 
 * Updates the user's active module ID in the session.
 * Used by the Hub to track which sub-app (Academy, WAVE, etc.) 
 * the user is currently interacting with.
 * 
 * @param moduleId - The slug of the module (e.g., 'academy', 'wave')
 */
export async function switchModuleAction(moduleId: string) {
    const session = await auth();
    if (!session?.user) return { success: false, error: "Unauthorized" };

    // Note: In NextAuth v5, you can't easily update the server session 
    // without a client-side update() call. This action acts as a trigger.
    // The client should call this and then call session.update().
    
    // We can also store this in a cookie for middleware to read
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    cookieStore.set("current_module_id", moduleId, { path: "/", maxAge: 60 * 60 * 24 * 7 });

    revalidatePath("/", "layout");
    
    return { success: true, moduleId };
}
