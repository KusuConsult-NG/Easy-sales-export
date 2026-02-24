"use client";

import { createContext, useContext, useCallback, useRef } from "react";
import { toast } from "sonner";

type ToastType = "success" | "error" | "info" | "warning" | "loading";

interface ToastContextValue {
    showToast: (message: string, type: ToastType, duration?: number) => string | number;
    updateToast: (id: string | number, message: string, type: ToastType) => void;
    dismissToast: (id: string | number) => void;
    promise: <T>(
        promise: Promise<T>,
        messages: {
            loading: string;
            success: string | ((data: T) => string);
            error: string | ((error: any) => string);
        }
    ) => Promise<T>;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

// Deduplication window: ignore a repeat of the exact same message+type within 2 seconds
const DEDUP_WINDOW_MS = 2000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
    // Map of "type:message" -> timestamp of last show
    const recentToastsRef = useRef<Map<string, number>>(new Map());

    const showToast = useCallback((message: string, type: ToastType, duration = 5000) => {
        const key = `${type}:${message}`;
        const now = Date.now();
        const last = recentToastsRef.current.get(key) ?? 0;

        // Deduplicate: if same message+type shown within DEDUP_WINDOW_MS, do nothing
        if (now - last < DEDUP_WINDOW_MS) {
            return 0; // return a stable no-op id
        }
        recentToastsRef.current.set(key, now);

        switch (type) {
            case "success":
                return toast.success(message, { duration });
            case "error":
                return toast.error(message, { duration });
            case "warning":
                return toast.warning(message, { duration });
            case "info":
                return toast.info(message, { duration });
            case "loading":
                return toast.loading(message, { duration });
            default:
                return toast(message, { duration });
        }
    }, []);

    const updateToast = useCallback((id: string | number, message: string, type: ToastType) => {
        const options = { id };
        switch (type) {
            case "success":
                toast.success(message, options);
                break;
            case "error":
                toast.error(message, options);
                break;
            case "warning":
                toast.warning(message, options);
                break;
            case "info":
                toast.info(message, options);
                break;
            case "loading":
                toast.loading(message, options);
                break;
            default:
                toast(message, options);
        }
    }, []);

    const dismissToast = useCallback((id: string | number) => {
        toast.dismiss(id);
    }, []);

    const promise = useCallback(
        async <T,>(
            promiseToResolve: Promise<T>,
            messages: {
                loading: string;
                success: string | ((data: T) => string);
                error: string | ((error: any) => string);
            }
        ): Promise<T> => {
            toast.promise(promiseToResolve, {
                loading: messages.loading,
                success: messages.success,
                error: messages.error,
            });
            return promiseToResolve;
        },
        []
    );

    return (
        <ToastContext.Provider value={{ showToast, updateToast, dismissToast, promise }}>
            {children}
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error("useToast must be used within ToastProvider");
    }
    return context;
}
