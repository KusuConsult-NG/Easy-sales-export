class MockBucket {
  file(path) {
    return {
      save: async () => {},
      delete: async () => {},
      exists: async () => [true]
    };
  }
}

class MockStorage {
  bucket(name) {
    return new MockBucket();
  }
}

module.exports = {
  getStorage: () => new MockStorage()
};
