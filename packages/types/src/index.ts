/**
 * @easy-sales/types
 *
 * Central type package for the Easy Sales Export platform.
 * All domain types are re-exported from here.
 *
 * Import pattern for external consumers:
 *   import type { WaveApplication } from "@easy-sales/types/wave";
 *   import type { Course } from "@easy-sales/types/academy";
 *   import type { User } from "@easy-sales/types";
 */

// Core / Hub types
export * from "./shared";

// Domain types
export * from "./wave";
export * from "./academy";
export * from "./export";
export * from "./farm-nation";
export * from "./cooperative";
export * from "./marketplace";
export * from "./roles";
