const { calculateResult, getOrInitState, log } = require("../lib/bet-state");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const state = await getOrInitState();
    res.status(200).json(calculateResult(state));
  } catch (error) {
    log("error", "state_api_failed", { error: error.message, code: error.code });
    if (error.code === "KV_ENV_MISSING") {
      res.status(500).json({
        error: "KV environment variables are missing",
        required: ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
      });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
};
