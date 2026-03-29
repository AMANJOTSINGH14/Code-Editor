const { setTestEnv, connectTestDb, disconnectTestDb, clearTestDb } = require("../testUtils");

setTestEnv();

const User = require("../../src/models/User");
const {
  createDocument,
  getDocumentById,
  updateDocument,
  deleteDocument
} = require("../../src/services/document.service");
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

test("creates and reads document", async () => {
  const user = await User.create({
    name: "Owner",
    email: "owner@example.com",
    passwordHash: "hash"
  });

  const document = await createDocument({
    title: "Doc",
    language: "javascript",
    ownerId: user._id.toString(),
    isPublic: false
  });

  const fetched = await getDocumentById(document._id.toString(), user._id.toString());
  expect(fetched.title).toBe("Doc");
});

test("prevents unauthorized access", async () => {
  const owner = await User.create({
    name: "Owner",
    email: "owner2@example.com",
    passwordHash: "hash"
  });
  const other = await User.create({
    name: "Other",
    email: "other@example.com",
    passwordHash: "hash"
  });

  const document = await createDocument({
    title: "Private",
    language: "javascript",
    ownerId: owner._id.toString(),
    isPublic: false
  });

  await expect(getDocumentById(document._id.toString(), other._id.toString())).rejects.toBeInstanceOf(AppError);
});

test("updates document metadata", async () => {
  const user = await User.create({
    name: "Owner",
    email: "owner3@example.com",
    passwordHash: "hash"
  });

  const document = await createDocument({
    title: "Doc",
    language: "javascript",
    ownerId: user._id.toString(),
    isPublic: false
  });

  const updated = await updateDocument(document._id.toString(), user._id.toString(), {
    title: "New Title"
  });
  expect(updated.title).toBe("New Title");
});

test("deletes document", async () => {
  const user = await User.create({
    name: "Owner",
    email: "owner4@example.com",
    passwordHash: "hash"
  });

  const document = await createDocument({
    title: "Doc",
    language: "javascript",
    ownerId: user._id.toString(),
    isPublic: false
  });

  await deleteDocument(document._id.toString(), user._id.toString());
  await expect(getDocumentById(document._id.toString(), user._id.toString())).rejects.toBeInstanceOf(AppError);
});

test("invalid id throws", async () => {
  await expect(getDocumentById("not-an-id", "user"))
    .rejects
    .toBeInstanceOf(AppError);
});
