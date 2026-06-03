const { setTestEnv } = require("../testUtils");

setTestEnv();

const {
  estimateTokens,
  splitCodeByBoundary,
  selectRelevantChunk,
  buildReviewPrompt,
  retrieveContext,
  setVectorStoreForTest
} = require("../../src/services/rag.service");

afterEach(() => {
  setVectorStoreForTest(null);
});

// ── estimateTokens edge cases ──

describe("estimateTokens", () => {
  test("returns 0 for null input", () => {
    expect(estimateTokens(null)).toBe(0);
  });

  test("returns 0 for undefined input", () => {
    expect(estimateTokens(undefined)).toBe(0);
  });

  test("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("returns 1 for very short string (1-4 chars)", () => {
    expect(estimateTokens("ab")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
  });

  test("returns correct estimate for long string", () => {
    const text = "a".repeat(4000);
    expect(estimateTokens(text)).toBe(1000);
  });

  test("rounds up partial tokens", () => {
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("abcdefg")).toBe(2);
  });

  test("handles single character", () => {
    expect(estimateTokens("a")).toBe(1);
  });
});

// ── splitCodeByBoundary edge cases ──

describe("splitCodeByBoundary", () => {
  test("returns single chunk for code without boundaries", () => {
    const code = "console.log('hello');\nconsole.log('world');";
    const chunks = splitCodeByBoundary(code);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("hello");
    expect(chunks[0]).toContain("world");
  });

  test("returns empty array for empty string", () => {
    const chunks = splitCodeByBoundary("");
    expect(chunks.length).toBe(0);
  });

  test("returns empty array for whitespace only", () => {
    const chunks = splitCodeByBoundary("   \n   \n   ");
    expect(chunks.length).toBe(0);
  });

  test("splits on function declarations", () => {
    const code = "function a() { return 1; }\nfunction b() { return 2; }";
    const chunks = splitCodeByBoundary(code);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("function a");
    expect(chunks[1]).toContain("function b");
  });

  test("splits on class declarations", () => {
    const code = "class Foo {\n  bar() {}\n}\nclass Baz {\n  qux() {}\n}";
    const chunks = splitCodeByBoundary(code);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("class Foo");
    expect(chunks[1]).toContain("class Baz");
  });

  test("splits on const/let/var declarations", () => {
    const code = "const a = 1;\nlet b = 2;\nvar c = 3;";
    const chunks = splitCodeByBoundary(code);
    expect(chunks.length).toBe(3);
  });

  test("splits on export declarations", () => {
    const code = "export function foo() {}\nexport class Bar {}";
    const chunks = splitCodeByBoundary(code);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("export function foo");
    expect(chunks[1]).toContain("export class Bar");
  });

  test("keeps leading non-boundary lines with first chunk", () => {
    const code = "// header comment\nimport x from 'y';\nfunction main() {}";
    const chunks = splitCodeByBoundary(code);
    // function is a boundary, so it splits into 2: [comments+import, function]
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("// header comment");
    expect(chunks[0]).toContain("import x");
    expect(chunks[1]).toContain("function main");
  });

  test("handles multiline functions with body", () => {
    const code = [
      "function processData(input) {",
      "  const result = input.map(x => x * 2);",
      "  return result.filter(x => x > 5);",
      "}",
      "function formatOutput(data) {",
      "  return JSON.stringify(data, null, 2);",
      "}"
    ].join("\n");
    const chunks = splitCodeByBoundary(code);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("processData");
    expect(chunks[0]).toContain("result.filter");
    expect(chunks[1]).toContain("formatOutput");
  });

  test("handles code with only one boundary at the start", () => {
    const code = "function single() {\n  return true;\n}";
    const chunks = splitCodeByBoundary(code);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("function single");
  });
});

// ── selectRelevantChunk edge cases ──

