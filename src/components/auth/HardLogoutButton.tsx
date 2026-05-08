'use client';

import { ShieldAlert } from 'lucide-react';
import { logoutAction } from '@/app/actions/auth';
import { useState } from 'react';

interface HardLogoutButtonProps {
    className?: string;
    variant?: 'primary' | 'secondary' | 'ghost';
    showText?: boolean;
}

export function HardLogoutButton({ 
    className = "", 
    variant = 'primary',
    showText = true 
}: HardLogoutButtonProps) {
    const [isLoading, setIsLoading] = useState(false);

    const handleLogout = async () => {
        setIsLoading(true);
        try {
            await logoutAction();
        } catch (error) {
            console.error('Logout failed:', error);
            // Fallback for extreme cases: hard refresh to hub login
            window.location.href = 'https://easysalesexport.com/auth/login';
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
