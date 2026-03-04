import { Server as IOServer } from "socket.io";

declare global {
  var __io: IOServer | undefined;
}

export function getIO() {
  return global.__io;
}

export function emitRealtime(event: string, payload: unknown) {
  const io = getIO();
  if (io) {
    io.emit(event, payload);
  }
}

