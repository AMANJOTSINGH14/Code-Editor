const jwt = require("jsonwebtoken");
const { setTestEnv, connectTestDb, disconnectTestDb, clearTestDb } = require("../testUtils");

setTestEnv();

const {
  hashPassword,
  comparePassword,
  signAccessToken,
  verifyAccessToken
} = require("../../src/services/auth.service");
const User = require("../../src/models/User");

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await disconnectTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

test("hashes and verifies password", async () => {
  const hash = await hashPassword("password123");
  const match = await comparePassword("password123", hash);
  expect(match).toBe(true);
});

test("signs and verifies access token", async () => {
  const user = await User.create({
    name: "Test",
    email: "test@example.com",
    passwordHash: "hash"
  });
  const token = signAccessToken({ id: user._id.toString(), name: "Test", email: "test@example.com" });
  const payload = verifyAccessToken(token);
  expect(payload.email).toBe("test@example.com");
});

test("expired token throws", async () => {
  const token = jwt.sign({ id: "123" }, process.env.JWT_ACCESS_SECRET, { expiresIn: "1ms" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(() => verifyAccessToken(token)).toThrow();
});
