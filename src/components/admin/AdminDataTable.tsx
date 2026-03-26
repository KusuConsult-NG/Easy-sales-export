"use client";

import { useState, useEffect, ReactNode } from "react";
import { Search, ChevronLeft, ChevronRight, Loader2, Download, Filter } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce"; // Assuming this exists, or I will implement a simple one inside useAdminData

interface Column<T> {
    header: string;
    accessor: keyof T | ((item: T) => ReactNode);
    className?: string;
    hideOnMobile?: boolean;
}

interface AdminDataTableProps<T> {
    columns: Column<T>[];
    data: T[];
    loading: boolean;
    error?: string | null;

    // Search
    searchPlaceholder?: string;
    onSearch?: (term: string) => void;
    searchTerm?: string;

    // Pagination
    hasMore?: boolean;
    onNextPage?: () => void;
    onPrevPage?: () => void;
    pageIndex?: number; // 0-based index for display (Page X)

    // Actions
    onRowClick?: (item: T) => void;
    actionButtons?: ReactNode; // e.g. "Export CSV", "Create New"

    // Selection (Bulk Actions)
    selectable?: boolean;
    selectedIds?: Set<string>;
    onSelectAll?: () => void;
    onSelectRow?: (id: string) => void;
    getRowId?: (item: T) => string;

    // Filter Slots
    filters?: ReactNode;
}

export default function AdminDataTable<T extends Record<string, any>>({
    columns,
    data,
    loading,
    error,
    searchPlaceholder = "Search...",
    onSearch,
    searchTerm,
    hasMore,
    onNextPage,
    onPrevPage,
    pageIndex = 0,
    onRowClick,
    actionButtons,
    selectable = false,
    selectedIds,
    onSelectAll,
    onSelectRow,
    getRowId = (item) => item.id,
    filters,
}: AdminDataTableProps<T>) {

    // Helper to render cell content
    const getCellValue = (item: T, column: Column<T>) => {
        if (typeof column.accessor === "function") {
            return column.accessor(item);
        }
        return item[column.accessor];
    };

    return (
        <div className="space-y-4">
            {/* Toolbar: Search, Filters, Actions */}
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-white p-4 rounded-xl elevation-1">
                <div className="flex flex-1 flex-col sm:flex-row gap-3 w-full sm:w-auto">
                    {onSearch && (
                        <div className="relative flex-1 sm:max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder={searchPlaceholder}
                                value={searchTerm || ""}
                                onChange={(e) => onSearch(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-600 text-sm"
                            />
                        </div>
                    )}

                    {filters && (
                        <div className="flex gap-2">
                            {filters}
                        </div>
                    )}
                </div>

                <div className="flex gap-2 w-full sm:w-auto justify-end items-center flex-wrap">
                    {actionButtons}
                </div>
            </div>

            {/* Error State */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-600 text-sm">
                    {error}
                </div>
            )}

            {/* Table / List */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden elevation-1">
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                {selectable && onSelectAll && (
                                    <th className="px-6 py-4 w-4">
                                        <input
                                            type="checkbox"
                                            className="rounded border-slate-300"
                                            checked={Math.max(0, data.length) > 0 && selectedIds?.size === data.length}
                                            onChange={onSelectAll}
                                        />
                                    </th>
                                )}
                                {columns.map((col, idx) => (
                                    <th key={idx} className={`px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider ${col.className || ""}`}>
                                        {col.header}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading && data.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-6 py-12 text-center">
                                        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
                                        <p className="mt-2 text-slate-500">Loading data...</p>
                                    </td>
                                </tr>
                            ) : data.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-6 py-12 text-center text-slate-500">
                                        No results found
                                    </td>
                                </tr>
                            ) : (
                                data.map((item) => {
                                    const id = getRowId(item);
                                    return (
                                        <tr
                                            key={id}
                                            onClick={() => onRowClick?.(item)}
                                            className={`
                                                group transition-colors
                                                ${onRowClick ? "hover:bg-slate-50 cursor-pointer" : ""}
                                                ${selectedIds?.has(id) ? "bg-blue-50/50" : ""}
                                            `}
                                        >
                                            {selectable && onSelectRow && (
                                                <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        className="rounded border-slate-300"
                                                        checked={selectedIds?.has(id)}
                                                        onChange={() => onSelectRow(id)}
                                                    />
                                                </td>
                                            )}
                                            {columns.map((col, idx) => (
                                                <td key={idx} className={`px-6 py-4 text-sm text-slate-900 ${col.className || ""}`}>
                                                    {getCellValue(item, col)}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile List View */}
                <div className="md:hidden divide-y divide-slate-100">
                    {/* Mobile Select All Header */}
                    {selectable && onSelectAll && data.length > 0 && (
                        <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                            <label className="flex items-center gap-3 w-full cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="rounded border-slate-300 w-4 h-4 text-blue-600 focus:ring-blue-600"
                                    checked={selectedIds?.size === data.length}
                                    onChange={onSelectAll}
                                />
                                <span className="text-sm font-medium text-slate-700">Select All ({data.length})</span>
                            </label>
                        </div>
                    )}
                    
                    {loading && data.length === 0 ? (
                        <div className="p-12 text-center">
                            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
                        </div>
                    ) : data.length === 0 ? (
                        <div className="p-12 text-center text-slate-500">
                            No results found
                        </div>
                    ) : (
                        data.map((item) => {
                            const id = getRowId(item);
                            return (
                                <div
                                    key={id}
                                    onClick={() => onRowClick?.(item)}
                                    className={`p-4 space-y-3 ${onRowClick ? "active:bg-slate-50" : ""}`}
                                >
                                    <div className="flex justify-between items-start">
                                        {selectable && onSelectRow && (
                                            <div onClick={(e) => e.stopPropagation()} className="mr-3 pt-1">
                                                <input
                                                    type="checkbox"
                                                    className="rounded border-slate-300"
                                                    checked={selectedIds?.has(id)}
                                                    onChange={() => onSelectRow(id)}
                                                />
                                            </div>
                                        )}
                                        <div className="flex-1 space-y-2">
                                            {columns.filter(c => !c.hideOnMobile).map((col, idx) => (
                                                <div key={idx} className="flex justify-between">
                                                    <span className="text-xs font-semibold text-slate-500 uppercase">{col.header}</span>
                                                    <span className="text-sm text-slate-900 text-right">{getCellValue(item, col)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200">
                <button
                    onClick={onPrevPage}
                    disabled={pageIndex === 0 || loading}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-50 text-sm hover:bg-slate-50 transition"
                >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                </button>
                <div className="text-sm font-medium text-slate-600">
                    Page {pageIndex + 1}
                </div>
                <button
                    onClick={onNextPage}
                    disabled={!hasMore || loading}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-50 text-sm hover:bg-blue-700 transition"
                >
                    Next
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
