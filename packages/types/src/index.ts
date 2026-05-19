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
export type * from "./shared";

// Domain types
export type * from "./wave";
export type * from "./academy";
export type * from "./export";
export type * from "./farm-nation";
export type * from "./cooperative";
export type * from "./marketplace";
export type * from "./roles";
