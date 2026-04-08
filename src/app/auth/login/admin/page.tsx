"use client";

import LoginForm from "@/components/auth/LoginForm";
import { Suspense } from "react";

export default function AdminLoginPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center">Loading...</div>}>
            <LoginForm />
        </Suspense>
    );
}
