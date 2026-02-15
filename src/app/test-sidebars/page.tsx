"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import WaveSidebar from "@/app/wave/(member)/WaveSidebar";
import FarmNationSidebar from "@/app/farm-nation/(member)/FarmNationSidebar";
import CooperativeSidebar from "@/app/cooperatives/(member)/CooperativeSidebar";
import AcademySidebar from "@/app/academy/(learner)/AcademySidebar";
import ExportSidebar from "@/app/export/(app)/ExportSidebar";

function SidebarTester() {
    const searchParams = useSearchParams();
    const module = searchParams.get("module");

    // Mock user for Cooperative
    const mockUser = {
        firstName: "Test",
        lastName: "User",
        tier: "Gold"
    };

    return (
        <div className="min-h-screen bg-white dark:bg-slate-950">
            {module === "wave" && <WaveSidebar />}
            {module === "farm-nation" && <FarmNationSidebar />}
            {module === "cooperative" && <CooperativeSidebar user={mockUser} />}
            {module === "academy" && <AcademySidebar />}
            {module === "export" && <ExportSidebar />}

            {!module && (
                <div className="p-10">
                    <h1 className="text-2xl font-bold mb-4">Sidebar Test Page</h1>
                    <div className="flex flex-col gap-2">
                        <Link href="/test-sidebars?module=wave" className="text-blue-500 hover:underline">Test WAVE Sidebar</Link>
                        <Link href="/test-sidebars?module=farm-nation" className="text-blue-500 hover:underline">Test Farm Nation Sidebar</Link>
                        <Link href="/test-sidebars?module=cooperative" className="text-blue-500 hover:underline">Test Cooperative Sidebar</Link>
                        <Link href="/test-sidebars?module=academy" className="text-blue-500 hover:underline">Test Academy Sidebar</Link>
                        <Link href="/test-sidebars?module=export" className="text-blue-500 hover:underline">Test Export Sidebar</Link>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function TestSidebarsPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <SidebarTester />
        </Suspense>
    );
}
