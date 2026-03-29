import React from "react";
import { getInitials, getUserColor } from "../utils/colors.js";

/**
 * Presence bar showing online collaborators.
 * @param {Object} props - Component props.
 * @param {Array<Object>} props.users - Presence users.
 * @returns {JSX.Element} Presence bar.
 */
export default function PresenceBar({ users }) {
  if (!users || users.length === 0) {
    return (
      <div className="text-xs text-slate-500">No collaborators</div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {users.slice(0, 5).map((user) => (
        <div
          key={user.socketId || user.id}
          title={user.name}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ background: getUserColor(user.id) }}
        >
          {getInitials(user.name)}
        </div>
      ))}
      {users.length > 5 && (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-[10px] text-slate-300">
          +{users.length - 5}
        </div>
      )}
      <span className="ml-1 text-xs text-slate-400">{users.length} online</span>
    </div>
  );
}
