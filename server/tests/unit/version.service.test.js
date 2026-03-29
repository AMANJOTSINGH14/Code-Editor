const { setTestEnv, connectTestDb, disconnectTestDb, clearTestDb } = require("../testUtils");

setTestEnv();
process.env.AUTO_SAVE_LIMIT = "3";

const mongoose = require("mongoose");
const Document = require("../../src/models/Document");
const Version = require("../../src/models/Version");
const User = require("../../src/models/User");
const {
  createAutoSaveVersion,
  createPublishedVersion,
  listVersions,
  restoreVersion,
  deleteVersion
} = require("../../src/services/version.service");
const AppError = require("../../src/utils/AppError");

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await disconnectTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

async function createTestUser() {
  return User.create({
    name: "Test User",
    email: `test-${Date.now()}@example.com`,
    passwordHash: "hashed"
  });
}

test("creates published version", async () => {
  const user = await createTestUser();
  const document = await Document.create({
    title: "Doc",
    language: "javascript",
    roomId: `room-${Date.now()}-1`,
    owner: user._id,
    collaborators: [],
    isPublic: false,
    content: Buffer.from([]),
    snapshotText: "Hello"
  });

  const version = await createPublishedVersion({
    documentId: document._id.toString(),
    label: "v1",
    userId: user._id.toString()
  });

  expect(version.isPublished).toBe(true);
  expect(version.label).toBe("v1");
});

test("auto-save cleanup caps at limit", async () => {
  const user = await createTestUser();
  const document = await Document.create({
    title: "Doc",
    language: "javascript",
    roomId: `room-${Date.now()}-2`,
    owner: user._id,
    collaborators: [],
    isPublic: false,
    content: Buffer.from([]),
    snapshotText: ""
  });

  for (let i = 0; i < 5; i += 1) {
    await createAutoSaveVersion({
      documentId: document._id.toString(),
      content: Buffer.from([i]),
      snapshotText: `snapshot-${i}`,
      userId: user._id.toString()
    });
  }

  const autoSaves = await Version.find({ documentId: document._id.toString(), isAutoSave: true });
  expect(autoSaves.length).toBeLessThanOrEqual(3);
});

test("restore creates backup and updates document", async () => {
  const user = await createTestUser();
  const document = await Document.create({
    title: "Doc",
    language: "javascript",
    roomId: `room-${Date.now()}-3`,
    owner: user._id,
    collaborators: [],
    isPublic: false,
    content: Buffer.from([1]),
    snapshotText: "Current"
  });

  const version = await Version.create({
    documentId: document._id,
    versionNumber: 1,
    label: "v1",
    content: Buffer.from([2]),
    snapshotText: "Restored",
    createdBy: user._id,
    isPublished: true,
    isAutoSave: false
  });

  const result = await restoreVersion({
    documentId: document._id.toString(),
    versionId: version._id.toString(),
    userId: user._id.toString()
  });

  const updated = await Document.findById(document._id);
  expect(updated.snapshotText).toBe("Restored");
  expect(result.backup.label).toContain("Restored from");
});

test("delete blocks published versions", async () => {
  const user = await createTestUser();
  const document = await Document.create({
    title: "Doc",
    language: "javascript",
    roomId: `room-${Date.now()}-4`,
    owner: user._id,
    collaborators: [],
    isPublic: false,
    content: Buffer.from([1]),
    snapshotText: "Current"
  });

  const version = await Version.create({
    documentId: document._id,
    versionNumber: 1,
    label: "v1",
    content: Buffer.from([2]),
    snapshotText: "Restored",
    createdBy: user._id,
    isPublished: true,
    isAutoSave: false
  });

  await expect(
    deleteVersion({
      documentId: document._id.toString(),
      versionId: version._id.toString(),
      userId: user._id.toString()
    })
  ).rejects.toBeInstanceOf(AppError);
});

test("list versions paginated", async () => {
  const user = await createTestUser();
  const document = await Document.create({
    title: "Doc",
    language: "javascript",
    roomId: `room-${Date.now()}-5`,
    owner: user._id,
    collaborators: [],
    isPublic: false,
    content: Buffer.from([1]),
    snapshotText: "Current"
  });

  await Version.create({
    documentId: document._id,
    versionNumber: 1,
    label: "v1",
    content: Buffer.from([2]),
    snapshotText: "Restored",
    createdBy: user._id,
    isPublished: true,
    isAutoSave: false
  });

  const result = await listVersions({
    documentId: document._id.toString(),
    userId: user._id.toString(),
    page: 1,
    limit: 20
  });

  expect(result.items.length).toBe(1);
  expect(result.items[0].label).toBe("v1");
});
