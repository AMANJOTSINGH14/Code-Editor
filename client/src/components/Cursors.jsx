import React from "react";
import { getUserColor } from "../utils/colors.js";

/**
 * Display remote cursor users.
 * @param {Object} props - Component props.
 * @param {Array<Object>} props.users - Presence users.
 * @returns {JSX.Element} Cursors list.
 */
export default function Cursors({ users }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs text-slate-400">
      {users.map((user) => (
        <span key={user.socketId} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: getUserColor(user.id) }} />
          {user.name}
        </span>
      ))}
    </div>
  );
}
