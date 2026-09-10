"use client";

import Link from "next/link";
import {
    ArrowLeft, Package, FileText, AlertTriangle, Ship, ShoppingCart,
} from "lucide-react";

import type { BuyerExportOrder } from "@/lib/export-orders-reader";

/**
 * What each order status means to the buyer — see #585.
 *
 * The vocabulary is the one export-payment.ts writes and
 * updateAdminExportOrderStatusAction whitelists. `cancelled_out_of_stock` and
 * `paid_awaiting_refund` are #582's states: they say the buyer was charged and
 * is owed money, and they must not be dressed up as anything else.
 */
const STATUS: Record<string, { label: string; tone: string; detail: string }> = {
    pending_payment: {
        label: "Awaiting payment", tone: "bg-amber-50 text-amber-700 border-amber-200",
        detail: "This order was started but the payment was never completed.",
    },
    processing: {
        label: "Processing", tone: "bg-blue-50 text-blue-700 border-blue-200",
        detail: "Paid. Our export team is preparing your consignment and documentation.",
    },
    shipped: {
        label: "Shipped", tone: "bg-indigo-50 text-indigo-700 border-indigo-200",
        detail: "On its way to your port of destination.",
    },
    delivered: {
        label: "Delivered", tone: "bg-green-50 text-green-700 border-green-200",
        detail: "Delivered to your port of destination.",
    },
    completed: {
        label: "Completed", tone: "bg-green-50 text-green-700 border-green-200",
        detail: "This order is closed.",
    },
    cancelled: {
        label: "Cancelled", tone: "bg-slate-100 text-slate-700 border-slate-200",
        detail: "This order was cancelled.",
    },
    cancelled_out_of_stock: {
        label: "Cancelled — refund due", tone: "bg-red-50 text-red-700 border-red-200",
        detail: "You were charged and this order could not be fulfilled. A refund is being arranged.",
    },
    refunded: {
        label: "Refunded", tone: "bg-slate-100 text-slate-700 border-slate-200",
        detail: "This order was refunded.",
    },
};

function statusOf(order: BuyerExportOrder) {
    return STATUS[String(order.status ?? "")] ?? {
        label: String(order.status ?? "Unknown"),
        tone: "bg-slate-100 text-slate-700 border-slate-200",
        detail: "Contact our export team for the current position of this order.",
    };
}

const money = (n: unknown, currency: "USD" | "NGN") => {
    const value = Number(n);
    if (!Number.isFinite(value)) return currency === "USD" ? "$—" : "₦—";
    return `${currency === "USD" ? "$" : "₦"}${value.toLocaleString()}`;
};

export default function MyExportOrdersClient({ orders }: { orders: BuyerExportOrder[] | null }) {
    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <Link
                    href="/export/buyer"
                    className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6 transition"
                >
                    <ArrowLeft className="w-5 h-5" />
                    Back to Catalog
                </Link>

                <h1 className="text-3xl font-bold text-slate-900 mb-2">My Export Orders</h1>
                <p className="text-slate-600 mb-8">
                    Every order you have placed, and where each one has got to.
                </p>

                {orders === null ? (
                    /**
                     *   A FAILED READ IS NOT AN EMPTY LIST — #579's distinction,
                     *   and it matters more here: telling somebody who has paid
                     *   that they have no orders is the worse of the two lies.
                     */
                    <div className="bg-white rounded-2xl border border-amber-200 p-8 text-center">
                        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                        <h2 className="text-xl font-bold text-slate-900 mb-2">We could not load your orders</h2>
                        <p className="text-slate-600">
                            Your orders are safe — this screen could not reach them just now. Please try again
                            shortly, or contact our export team with your payment reference.
                        </p>
                    </div>
                ) : orders.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                        <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h2 className="text-xl font-bold text-slate-900 mb-2">No orders yet</h2>
                        <p className="text-slate-600 mb-6">
                            Orders you place from the export catalogue will appear here.
                        </p>
                        <Link
                            href="/export/buyer"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition"
                        >
                            <ShoppingCart className="w-5 h-5" />
                            Browse Products
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-5">
                        {orders.map((order) => {
                            const status = statusOf(order);
                            return (
                                <div key={order.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                                    <div className="p-6 border-b border-slate-100 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <p className="text-xs text-slate-500 mb-1">Order reference</p>
                                            <p className="font-mono font-bold text-slate-900">{order.orderId ?? order.id}</p>
                                            {order.createdAt && (
                                                <p className="text-xs text-slate-500 mt-1">
                                                    Placed {new Date(String(order.createdAt)).toLocaleDateString()}
                                                </p>
                                            )}
                                        </div>
                                        <span className={`px-3 py-1.5 rounded-full border text-sm font-semibold ${status.tone}`}>
                                            {status.label}
                                        </span>
                                    </div>

                                    <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
                                        <p className="text-sm text-slate-600">{status.detail}</p>
                                        {order.refundReason && (
                                            <p className="text-sm text-red-700 mt-2">{String(order.refundReason)}</p>
                                        )}
                                    </div>

                                    <div className="p-6 space-y-3">
                                        {order.items.map((item, index) => (
                                            <div key={index} className="flex justify-between text-sm">
                                                <span className="text-slate-600">
                                                    {String(item.name ?? "Product")}
                                                    {item.grade ? ` · ${String(item.grade)}` : ""}
                                                    {" × "}{String(item.quantityMT ?? "?")} MT
                                                </span>
                                                <span className="font-semibold text-slate-900">
                                                    {money(item.totalUSD, "USD")}
                                                </span>
                                            </div>
                                        ))}

                                        <div className="pt-3 border-t border-slate-100 space-y-1">
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-600">Total (USD)</span>
                                                <span className="font-bold text-slate-900">{money(order.totalUSD, "USD")}</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-600">Charged</span>
                                                <span className="font-bold text-green-700">{money(order.totalNGN, "NGN")}</span>
                                            </div>
                                            {order.paymentReference && (
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-slate-600">Payment reference</span>
                                                    <span className="font-mono text-slate-900">{order.paymentReference}</span>
                                                </div>
                                            )}
                                        </div>

                                        {(order.shippingTerm || order.portOfDestination) && (
                                            <p className="pt-3 border-t border-slate-100 text-sm text-slate-600 flex items-center gap-2">
                                                <Ship className="w-4 h-4 text-slate-400" />
                                                {String(order.shippingTerm ?? "—")}
                                                {order.portOfDestination ? ` → ${String(order.portOfDestination)}` : ""}
                                            </p>
                                        )}

                                        {Array.isArray(order.documents) && order.documents.length > 0 && (
                                            <div className="pt-3 border-t border-slate-100">
                                                <p className="text-sm text-slate-500 mb-2">Shipping documents</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {(order.documents as any[]).map((doc, index) => (
                                                        <a
                                                            key={index}
                                                            href={String(doc?.url ?? "#")}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
                                                        >
                                                            <FileText className="w-3.5 h-3.5" />
                                                            {String(doc?.name ?? "Document")}
                                                        </a>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
