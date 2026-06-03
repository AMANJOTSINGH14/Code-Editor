const request = require("supertest");
const { setTestEnv, connectTestDb, disconnectTestDb, clearTestDb } = require("../testUtils");

setTestEnv();

jest.mock("../../src/services/review.service", () => ({
  runReview: jest.fn(),
  streamReview: jest.fn()
}));

const app = require("../../src/app");
const Document = require("../../src/models/Document");
const User = require("../../src/models/User");
const ReviewHistory = require("../../src/models/ReviewHistory");
const { resetRateLimiterForTest } = require("../../src/middleware/rateLimiter");
const { runReview, streamReview } = require("../../src/services/review.service");

let agent;
let token;
let userId;
let documentId;

beforeAll(async () => {
  await connectTestDb();
  agent = request.agent(app);

  const registerRes = await agent.post("/api/auth/register").send({
    name: "Reviewer",
    email: "reviewer@test.com",
    password: "password123"
  });
  token = registerRes.body.data.accessToken;
  userId = registerRes.body.data.user.id;
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  const doc = await Document.create({
    title: "Review Test Doc",
    language: "javascript",
    roomId: "review-room-1",
    owner: userId,
    collaborators: [],
    isPublic: false,
    content: Buffer.from([1]),
    snapshotText: "const x = 1;"
  });
  documentId = doc._id.toString();

  // Default mock implementations
  runReview.mockResolvedValue({ text: "Review text", notice: "" });
  streamReview.mockImplementation(async (docId, uid, res) => {
    res.write(`data: ${JSON.stringify({ text: "Stream chunk" })}\n\n`);
    res.write("event: done\n");
    res.write("data: {}\n\n");
    res.end();
  });
});

afterEach(async () => {
  await clearTestDb();

  // Re-create the user for next test since clearTestDb wipes everything
  const registerRes = await agent.post("/api/auth/register").send({
    name: "Reviewer",
    email: "reviewer@test.com",
    password: "password123"
  });
  token = registerRes.body.data.accessToken;
  userId = registerRes.body.data.user.id;

  resetRateLimiterForTest();
  jest.clearAllMocks();
});

// ── POST /api/review (non-streaming) ──

