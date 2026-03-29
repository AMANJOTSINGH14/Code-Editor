const http = require("http");
const { io: Client } = require("socket.io-client");
const Y = require("yjs");
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
let port;
let clientA;
let clientB;

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
  if (clientA) {
    clientA.disconnect();
  }
  if (clientB) {
    clientB.disconnect();
  }
  io.close();
  server.close();
  await disconnectTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

test("sync merges updates between clients", async () => {
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
  clientA = new Client(`http://localhost:${port}`, { auth: { token }, transports: ["websocket"] });
  clientB = new Client(`http://localhost:${port}`, { auth: { token }, transports: ["websocket"] });

  await new Promise((resolve) => {
    let ready = 0;
    const check = () => {
      ready += 1;
      if (ready === 2) {
        resolve();
      }
    };
    clientA.on("connect", check);
    clientB.on("connect", check);
  });

  const joinA = new Promise((resolve) => {
    clientA.on("sync:full", (payload) => {
      if (payload.documentId === document._id.toString()) resolve();
    });
  });
  const joinB = new Promise((resolve) => {
    clientB.on("sync:full", (payload) => {
      if (payload.documentId === document._id.toString()) resolve();
    });
  });

  clientA.emit("room:join", { documentId: document._id.toString() });
  clientB.emit("room:join", { documentId: document._id.toString() });

  await joinA;
  await joinB;

  const updateDoc = new Y.Doc();
  updateDoc.getText("content").insert(0, "Hello");
  const update = Buffer.from(Y.encodeStateAsUpdate(updateDoc)).toString("base64");

  const updateFromA = new Promise((resolve) => {
    clientB.on("sync:update", (payload) => {
      if (payload.documentId === document._id.toString()) {
        resolve(payload.update);
      }
    });
  });

  const updateFromB = new Promise((resolve) => {
    clientA.on("sync:update", (payload) => {
      if (payload.documentId === document._id.toString()) {
        resolve(payload.update);
      }
    });
  });

  clientA.emit("sync:update", { documentId: document._id.toString(), update });

  const updateDocB = new Y.Doc();
  updateDocB.getText("content").insert(0, "World");
  const updateB = Buffer.from(Y.encodeStateAsUpdate(updateDocB)).toString("base64");
  clientB.emit("sync:update", { documentId: document._id.toString(), update: updateB });

  const receivedA = await updateFromA;
  const receivedB = await updateFromB;

  expect(receivedA).toBe(update);
  expect(receivedB).toBe(updateB);
});
