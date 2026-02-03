import { Package, Clock, CheckCircle, AlertCircle, FileText } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function ExportWindowsPage() {
    // Mock data - will be replaced with API calls
    const orders = [
        {
            id: "EXP-2024-001",
            commodity: "Yam Tubers",
            quantity: "500 kg",
            amount: 150000,
            status: "in_transit",
            orderDate: "2024-01-15",
            deliveryDate: "2024-02-20",
            escrowReleaseDate: "2024-03-05",
            canReleaseEscrow: false,
            timeline: [
                { stage: "Order Placed", date: "Jan 15, 2024", completed: true },
                { stage: "Processing", date: "Jan 18, 2024", completed: true },
                { stage: "In Transit", date: "Feb 1, 2024", completed: true, current: true },
                { stage: "Delivered", date: "Expected Feb 20", completed: false },
                { stage: "Escrow Release", date: "Expected Mar 5", completed: false },
            ],
        },
        {
            id: "EXP-2024-002",
            commodity: "Sesame Seeds",
            quantity: "200 kg",
            amount: 80000,
            status: "delivered",
            orderDate: "2024-01-10",
            deliveryDate: "2024-02-12",
            escrowReleaseDate: "2024-02-27",
            canReleaseEscrow: true,
            timeline: [
                { stage: "Order Placed", date: "Jan 10, 2024", completed: true },
                { stage: "Processing", date: "Jan 12, 2024", completed: true },
                { stage: "In Transit", date: "Jan 25, 2024", completed: true },
                { stage: "Delivered", date: "Feb 12, 2024", completed: true, current: true },
                { stage: "Escrow Release", date: "Awaiting Release", completed: false },
            ],
        },
    ];

    const getStatusColor = (status: string) => {
        switch (status) {
            case "delivered":
                return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400";
            case "in_transit":
                return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400";
            case "processing":
                return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400";
            default:
                return "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300";
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case "delivered":
                return <CheckCircle className="w-5 h-5" />;
            case "in_transit":
                return <Package className="w-5 h-5" />;
            case "processing":
                return <Clock className="w-5 h-5" />;
            default:
                return <AlertCircle className="w-5 h-5" />;
        }
    };

    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Export Orders
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Track your export orders and manage escrow releases
                </p>
            </div>

            {/* Orders List */}
            <div className="space-y-6">
                {orders.map((order, index) => (
                    <div
                        key={order.id}
                        className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 hover-lift animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]"
                        style={{ animationDelay: `${index * 100}ms` }}
                    >
                        {/* Order Header */}
                        <div className="flex items-start justify-between mb-6">
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                                        {order.commodity}
                                    </h3>
                                    <span
                                        className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${getStatusColor(
                                            order.status
                                        )}`}
                                    >
                                        {getStatusIcon(order.status)}
                                        {order.status.replace("_", " ").toUpperCase()}
                                    </span>
                                </div>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Order ID: {order.id}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
                                    Total Amount
                                </p>
                                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                                    {formatCurrency(order.amount)}
                                </p>
                            </div>
                        </div>

                        {/* Order Details */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                            <div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                    Quantity
                                </p>
                                <p className="font-semibold text-slate-900 dark:text-white">
                                    {order.quantity}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                    Order Date
                                </p>
                                <p className="font-semibold text-slate-900 dark:text-white">
                                    {order.orderDate}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                    Expected Delivery
                                </p>
                                <p className="font-semibold text-slate-900 dark:text-white">
                                    {order.deliveryDate}
                                </p>
                            </div>
                        </div>

                        {/* Timeline */}
                        <div className="mb-6">
                            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">
                                Order Timeline
                            </h4>
                            <div className="relative">
                                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700" />
                                <div className="space-y-4">
                                    {order.timeline.map((stage, idx) => (
                                        <div key={idx} className="relative flex items-start gap-4">
                                            <div
                                                className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center ${stage.completed
                                                        ? "bg-primary text-white"
                                                        : stage.current
                                                            ? "bg-blue-100 dark:bg-blue-900/30 text-primary border-2 border-primary"
                                                            : "bg-slate-200 dark:bg-slate-700 text-slate-400"
                                                    }`}
                                            >
                                                {stage.completed ? (
                                                    <CheckCircle className="w-4 h-4" />
                                                ) : (
                                                    <div className="w-2 h-2 rounded-full bg-current" />
                                                )}
                                            </div>
                                            <div className="flex-1 pt-1">
                                                <p
                                                    className={`font-semibold ${stage.current
                                                            ? "text-primary"
                                                            : stage.completed
                                                                ? "text-slate-900 dark:text-white"
                                                                : "text-slate-500 dark:text-slate-400"
                                                        }`}
                                                >
                                                    {stage.stage}
                                                </p>
                                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                                    {stage.date}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                            {order.canReleaseEscrow ? (
                                <button className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white font-semibold rounded-xl hover:scale-105 transition-transform elevation-2">
                                    Release Escrow
                                </button>
                            ) : (
                                <button
                                    disabled
                                    className="px-6 py-3 bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 font-semibold rounded-xl cursor-not-allowed"
                                >
                                    Escrow Locked
                                </button>
                            )}
                            <button className="px-6 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                                Track Shipment
                            </button>
                            <button className="px-6 py-3 border-2 border-accent text-accent font-semibold rounded-xl hover:bg-accent/5 transition-colors flex items-center gap-2">
                                <FileText className="w-4 h-4" />
                                File Dispute
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Help Section */}
            <div className="mt-8 p-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                    About Escrow Protection
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                    Your payment is held in escrow until 15 days after delivery. This
                    protects both buyers and sellers. You can release the escrow early if
                    you're satisfied with the delivery, or file a dispute if there are
                    issues.
                </p>
                <a
                    href="#"
                    className="text-sm font-semibold text-primary hover:underline"
                >
                    Learn more about our escrow system →
                </a>
            </div>
        </div>
    );
}
