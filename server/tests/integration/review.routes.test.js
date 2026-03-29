const request = require("supertest");
const { setTestEnv, connectTestDb, disconnectTestDb, clearTestDb } = require("../testUtils");

setTestEnv();

jest.mock("../../src/services/review.service", () => ({
  runReview: jest.fn().mockResolvedValue({ text: "Review text", notice: "" }),
  streamReview: jest.fn().mockImplementation(async (documentId, userId, res) => {
    res.write(`data: ${JSON.stringify({ text: "Stream" })}\n\n`);
    res.write("event: done\n");
    res.write("data: {}\n\n");
    res.end();
  })
}));

const app = require("../../src/app");
const Document = require("../../src/models/Document");
const { resetRateLimiterForTest } = require("../../src/middleware/rateLimiter");

let agent;
let token;
let documentId;
let userId;

beforeAll(async () => {
  await connectTestDb();
  agent = request.agent(app);

  const registerRes = await agent.post("/api/auth/register").send({
    name: "Owner",
    email: "owner@example.com",
    password: "password123"
  });
  token = registerRes.body.data.accessToken;
  userId = registerRes.body.data.user.id;

  documentId = null;
});

beforeEach(async () => {
  const document = await Document.create({
    title: "Doc",
    language: "javascript",
    roomId: "room-1",
    owner: userId,
    collaborators: [],
    isPublic: false,
    content: Buffer.from([]),
    snapshotText: "Hello"
  });
  documentId = document._id.toString();
});

afterAll(async () => {
  await disconnectTestDb();
});

afterEach(async () => {
  await clearTestDb();
  resetRateLimiterForTest();
});

test("streams review response", async () => {
  const res = await agent
    .get(`/api/review/stream?documentId=${documentId}`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
});

test("rate limiting blocks after threshold", async () => {
  for (let i = 0; i < 10; i += 1) {
    const res = await agent
      .post("/api/review")
      .set("Authorization", `Bearer ${token}`)
      .send({ documentId });
    expect(res.status).toBe(200);
  }

  const blocked = await agent
    .post("/api/review")
    .set("Authorization", `Bearer ${token}`)
    .send({ documentId });

  expect(blocked.status).toBe(429);
});
