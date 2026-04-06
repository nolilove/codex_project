const { calculateResult, getOrInitState, log } = require("../lib/bet-state");
const { SERVER_LABELS } = require("../lib/neople");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const state = await getOrInitState();
    log("info", "state_loaded");
    res.status(200).json({
      ...calculateResult(state),
      meta: {
        baselineKst: state.bet.baselineKst,
        servers: SERVER_LABELS,
      },
    });
  } catch (error) {
    log("error", "state_api_failed", { error: error.message, code: error.code });
    if (error.code === "BLOB_ENV_MISSING") {
      res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN is missing on server" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
};
