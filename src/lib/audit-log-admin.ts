import { 
    createAuditLog, 
    logFinancialAction, 
    logAdminAction,
    AuditLogEntry
} from './audit-log';

// Re-export createAuditLog as createAdminAuditLog for backward compatibility
// with existing call sites, since audit-log.ts now safely uses Admin SDK.
export const createAdminAuditLog = createAuditLog;

// Re-export common helpers
export { logFinancialAction as logAdminFinancialAction, logAdminAction };
export type { AuditLogEntry };
