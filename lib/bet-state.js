const { del, list, put } = require("@vercel/blob");

const BASELINE_KST = "2026-03-30T12:00:00+09:00";
const BASELINE_MS = new Date(BASELINE_KST).getTime();
const PARTICIPANT_PREFIX = "state/participants/";

function log(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  console.log(JSON.stringify(entry));
}

function getDefaultState() {
  return {
    bet: {
      name: "태초서약 선제 획득 내기",
      baselineKst: BASELINE_KST,
      loserRule: "가장 늦게 태초서약을 최초 획득한 1명이 나머지 3명에게 기프티콘 지급",
    },
    participants: [],
  };
}

function isValidIsoDate(value) {
  if (value === null) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  return Number.isFinite(new Date(value).getTime());
}

function participantPathById(participantId) {
  return `${PARTICIPANT_PREFIX}${encodeURIComponent(participantId)}.json`;
}

function sanitizeParticipant(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const participant = {
    id: typeof raw.id === "string" ? raw.id : null,
    serverId: typeof raw.serverId === "string" ? raw.serverId : null,
    characterId: typeof raw.characterId === "string" ? raw.characterId : null,
    characterName: typeof raw.characterName === "string" ? raw.characterName : null,
    adventureName: typeof raw.adventureName === "string" ? raw.adventureName : "",
    avatarImageUrl: typeof raw.avatarImageUrl === "string" ? raw.avatarImageUrl : "",
    addedAt: isValidIsoDate(raw.addedAt) ? raw.addedAt : new Date().toISOString(),
    stats: {
      oathCountTotal: Number.isInteger(raw?.stats?.oathCountTotal)
        ? Math.max(raw.stats.oathCountTotal, 0)
        : 0,
      oathCrystalCountTotal: Number.isInteger(raw?.stats?.oathCrystalCountTotal)
        ? Math.max(raw.stats.oathCrystalCountTotal, 0)
        : 0,
      oathCountAfterBaseline: Number.isInteger(raw?.stats?.oathCountAfterBaseline)
        ? Math.max(raw.stats.oathCountAfterBaseline, 0)
        : 0,
      oathCrystalCountAfterBaseline: Number.isInteger(raw?.stats?.oathCrystalCountAfterBaseline)
        ? Math.max(raw.stats.oathCrystalCountAfterBaseline, 0)
        : 0,
      firstOathAcquiredAtAfterBaseline: isValidIsoDate(raw?.stats?.firstOathAcquiredAtAfterBaseline)
        ? raw.stats.firstOathAcquiredAtAfterBaseline
        : null,
      lastSyncedAt: isValidIsoDate(raw?.stats?.lastSyncedAt) ? raw.stats.lastSyncedAt : null,
      timeline: Array.isArray(raw?.stats?.timeline)
        ? raw.stats.timeline
            .filter((event) => event && typeof event === "object")
            .map((event) => ({
              date: typeof event.date === "string" ? event.date : "",
              itemName: typeof event.itemName === "string" ? event.itemName : "",
              code: typeof event.code === "number" ? event.code : null,
            }))
            .filter((event) => event.date && event.itemName)
            .slice(0, 100)
        : [],
    },
  };

  if (!participant.serverId || !participant.characterId || !participant.characterName) {
    return null;
  }
  if (!participant.id) {
    participant.id = `${participant.serverId}:${participant.characterId}`;
  }
  return participant;
}

function sanitizeIncomingState(input) {
  const fallback = getDefaultState();
  if (!input || typeof input !== "object") {
    return fallback;
  }
  const sourceParticipants = Array.isArray(input.participants) ? input.participants : [];
  const participants = sourceParticipants.map((p) => sanitizeParticipant(p)).filter(Boolean);
  return {
    bet: fallback.bet,
    participants,
  };
}

