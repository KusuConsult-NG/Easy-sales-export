"use client";

import { ReactNode } from "react";

interface Column<T> {
    header: string;
    accessor: keyof T | ((item: T) => ReactNode);
    className?: string;
    hideOnMobile?: boolean;
}

interface ResponsiveTableProps<T> {
    data: T[];
    columns: Column<T>[];
    onRowClick?: (item: T) => void;
    loading?: boolean;
    emptyState?: ReactNode;
    getRowKey: (item: T) => string;
    mobileCardRender?: (item: T) => ReactNode;
}

export default function ResponsiveTable<T extends Record<string, any>>({
    data,
    columns,
    onRowClick,
    loading,
    emptyState,
    getRowKey,
    mobileCardRender,
}: ResponsiveTableProps<T>) {
    const getCellValue = (item: T, column: Column<T>) => {
        if (typeof column.accessor === "function") {
            return column.accessor(item);
        }
        return item[column.accessor];
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (data.length === 0 && emptyState) {
        return <>{emptyState}</>;
    }

    return (
        <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-white/5 border-b border-white/10">
                        <tr>
                            {columns.map((column, index) => (
                                <th
                                    key={index}
                                    className={`px-6 py-4 text-left text-sm font-semibold ${column.className || ""
                                        }`}
                                >
                                    {column.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                        {data.map((item) => (
                            <tr
                                key={getRowKey(item)}
                                onClick={() => onRowClick?.(item)}
                                className={onRowClick ? "hover:bg-white/5 cursor-pointer transition" : ""}
                            >
                                {columns.map((column, colIndex) => (
                                    <td
                                        key={colIndex}
                                        className={`px-6 py-4 text-sm ${column.className || ""}`}
                                    >
                                        {getCellValue(item, column)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-4">
                {mobileCardRender ? (
                    data.map((item) => (
                        <div
                            key={getRowKey(item)}
                            onClick={() => onRowClick?.(item)}
                            className={onRowClick ? "cursor-pointer" : ""}
                        >
                            {mobileCardRender(item)}
                        </div>
                    ))
                ) : (
                    data.map((item) => (
                        <div
                            key={getRowKey(item)}
                            onClick={() => onRowClick?.(item)}
                            className={`bg-white/10 backdrop-blur-xl border border-white/20 rounded-xl p-4 ${onRowClick ? "cursor-pointer active:scale-98 transition" : ""
                                }`}
                        >
                            {columns
                                .filter((col) => !col.hideOnMobile)
                                .map((column, index) => (
                                    <div key={index} className="flex justify-between items-start mb-3 last:mb-0">
                                        <span className="text-sm font-semibold text-blue-300 mr-2">
                                            {column.header}:
                                        </span>
                                        <span className={`text-sm text-right flex-1 ${column.className || ""}`}>
                                            {getCellValue(item, column)}
                                        </span>
                                    </div>
                                ))}
                        </div>
                    ))
                )}
            </div>
        </>
    );
}
