const {
  BASELINE_KST,
  applyUpdate,
  calculateResult,
  getOrInitState,
  log,
  validatePayload,
  writeStateToKv,
} = require("../lib/bet-state");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const rawBody = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
    const { id, count } = validatePayload(rawBody);
    const state = await getOrInitState();
    applyUpdate(state, id, count);
    await writeStateToKv(state);

    log("info", "participant_updated", {
      participantId: id,
      count,
    });

    res.status(200).json(calculateResult(state));
  } catch (error) {
    log("error", "update_api_failed", { error: error.message, code: error.code });

    if (error.code === "INVALID_PAYLOAD") {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }
    if (error.code === "NOT_FOUND") {
      res.status(404).json({ error: "Participant not found" });
      return;
    }
    if (error.code === "BASELINE_NOT_REACHED") {
      res.status(400).json({ error: "Baseline time not reached", baselineKst: BASELINE_KST });
      return;
    }
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
