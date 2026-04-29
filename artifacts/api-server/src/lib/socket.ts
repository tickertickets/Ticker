import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import { logger } from "./logger";

let io: SocketIOServer | null = null;

export function initSocket(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    path: "/api/socket.io",
    cors: { origin: true, credentials: true },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    logger.debug({ socketId: socket.id }, "Socket connected");

    socket.on("user:join", (userId: string) => {
      if (typeof userId === "string" && userId.length < 128) {
        socket.join(`user:${userId}`);
      }
    });

    socket.on("ticket:join", (ticketId: string) => {
      if (typeof ticketId === "string" && ticketId.length < 128) {
        socket.join(`ticket:${ticketId}`);
      }
    });

    socket.on("ticket:leave", (ticketId: string) => {
      socket.leave(`ticket:${ticketId}`);
    });

    socket.on("disconnect", () => {
      logger.debug({ socketId: socket.id }, "Socket disconnected");
    });
  });

  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

export function emitFeedNew(followerIds: string[], authorUserId: string): void {
  if (!io || followerIds.length === 0) return;
  for (const followerId of followerIds) {
    io.to(`user:${followerId}`).emit("feed:new", { userId: authorUserId });
  }
}

export function emitTicketLiked(ticketId: string, likeCount: number): void {
  io?.to(`ticket:${ticketId}`).emit("ticket:liked", { ticketId, likeCount });
}

export function emitCommentNew(ticketId: string): void {
  io?.to(`ticket:${ticketId}`).emit("comment:new", { ticketId });
}

export function emitCommentDeleted(ticketId: string): void {
  io?.to(`ticket:${ticketId}`).emit("comment:deleted", { ticketId });
}

export function emitNotificationNew(userId: string): void {
  io?.to(`user:${userId}`).emit("notification:new", { userId });
}

/**
 * Notifies the given user(s) that their chat state changed (new message
 * received, conversation marked read, etc) so every device they're
 * viewing on can refresh the chat unread badge + conversations list
 * without waiting for a poll cycle.
 */
export function emitChatChanged(userIds: string[]): void {
  if (!io) return;
  for (const uid of userIds) {
    io.to(`user:${uid}`).emit("chat:changed", { userId: uid });
  }
}

export function emitFollowChanged(opts: { followerId: string; followingId: string }): void {
  if (!io) return;
  const payload = { followerId: opts.followerId, followingId: opts.followingId };
  io.to(`user:${opts.followerId}`).emit("follow:changed", payload);
  io.to(`user:${opts.followingId}`).emit("follow:changed", payload);
}