function sanitizeLegacyParticipant(raw) {
  const normalized = sanitizeParticipant(raw);
  if (normalized) {
    return normalized;
  }

  if (
    raw &&
    typeof raw === "object" &&
    typeof raw.serverId === "string" &&
    typeof raw.characterId === "string" &&
    typeof raw.characterName === "string"
  ) {
    return sanitizeParticipant({
      id: typeof raw.id === "string" ? raw.id : `${raw.serverId}:${raw.characterId}`,
      serverId: raw.serverId,
      characterId: raw.characterId,
      characterName: raw.characterName,
      adventureName: typeof raw.adventureName === "string" ? raw.adventureName : "",
      avatarImageUrl: typeof raw.avatarImageUrl === "string" ? raw.avatarImageUrl : "",
      addedAt: isValidIsoDate(raw.addedAt) ? raw.addedAt : new Date().toISOString(),
      stats: raw.stats || {},
    });
  }

  return null;
}

function calculateResult(state) {
  const completed = state.participants.filter(
    (participant) => participant.stats.firstOathAcquiredAtAfterBaseline
  );
  let loser = null;

  if (state.participants.length > 0 && completed.length === state.participants.length) {
    loser = [...completed].sort(
      (a, b) =>
        new Date(b.stats.firstOathAcquiredAtAfterBaseline).getTime() -
        new Date(a.stats.firstOathAcquiredAtAfterBaseline).getTime()
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
            characterName: loser.characterName,
            serverId: loser.serverId,
            firstOathAcquiredAt: loser.stats.firstOathAcquiredAtAfterBaseline,
          }
        : null,
    },
  };
}

function assertBlobEnv() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    const error = new Error("BLOB_READ_WRITE_TOKEN is missing");
    error.code = "BLOB_ENV_MISSING";
    throw error;
  }
  return { token };
}

async function listAllParticipantBlobs(token) {
  const blobs = [];
  let cursor = undefined;

  while (true) {
    const response = await list({
      prefix: PARTICIPANT_PREFIX,
      cursor,
      token,
      limit: 1000,
    });
    if (Array.isArray(response.blobs)) {
      blobs.push(...response.blobs);
    }
    if (!response.hasMore || !response.cursor) {
      break;
    }
    cursor = response.cursor;
  }

  return blobs;
}

async function readParticipantBlob(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    log("warn", "participant_blob_read_failed", { url, status: response.status });
    return null;
  }

  const text = await response.text();
  try {
    return sanitizeParticipant(JSON.parse(text));
  } catch (_error) {
    log("warn", "participant_blob_parse_failed", { url });
    return null;
  }
}

async function readLegacyStateParticipants(token) {
  const response = await list({
    prefix: "state/",
    token,
    limit: 1000,
  });

  const blobs = Array.isArray(response.blobs) ? response.blobs : [];
  const stateBlobs = blobs.filter((blob) => !blob.pathname.startsWith(PARTICIPANT_PREFIX));
  if (stateBlobs.length === 0) {
    return [];
  }

  const parsed = await Promise.all(
    stateBlobs.map(async (blob) => {
      const res = await fetch(blob.url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        return [];
      }
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (!Array.isArray(json?.participants)) {
          return [];
        }
        return json.participants.map((p) => sanitizeLegacyParticipant(p)).filter(Boolean);
      } catch (_error) {
        return [];
      }
    })
  );

  const byId = new Map();
  for (const row of parsed.flat()) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function getOrInitState() {
  const { token } = assertBlobEnv();
  const blobs = await listAllParticipantBlobs(token);
  const participants = blobs.length
    ? (
    await Promise.all(blobs.map((blob) => readParticipantBlob(blob.url, token)))
      ).filter(Boolean)
    : [];

  if (participants.length > 0) {
    return sanitizeIncomingState({
      ...getDefaultState(),
      participants,
    });
  }

  const legacyParticipants = await readLegacyStateParticipants(token);
  if (legacyParticipants.length === 0) {
    return getDefaultState();
  }

  return sanitizeIncomingState({
    ...getDefaultState(),
    participants: legacyParticipants,
  });
}

async function saveParticipant(participant) {
  const { token } = assertBlobEnv();
  const path = participantPathById(participant.id);
  await put(path, JSON.stringify(participant), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    token,
  });
}

