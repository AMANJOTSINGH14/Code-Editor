/* One-off: reset a local user's password using the app's own bcrypt hashing. */
const mongoose = require("mongoose");
const config = require("./src/config");
const User = require("./src/models/User");
const { hashPassword } = require("./src/services/auth.service");

const [email, newPassword] = process.argv.slice(2);

async function main() {
  if (!email || !newPassword) {
    console.error("Usage: node reset-password.js <email> <newPassword>");
    process.exit(1);
  }
  await mongoose.connect(config.mongoUri);
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    console.error(`No user found with email ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  console.log(`Password updated for ${user.email} (${user.name})`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