describe("selectRelevantChunk", () => {
  test("returns empty string for empty chunks array", () => {
    expect(selectRelevantChunk([], "some context")).toBe("");
  });

  test("returns the only chunk when array has one element", () => {
    expect(selectRelevantChunk(["only chunk"], "irrelevant context")).toBe("only chunk");
  });

  test("selects chunk with highest keyword overlap", () => {
    const chunks = [
      "function handleAuth() { validateToken(); }",
      "function cacheData() { redis.set(); pagination(); }",
      "function renderUI() { createElement(); }"
    ];
    const context = "redis caching pagination performance optimization";
    const result = selectRelevantChunk(chunks, context);
    expect(result).toContain("cacheData");
  });

  test("ignores short context words (3 or fewer chars)", () => {
    const chunks = ["the cat sat on the mat", "big dog ran fast"];
    const context = "the cat is a big dog";
    const result = selectRelevantChunk(chunks, context);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("handles empty context text", () => {
    const chunks = ["chunk one", "chunk two"];
    const result = selectRelevantChunk(chunks, "");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("handles context with special characters", () => {
    const chunks = ["func() { return 1; }", "class Foo {}"];
    const context = "func() { return!!! special @#$ chars }";
    const result = selectRelevantChunk(chunks, context);
    expect(typeof result).toBe("string");
  });

  test("handles identical chunks", () => {
    const chunks = ["duplicate code", "duplicate code"];
    const result = selectRelevantChunk(chunks, "duplicate code here");
    expect(result).toBe("duplicate code");
  });

  test("frequency weighting picks repeated keywords", () => {
    const chunks = [
      "function validate(input) { check(input); }",
      "function transform(data) { map(data); }"
    ];
    const context = "validate validate validate input input checking validation";
    const result = selectRelevantChunk(chunks, context);
    expect(result).toContain("validate");
  });
});

// ── buildReviewPrompt edge cases ──

describe("buildReviewPrompt", () => {
  test("includes context when provided", () => {
    const prompt = buildReviewPrompt("Use async/await", "const x = 1;");
    expect(prompt).toContain("Use async/await");
    expect(prompt).toContain("best-practices context");
    expect(prompt).toContain("const x = 1;");
  });

  test("skips context section when empty string", () => {
    const prompt = buildReviewPrompt("", "const x = 1;");
    expect(prompt).not.toContain("best-practices context");
    expect(prompt).toContain("const x = 1;");
  });

  test("skips context section when whitespace only", () => {
    const prompt = buildReviewPrompt("   ", "code here");
    expect(prompt).not.toContain("best-practices context");
    expect(prompt).toContain("code here");
  });

  test("wraps code in fenced code block", () => {
    const prompt = buildReviewPrompt("", "function test() {}");
    expect(prompt).toContain("```\nfunction test() {}\n```");
  });

  test("handles multiline code", () => {
    const code = "line1\nline2\nline3";
    const prompt = buildReviewPrompt("", code);
    expect(prompt).toContain("line1\nline2\nline3");
  });

  test("handles null/undefined context gracefully", () => {
    const prompt = buildReviewPrompt(null, "code");
    expect(prompt).not.toContain("best-practices");
    expect(prompt).toContain("code");
  });

  test("includes review instructions", () => {
    const prompt = buildReviewPrompt("", "x = 1");
    expect(prompt).toContain("bugs");
    expect(prompt).toContain("security");
    expect(prompt).toContain("performance");
  });
});

// ── retrieveContext edge cases ──

describe("retrieveContext", () => {
  test("returns empty array when vector store is null", async () => {
    setVectorStoreForTest(null);
    const result = await retrieveContext("query");
    expect(result).toEqual([]);
  });

  test("returns mapped results from vector store", async () => {
    const mockStore = {
      similaritySearchWithScore: async () => [
        [{ pageContent: "Content A", metadata: { chunkId: "id-a" } }, 0.95],
        [{ pageContent: "Content B", metadata: { chunkId: "id-b" } }, 0.80]
      ]
    };
    setVectorStoreForTest(mockStore);

    const result = await retrieveContext("query", 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ chunkId: "id-a", content: "Content A", score: 0.95 });
    expect(result[1]).toEqual({ chunkId: "id-b", content: "Content B", score: 0.80 });
  });

  test("uses default topK of 3", async () => {
    let capturedTopK;
    const mockStore = {
      similaritySearchWithScore: async (query, topK) => {
        capturedTopK = topK;
        return [];
      }
    };
    setVectorStoreForTest(mockStore);

    await retrieveContext("query");
    expect(capturedTopK).toBe(3);
  });

  test("returns empty array when vector store throws", async () => {
    const mockStore = {
      similaritySearchWithScore: async () => {
        throw new Error("ChromaDB connection failed");
      }
    };
    setVectorStoreForTest(mockStore);

    const result = await retrieveContext("query");
    expect(result).toEqual([]);
  });

  test("generates fallback chunkId when metadata missing", async () => {
    const mockStore = {
      similaritySearchWithScore: async () => [
        [{ pageContent: "No metadata chunk", metadata: {} }, 0.5]
      ]
    };
    setVectorStoreForTest(mockStore);

    const result = await retrieveContext("query");
    expect(result[0].chunkId).toBe("chunk-0");
    expect(result[0].content).toBe("No metadata chunk");
  });

  test("handles empty results from vector store", async () => {
    const mockStore = {
      similaritySearchWithScore: async () => []
    };
    setVectorStoreForTest(mockStore);

    const result = await retrieveContext("query");
    expect(result).toEqual([]);
  });

  test("passes query string to vector store", async () => {
    let capturedQuery;
    const mockStore = {
      similaritySearchWithScore: async (query) => {
        capturedQuery = query;
        return [];
      }
    };
    setVectorStoreForTest(mockStore);

    await retrieveContext("function handleLogin() {}");
    expect(capturedQuery).toBe("function handleLogin() {}");
  });
});
