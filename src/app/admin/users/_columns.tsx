"use client";

/**
 * The admin users table: its row type, its colour maps, and its column
 * definitions.
 *
 * Lifted out of page.tsx, which was 1,456 lines — the largest React file in the
 * repository and one of the four the action-file splits (#202-#210) could not
 * reach. Nine hundred of those lines were JSX inside a single component holding
 * eighteen useState hooks.
 *
 * WHY THIS PART AND NOT MORE
 * --------------------------
 * There are no rendering tests in this repository. Nothing mounts a component,
 * so a mistake in a React extraction is caught by tsc and by review, and by
 * nothing else — unlike the server-action splits, where 2,216 tests exercised
 * the moved code.
 *
 * So the cut follows what can be moved without a judgement call. The column
 * definitions capture exactly five things from the component scope:
 *
 *     processingId               state
 *     handleToggleVerification   handler
 *     handleManageUser           handler
 *     MODULE_COLORS              constant, moved here
 *     getRoleBadge               pure function, moved here
 *
 * Two of those are data and two are callbacks, so the block becomes a factory
 * taking them as an explicit parameter object. Every render function inside is
 * byte-for-byte what it was; nothing was rewritten, reordered or "tidied".
 *
 * The stateful parts of the page — the modal, the filter panel, the bulk
 * actions — are deliberately left alone. Extracting those means deciding which
 * of eighteen state variables each one owns, and that is design work, not a
 * move.
 */

import React from "react";
import { Users, CheckCircle, XCircle, Loader2, Edit, Shield, FileCheck, FileX, MapPin, Layers } from "lucide-react";
import { formatDate } from "@/lib/utils";

export interface User {
    id: string;
    name: string;
    email: string;
    phone?: string;
    role: string;
    roles?: string[];
    isVerified: boolean;
    createdAt: Date;
    verifiedAt?: Date;
    bankDetails?: any;
    bvn?: string;
    bvnVerified?: boolean;
    nin?: string;
    ninVerified?: boolean;
    kycStatus?: string;
    idType?: string;
    taxId?: string;
    tinVerified?: boolean;
    cacNumber?: string;
    cacVerified?: boolean;
    state?: string;
    lga?: string;
    address?: any;
    residentialAddress?: string;
    stateOfOrigin?: string;
    nextOfKin?: any;
    accountType?: string;
    gender?: string;
    serviceRegistrations?: Record<string, any>;
    activeModules?: string[];
    moduleCount?: number;
    identityDocument?: string;
}

/** Module pill colours. */
export // Module pill colours
const MODULE_COLORS: Record<string, string> = {
    marketplace:   "bg-orange-100 text-orange-700 border-orange-200",
    academy:       "bg-violet-100 text-violet-700 border-violet-200",
    wave:          "bg-pink-100 text-pink-700 border-pink-200",
    cooperatives:  "bg-cyan-100 text-cyan-700 border-cyan-200",
    export:        "bg-indigo-100 text-indigo-700 border-indigo-200",
    "farm-nation": "bg-green-100 text-green-700 border-green-200",
};

/** Role badge colours. Pure lookup, no state. */
export const getRoleBadge = (role: string) => {
    const colors: Record<string, string> = {
        admin: "bg-purple-100 text-purple-700",
        farmer: "bg-green-100 text-green-700",
        buyer: "bg-blue-100 text-blue-700",
        seller: "bg-orange-100 text-orange-700",
        exporter: "bg-indigo-100 text-indigo-700",
        vendor: "bg-pink-100 text-pink-700",
        member: "bg-cyan-100 text-cyan-700",
    };
    return colors[role] || "bg-slate-100 text-slate-900";
};

/**
 * The column definitions, as a factory over what they used to close over.
 *
 * @param deps.processingId              the row currently being verified, or null
 * @param deps.onToggleVerification      was handleToggleVerification
 * @param deps.onManageUser              was handleManageUser
 */
