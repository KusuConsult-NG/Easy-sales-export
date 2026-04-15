"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import {
    TrendingUp, Package, DollarSign, ShoppingCart, AlertCircle,
    Activity, BarChart3, Users, Clock, ArrowUp, ArrowDown
} from "lucide-react";
import {
    getVendorSalesStatsAction,
    getVendorRevenueTrendsAction,
    getTopSellingProductsAction,
    getVendorInventoryStatsAction,
    getVendorRevenueInsightsAction,
    getVendorActivityFeedAction,
} from "@/app/actions/vendor-dashboard";

export default function VendorOverviewPage() {
    const [salesStats, setSalesStats] = useState<any>(null);
    const [revenueTrends, setRevenueTrends] = useState<any[]>([]);
    const [topProducts, setTopProducts] = useState<any[]>([]);
    const [inventoryStats, setInventoryStats] = useState<any>(null);
    const [revenueInsights, setRevenueInsights] = useState<any>(null);
    const [activityFeed, setActivityFeed] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function loadDashboardData() {
            try {
                const [sales, trends, products, inventory, insights, activities] = await Promise.all([
                    getVendorSalesStatsAction(),
                    getVendorRevenueTrendsAction(),
                    getTopSellingProductsAction(5),
                    getVendorInventoryStatsAction(),
                    getVendorRevenueInsightsAction(),
                    getVendorActivityFeedAction(10),
                ]);

                if (sales.success) setSalesStats(sales.stats);
                if (trends.success) setRevenueTrends(trends.trends || []);
                if (products.success) setTopProducts(products.products || []);
                if (inventory.success) setInventoryStats(inventory.stats);
                if (insights.success) setRevenueInsights(insights.insights);
                if (activities.success) setActivityFeed(activities.activities || []);
            } catch (error) {
                logger.error("Dashboard load error:", error);
            } finally {
                setIsLoading(false);
            }
        }

        loadDashboardData();
    }, []);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        Vendor Dashboard
                    </h1>
                    <p className="text-slate-600">
                        Track your sales, inventory, and performance metrics
                    </p>
                </div>

                {/* Sales Statistics Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <StatCard
                        title="Today's Sales"
                        value={`₦${salesStats?.today.revenue.toLocaleString() || 0}`}
                        subtitle={`${salesStats?.today.orders || 0} orders`}
                        icon={DollarSign}
                        color="green"
                    />
                    <StatCard
                        title="This Week"
                        value={`₦${salesStats?.thisWeek.revenue.toLocaleString() || 0}`}
                        subtitle={`${salesStats?.thisWeek.orders || 0} orders`}
                        icon={TrendingUp}
                        color="blue"
                    />
                    <StatCard
                        title="This Month"
                        value={`₦${salesStats?.thisMonth.revenue.toLocaleString() || 0}`}
                        subtitle={`${salesStats?.thisMonth.orders || 0} orders`}
                        icon={BarChart3}
                        color="purple"
                    />
                    <StatCard
                        title="All Time"
                        value={`₦${salesStats?.allTime.revenue.toLocaleString() || 0}`}
                        subtitle={`${salesStats?.allTime.orders || 0} orders`}
                        icon={ShoppingCart}
                        color="indigo"
                    />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                    {/* Revenue Trends Chart */}
                    <div className="lg:col-span-2 bg-white rounded-2xl p-6 shadow-lg">
                        <h2 className="text-xl font-bold text-slate-900 mb-4">
                            Revenue Trends (Last 30 Days)
                        </h2>
                        <div className="h-64 flex items-end justify-between gap-1">
                            {revenueTrends.slice(-15).map((day, index) => {
                                const maxRevenue = Math.max(...revenueTrends.map(d => d.revenue), 1);
                                const height = (day.revenue / maxRevenue) * 100;
                                return (
                                    <div key={index} className="flex-1 flex flex-col items-center group">
                                        <div
                                            className="w-full bg-linear-to-t from-primary to-primary/60 rounded-t transition-all hover:opacity-80 relative"
                                            style={{ height: `${height}%`, minHeight: day.revenue > 0 ? '4px' : '2px' }}
                                        >
                                            <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs py-1 px-2 rounded whitespace-nowrap transition-opacity">
                                                ₦{day.revenue.toLocaleString()}
                                            </div>
                                        </div>
                                        <span className="text-[10px] text-slate-500 mt-2">
                                            {new Date(day.date).getDate()}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Inventory Overview */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <h2 className="text-xl font-bold text-slate-900 mb-4">
                            Inventory Status
                        </h2>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="text-slate-600">Total Products</span>
                                <span className="text-2xl font-bold text-slate-900">
                                    {inventoryStats?.totalProducts || 0}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-slate-600">Active</span>
                                <span className="text-xl font-semibold text-green-600">
                                    {inventoryStats?.activeProducts || 0}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-slate-600">Out of Stock</span>
                                <span className="text-xl font-semibold text-red-600">
                                    {inventoryStats?.outOfStock || 0}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-slate-600">Low Stock</span>
                                <span className="text-xl font-semibold text-amber-600">
                                    {inventoryStats?.lowStock || 0}
                                </span>
                            </div>
                        </div>

                        {inventoryStats?.lowStockProducts?.length > 0 && (
                            <div className="mt-6 pt-6 border-t border-slate-200">
                                <h3 className="text-sm font-semibold text-slate-900 mb-3">
                                    Low Stock Alerts
                                </h3>
                                <div className="space-y-2">
                                    {inventoryStats.lowStockProducts.slice(0, 3).map((product: any) => (
                                        <div key={product.id} className="flex items-center gap-2 text-xs">
                                            <AlertCircle className="w-4 h-4 text-amber-500" />
                                            <span className="text-slate-900 flex-1 truncate">
                                                {product.name}
                                            </span>
                                            <span className="text-amber-600 font-semibold">
                                                {product.stock}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                    {/* Top Selling Products */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <h2 className="text-xl font-bold text-slate-900 mb-4">
                            Top Selling Products
                        </h2>
                        <div className="space-y-3">
                            {topProducts.length > 0 ? (
                                topProducts.map((product, index) => (
                                    <div key={product.productId} className="flex items-center gap-4 p-3 bg-slate-50 rounded-xl">
                                        <div className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center font-bold">
                                            {index + 1}
                                        </div>
                                        <div className="flex-1">
                                            <p className="font-semibold text-slate-900">
                                                {product.productName}
                                            </p>
                                            <p className="text-sm text-slate-600">
                                                {product.totalSold} units sold
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-bold text-green-600">
                                                ₦{product.totalRevenue.toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-slate-500 text-center py-8">No sales data yet</p>
                            )}
                        </div>
                    </div>

                    {/* Revenue Insights */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <h2 className="text-xl font-bold text-slate-900 mb-4">
                            Revenue Insights
                        </h2>
                        <div className="space-y-4">
                            <div className="p-4 bg-green-50 rounded-xl">
                                <p className="text-sm text-green-700 mb-1">Total Revenue</p>
                                <p className="text-2xl font-bold text-green-900">
                                    ₦{revenueInsights?.totalRevenue?.toLocaleString() || 0}
                                </p>
                            </div>
                            <div className="p-4 bg-amber-50 rounded-xl">
                                <p className="text-sm text-amber-700 mb-1">Pending Payouts</p>
                                <p className="text-2xl font-bold text-amber-900">
                                    ₦{revenueInsights?.pendingPayouts?.toLocaleString() || 0}
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm text-slate-600 mb-1">
                                        Completed Transactions
                                    </p>
                                    <p className="text-xl font-bold text-slate-900">
                                        {revenueInsights?.completedTransactions || 0}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm text-slate-600 mb-1">
                                        Avg. Order Value
                                    </p>
                                    <p className="text-xl font-bold text-slate-900">
                                        ₦{revenueInsights?.averageOrderValue?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 0}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Recent Activity Feed */}
                <div className="bg-white rounded-2xl p-6 shadow-lg">
                    <h2 className="text-xl font-bold text-slate-900 mb-4">
                        Recent Activity
                    </h2>
                    <div className="space-y-3">
                        {activityFeed.length > 0 ? (
                            activityFeed.map((activity) => (
                                <div key={activity.id} className="flex items-start gap-4 p-4 bg-slate-50 rounded-xl">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${activity.type === 'order' ? 'bg-blue-100 text-blue-600' :
                                            activity.type === 'stock' ? 'bg-amber-100 text-amber-600' :
                                                activity.type === 'payout' ? 'bg-green-100 text-green-600' :
                                                    'bg-slate-100 text-slate-600'
                                        }`}>
                                        {activity.type === 'order' && <ShoppingCart className="w-5 h-5" />}
                                        {activity.type === 'stock' && <Package className="w-5 h-5" />}
                                        {activity.type === 'payout' && <DollarSign className="w-5 h-5" />}
                                        {activity.type === 'review' && <Users className="w-5 h-5" />}
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-semibold text-slate-900">
                                            {activity.title}
                                        </p>
                                        <p className="text-sm text-slate-600">
                                            {activity.description}
                                        </p>
                                        <p className="text-xs text-slate-500 mt-1">
                                            {new Date(activity.timestamp).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="text-slate-500 text-center py-8">No recent activity</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ title, value, subtitle, icon: Icon, color }: {
    title: string;
    value: string;
    subtitle: string;
    icon: any;
    color: string;
}) {
    const colorClasses = {
        green: 'bg-green-100 text-green-600',
        blue: 'bg-blue-100 text-blue-600',
        purple: 'bg-purple-100 text-purple-600',
        indigo: 'bg-indigo-100 text-indigo-600',
    };

    return (
        <div className="bg-white rounded-2xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-600">
                    {title}
                </h3>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorClasses[color as keyof typeof colorClasses]}`}>
                    <Icon className="w-5 h-5" />
                </div>
            </div>
            <p className="text-2xl font-bold text-slate-900 mb-1">
                {value}
            </p>
            <p className="text-sm text-slate-500">
                {subtitle}
            </p>
        </div>
    );
}
