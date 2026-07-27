require("dotenv").config();
if (process.env.npm_lifecycle_event === "start") {
  process.env.NODE_ENV = "production";
}

const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");
const {
  validateApiEnvironment,
} = require("./lib/config/runtime-env.cjs");
const {
  configuredOrigins,
  isAllowedRequestOrigin,
  rejectsCookieMutationWithoutOrigin,
} = require("./lib/config/cors.cjs");

function parseCookies(value) {
  return Object.fromEntries(
    String(value || "")
      .split(";")
      .map((item) => {
        const separator = item.indexOf("=");
        if (separator < 0) return ["", ""];
        return [
          item.slice(0, separator).trim(),
          decodeURIComponent(item.slice(separator + 1).trim()),
        ];
      })
      .filter(([key]) => key),
  );
}

validateApiEnvironment();

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4002);
const allowedOrigins = configuredOrigins();
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(async () => {
    const { jwtVerify } = await import("jose");
    const jwtSecret = new TextEncoder().encode(
      process.env.JWT_SECRET || "development-only-secret-change-me",
    );

    const httpServer = createServer((req, res) => {
      const origin = String(req.headers.origin || "").replace(/\/$/, "");
      const originAllowed = isAllowedRequestOrigin(
        origin,
        allowedOrigins,
        req.headers,
      );
      if (
        rejectsCookieMutationWithoutOrigin({
          method: req.method,
          origin,
          cookie: req.headers.cookie,
          path: req.url,
        })
      ) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Origem obrigatória para esta operação" }));
        return;
      }
      if (origin && originAllowed) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Vary", "Origin");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, Idempotency-Key, X-Request-Id, X-Mavo-Agent-Id, X-Mavo-Timestamp, X-Mavo-Nonce, X-Mavo-Signature",
        );
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        );
        res.setHeader("Access-Control-Max-Age", "600");
      }
      if (req.method === "OPTIONS") {
        if (!originAllowed) {
          res.writeHead(403).end();
          return;
        }
        res.writeHead(204).end();
        return;
      }
      if (!originAllowed) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Origem não permitida" }));
        return;
      }
      handle(req, res);
    });

    const io = new Server(httpServer, {
      path: "/socket.io",
      cors: {
        origin: allowedOrigins,
        credentials: true,
        methods: ["GET", "POST"],
      },
      pingInterval: 25_000,
      pingTimeout: 20_000,
      maxHttpBufferSize: 100_000,
    });

    io.use(async (socket, nextSocket) => {
      try {
        const cookieName =
          process.env.SESSION_COOKIE_NAME || "willtalk_session";
        const token = parseCookies(socket.request.headers.cookie)[cookieName];
        if (!token) return nextSocket(new Error("unauthorized"));
        const verified = await jwtVerify(token, jwtSecret, {
          issuer: "mavo-talk",
          audience: "mavo-talk-web",
          algorithms: ["HS256"],
        });
        const organizationId = String(
          verified.payload.organizationId || "",
        ).trim();
        const userId = String(verified.payload.userId || "").trim();
        if (!organizationId || !userId) {
          return nextSocket(new Error("unauthorized"));
        }
        const sessionResponse = await fetch(
          `http://127.0.0.1:${port}/api/me`,
          {
            headers: {
              cookie: socket.request.headers.cookie || "",
            },
            signal: AbortSignal.timeout(5_000),
          },
        );
        const currentSession = await sessionResponse.json().catch(() => null);
        if (
          !sessionResponse.ok ||
          !currentSession?.user ||
          String(currentSession.user.userId || currentSession.user.id) !==
            userId ||
          String(currentSession.user.organizationId) !== organizationId
        ) {
          return nextSocket(new Error("unauthorized"));
        }
        socket.data.organizationId = organizationId;
        socket.data.userId = userId;
        socket.data.userName = String(verified.payload.name || "Atendente").slice(
          0,
          200,
        );
        nextSocket();
      } catch {
        nextSocket(new Error("unauthorized"));
      }
    });

    // No plano gratuito do Render não existe Background Worker, então as filas
    // rodam dentro do próprio processo web.
    let inlineWorkers = null;
    if (String(process.env.MAVO_INLINE_WORKER || "").toLowerCase() === "true") {
      try {
        const { startWorkers } = await import("./worker.mjs");
        inlineWorkers = startWorkers({ standalone: false });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "inline_worker_start_failed",
            message: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    }

    global.__io = io;
    io.on("connection", (socket) => {
      const room = `organization:${socket.data.organizationId}`;
      socket.join(room);
      socket.emit("connected", { ok: true });
      socket.on("typing:start", (data) => {
        const conversationId = String(data?.conversationId || "").slice(0, 200);
        if (!conversationId) return;
        socket.to(room).emit("typing", {
          conversationId,
          userId: socket.data.userId,
          userName: socket.data.userName,
          isTyping: true,
        });
      });
      socket.on("typing:stop", (data) => {
        const conversationId = String(data?.conversationId || "").slice(0, 200);
        if (!conversationId) return;
        socket.to(room).emit("typing", {
          conversationId,
          userId: socket.data.userId,
          userName: socket.data.userName,
          isTyping: false,
        });
      });
    });

    let shuttingDown = false;
    async function shutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(JSON.stringify({ event: "shutdown_started", signal }));
      const deadline = setTimeout(() => {
        console.error(JSON.stringify({ event: "shutdown_timeout" }));
        process.exit(1);
      }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 15_000));
      deadline.unref();
      try {
        await new Promise((resolve) => io.close(resolve));
        if (inlineWorkers) {
          await inlineWorkers.close().catch(() => undefined);
          inlineWorkers = null;
        }
        if (global.__waClient) {
          // Baileys expõe `end`, não o `destroy` do antigo whatsapp-web.js.
          try {
            global.__waClient.end(undefined);
          } catch {
            // O processo já está encerrando; o timeout é o fallback.
          }
          global.__waClient = undefined;
        }
        if (Array.isArray(global.__mavoQueues)) {
          await Promise.all(
            global.__mavoQueues.map((queue) =>
              queue.close().catch(() => undefined),
            ),
          );
        }
        if (global.__mavoRedis) {
          await global.__mavoRedis.quit().catch(() => {
            global.__mavoRedis.disconnect();
          });
          global.__mavoRedis = undefined;
        }
        if (global.__mavoDatabasePool) {
          await global.__mavoDatabasePool.end().catch(() => undefined);
          global.__mavoDatabasePool = undefined;
        }
        await new Promise((resolve) => httpServer.close(resolve));
        clearTimeout(deadline);
        console.log(JSON.stringify({ event: "shutdown_complete", signal }));
        process.exit(0);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "shutdown_failed",
            message: error instanceof Error ? error.message : "unknown",
          }),
        );
        process.exit(1);
      }
    }

    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));

    httpServer
      .once("error", (error) => {
        console.error(error);
        process.exit(1);
      })
      .listen(port, hostname, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
      });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
