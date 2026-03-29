import { useSocketContext } from "../context/SocketContext.jsx";

/**
 * Hook wrapper for socket context.
 * @returns {Object} Socket context.
 */
export function useSocket() {
  return useSocketContext();
}
