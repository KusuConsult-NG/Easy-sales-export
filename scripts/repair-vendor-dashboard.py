import os
import re

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/vendor-dashboard.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Fix _getVendorSalesStatsAction
content = content.replace('return { success: true as const, error: null, data: null };', 'return { success: true as const, error: null, data: stats };')

# Fix _getVendorRevenueTrendsAction
content = content.replace('return { error: null,  success: true as const, data: null };', 'return { error: null, success: true as const, data: trends };')

# Fix _getTopSellingProductsAction
content = content.replace('return { success: true as const, error: null, data: null };', 'return { success: true as const, error: null, data: products };')

# Fix _getVendorInventoryStatsAction
content = content.replace('return { error: null,  success: true as const, data: null };', 'return { error: null, success: true as const, data: stats };')

# Fix _getVendorActivityFeedAction
content = content.replace('return { error: null,  success: true as const, data: null };', 'return { error: null, success: true as const, data: activities.slice(0, limit) };')

# Fix mangled _getVendorRevenueInsightsAction
mangled_return = """        return { error: null, success: true as const, data: null
            }
        };"""
new_return = """        return { 
            error: null, 
            success: true as const, 
            data: { totalRevenue, pendingPayouts, completedTransactions, averageOrderValue, revenueByCategory } 
        };"""
content = content.replace(mangled_return, new_return)

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired vendor-dashboard.ts")
