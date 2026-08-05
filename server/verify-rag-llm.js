/* One-off verification: RAG retrieval from Chroma + live Gemini review.
 * Makes exactly 2 Gemini calls: 1 embedContent (query), 1 generateContent.
 */
const { retrieveContext, buildReviewPrompt } = require("./src/services/rag.service");

const SAMPLE_CODE = `
function calculateZebraDiscount(price, user) {
  var discount = 0;
  if (user.type == "premium") {
    discount = price * 0.2;
  }
  try {
    logDiscount(discount);
  } catch (e) {}
  return eval("price - " + discount);
}
`;

const MOCK_SNIPPET = "Code is readable and the intent is clear.";

async function main() {
  console.log("=== STEP 1: retrieveContext (Gemini embed hit #1 + Chroma query) ===");
  const t0 = Date.now();
  const chunks = await retrieveContext(SAMPLE_CODE, 3);
  console.log(`retrieved ${chunks.length} chunks in ${Date.now() - t0}ms`);
  chunks.forEach((c, i) => {
    console.log(`--- chunk ${i + 1}: ${c.chunkId} (distance ${c.score}) ---`);
    console.log(c.content.slice(0, 200).replace(/\n/g, " | "));
  });

  const contextText = chunks.map((c) => c.content).join("\n\n");
  const prompt = buildReviewPrompt(contextText, SAMPLE_CODE);
  console.log(`\nprompt length: ${prompt.length} chars (context portion: ${contextText.length})`);

  console.log("\n=== STEP 2: live Gemini review (generateContent hit #2) ===");
  // Call the same internal path review.service uses, without its mock-fallback
  // timeout, so we see the raw live result.
  const config = require("./src/config");
  const model = config.gemini.model;
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${config.gemini.apiKey}`;
  const t1 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "You are a senior software engineer performing a code review. Be specific and actionable.\n\n" + prompt }] }],
      generationConfig: { temperature: 0.2 }
    })
  });
  console.log(`HTTP ${res.status} from model ${model} in ${Date.now() - t1}ms`);
  if (!res.ok) {
    console.log((await res.text()).slice(0, 500));
    process.exit(1);
  }
  const json = await res.json();
  const text = ((json.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("");
  console.log(`\nresponse length: ${text.length} chars`);
  console.log(`mentions calculateZebraDiscount: ${text.includes("calculateZebraDiscount")}`);
  console.log(`mentions eval: ${/eval/i.test(text)}`);
  console.log(`matches hardcoded mock text: ${text.includes(MOCK_SNIPPET)}`);
  console.log("\n--- first 1500 chars of LLM output ---\n");
  console.log(text.slice(0, 1500));
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