export function buildUserColumns(deps: {
    processingId: string | null;
    onToggleVerification: (userId: string) => void | Promise<void>;
    onManageUser: (user: User) => void;
}) {
    const { processingId, onToggleVerification: handleToggleVerification, onManageUser: handleManageUser } = deps;

    return [
    {
        header: "User",
        accessor: (user: User) => (
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5 text-primary" />
                </div>
                <div>
                    <div className="font-bold text-slate-900 flex items-center gap-2">
                        {user.name}
                        {user.isVerified && <Shield className="w-3 h-3 text-green-600" />}
                    </div>
                    <div className="text-xs text-slate-500">{user.email}</div>
                </div>
            </div>
        )
    },
    {
        header: "Role",
        accessor: (user: User) => (
            <div className="flex flex-col gap-1 items-start">
                <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${getRoleBadge(user.role)}`}>
                    {user.role}
                </span>
                {user.accountType && (
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border capitalize ${
                        user.accountType === 'seller' ? 'border-orange-200 text-orange-600 bg-orange-50' : 
                        user.accountType === 'buyer' ? 'border-blue-200 text-blue-600 bg-blue-50' : 
                        'border-indigo-200 text-indigo-600 bg-indigo-50'
                    }`}>
                        Mkt: {user.accountType}
                    </span>
                )}
            </div>
        ),
        hideOnMobile: true
    },
    {
        header: "Gender",
        accessor: (user: User) => (
            <span className="text-sm text-slate-700 capitalize">
                {user.gender || "—"}
            </span>
        ),
        hideOnMobile: true
    },
    {
        header: "KYC",
        accessor: (user: User) => (
            <div className="flex gap-1.5 flex-wrap w-32">
                {/* NIN badge */}
                {user.nin ? (
                    <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${user.ninVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                            }`}
                        title={`NIN: ${user.ninVerified ? 'Verified' : 'Pending'}`}
                    >NIN</span>
                ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-400" title="NIN not provided">NIN</span>
                )}
                {/* BVN badge */}
                {user.bvn ? (
                    <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${user.bvnVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                            }`}
                        title={`BVN: ${user.bvnVerified ? 'Verified' : 'Pending'}`}
                    >BVN</span>
                ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-400" title="BVN not provided">BVN</span>
                )}
                {user.taxId && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${user.tinVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`} title="TIN">TIN</span>
                )}
                {user.cacNumber && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${user.cacVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`} title="CAC">CAC</span>
                )}
            </div>
        ),
        hideOnMobile: true
    },
    {
        header: "Modules",
        accessor: (user: User) => (
            <div className="flex flex-wrap gap-1 max-w-[160px]">
                {(user.activeModules && user.activeModules.length > 0) ? (
                    <>
                        {user.activeModules.map(mod => (
                            <span
                                key={mod}
                                className={`px-1.5 py-0.5 rounded border text-[10px] font-bold capitalize ${
                                    MODULE_COLORS[mod] || "bg-slate-100 text-slate-600 border-slate-200"
                                }`}
                            >
                                {mod}
                            </span>
                        ))}
                        {(user.moduleCount ?? 0) >= 2 && (
                            <span className="px-1.5 py-0.5 rounded border text-[10px] font-bold bg-amber-100 text-amber-700 border-amber-200 flex items-center gap-0.5">
                                <Layers className="w-2.5 h-2.5" />{user.moduleCount}
                            </span>
                        )}
                    </>
                ) : (
                    <span className="text-[10px] text-slate-400 italic">None</span>
                )}
            </div>
        ),
        hideOnMobile: true
    },
    {
        header: "Joined",
        accessor: (user: User) => formatDate(user.createdAt),
        hideOnMobile: true
    },
    {
        header: "Location",
        accessor: (user: User) => (
            <div className="text-xs text-slate-600">
                {user.state ? (
                    <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        <span>{user.state}{user.lga ? `, ${user.lga}` : ""}</span>
                    </div>
                ) : <span className="text-slate-400 italic">—</span>}
            </div>
        ),
        hideOnMobile: true
    },
    {
        header: "Actions",
        accessor: (user: User) => (
            <div className="flex items-center gap-2 justify-end">
                <button
                    onClick={(e) => { e.stopPropagation(); handleToggleVerification(user.id); }}
                    disabled={processingId === user.id}
                    className={`p-1.5 rounded-lg transition disabled:opacity-50 ${user.isVerified
                        ? "text-red-600 hover:bg-red-50"
                        : "text-green-600 hover:bg-green-50"
                        }`}
                    title={user.isVerified ? "Unverify" : "Verify"}
                >
                    {processingId === user.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : user.isVerified ? (
                        <XCircle className="w-4 h-4" />
                    ) : (
                        <CheckCircle className="w-4 h-4" />
                    )}
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); handleManageUser(user); }}
                    className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                    title="Manage Roles"
                >
                    <Edit className="w-4 h-4" />
                </button>
            </div>
        )
    }
]
}
