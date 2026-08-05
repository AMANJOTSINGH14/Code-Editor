const fs = require("fs");
const path = require("path");
const config = require("../../config");
const logger = require("../../../utils/logger");

/**
 * GitHub pull request sink.
 *
 * Opens a PR containing the run's artifacts and its attempt history. Entirely
 * optional: gated behind AGENT_RUNNER_GITHUB_ENABLED plus a token and repo, and
 * every missing precondition results in a clean skip rather than a failed run.
 * A run's real work is done and persisted before this is ever called.
 */

/**
 * Load Octokit lazily.
 *
 * Required at call time, not module load, so the dependency stays genuinely
 * optional: with the sink disabled — the default — the package is never touched,
 * and if it is not installed at all the sink skips instead of crashing the
 * subsystem at import.
 * @returns {Function|null} Octokit constructor, or null when unavailable.
 */
function loadOctokit() {
  try {
    // eslint-disable-next-line global-require
    return require("@octokit/rest").Octokit;
  } catch {
    return null;
  }
}

/**
 * Whether the sink has everything it needs.
 * @returns {{ready: boolean, reason: string}} Readiness.
 */
function readiness() {
  if (!config.artifacts.github.enabled) return { ready: false, reason: "AGENT_RUNNER_GITHUB_ENABLED is false" };
  if (!config.artifacts.github.token) return { ready: false, reason: "AGENT_RUNNER_GITHUB_TOKEN is not set" };
  if (!config.artifacts.github.repo) return { ready: false, reason: "AGENT_RUNNER_GITHUB_REPO is not set" };
  if (!/^[^/]+\/[^/]+$/.test(config.artifacts.github.repo)) {
    return { ready: false, reason: "AGENT_RUNNER_GITHUB_REPO must be owner/repo" };
  }
  if (!loadOctokit()) return { ready: false, reason: "@octokit/rest is not installed" };
  return { ready: true, reason: "" };
}

/**
 * Build the PR body from the run's attempt history.
 *
 * The attempt history is the interesting part of a self-correcting run, so the
 * PR leads with it rather than with the artifact list.
 * @param {import("mongoose").Document} run - The run.
 * @param {import("mongoose").Document} task - The task.
 * @param {Object[]} artifacts - Artifact metadata.
 * @returns {string} Markdown body.
 */
function buildPrBody(run, task, artifacts) {
  const lines = [
    `Automated run of task **${task.name}** (\`${task.slug}\`).`,
    "",
    `- Run id: \`${run._id}\``,
    `- Status: **${run.status}**`,
    `- Trigger: ${run.triggerSource}`,
    `- Attempts: ${run.attempts.length}`,
    `- Gemini calls: ${run.geminiCalls ? run.geminiCalls.length : 0}`,
    "",
    "## Attempts",
    ""
  ];

  run.attempts.forEach((attempt) => {
    const outcome = attempt.timedOut
      ? "timed out"
      : attempt.exitCode === 0
        ? "succeeded"
        : `failed (exit ${attempt.exitCode})`;
    lines.push(`### Attempt ${attempt.index} — ${outcome}`);
    if (attempt.plan) lines.push("", attempt.plan);
    if (attempt.exitCode !== 0 && attempt.stderr) {
      lines.push("", "<details><summary>stderr</summary>", "", "```", attempt.stderr.slice(0, 2000), "```", "", "</details>");
    }
    lines.push("");
  });

  lines.push("## Artifacts", "");
  artifacts.forEach((artifact) => {
    lines.push(`- \`${artifact.name}\` — ${artifact.sizeBytes} bytes, sha256 \`${artifact.sha256.slice(0, 16)}…\``);
  });

  return lines.join("\n");
}

/**
 * Open a pull request containing the run's artifacts.
 * @param {Object} options - Delivery options.
 * @param {import("mongoose").Document} options.run - The run.
 * @param {import("mongoose").Document} options.task - The task.
 * @param {string} options.runId - Run id.
 * @param {Object[]} options.artifacts - Artifact metadata.
 * @param {string} options.dir - Artifact directory.
 * @returns {Promise<{url: string, number: number}|null>} PR info, or null when skipped.
 */
async function deliver({ run, task, runId, artifacts, dir }) {
  const state = readiness();
  if (!state.ready) {
    logger.info({ message: "GitHub sink skipped", runId, reason: state.reason });
    return null;
  }

  const Octokit = loadOctokit();
  const octokit = new Octokit({ auth: config.artifacts.github.token });
  const [owner, repo] = config.artifacts.github.repo.split("/");
  const baseBranch = config.artifacts.github.baseBranch;
  const branch = `agent-run/${runId}`;

  // Resolve the base branch head to branch from.
  const baseRef = await octokit.git.getRef({ owner, repo, ref: `heads/${baseBranch}` });
  const baseSha = baseRef.data.object.sha;

  await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: baseSha });

  // Blob -> tree -> commit, so all artifacts land in a single commit rather than
  // one commit per file.
  const treeItems = [];
  for (const artifact of artifacts) {
    const content = fs.readFileSync(path.join(dir, artifact.name));
    const blob = await octokit.git.createBlob({
      owner,
      repo,
      content: content.toString("base64"),
      encoding: "base64"
    });
    treeItems.push({
      path: `artifacts/${runId}/${artifact.name}`,
      mode: "100644",
      type: "blob",
      sha: blob.data.sha
    });
  }

  const tree = await octokit.git.createTree({ owner, repo, base_tree: baseSha, tree: treeItems });
  const commit = await octokit.git.createCommit({
    owner,
    repo,
    message: `agent run ${runId}: ${task.name}`,
    tree: tree.data.sha,
    parents: [baseSha]
  });
  await octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.data.sha });

  const pr = await octokit.pulls.create({
    owner,
    repo,
    title: `Agent run: ${task.name}`,
    head: branch,
    base: baseBranch,
    body: buildPrBody(run, task, artifacts)
  });

  logger.info({ message: "GitHub PR opened for run", runId, url: pr.data.html_url });
  return { url: pr.data.html_url, number: pr.data.number };
}

module.exports = { deliver, readiness, buildPrBody, name: "github" };
