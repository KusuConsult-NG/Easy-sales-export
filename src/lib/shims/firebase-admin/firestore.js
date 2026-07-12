class GeoPoint {
  constructor(latitude, longitude) {
    this.latitude = latitude;
    this.longitude = longitude;
  }
}

class AggregateField {
  static sum(field) { return new AggregateField(); }
  static count(field) { return new AggregateField(); }
  static average(field) { return new AggregateField(); }
}

const FieldValue = {
  arrayUnion: (...args) => args,
  arrayRemove: (...args) => args,
  serverTimestamp: () => new Date(),
  increment: (val) => val,
  delete: () => null
};

module.exports = {
  GeoPoint,
  AggregateField,
  FieldValue,
  Query: class {},
  Firestore: class {}
};