async function deleteParticipantById(participantId) {
  const { token } = assertBlobEnv();
  const pathname = participantPathById(participantId);
  await del(pathname, { token });
}

function validateParticipantIdentity(payload) {
  const serverId = payload?.serverId;
  const characterId = payload?.characterId;
  const characterName = payload?.characterName;
  const adventureName = payload?.adventureName;

  if (
    typeof serverId !== "string" ||
    typeof characterId !== "string" ||
    typeof characterName !== "string"
  ) {
    const error = new Error("Invalid participant payload");
    error.code = "INVALID_PARTICIPANT_PAYLOAD";
    throw error;
  }

  return {
    id: `${serverId}:${characterId}`,
    serverId,
    characterId,
    characterName,
    adventureName: typeof adventureName === "string" ? adventureName : "",
    avatarImageUrl: typeof payload?.avatarImageUrl === "string" ? payload.avatarImageUrl : "",
  };
}

function addParticipant(state, payload) {
  const identity = validateParticipantIdentity(payload);
  const exists = state.participants.some((participant) => participant.id === identity.id);
  if (exists) {
    const error = new Error("Participant already exists");
    error.code = "PARTICIPANT_DUPLICATED";
    throw error;
  }

  const participant = {
    ...identity,
    addedAt: new Date().toISOString(),
    stats: {
      oathCountTotal: 0,
      oathCrystalCountTotal: 0,
      oathCountAfterBaseline: 0,
      oathCrystalCountAfterBaseline: 0,
      firstOathAcquiredAtAfterBaseline: null,
      lastSyncedAt: null,
      timeline: [],
    },
  };
  state.participants.push(participant);
  return participant;
}

function removeParticipant(state, participantId) {
  if (typeof participantId !== "string") {
    const error = new Error("Invalid participant id");
    error.code = "INVALID_PARTICIPANT_ID";
    throw error;
  }

  const index = state.participants.findIndex((participant) => participant.id === participantId);
  if (index < 0) {
    const error = new Error("Participant not found");
    error.code = "PARTICIPANT_NOT_FOUND";
    throw error;
  }

  const [removed] = state.participants.splice(index, 1);
  return removed;
}

function upsertParticipantStats(state, participantId, stats) {
  const target = state.participants.find((participant) => participant.id === participantId);
  if (!target) {
    const error = new Error("Participant not found");
    error.code = "PARTICIPANT_NOT_FOUND";
    throw error;
  }

  target.stats = {
    oathCountTotal: Number.isInteger(stats.oathCountTotal) ? Math.max(stats.oathCountTotal, 0) : 0,
    oathCrystalCountTotal: Number.isInteger(stats.oathCrystalCountTotal)
      ? Math.max(stats.oathCrystalCountTotal, 0)
      : 0,
    oathCountAfterBaseline: Number.isInteger(stats.oathCountAfterBaseline)
      ? Math.max(stats.oathCountAfterBaseline, 0)
      : 0,
    oathCrystalCountAfterBaseline: Number.isInteger(stats.oathCrystalCountAfterBaseline)
      ? Math.max(stats.oathCrystalCountAfterBaseline, 0)
      : 0,
    firstOathAcquiredAtAfterBaseline: isValidIsoDate(stats.firstOathAcquiredAtAfterBaseline)
      ? stats.firstOathAcquiredAtAfterBaseline
      : null,
    lastSyncedAt: new Date().toISOString(),
    timeline: Array.isArray(stats.timeline) ? stats.timeline.slice(0, 100) : [],
  };

  if (typeof stats.adventureName === "string") {
    target.adventureName = stats.adventureName;
  }
  if (typeof stats.avatarImageUrl === "string") {
    target.avatarImageUrl = stats.avatarImageUrl;
  }

  return target;
}

module.exports = {
  BASELINE_KST,
  BASELINE_MS,
  addParticipant,
  calculateResult,
  deleteParticipantById,
  getOrInitState,
  log,
  removeParticipant,
  saveParticipant,
  upsertParticipantStats,
};
