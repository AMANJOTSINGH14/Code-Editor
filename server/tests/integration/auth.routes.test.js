const request = require("supertest");
const { setTestEnv, connectTestDb, disconnectTestDb, clearTestDb } = require("../testUtils");

setTestEnv();

const app = require("../../src/app");

let agent;

beforeAll(async () => {
  await connectTestDb();
  agent = request.agent(app);
});

afterAll(async () => {
  await disconnectTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

test("register, login, access protected route, refresh", async () => {
  const registerRes = await agent.post("/api/auth/register").send({
    name: "Tester",
    email: "tester@example.com",
    password: "password123"
  });

  expect(registerRes.status).toBe(201);
  const token = registerRes.body.data.accessToken;

  const protectedRes = await agent
    .get("/api/documents")
    .set("Authorization", `Bearer ${token}`);
  expect(protectedRes.status).toBe(200);

  const loginRes = await agent.post("/api/auth/login").send({
    email: "tester@example.com",
    password: "password123"
  });
  expect(loginRes.status).toBe(200);

  const refreshRes = await agent.post("/api/auth/refresh");
  expect(refreshRes.status).toBe(200);
});
