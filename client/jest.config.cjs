module.exports = {
  testEnvironment: "jsdom",
  testMatch: ["**/tests/**/*.test.jsx"],
  setupFilesAfterEnv: ["<rootDir>/tests/setupTests.js"],
  moduleNameMapper: {
    "\\.(css|less|scss)$": "identity-obj-proxy"
  },
  transform: {
    "^.+\\.(js|jsx)$": "babel-jest"
  }
};
