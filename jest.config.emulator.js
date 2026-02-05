const baseConfig = require('./jest.config');

module.exports = {
    ...baseConfig,
    testMatch: ['**/__tests__/integration/**/*.test.ts'],
    setupFilesAfterEnv: ['<rootDir>/jest.emulator.setup.js'],
    testEnvironment: 'node',
    testTimeout: 10000, // 10 seconds for integration tests
};
