#!/usr/bin/env node
/**
 * Seed the Agent Runner demo tasks.
 *
 *   node scripts/seed-demo.js
 *
 * A thin wrapper. The implementation lives inside the subsystem
 * (server/src/agent-runner/demo/seed-demo.js) so that deleting
 * src/agent-runner/ removes the logic along with everything else, and this file
 * is one of the few strays REMOVAL.md has to mention.
 */
require("../server/src/agent-runner/demo/seed-demo").main().catch((error) => {
  console.error("Seeding failed:", error.message);
  process.exit(1);
});
