const { log } = require("../lib/bet-state");
const { searchCharacters } = require("../lib/neople");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const mode = req.query?.mode === "adventure" ? "adventure" : "server";
    const serverId = typeof req.query?.serverId === "string" ? req.query.serverId : "all";
    const keyword = typeof req.query?.keyword === "string" ? req.query.keyword : "";
    const limit = Number.isFinite(Number(req.query?.limit)) ? Number(req.query.limit) : 20;

    const rows = await searchCharacters({ mode, serverId, keyword, limit });
    res.status(200).json({ rows });
  } catch (error) {
    log("error", "search_api_failed", { error: error.message, code: error.code, status: error.status });
    if (error.code === "NEOPLE_API_KEY_MISSING") {
      res.status(500).json({ error: "NEOPLE_API_KEY is missing on server" });
      return;
    }
    if (error.code === "NEOPLE_REQUEST_FAILED") {
      res.status(error.status || 502).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
};
