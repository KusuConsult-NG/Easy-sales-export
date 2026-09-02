'use client';

import { ShieldAlert } from 'lucide-react';
import { logoutAction } from '@/app/actions/auth';
import { useState } from 'react';

interface HardLogoutButtonProps {
    className?: string;
    variant?: 'primary' | 'secondary' | 'ghost';
    showText?: boolean;
}

/**
 *   #337 THE RECOVERY BUTTON DID NOT PERFORM THE RECOVERY, AND ITS FALLBACK
 *        LEFT THE DEPLOYMENT.
 *
 *        This button is rendered by EVERY error page — root, admin,
 *        marketplace, farm-nation, export — under the caption "Recommended if
 *        you are stuck in a login loop". It is the control a user reaches when
 *        the app has already broken.
 *
 *        IT CLEARED NO CLIENT STATE. The label says "Clear Cache & Hard
 *        Logout" and the tooltip says "Clear all session data and force a
 *        fresh login"; the handler called logoutAction() and nothing else.
 *        logoutAction is thorough about COOKIES — root-domain and host-scoped,
 *        session and CSRF — but it runs on the server and cannot touch the
 *        browser. So the one thing most likely to cause the loop the caption
 *        names went untouched: `lastActivity`, the timestamp
 *        SessionActivityTracker reads to decide the session has gone idle. A
 *        stale value there signs the user straight back out after they log in,
 *        which is the loop, and the button advertised as its cure left it in
 *        place.
 *
 *        AND THE FALLBACK WENT TO PRODUCTION. On failure it did
 *
 *            window.location.href = 'https://easysalesexport.com/auth/login';
 *
 *        a hard-coded absolute host. From staging, a preview build or
 *        localhost that navigates to a DIFFERENT DEPLOYMENT, where the user's
 *        session has nothing to do with the one that just failed — and the
 *        cookies just cleared were for the origin they were sent away from.
 *        Relative now, so the fallback stays in the deployment the user is in.
 *
 *        WHAT IS DELIBERATELY NOT CLEARED. `localStorage.clear()` would be the
 *        obvious way to honour "clear all session data", and it would silently
 *        destroy `wave_briefing_pending_sync` — a WAVE briefing registration
 *        the user submitted while offline, held until connectivity returns.
 *        Unsent user data is not cache. Session-scoped state is cleared and
 *        that key is stepped around, so the button does what it says without
 *        throwing away something the user typed.
 */
export const SESSION_STORAGE_KEYS_CLEARED = ['lastActivity'] as const;
export const CLIENT_KEYS_PRESERVED = ['wave_briefing_pending_sync'] as const;

export function clearClientSessionState() {
    try {
        // Session-scoped by definition — nothing durable lives here.
        window.sessionStorage.clear();
    } catch {
        // Storage can be unavailable (private mode, blocked cookies). A
        // logout must not fail because the browser refused a clear.
    }
    for (const key of SESSION_STORAGE_KEYS_CLEARED) {
        try {
            window.localStorage.removeItem(key);
        } catch {
            /* as above */
        }
    }
}


export function HardLogoutButton({ 
    className = "", 
    variant = 'primary',
    showText = true 
}: HardLogoutButtonProps) {
    const [isLoading, setIsLoading] = useState(false);

    const handleLogout = async () => {
        setIsLoading(true);

        // BEFORE the action, not after: logoutAction ends in signOut(), which
        // navigates. Anything queued to run after the await may never run.
        clearClientSessionState();

        try {
            await logoutAction();
        } catch (error) {
            console.error('Logout failed:', error);
            // Relative, so a failed logout lands on THIS deployment's login
            // page rather than production's.
            window.location.href = '/auth/login';
        } finally {
            setIsLoading(false);
        }
    };

    const baseStyles = "inline-flex items-center justify-center gap-2 font-semibold transition-all rounded-xl cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
    
    const variantStyles = {
        primary: "bg-slate-900 hover:bg-slate-800 text-white px-6 py-3",
        secondary: "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-6 py-3 shadow-sm",
        ghost: "text-slate-500 hover:text-slate-900 text-xs py-1"
    };

    return (
        <div className={`flex flex-col items-center gap-1.5 ${className}`}>
            <button
                onClick={handleLogout}
                disabled={isLoading}
                className={`${baseStyles} ${variantStyles[variant]}`}
                title="Clear all session data and force a fresh login"
            >
                <ShieldAlert className={`${showText ? 'w-4 h-4' : 'w-5 h-5'} ${isLoading ? 'animate-pulse' : ''}`} />
                {showText && (isLoading ? 'Resetting Session...' : 'Clear Cache & Hard Logout')}
            </button>
            {showText && (
                <p className="text-[10px] text-slate-400 uppercase tracking-widest font-medium">
                    Recommended if you are stuck in a login loop
                </p>
            )}
        </div>
    );
}
