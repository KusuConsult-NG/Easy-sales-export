"use client";

import { useState } from "react";
import { StatCard } from "@/components/ui/StatCard";
import { LineChartComponent } from "@/components/ui/Chart";
import { formatCurrency } from "@/lib/utils";
import { Filter } from "lucide-react";

export default function DashboardPage() {
  // State for filters
  const [windowFilter, setWindowFilter] = useState("all");

  // Mock data -will be replaced with API calls
  const stats = {
    totalExports: 8,
    totalRevenue: 1250000,
    activeWindows: 3,
    pendingOrders: 2,
  };

  // Revenue trend data for the last 6 months
  const revenueData = [
    { name: "Aug", value: 150000 },
    { name: "Sep", value: 180000 },
    { name: "Oct", value: 220000 },
    { name: "Nov", value: 190000 },
    { name: "Dec", value: 260000 },
    { name: "Jan", value: 250000 },
  ];

  const exportWindows = [
    {
      id: "1",
      commodity: "Yam Tubers",
      phase: "Phase 2 - Harvesting",
      roi: "22% ROI",
      progress: 85,
      daysLeft: 12,
      minInvestment: 50000,
      status: "active",
    },
    {
      id: "2",
      commodity: "Sesame Seeds",
      phase: "Phase 1 - Planting",
      roi: "18% ROI",
      progress: 45,
      daysLeft: 28,
      minInvestment: 25000,
      status: "active",
    },
    {
      id: "3",
      commodity: "Dried Hibiscus",
      phase: "Phase 3 - Completed",
      roi: "20% ROI",
      progress: 100,
      daysLeft: 0,
      minInvestment: 35000,
      status: "completed",
    },
  ];

  // Filter export windows
  const filteredWindows = exportWindows.filter((window) => {
    if (windowFilter === "all") return true;
    return window.status === windowFilter;
  });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
          Member Dashboard
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          Welcome back! Here's your export activity overview.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Total Exports"
          value={stats.totalExports}
          icon="Package"
          subtitle="Lifetime participations"
          delay={0}
        />
        <StatCard
          title="Total Revenue"
          value={formatCurrency(stats.totalRevenue)}
          icon="DollarSign"
          trend={{ value: "+12.5%", isPositive: true }}
          delay={100}
        />
        <StatCard
          title="Active Windows"
          value={stats.activeWindows}
          icon="TrendingUp"
          subtitle="Currently invested"
          delay={200}
        />
        <StatCard
          title="Pending Orders"
          value={stats.pendingOrders}
          icon="ShoppingCart"
          subtitle="Marketplace orders"
          delay={300}
        />
      </div>

      {/* Revenue Trend Chart */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 mb-8 animate-[slideInUp_0.6s_ease-out] opacity-0 [animation-delay:400ms] [animation-fill-mode:forwards]">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
          Revenue Trend
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          Your export revenue over the last 6 months
        </p>
        <LineChartComponent
          data={revenueData}
          dataKey="value"
          xAxisKey="name"
          color="#2E519F"
        />
      </div>

      {/* Export Windows Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
            Export Windows
          </h2>
          <div className="flex items-center gap-3">
            {/* Filter Dropdown */}
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-slate-500" />
              <select
                value={windowFilter}
                onChange={(e) => setWindowFilter(e.target.value)}
                className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Windows</option>
                <option value="active">Active Only</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <a
              href="/export"
              className="text-sm font-semibold text-primary hover:text-primary/80"
            >
              View All →
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredWindows.length > 0 ? (
            filteredWindows.map((window, index) => (
              <div
                key={window.id}
                className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-3 hover-glow animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]"
                style={{ animationDelay: `${500 + index * 100}ms` }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      {window.commodity}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {window.phase}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-bold rounded-full">
                      {window.roi}
                    </span>
                    {window.status === "completed" && (
                      <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold rounded-full">
                        COMPLETED
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-4">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-slate-600 dark:text-slate-400">
                      Funding Progress
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {window.progress}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-blue-600 rounded-full transition-all duration-500"
                      style={{ width: `${window.progress}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Min. Investment
                    </p>
                    <p className="font-bold text-slate-900 dark:text-white">
                      {formatCurrency(window.minInvestment)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Days Remaining
                    </p>
                    <p className="font-bold text-primary">
                      {window.daysLeft || "Completed"}
                    </p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-2 text-center py-12 text-slate-500 dark:text-slate-400">
              No export windows match your filter
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <a
          href="/marketplace"
          className="bg-gradient-to-br from-primary to-blue-700 rounded-2xl p-6 text-white hover:scale-105 transition-transform elevation-3"
        >
          <h3 className="text-lg font-bold mb-2">Browse Marketplace</h3>
          <p className="text-sm text-blue-100">
            Explore premium agricultural commodities
          </p>
        </a>
        <a
          href="/cooperatives"
          className="bg-white dark:bg-slate-800 border-2 border-primary rounded-2xl p-6 hover:bg-primary/5 transition-colors"
        >
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
            My Cooperative
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            View membership and savings
          </p>
        </a>
        <a
          href="/academy"
          className="bg-white dark:bg-slate-800 border-2 border-accent rounded-2xl p-6 hover:bg-accent/5 transition-colors"
        >
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
            Continue Learning
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Resume your export courses
          </p>
        </a>
      </div>
    </div>
  );
}
