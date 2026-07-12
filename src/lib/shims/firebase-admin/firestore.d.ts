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
