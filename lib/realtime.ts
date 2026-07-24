import { Server as IOServer } from "socket.io";

declare global {
  var __io: IOServer | undefined;
}

export function getIO() {
  return global.__io;
}

export function organizationRoom(organizationId: string): string {
  return `organization:${organizationId}`;
}

export function emitRealtime(
  organizationId: string,
  event: string,
  payload: unknown,
) {
  const io = getIO();
  if (io && organizationId) {
    io.to(organizationRoom(organizationId)).emit(event, payload);
  }
}