describe("POST /api/review", () => {
  test("returns 200 with review text", async () => {
    const res = await agent
      .post("/api/review")
      .set("Authorization", `Bearer ${token}`)
      .send({ documentId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.text).toBe("Review text");
    expect(res.body.data.notice).toBe("");
  });

  test("returns 400 when documentId is missing", async () => {
    const res = await agent
      .post("/api/review")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test("returns 400 for empty documentId", async () => {
    const res = await agent
      .post("/api/review")
      .set("Authorization", `Bearer ${token}`)
      .send({ documentId: "" });

    expect(res.status).toBe(400);
  });

  test("returns 401 without auth token", async () => {
    const res = await agent
      .post("/api/review")
      .send({ documentId });

    expect(res.status).toBe(401);
  });

  test("returns 401 with invalid auth token", async () => {
    const res = await agent
      .post("/api/review")
      .set("Authorization", "Bearer invalid-token-here")
      .send({ documentId });

    expect(res.status).toBe(401);
  });

  test("returns notice for large files", async () => {
    runReview.mockResolvedValue({
      text: "Partial review",
      notice: "Large file — reviewing the most relevant section."
    });

    const res = await agent
      .post("/api/review")
      .set("Authorization", `Bearer ${token}`)
      .send({ documentId });

    expect(res.status).toBe(200);
    expect(res.body.data.notice).toContain("Large file");
  });

  test("passes documentId and userId to runReview", async () => {
    await agent
      .post("/api/review")
      .set("Authorization", `Bearer ${token}`)
      .send({ documentId });

    expect(runReview).toHaveBeenCalledWith(documentId, userId);
  });

  test("returns 500 when runReview throws", async () => {
    runReview.mockRejectedValue(new Error("Model crashed"));

    const res = await agent
      .post("/api/review")
      .set("Authorization", `Bearer ${token}`)
      .send({ documentId });

    expect(res.status).toBe(500);
  });
});

// ── GET /api/review/stream (SSE) ──

describe("GET /api/review/stream", () => {
  test("returns 200 with SSE content type", async () => {
    const res = await agent
      .get(`/api/review/stream?documentId=${documentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
  });

  test("streams review data", async () => {
    const res = await agent
      .get(`/api/review/stream?documentId=${documentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.text).toContain("Stream chunk");
    expect(res.text).toContain("event: done");
  });

  test("returns 401 without auth", async () => {
    const res = await agent
      .get(`/api/review/stream?documentId=${documentId}`);

    expect(res.status).toBe(401);
  });

  test("handles stream with notice event", async () => {
    streamReview.mockImplementation(async (docId, uid, res) => {
      res.write(`event: notice\ndata: ${JSON.stringify({ notice: "Large file" })}\n\n`);
      res.write(`data: ${JSON.stringify({ text: "Review text" })}\n\n`);
      res.write("event: done\ndata: {}\n\n");
      res.end();
    });

    const res = await agent
      .get(`/api/review/stream?documentId=${documentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("event: notice");
    expect(res.text).toContain("Large file");
  });

  test("handles stream with error event", async () => {
    streamReview.mockImplementation(async (docId, uid, res) => {
      res.write(`event: error\ndata: ${JSON.stringify({ message: "API failed" })}\n\n`);
      res.end();
    });

    const res = await agent
      .get(`/api/review/stream?documentId=${documentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("API failed");
  });

  test("handles empty code (nothing to review)", async () => {
    streamReview.mockImplementation(async (docId, uid, res) => {
      res.write(`data: ${JSON.stringify({ text: "Nothing to review yet." })}\n\n`);
      res.write("event: done\ndata: {}\n\n");
      res.end();
    });

    const res = await agent
      .get(`/api/review/stream?documentId=${documentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.text).toContain("Nothing to review");
  });
});

// ── Rate Limiting ──

describe("Rate limiting", () => {
  test("allows requests up to the limit", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await agent
        .post("/api/review")
        .set("Authorization", `Bearer ${token}`)
        .send({ documentId });
      expect(res.status).toBe(200);
    }
  });

  test("blocks after threshold with 429", async () => {
    for (let i = 0; i < 10; i++) {
      await agent
        .post("/api/review")
        .set("Authorization", `Bearer ${token}`)
        .send({ documentId });
    }

    const res = await agent
      .post("/api/review")
      .set("Authorization", `Bearer ${token}`)
      .send({ documentId });

    expect(res.status).toBe(429);
  });

  test("rate limit applies to streaming endpoint too", async () => {
    for (let i = 0; i < 10; i++) {
      await agent
        .get(`/api/review/stream?documentId=${documentId}`)
        .set("Authorization", `Bearer ${token}`);
    }

    const res = await agent
      .get(`/api/review/stream?documentId=${documentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(429);
  });

  test("rate limit is per-user (different users have separate limits)", async () => {
    // Exhaust limit for first user
    for (let i = 0; i < 10; i++) {
      await agent
        .post("/api/review")
        .set("Authorization", `Bearer ${token}`)
        .send({ documentId });
    }

    // Create second user
    const agent2 = request.agent(app);
    const reg2 = await agent2.post("/api/auth/register").send({
      name: "User2",
      email: "user2@test.com",
      password: "password123"
    });
    const token2 = reg2.body.data.accessToken;

    // Make the doc public so user2 can access it
    await Document.updateOne({ _id: documentId }, { isPublic: true });

    // Second user should still be allowed
    const res = await agent2
      .post("/api/review")
      .set("Authorization", `Bearer ${token2}`)
      .send({ documentId });

    expect(res.status).toBe(200);
  });

  test("429 response has error message", async () => {
    for (let i = 0; i < 10; i++) {
      await agent
        .post("/api/review")
        .set("Authorization", `Bearer ${token}`)
        .send({ documentId });
    }

    const res = await agent
      .post("/api/review")
      .set("Authorization", `Bearer ${token}`)
      .send({ documentId });

    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
  });
});

// ── GET /api/review/history ──

describe("GET /api/review/history", () => {
  test("returns empty list when no reviews exist", async () => {
    const res = await agent
      .get(`/api/review/history?documentId=${documentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.reviews).toEqual([]);
  });

  test("returns review history with correct fields", async () => {
    await ReviewHistory.create({
      documentId,
      userId,
      reviewText: "Looks good!",
      model: "gemini-2.0-flash",
      notice: "",
      contextChunks: [{ chunkId: "c1", content: "Best practice", score: 0.9 }]
    });

    const res = await agent
      .get(`/api/review/history?documentId=${documentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.reviews).toHaveLength(1);

    const review = res.body.data.reviews[0];
    expect(review.reviewText).toBe("Looks good!");
    expect(review.model).toBe("gemini-2.0-flash");
    expect(review.documentId).toBe(documentId);
    expect(review.userId).toBe(userId);
    expect(review.contextChunks).toHaveLength(1);
    expect(review.id).toBeDefined();
    expect(review.createdAt).toBeDefined();
  });

  test("returns reviews sorted by newest first", async () => {
    await ReviewHistory.create({
      documentId,
      userId,
      reviewText: "First review",
      model: "gemini-2.0-flash",
      createdAt: new Date("2025-01-01")
    });
    await ReviewHistory.create({
      documentId,
      userId,
      reviewText: "Second review",
      model: "gemini-2.0-flash",
      createdAt: new Date("2025-06-01")
    });

    const res = await agent
      .get(`/api/review/history?documentId=${documentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.data.reviews[0].reviewText).toBe("Second review");
    expect(res.body.data.reviews[1].reviewText).toBe("First review");
  });

  test("limits history to 20 entries", async () => {
    const promises = [];
    for (let i = 0; i < 25; i++) {
      promises.push(
        ReviewHistory.create({
          documentId,
          userId,
          reviewText: `Review #${i}`,
          model: "gemini-2.0-flash"
        })
      );
    }
    await Promise.all(promises);

    const res = await agent
      .get(`/api/review/history?documentId=${documentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.data.reviews).toHaveLength(20);
  });

  test("returns 400 when documentId is missing", async () => {
    const res = await agent
      .get("/api/review/history")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  test("returns 401 without auth", async () => {
    const res = await agent
      .get(`/api/review/history?documentId=${documentId}`);

    expect(res.status).toBe(401);
  });

  test("returns 403 for document user cannot access", async () => {
    const otherAgent = request.agent(app);
    const otherReg = await otherAgent.post("/api/auth/register").send({
      name: "Stranger",
      email: "stranger@test.com",
      password: "password123"
    });
    const otherToken = otherReg.body.data.accessToken;

    const res = await otherAgent
      .get(`/api/review/history?documentId=${documentId}`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  test("only returns reviews for the requesting user", async () => {
    // Create review for owner
    await ReviewHistory.create({
      documentId,
      userId,
      reviewText: "Owner review",
      model: "gemini-2.0-flash"
    });

    // Make doc public and create another user's review
    await Document.updateOne({ _id: documentId }, { isPublic: true });
    const otherAgent = request.agent(app);
    const otherReg = await otherAgent.post("/api/auth/register").send({
      name: "Other",
      email: "other@test.com",
      password: "password123"
    });
    const otherToken = otherReg.body.data.accessToken;
    const otherUserId = otherReg.body.data.user.id;

    await ReviewHistory.create({
      documentId,
      userId: otherUserId,
      reviewText: "Other user review",
      model: "gemini-2.0-flash"
    });

    // Owner should only see their own review
    const res = await agent
      .get(`/api/review/history?documentId=${documentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.data.reviews).toHaveLength(1);
    expect(res.body.data.reviews[0].reviewText).toBe("Owner review");
  });
});

// ── ReviewHistory Model ──

describe("ReviewHistory model", () => {
  test("toSummary returns correct shape", async () => {
    const review = await ReviewHistory.create({
      documentId,
      userId,
      reviewText: "Test review",
      model: "gemini-2.0-flash",
      notice: "Large file",
      contextChunks: [
        { chunkId: "c1", content: "chunk content", score: 0.85 }
      ]
    });

    const summary = review.toSummary();
    expect(summary.id).toBe(review._id.toString());
    expect(summary.documentId).toBe(documentId);
    expect(summary.userId).toBe(userId);
    expect(summary.reviewText).toBe("Test review");
    expect(summary.model).toBe("gemini-2.0-flash");
    expect(summary.notice).toBe("Large file");
    expect(summary.contextChunks).toHaveLength(1);
    expect(summary.createdAt).toBeDefined();
  });

  test("requires documentId, userId, reviewText, model", async () => {
    await expect(ReviewHistory.create({})).rejects.toThrow();
    await expect(ReviewHistory.create({ documentId })).rejects.toThrow();
    await expect(ReviewHistory.create({ documentId, userId })).rejects.toThrow();
    await expect(
      ReviewHistory.create({ documentId, userId, reviewText: "x" })
    ).rejects.toThrow();
  });

  test("defaults notice to empty string", async () => {
    const review = await ReviewHistory.create({
      documentId,
      userId,
      reviewText: "Test",
      model: "test-model"
    });
    expect(review.notice).toBe("");
  });

  test("defaults contextChunks to empty array", async () => {
    const review = await ReviewHistory.create({
      documentId,
      userId,
      reviewText: "Test",
      model: "test-model"
    });
    expect(review.contextChunks).toEqual([]);
  });
});
