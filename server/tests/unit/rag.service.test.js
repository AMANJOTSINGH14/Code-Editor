const { setTestEnv } = require("../testUtils");

setTestEnv();

const {
  estimateTokens,
  splitCodeByBoundary,
  selectRelevantChunk,
  buildReviewPrompt,
  retrieveContext,
  setVectorStoreForTest,
  setEmbeddingsClientForTest
} = require("../../src/services/rag.service");

const mockStore = {
  ensureCollection: async () => ({
    query: async () => ({
      ids: [["chunk-1"]],
      documents: [["Use pagination"]],
      metadatas: [[{ chunkId: "chunk-1" }]],
      distances: [[0.12]]
    })
  })
};

const mockEmbeddings = {
  embedQuery: async () => [0, 0, 0],
  embedDocuments: async (texts) => texts.map(() => [0, 0, 0])
};

beforeEach(() => {
  setVectorStoreForTest(mockStore);
  setEmbeddingsClientForTest(mockEmbeddings);
});

afterEach(() => {
  setVectorStoreForTest(null);
  setEmbeddingsClientForTest(null);
});

test("estimates tokens", () => {
  expect(estimateTokens("abcd")).toBe(1);
});

test("splits code by boundary", () => {
  const code = "function a() {}\nfunction b() {}";
  const chunks = splitCodeByBoundary(code);
  expect(chunks.length).toBe(2);
});

test("selects relevant chunk", () => {
  const chunks = ["foo bar", "pagination cache"];
  const selected = selectRelevantChunk(chunks, "pagination is good");
  expect(selected).toBe("pagination cache");
});

test("builds review prompt", () => {
  const prompt = buildReviewPrompt("context", "code");
  expect(prompt.includes("context")).toBe(true);
  expect(prompt.includes("code")).toBe(true);
});

test("retrieves context from vector store", async () => {
  const chunks = await retrieveContext("query", 1);
  expect(chunks[0].content).toBe("Use pagination");
});
