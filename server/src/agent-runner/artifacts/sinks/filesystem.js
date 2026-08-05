const fs = require("fs");
const path = require("path");
const config = require("../../config");

/**
 * Filesystem sink — the default, and the system of record.
 *
 * There is no "write" step here: the sandbox writes directly into the run's
 * artifact directory through the bind mount, so by the time a run finishes the
 * files already exist. This module exists to describe and read that location, so
 * the download route and the other sinks share one definition of where
 * artifacts live rather than each recomputing the path.
 */

/**
 * Absolute artifact directory for a run.
 * @param {string} runId - Run id.
 * @returns {string} Directory path.
 */
function dirFor(runId) {
  return path.resolve(config.artifacts.path, runId);
}

/**
 * List artifact filenames for a run.
 * @param {string} runId - Run id.
 * @returns {string[]} Filenames.
 */
function list(runId) {
  try {
    return fs
      .readdirSync(dirFor(runId), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Read one artifact.
 * @param {string} runId - Run id.
 * @param {string} name - Filename.
 * @returns {Buffer} File contents.
 */
function read(runId, name) {
  return fs.readFileSync(path.join(dirFor(runId), name));
}

module.exports = { dirFor, list, read, name: "filesystem" };
