const BASELINE_KST = "2026-03-30T12:00:00+09:00";
const BASELINE_MS = new Date(BASELINE_KST).getTime();
const STATE_KEY = "taecho:bet:state:v1";

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
      name: "아이템 획득 내기 (태초서약)",
      baselineKst: BASELINE_KST,
    },
    participants: [
      { id: "priest", name: "이단", count: 0, firstAcquiredAt: null, updatedAt: null },
      { id: "bm", name: "배메", count: 0, firstAcquiredAt: null, updatedAt: null },
      {
        id: "buffer",
        name: "앵콜없는도태버퍼",
        count: 0,
        firstAcquiredAt: null,
        updatedAt: null,
      },
      { id: "hunter", name: "헌터", count: 0, firstAcquiredAt: null, updatedAt: null },
    ],
  };
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

function sanitizeIncomingState(incoming) {
  const fallback = getDefaultState();
  if (!incoming || !Array.isArray(incoming.participants)) {
    return fallback;
  }

  const byId = new Map(incoming.participants.map((participant) => [participant.id, participant]));
  const participants = fallback.participants.map((defaultParticipant) => {
    const fromStore = byId.get(defaultParticipant.id);
    if (!fromStore) {
      return defaultParticipant;
    }
    return {
      ...defaultParticipant,
      count:
        Number.isInteger(fromStore.count) && fromStore.count >= 0
          ? fromStore.count
          : defaultParticipant.count,
      firstAcquiredAt:
        typeof fromStore.firstAcquiredAt === "string" || fromStore.firstAcquiredAt === null
          ? fromStore.firstAcquiredAt
          : null,
      updatedAt:
        typeof fromStore.updatedAt === "string" || fromStore.updatedAt === null
          ? fromStore.updatedAt
          : null,
    };
  });

  return {
    bet: {
      name: fallback.bet.name,
      baselineKst: BASELINE_KST,
    },
    participants,
  };
}

function assertKvEnv() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    const error = new Error("KV environment variables are missing");
    error.code = "KV_ENV_MISSING";
    throw error;
  }

  return { url, token };
}

async function kvRequest(path, options = {}) {
  const { url, token } = assertKvEnv();
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = new Error(payload.error || "KV request failed");
    error.code = "KV_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function readStateFromKv() {
  const result = await kvRequest(`/get/${encodeURIComponent(STATE_KEY)}`);
  if (!result.result) {
    return null;
  }
  try {
    return sanitizeIncomingState(JSON.parse(result.result));
  } catch (_error) {
    log("warn", "invalid_state_payload_in_kv");
    return getDefaultState();
  }
}

async function writeStateToKv(state) {
  const body = JSON.stringify(["SET", STATE_KEY, JSON.stringify(state)]);
  await kvRequest("", { method: "POST", body });
}

async function getOrInitState() {
  const existing = await readStateFromKv();
  if (existing) {
    return existing;
  }
  const initial = getDefaultState();
  await writeStateToKv(initial);
  return initial;
}

function validatePayload(payload) {
  const id = payload?.id;
  const count = payload?.count;
  if (typeof id !== "string" || !Number.isInteger(count) || count < 0) {
    const error = new Error("Invalid payload");
    error.code = "INVALID_PAYLOAD";
    throw error;
  }
  return { id, count };
}

function applyUpdate(state, id, count) {
  const target = state.participants.find((participant) => participant.id === id);
  if (!target) {
    const error = new Error("Participant not found");
    error.code = "NOT_FOUND";
    throw error;
  }

  target.count = count;
  target.updatedAt = new Date().toISOString();

  if (count > 0 && !target.firstAcquiredAt) {
    const now = Date.now();
    if (now < BASELINE_MS) {
      const error = new Error("Baseline time not reached");
      error.code = "BASELINE_NOT_REACHED";
      throw error;
    }
    target.firstAcquiredAt = new Date().toISOString();
  }

  if (count === 0) {
    target.firstAcquiredAt = null;
  }

  return state;
}

module.exports = {
  BASELINE_KST,
  applyUpdate,
  calculateResult,
  getOrInitState,
  log,
  validatePayload,
  writeStateToKv,
};
