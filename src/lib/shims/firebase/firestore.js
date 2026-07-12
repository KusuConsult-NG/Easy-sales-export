const db = require('../../supabase-client-db');

module.exports = {
  ...db,
  addDoc: async (collectionRef, data) => ({ id: "mock-id" }),
  updateDoc: async (docRef, data) => ({})
};
