const request = require("supertest");
const { setTestEnv, connectTestDb, disconnectTestDb, clearTestDb } = require("../testUtils");

setTestEnv();

const app = require("../../src/app");

let agent;
let token;

beforeAll(async () => {
  await connectTestDb();
  agent = request.agent(app);

  const registerRes = await agent.post("/api/auth/register").send({
    name: "Owner",
    email: "owner@example.com",
    password: "password123"
  });

  token = registerRes.body.data.accessToken;
});

afterAll(async () => {
  await disconnectTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

test("create, update, get, delete document", async () => {
  const createRes = await agent
    .post("/api/documents")
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "Doc", language: "javascript" });

  expect(createRes.status).toBe(201);
  const documentId = createRes.body.data.document.id;

  const updateRes = await agent
    .patch(`/api/documents/${documentId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "Updated" });
  expect(updateRes.status).toBe(200);

  const getRes = await agent
    .get(`/api/documents/${documentId}`)
    .set("Authorization", `Bearer ${token}`);
  expect(getRes.status).toBe(200);

  const deleteRes = await agent
    .delete(`/api/documents/${documentId}`)
    .set("Authorization", `Bearer ${token}`);
  expect(deleteRes.status).toBe(204);
});

test("unauthorized access returns 403", async () => {
  const ownerRes = await agent.post("/api/auth/register").send({
    name: "Owner2",
    email: "owner2@example.com",
    password: "password123"
  });
  const ownerToken = ownerRes.body.data.accessToken;

  const docRes = await agent
    .post("/api/documents")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ title: "Private", language: "javascript" });
  const documentId = docRes.body.data.document.id;

  const otherRes = await agent.post("/api/auth/register").send({
    name: "Other",
    email: "other@example.com",
    password: "password123"
  });
  const otherToken = otherRes.body.data.accessToken;

  const forbiddenRes = await agent
    .get(`/api/documents/${documentId}`)
    .set("Authorization", `Bearer ${otherToken}`);

  expect(forbiddenRes.status).toBe(403);
});
