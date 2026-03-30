const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = path.join(__dirname, "data", "state.json");
const BASELINE_MS = new Date("2026-03-30T12:00:00+09:00").getTime();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function log(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  console.log(JSON.stringify(entry));
}

async function readState() {
  const text = await fsp.readFile(DATA_FILE, "utf-8");
  return JSON.parse(text);
}

let writeQueue = Promise.resolve();
function writeState(state) {
  writeQueue = writeQueue.then(async () => {
    const payload = JSON.stringify(state, null, 2);
    await fsp.writeFile(DATA_FILE, payload, "utf-8");
  });
  return writeQueue;
}

function calculateResult(state) {
  const completed = state.participants.filter((participant) => participant.firstAcquiredAt);
  let loser = null;

  if (completed.length === state.participants.length) {
    loser = [...completed].sort(
      (participantA, participantB) =>
        new Date(participantB.firstAcquiredAt).getTime() -
        new Date(participantA.firstAcquiredAt).getTime()
    )[0];
  }

  return {
    ...state,
    stats: {
      totalParticipants: state.participants.length,
      completedParticipants: completed.length,
      loser: loser
        ? {
            id: loser.id,
            name: loser.name,
            firstAcquiredAt: loser.firstAcquiredAt,
          }
        : null,
    },
  };
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function serveStatic(req, res) {
  const rawPath = req.url === "/" ? "/index.html" : req.url;
  const cleanPath = decodeURIComponent(rawPath.split("?")[0]);
  const filePath = path.join(PUBLIC_DIR, cleanPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  } catch (_error) {
    sendJson(res, 404, { error: "Not found" });
  }
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url.startsWith("/api/state")) {
    try {
      const state = await readState();
      sendJson(res, 200, calculateResult(state));
    } catch (error) {
      log("error", "failed_to_read_state", { error: error.message });
      sendJson(res, 500, { error: "Internal server error" });
    }
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/update")) {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
      if (rawBody.length > 1024 * 1024) {
        req.destroy();
      }
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(rawBody || "{}");
        const { id, count } = payload;

        if (typeof id !== "string" || !Number.isInteger(count) || count < 0) {
          sendJson(res, 400, { error: "Invalid payload" });
          return;
        }

        const state = await readState();
        const target = state.participants.find((participant) => participant.id === id);
        if (!target) {
          sendJson(res, 404, { error: "Participant not found" });
          return;
        }

        target.count = count;
        target.updatedAt = new Date().toISOString();

        if (count > 0 && !target.firstAcquiredAt) {
          const now = Date.now();
          if (now < BASELINE_MS) {
            sendJson(res, 400, {
              error: "Baseline time not reached",
              baselineKst: "2026-03-30T12:00:00+09:00",
            });
            return;
          }
          target.firstAcquiredAt = new Date().toISOString();
        }

        if (count === 0) {
          target.firstAcquiredAt = null;
        }

        await writeState(state);
        log("info", "participant_updated", {
          participantId: id,
          participantName: target.name,
          count: target.count,
          firstAcquiredAt: target.firstAcquiredAt,
        });

        sendJson(res, 200, calculateResult(state));
      } catch (error) {
        log("error", "failed_to_update_state", { error: error.message });
        sendJson(res, 400, { error: "Invalid request body" });
      }
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "Bad request" });
    return;
  }

  if (req.url.startsWith("/api/")) {
    await handleApi(req, res);
    return;
  }

  await serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  log("info", "server_started", { host: HOST, port: PORT });
});
