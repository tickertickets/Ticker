import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const url: string | undefined = import.meta.env.VITE_API_URL || undefined;
    socket = io(url, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: 8,
    });
  }
  return socket;
}
