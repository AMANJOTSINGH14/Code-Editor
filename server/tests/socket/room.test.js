const http = require("http");
const { io: Client } = require("socket.io-client");
const { setTestEnv, connectTestDb, disconnectTestDb, clearTestDb } = require("../testUtils");

setTestEnv();

const app = require("../../src/app");
const { initSocketServer } = require("../../src/config/socket");
const { registerSocketHandlers } = require("../../src/socket");
const User = require("../../src/models/User");
const Document = require("../../src/models/Document");
const { signAccessToken } = require("../../src/services/auth.service");

let server;
let io;
let client;
let port;

beforeAll(async () => {
  await connectTestDb();
  server = http.createServer(app);
  io = initSocketServer(server);
  registerSocketHandlers(io);
  await new Promise((resolve) => {
    server.listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (client) {
    client.disconnect();
  }
  io.close();
  server.close();
  await disconnectTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

test("join and leave room updates presence", async () => {
  const user = await User.create({
    name: "Tester",
    email: "tester@example.com",
    passwordHash: "hash"
  });

  const document = await Document.create({
    title: "Doc",
    language: "javascript",
    roomId: "room-1",
    owner: user._id,
    collaborators: [],
    isPublic: true,
    content: null,
    snapshotText: ""
  });

  const token = signAccessToken({ id: user._id.toString(), name: user.name, email: user.email });
  client = new Client(`http://localhost:${port}`, {
    auth: { token },
    transports: ["websocket"]
  });

  const presencePromise = new Promise((resolve) => {
    client.on("presence:update", (payload) => {
      if (payload.documentId === document._id.toString()) {
        resolve(payload.users);
      }
    });
  });

  client.emit("room:join", { documentId: document._id.toString() });
  const users = await presencePromise;

  expect(users.length).toBeGreaterThan(0);

  client.emit("room:leave", { documentId: document._id.toString() });
});
