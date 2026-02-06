"use client";

import { Toaster } from "react-hot-toast";

export function ToastProvider() {
    return (
        <Toaster
            position="top-right"
            toastOptions={{
                duration: 4000,
                style: {
                    background: "#1e293b",
                    color: "#fff",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                },
                success: {
                    iconTheme: {
                        primary: "#10b981",
                        secondary: "#fff",
                    },
                },
                error: {
                    iconTheme: {
                        primary: "#ef4444",
                        secondary: "#fff",
                    },
                },
            }}
        />
    );
}
