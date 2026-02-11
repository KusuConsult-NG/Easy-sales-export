"use client";

import { createContext, useContext, useCallback } from "react";
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

export function ToastProvider({ children }: { children: React.ReactNode }) {

    const showToast = useCallback((message: string, type: ToastType, duration = 5000) => {
        // Map to sonner methods
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
        // Sonner doesn't strictly separate "update" from "dismiss + new" for simple toasts,
        // but it does support updating if we have the ID.
        // For 'loading' to 'success'/'error', usually we use toast.promise or manual dismiss + show.
        // However, toast.success(message, { id }) can update an existing toast if the ID matches.

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
            const result = toast.promise(promiseToResolve, {
                loading: messages.loading,
                success: messages.success,
                error: messages.error,
            });
            // Await the promise to get the actual T value
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

