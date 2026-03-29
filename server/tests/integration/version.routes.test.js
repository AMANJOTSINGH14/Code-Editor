const request = require("supertest");
const { setTestEnv, connectTestDb, disconnectTestDb, clearTestDb } = require("../testUtils");

setTestEnv();

const app = require("../../src/app");
const Document = require("../../src/models/Document");
const Version = require("../../src/models/Version");

let agent;
let token;
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
});

afterAll(async () => {
  await disconnectTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

test("save, list, preview, restore, delete", async () => {
  const document = await Document.create({
    title: "Doc",
    language: "javascript",
    roomId: "room-1",
    owner: userId,
    collaborators: [],
    isPublic: false,
    content: Buffer.from([1]),
    snapshotText: "Hello"
  });

  const saveRes = await agent
    .post(`/api/documents/${document._id}/versions`)
    .set("Authorization", `Bearer ${token}`)
    .send({ label: "v1" });
  expect(saveRes.status).toBe(201);

  const listRes = await agent
    .get(`/api/documents/${document._id}/versions?page=1&limit=20`)
    .set("Authorization", `Bearer ${token}`);
  expect(listRes.status).toBe(200);

  const versionId = listRes.body.data.items[0].id;
  const previewRes = await agent
    .get(`/api/documents/${document._id}/versions/${versionId}`)
    .set("Authorization", `Bearer ${token}`);
  expect(previewRes.status).toBe(200);

  const restoreRes = await agent
    .post(`/api/documents/${document._id}/versions/${versionId}/restore`)
    .set("Authorization", `Bearer ${token}`);
  expect(restoreRes.status).toBe(200);

  const autoSave = await Version.create({
    documentId: document._id,
    versionNumber: 99,
    label: "Auto-save #99",
    content: Buffer.from([2]),
    snapshotText: "Auto",
    createdBy: userId,
    isPublished: false,
    isAutoSave: true
  });

  const deleteRes = await agent
    .delete(`/api/documents/${document._id}/versions/${autoSave._id}`)
    .set("Authorization", `Bearer ${token}`);
  expect(deleteRes.status).toBe(204);

  const published = await Version.findOne({ documentId: document._id, isPublished: true });
  const blockRes = await agent
    .delete(`/api/documents/${document._id}/versions/${published._id}`)
    .set("Authorization", `Bearer ${token}`);
  expect(blockRes.status).toBe(403);
});
