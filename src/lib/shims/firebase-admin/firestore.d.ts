export class GeoPoint {
  latitude: number;
  longitude: number;
  constructor(latitude: number, longitude: number);
}
export class AggregateField {
  static sum(field?: string): any;
  static count(field?: string): any;
  static average(field?: string): any;
}
export const FieldValue: any;
export type FieldValue = any;
export class Query {}
export class Firestore {}
export type DocumentData = any;
export type Timestamp = any;

/**
 * THE DECLARATION UNDER-DECLARED ITS OWN IMPLEMENTATION — #328.
 *
 * firestore.js has always exported `getFirestore` and `FieldPath`; this file
 * declared neither. A declaration file that is narrower than the module it
 * describes rejects code that works, which is the harmless direction — but it
 * is the same defect as a declaration that is WIDER than its module, and that
 * direction is what broke scripts/firebase-schema-fix.ts. Both halves of a
 * shim have to agree, or the typechecker is answering about a different module
 * than the one that runs.
 *
 * Kept in step by shim-declarations-match-implementation in
 * maintenance-scripts-are-inside-the-gates.test.ts, which requires every name
 * module.exports carries to be declared here.
 */
export function getFirestore(): any;
export const FieldPath: { documentId(): string };
