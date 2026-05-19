/**
 * Service Registry / Dependency Injection Layer
 *
 * This registry exports instantiated singletons of the platform services,
 * conformed to their contract interfaces defined in `@easy-sales/services`.
 */

import { UserMetricsService } from "./userMetrics.service";
import { FinanceService } from "./finance.service";
import { CommunicationsService } from "./communications.service";
import { AnalyticsService } from "./analytics.service";

import type {
    UserMetricsServiceContract,
    FinanceServiceContract,
    CommunicationsServiceContract,
    AnalyticsServiceContract
} from "@easy-sales/services";

export const userMetricsService: UserMetricsServiceContract = new UserMetricsService();
export const financeService: FinanceServiceContract = new FinanceService();
export const communicationsService: CommunicationsServiceContract = new CommunicationsService();
export const analyticsService: AnalyticsServiceContract = new AnalyticsService();

// Re-export concrete classes for backward compatibility where direct class references are still needed
export { UserMetricsService } from "./userMetrics.service";
export { FinanceService } from "./finance.service";
export { CommunicationsService } from "./communications.service";
export { AnalyticsService } from "./analytics.service";
