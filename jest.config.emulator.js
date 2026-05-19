const nextJest = require('next/jest');

const createJestConfig = nextJest({
    dir: './',
});

const emulatorConfig = {
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    testMatch: ['**/__tests__/integration/**/*.test.ts'],
    setupFilesAfterEnv: ['<rootDir>/jest.emulator.setup.js'],
    testEnvironment: 'node',
    testTimeout: 10000, // 10 seconds for integration tests
};

module.exports = createJestConfig(emulatorConfig);

