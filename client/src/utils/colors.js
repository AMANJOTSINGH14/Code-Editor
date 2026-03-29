/**
 * Create a numeric hash from a string.
 * @param {string} input - Input string.
 * @returns {number} Hash value.
 */
export function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Get a deterministic color for a user id.
 * @param {string} userId - User id.
 * @returns {string} HSL color.
 */
export function getUserColor(userId) {
  const hue = hashString(userId) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

/**
 * Get initials for a user name.
 * @param {string} name - User name.
 * @returns {string} Initials.
 */
export function getInitials(name) {
  if (!name) {
    return "?";
  }
  const parts = name.trim().split(/\s+/);
  const first = parts[0] || "";
  const second = parts[1] || "";
  return `${first[0] || ""}${second[0] || ""}`.toUpperCase();
}
