module.exports = {
  getMessaging: () => ({
    send: async () => "mock-message-id",
    sendEachForMulticast: async () => ({ successCount: 1, failureCount: 0, responses: [] })
  })
};
