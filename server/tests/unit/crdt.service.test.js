const Y = require("yjs");
const mongoose = require("mongoose");
const { setTestEnv, connectTestDb, disconnectTestDb, clearTestDb } = require("../testUtils");

setTestEnv();

const Document = require("../../src/models/Document");
const { getOrCreateRoom, applyUpdate, encodeStateAsUpdate } = require("../../src/services/crdt.service");

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await disconnectTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

test("creates a Yjs document and applies updates", async () => {
  const doc = await Document.create({
    title: "Doc",
    language: "javascript",
    roomId: "room-1",
    owner: new mongoose.Types.ObjectId(),
    collaborators: [],
    isPublic: false,
    content: null,
    snapshotText: ""
  });

  const ydoc = new Y.Doc();
  ydoc.getText("content").insert(0, "Hello");
  const update = Y.encodeStateAsUpdate(ydoc);

  await applyUpdate({ documentId: doc._id.toString(), update, actorId: "user" });

  const mergedUpdate = await encodeStateAsUpdate(doc._id.toString());
  const verifyDoc = new Y.Doc();
  Y.applyUpdate(verifyDoc, mergedUpdate);

  expect(verifyDoc.getText("content").toString()).toBe("Hello");
});

test("merges concurrent edits without loss", async () => {
  const doc = await Document.create({
    title: "Doc",
    language: "javascript",
    roomId: "room-2",
    owner: new mongoose.Types.ObjectId(),
    collaborators: [],
    isPublic: false,
    content: null,
    snapshotText: ""
  });

  const docA = new Y.Doc();
  const docB = new Y.Doc();

  docA.getText("content").insert(0, "Hello");
  docB.getText("content").insert(0, "World");

  const updateA = Y.encodeStateAsUpdate(docA);
  const updateB = Y.encodeStateAsUpdate(docB);

  await applyUpdate({ documentId: doc._id.toString(), update: updateA, actorId: "user" });
  await applyUpdate({ documentId: doc._id.toString(), update: updateB, actorId: "user" });

  const mergedUpdate = await encodeStateAsUpdate(doc._id.toString());
  const verifyDoc = new Y.Doc();
  Y.applyUpdate(verifyDoc, mergedUpdate);
  const text = verifyDoc.getText("content").toString();

  expect(text.includes("Hello")).toBe(true);
  expect(text.includes("World")).toBe(true);
});
