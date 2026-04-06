const {
  addParticipant,
  calculateResult,
  deleteParticipantById,
  getOrInitState,
  log,
  removeParticipant,
  saveParticipant,
  upsertParticipantStats,
} = require("../lib/bet-state");
const { getCharacterAvatarUrl, getOathStats } = require("../lib/neople");

const DEFAULT_SYNC_TTL_MS = 5 * 60 * 1000;
const REFRESH_CONCURRENCY = 4;

function isRecentlySynced(participant, ttlMs) {
  const iso = participant?.stats?.lastSyncedAt;
  if (typeof iso !== "string") {
    return false;
  }
  const syncedAt = new Date(iso).getTime();
  if (!Number.isFinite(syncedAt)) {
    return false;
  }
  return Date.now() - syncedAt < ttlMs;
}

async function refreshOne(state, participantId) {
  const participant = state.participants.find((item) => item.id === participantId);
  if (!participant) {
    const error = new Error("Participant not found");
    error.code = "PARTICIPANT_NOT_FOUND";
    throw error;
  }

  const stats = await getOathStats(participant.serverId, participant.characterId);
  const updated = upsertParticipantStats(state, participant.id, {
    ...stats,
    avatarImageUrl: getCharacterAvatarUrl(participant.serverId, participant.characterId),
  });
  await saveParticipant(updated);
}

async function refreshManyWithLimit(state, participantIds, limit) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, participantIds.length || 1)) }, async () => {
    while (cursor < participantIds.length) {
      const index = cursor;
      cursor += 1;
      await refreshOne(state, participantIds[index]);
    }
  });
  await Promise.all(workers);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const action = payload.action;
    const state = await getOrInitState();
    let storageMode = "blob";

    if (action === "add") {
      const participant = addParticipant(state, payload.participant);
      await saveParticipant(participant);
      await refreshOne(state, payload.participant?.serverId + ":" + payload.participant?.characterId);
    } else if (action === "remove") {
      const removed = removeParticipant(state, payload.participantId);
      await deleteParticipantById(removed.id);
    } else if (action === "refresh") {
      if (typeof payload.participantId === "string" && payload.participantId) {
        await refreshOne(state, payload.participantId);
      } else {
        const force = payload.force === true;
        const ttlMs = Number.isFinite(Number(payload.ttlMs))
          ? Math.max(0, Number(payload.ttlMs))
          : DEFAULT_SYNC_TTL_MS;
        const targetIds = state.participants
          .filter((participant) => force || !isRecentlySynced(participant, ttlMs))
          .map((participant) => participant.id);

        await refreshManyWithLimit(state, targetIds, REFRESH_CONCURRENCY);
        log("info", "participants_refresh_summary", {
          force,
          ttlMs,
          total: state.participants.length,
          refreshed: targetIds.length,
          skipped: state.participants.length - targetIds.length,
          concurrency: REFRESH_CONCURRENCY,
        });
      }
    } else {
      res.status(400).json({ error: "Invalid action" });
      return;
    }
    log("info", "participants_api_success", { action, storageMode, participantCount: state.participants.length });
    res.status(200).json(calculateResult(state));
  } catch (error) {
    log("error", "participants_api_failed", {
      error: error.message,
      code: error.code,
      status: error.status,
    });

    if (error.code === "INVALID_PARTICIPANT_PAYLOAD") {
      res.status(400).json({ error: "Invalid participant payload" });
      return;
    }
    if (error.code === "PARTICIPANT_DUPLICATED") {
      res.status(409).json({ error: "Participant already exists" });
      return;
    }
    if (error.code === "PARTICIPANT_NOT_FOUND") {
      res.status(404).json({ error: "Participant not found" });
      return;
    }
    if (error.code === "NEOPLE_API_KEY_MISSING") {
      res.status(500).json({ error: "NEOPLE_API_KEY is missing on server" });
      return;
    }
    if (error.code === "BLOB_ENV_MISSING") {
      res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN is missing on server" });
      return;
    }
    if (error.code === "NEOPLE_REQUEST_FAILED") {
      res.status(error.status || 502).json({
        error: error.message,
        apiCode: error.apiCode || null,
      });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
};
