"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

export default function SessionDebugger() {
    const { data: session, status } = useSession();
    const [cookies, setCookies] = useState<string>("");

    useEffect(() => {
        setCookies(document.cookie);
        const interval = setInterval(() => {
            setCookies(document.cookie);
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    if (process.env.NODE_ENV === "production" && !window.location.search.includes("debug=true")) return null;

    return (
        <div className="fixed bottom-4 right-4 z-50 p-4 bg-black/80 text-white text-xs font-mono rounded-lg max-w-sm overflow-hidden shadow-2xl border border-white/20">
            <h3 className="font-bold text-yellow-400 mb-2">Auth Debugger</h3>
            <div className="space-y-1">
                <p>Status: <span className={status === "authenticated" ? "text-green-400" : "text-red-400"}>{status}</span></p>
                <p>User ID: {session?.user?.id || "None"}</p>
                <p>Role: {session?.user?.roles?.[0] || "None"}</p>
                <div className="mt-2 border-t border-white/20 pt-1">
                    <p className="font-bold text-blue-300">Cookies Present:</p>
                    <ul className="list-disc pl-4 text-[10px] break-all">
                        {cookies.split("; ").map(c => {
                            const [name] = c.split("=");
                            return <li key={name} className={name.includes("next-auth") ? "text-green-300" : "text-gray-400"}>{name}</li>;
                        })}
                    </ul>
                </div>
            </div>
        </div>
    );
}
