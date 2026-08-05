/* One-off: inspect real version ordering for the most recently updated document. */
const mongoose = require("mongoose");
const config = require("./src/config");
const Version = require("./src/models/Version");
const Document = require("./src/models/Document");

async function main() {
  await mongoose.connect(config.mongoUri);

  const docs = await Document.find({}).sort({ updatedAt: -1 }).limit(3);
  for (const doc of docs) {
    console.log(`\n=== Document "${doc.title}" (${doc._id}) ===`);
    const versions = await Version.find({ documentId: doc._id })
      .sort({ createdAt: -1 })
      .limit(10);
    versions.forEach((v, i) => {
      console.log(
        `${i + 1}. #${v.versionNumber} "${v.label}" createdAt=${v.createdAt ? v.createdAt.toISOString() : "MISSING"} published=${v.isPublished}`
      );
    });
    if (!versions.length) console.log("(no versions)");
  }

  const missing = await Version.countDocuments({ createdAt: { $exists: false } });
  console.log(`\nversions with NO createdAt field: ${missing}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
