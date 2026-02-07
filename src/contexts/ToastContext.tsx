"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle, Loader2 } from "lucide-react";

type ToastType = "success" | "error" | "info" | "warning" | "loading";

interface Toast {
    id: string;
    message: string;
    type: ToastType;
    duration?: number;
}

interface ToastContextValue {
    showToast: (message: string, type: ToastType, duration?: number) => string;
    updateToast: (id: string, message: string, type: ToastType) => void;
    dismissToast: (id: string) => void;
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
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, type: ToastType, duration = 5000) => {
        const id = Math.random().toString(36).substring(7);
        const toast: Toast = { id, message, type, duration };

        setToasts((prev) => [...prev, toast]);

        // Auto-dismiss unless it's a loading toast
        if (type !== "loading" && duration > 0) {
            setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== id));
            }, duration);
        }

        return id;
    }, []);

    const updateToast = useCallback((id: string, message: string, type: ToastType) => {
        setToasts((prev) =>
            prev.map((t) => (t.id === id ? { ...t, message, type } : t))
        );

        // Auto-dismiss after update
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 5000);
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const promise = useCallback(
        async <T,>(
            promiseToResolve: Promise<T>,
            messages: {
                loading: string;
                success: string | ((data: T) => string);
                error: string | ((error: any) => string);
            }
        ) => {
            const toastId = showToast(messages.loading, "loading", 0);

            try {
                const data = await promiseToResolve;
                const successMessage =
                    typeof messages.success === "function"
                        ? messages.success(data)
                        : messages.success;
                updateToast(toastId, successMessage, "success");
                return data;
            } catch (error) {
                const errorMessage =
                    typeof messages.error === "function"
                        ? messages.error(error)
                        : messages.error;
                updateToast(toastId, errorMessage, "error");
                throw error;
            }
        },
        [showToast, updateToast]
    );

    const removeToast = (id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    };

    const getIcon = (type: ToastType) => {
        switch (type) {
            case "success":
                return <CheckCircle className="w-5 h-5" />;
            case "error":
                return <AlertCircle className="w-5 h-5" />;
            case "warning":
                return <AlertTriangle className="w-5 h-5" />;
            case "info":
                return <Info className="w-5 h-5" />;
            case "loading":
                return <Loader2 className="w-5 h-5 animate-spin" />;
        }
    };

    const getStyles = (type: ToastType) => {
        switch (type) {
            case "success":
                return "bg-green-500 text-white";
            case "error":
                return "bg-red-500 text-white";
            case "warning":
                return "bg-yellow-500 text-white";
            case "info":
                return "bg-blue-500 text-white";
            case "loading":
                return "bg-slate-700 text-white";
        }
    };

    return (
        <ToastContext.Provider value={{ showToast, updateToast, dismissToast, promise }}>
            {children}

            {/* Toast Container - Mobile optimized positioning */}
            <div className="fixed bottom-4 right-4 sm:right-4 left-4 sm:left-auto z-50 flex flex-col gap-2 sm:max-w-sm">
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        className={`${getStyles(
                            toast.type
                        )} rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 animate-[slideInRight_0.3s_ease-out]`}
                    >
                        {getIcon(toast.type)}
                        <p className="flex-1 font-semibold text-sm">{toast.message}</p>
                        {toast.type !== "loading" && (
                            <button
                                onClick={() => removeToast(toast.id)}
                                className="hover:bg-white/20 rounded-lg p-1 transition-colors"
                                aria-label="Dismiss notification"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                ))}
            </div>
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
