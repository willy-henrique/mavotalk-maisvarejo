require("dotenv").config();

const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 4002);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: "*",
    },
  });

  global.__io = io;

  io.on("connection", (socket) => {
    socket.emit("connected", { ok: true });
    socket.on("typing:start", (data) => {
      socket.broadcast.emit("typing", { ...data, isTyping: true });
    });
    socket.on("typing:stop", (data) => {
      socket.broadcast.emit("typing", { ...data, isTyping: false });
    });
  });

  httpServer
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});

