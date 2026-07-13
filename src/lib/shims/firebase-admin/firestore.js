try {
  global.WebSocket = require('ws');
} catch (e) {}

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseServiceKey || supabaseAnonKey || 'placeholder',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  }
);

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
  arrayUnion: (...args) => {
    // Return a transform sentinel
    return { _methodName: 'FieldValue.arrayUnion', _elements: args };
  },
  arrayRemove: (...args) => {
    return { _methodName: 'FieldValue.arrayRemove', _elements: args };
  },
  serverTimestamp: () => new Date().toISOString(),
  increment: (val) => {
    return { _methodName: 'FieldValue.increment', _operand: val };
  },
  delete: () => {
    return { _methodName: 'FieldValue.delete' };
  }
};

class DocumentSnapshot {
  constructor(id, data, exists = true) {
    this.id = id;
    this._data = data;
    this.exists = exists;
  }
  data() {
    return this._data;
  }
  get ref() {
    return new DocumentReference(null, this.id);
  }
}

class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.empty = docs.length === 0;
  }
}

class DocumentReference {
  constructor(collectionName, id) {
    this.collectionName = collectionName;
    this.id = id;
  }

  async get() {
    if (this.collectionName === 'users') {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', this.id);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        return new DocumentSnapshot(this.id, null, false);
      }
      const raw = data[0].raw_data || {};
      raw.id = this.id;
      raw.email = data[0].email;
      raw.roles = data[0].roles;
      return new DocumentSnapshot(this.id, raw, true);
    } else {
      const { data, error } = await supabase
        .from('document_collections')
        .select('*')
        .eq('collection_name', this.collectionName)
        .eq('id', this.id);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        return new DocumentSnapshot(this.id, null, false);
      }
      const raw = data[0].raw_data || {};
      raw.id = this.id;
      return new DocumentSnapshot(this.id, raw, true);
    }
  }

  async set(payload, options = {}) {
    const isMerge = options.merge === true;
    let existing = {};
    if (isMerge) {
      const snap = await this.get();
      if (snap.exists) {
        existing = snap.data();
      }
    }

    const merged = { ...existing };
    for (const [k, v] of Object.entries(payload)) {
      if (v && v._methodName === 'FieldValue.arrayUnion') {
        const arr = Array.isArray(merged[k]) ? [...merged[k]] : [];
        for (const el of v._elements) {
          if (!arr.includes(el)) arr.push(el);
        }
        merged[k] = arr;
      } else if (v && v._methodName === 'FieldValue.arrayRemove') {
        const arr = Array.isArray(merged[k]) ? [...merged[k]] : [];
        merged[k] = arr.filter(el => !v._elements.includes(el));
      } else if (v && v._methodName === 'FieldValue.increment') {
        merged[k] = (typeof merged[k] === 'number' ? merged[k] : 0) + v._operand;
      } else if (v && v._methodName === 'FieldValue.delete') {
        delete merged[k];
      } else if (v instanceof Date) {
        merged[k] = v.toISOString();
      } else {
        merged[k] = v;
      }
    }

    // Write to Supabase
    if (this.collectionName === 'users') {
      const row = {
        id: this.id,
        email: merged.email ? merged.email.toLowerCase() : null,
        roles: merged.roles || [],
        raw_data: merged,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('users').upsert(row);
      if (error) throw new Error(error.message);
    } else {
      const row = {
        id: this.id,
        collection_name: this.collectionName,
        raw_data: merged,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('document_collections').upsert(row);
      if (error) throw new Error(error.message);
    }
  }

  async update(payload) {
    return this.set(payload, { merge: true });
  }

  async delete() {
    if (this.collectionName === 'users') {
      const { error } = await supabase.from('users').delete().eq('id', this.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from('document_collections')
        .delete()
        .eq('collection_name', this.collectionName)
        .eq('id', this.id);
      if (error) throw new Error(error.message);
    }
  }
}

class Query {
  constructor(collectionName, filters = []) {
    this.collectionName = collectionName;
    this.filters = filters;
  }

  where(field, op, value) {
    return new Query(this.collectionName, [...this.filters, { field, op, value }]);
  }

  async get() {
    let rawDocs = [];
    if (this.collectionName === 'users') {
      const { data, error } = await supabase.from('users').select('*');
      if (error) throw new Error(error.message);
      rawDocs = (data || []).map(row => {
        const raw = row.raw_data || {};
        raw.id = row.id;
        raw.email = row.email;
        raw.roles = row.roles;
        return new DocumentSnapshot(row.id, raw, true);
      });
    } else {
      const { data, error } = await supabase
        .from('document_collections')
        .select('*')
        .eq('collection_name', this.collectionName);
      if (error) throw new Error(error.message);
      rawDocs = (data || []).map(row => {
        const raw = row.raw_data || {};
        raw.id = row.id;
        return new DocumentSnapshot(row.id, raw, true);
      });
    }

    // Filter in-memory
    let filtered = rawDocs;
    for (const f of this.filters) {
      filtered = filtered.filter(doc => {
        const data = doc.data() || {};
        const val = data[f.field];
        if (f.op === '==') return val === f.value;
        if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(val);
        return true;
      });
    }

    return new QuerySnapshot(filtered);
  }
}

class CollectionReference extends Query {
  constructor(name) {
    super(name);
  }
  doc(id) {
    return new DocumentReference(this.collectionName, id);
  }
}

class WriteBatch {
  constructor() {
    this.operations = [];
  }
  delete(ref) {
    this.operations.push({ type: 'delete', ref });
  }
  async commit() {
    for (const op of this.operations) {
      if (op.type === 'delete') {
        await op.ref.delete();
      }
    }
  }
}

class MockFirestore {
  collection(name) {
    return new CollectionReference(name);
  }
  doc(path) {
    const parts = path.split('/');
    if (parts.length % 2 !== 0) throw new Error("Invalid document path: " + path);
    const colName = parts.slice(0, -1).join('/');
    const docId = parts[parts.length - 1];
    return new DocumentReference(colName, docId);
  }
  batch() {
    return new WriteBatch();
  }
}

const firestoreInstance = new MockFirestore();

module.exports = {
  GeoPoint,
  AggregateField,
  FieldValue,
  Query,
  Firestore: MockFirestore,
  getFirestore: () => firestoreInstance,
  FieldPath: {
    documentId: () => 'id'
  }
};
