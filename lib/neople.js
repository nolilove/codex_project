const { BASELINE_MS } = require("./bet-state");

const API_BASE = "https://api.neople.co.kr";
const TIMELINE_CODES = [550, 551, 552, 553, 554, 555, 556];
const TIMELINE_SCAN_START_MS = new Date("2017-09-21T00:00:00+09:00").getTime();
const TIMELINE_WINDOW_DAYS = 90;
const MINUTE_MS = 60 * 1000;
const WINDOW_MS = TIMELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const SERVER_LABELS = {
  anton: "안톤",
  bakal: "바칼",
  cain: "카인",
  casillas: "카시야스",
  diregie: "디레지에",
  hilder: "힐더",
  prey: "프레이",
  siroco: "시로코",
  all: "전체",
};

function getCharacterAvatarUrl(serverId, characterId) {
  return `https://img-api.neople.co.kr/df/servers/${encodeURIComponent(
    serverId
  )}/characters/${encodeURIComponent(characterId)}?zoom=1`;
}

function log(level, message, meta = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      ...meta,
    })
  );
}

function getApiKey() {
  const key = process.env.NEOPLE_API_KEY;
  if (!key) {
    const error = new Error("NEOPLE_API_KEY is missing");
    error.code = "NEOPLE_API_KEY_MISSING";
    throw error;
  }
  return key;
}

async function callNeople(path, query = {}) {
  const key = getApiKey();
  const params = new URLSearchParams({ ...query, apikey: key });
  const url = `${API_BASE}${path}?${params.toString()}`;
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.error) {
    const apiError = payload?.error;
    const message =
      typeof apiError === "string"
        ? apiError
        : apiError?.message || apiError?.code || "Neople request failed";
    const error = new Error(message);
    error.code = "NEOPLE_REQUEST_FAILED";
    error.status = response.status;
    error.payload = payload;
    error.apiCode = typeof apiError === "object" ? apiError?.code : null;
    throw error;
  }

  return payload;
}

function formatDateForNeople(timestampMs) {
  const date = new Date(timestampMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}`;
}

function normalizeForCompare(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function collectStrings(value, bucket = []) {
  if (typeof value === "string") {
    bucket.push(value);
    return bucket;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, bucket);
    }
    return bucket;
  }
  if (value && typeof value === "object") {
    for (const element of Object.values(value)) {
      collectStrings(element, bucket);
    }
  }
  return bucket;
}

function collectTimelineItemEntries(value, bucket = [], visited = new Set()) {
  if (!value || typeof value !== "object") {
    return bucket;
  }
  if (Array.isArray(value)) {
    for (const element of value) {
      collectTimelineItemEntries(element, bucket, visited);
    }
    return bucket;
  }

  const rawName =
    typeof value.itemName === "string"
      ? value.itemName
      : typeof value.name === "string"
      ? value.name
      : "";
  const rawRarity =
    typeof value.itemRarity === "string"
      ? value.itemRarity
      : typeof value.rarity === "string"
      ? value.rarity
      : typeof value.rarityName === "string"
      ? value.rarityName
      : "";

  if (rawName || rawRarity) {
    const key = `${rawName}|${rawRarity}`;
    if (!visited.has(key)) {
      visited.add(key);
      bucket.push({
        itemName: rawName,
        itemRarity: rawRarity,
      });
    }
  }

  for (const element of Object.values(value)) {
    collectTimelineItemEntries(element, bucket, visited);
  }
  return bucket;
}

function classifyOathEvents(row) {
  const events = [];
  const entries = collectTimelineItemEntries(row?.data || row);
  for (const entry of entries) {
    const nameNorm = normalizeForCompare(entry.itemName);
    const rarityNorm = normalizeForCompare(entry.itemRarity);
    const isTaecho = rarityNorm.includes("태초") || nameNorm.includes("태초");
    const isOath = nameNorm.includes("서약");
    const isCrystal = nameNorm.includes("결정");
    if (!isTaecho || (!isOath && !isCrystal)) {
      continue;
    }
    events.push({
      itemName: entry.itemName || (isCrystal ? "태초서약결정" : "태초서약"),
      kind: isCrystal ? "crystal" : "oath",
    });
  }

  if (events.length > 0) {
    return events;
  }

  const allText = collectStrings(row?.data || row).map(normalizeForCompare).join(" ");
  if (!allText.includes("서약/결정-태초")) {
    return [];
  }

  const fallbackIsCrystal = allText.includes("결정");
  return [
    {
      itemName: fallbackIsCrystal ? "태초서약결정" : "태초서약",
      kind: fallbackIsCrystal ? "crystal" : "oath",
    },
  ];
}

function normalizeTimeline(rows) {
  const timeline = [];
  let oathCountTotal = 0;
  let oathCrystalCountTotal = 0;
  let oathCountAfterBaseline = 0;
  let oathCrystalCountAfterBaseline = 0;
  let firstOathAcquiredAtAfterBaseline = null;

  for (const row of rows) {
    const date = typeof row.date === "string" ? row.date : "";
    const dateMs = Number.isFinite(new Date(date).getTime()) ? new Date(date).getTime() : null;
    const events = classifyOathEvents(row);

    for (const eventInfo of events) {
      const event = {
        date,
        code: typeof row.code === "number" ? row.code : null,
        itemName: eventInfo.itemName,
      };
      timeline.push(event);

      if (eventInfo.kind === "crystal") {
        oathCrystalCountTotal += 1;
        if (dateMs !== null && dateMs >= BASELINE_MS) {
          oathCrystalCountAfterBaseline += 1;
        }
        continue;
      }

      oathCountTotal += 1;
      if (dateMs !== null && dateMs >= BASELINE_MS) {
        oathCountAfterBaseline += 1;
        if (
          !firstOathAcquiredAtAfterBaseline ||
          dateMs < new Date(firstOathAcquiredAtAfterBaseline).getTime()
        ) {
          firstOathAcquiredAtAfterBaseline = new Date(dateMs).toISOString();
        }
      }
    }
  }

  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    oathCountTotal,
    oathCrystalCountTotal,
    oathCountAfterBaseline,
    oathCrystalCountAfterBaseline,
    firstOathAcquiredAtAfterBaseline,
    timeline: timeline.slice(0, 30),
  };
}

function buildTimelineWindows(startMs, endMs) {
  const windows = [];
  let windowStart = startMs;
  while (windowStart <= endMs) {
    const windowEnd = Math.min(windowStart + WINDOW_MS - MINUTE_MS, endMs);
    windows.push({ startMs: windowStart, endMs: windowEnd });
    windowStart = windowEnd + MINUTE_MS;
  }
  return windows;
}

async function getCharacterBasic(serverId, characterId) {
  return callNeople(`/df/servers/${encodeURIComponent(serverId)}/characters/${encodeURIComponent(characterId)}`);
}

async function searchCharactersByServer({ serverId, keyword, limit }) {
  const result = await callNeople(`/df/servers/${encodeURIComponent(serverId)}/characters`, {
    characterName: keyword,
    limit: String(limit),
    wordType: "full",
  });

  return Array.isArray(result.rows) ? result.rows : [];
}

async function enrichCharacters(rows, maxCount = 20) {
  const sliced = rows.slice(0, maxCount);
  const enriched = await Promise.all(
    sliced.map(async (row) => {
      try {
        const detail = await getCharacterBasic(row.serverId, row.characterId);
        return {
          id: `${row.serverId}:${row.characterId}`,
          serverId: row.serverId,
          serverName: SERVER_LABELS[row.serverId] || row.serverId,
          characterId: row.characterId,
          characterName: row.characterName,
          adventureName: typeof detail.adventureName === "string" ? detail.adventureName : "",
          avatarImageUrl: getCharacterAvatarUrl(row.serverId, row.characterId),
          level: row.level,
          fame: row.fame,
          jobGrowName: row.jobGrowName,
        };
      } catch (_error) {
        return {
          id: `${row.serverId}:${row.characterId}`,
          serverId: row.serverId,
          serverName: SERVER_LABELS[row.serverId] || row.serverId,
          characterId: row.characterId,
          characterName: row.characterName,
          adventureName: "",
          avatarImageUrl: getCharacterAvatarUrl(row.serverId, row.characterId),
          level: row.level,
          fame: row.fame,
          jobGrowName: row.jobGrowName,
        };
      }
    })
  );

  const unique = new Map();
  for (const character of enriched) {
    unique.set(character.id, character);
  }
  return [...unique.values()];
}

async function searchCharacters({ mode, serverId, keyword, limit = 20 }) {
  const safeLimit = Math.max(1, Math.min(limit, 30));
  const trimmedKeyword = String(keyword || "").trim();
  if (!trimmedKeyword) {
    return [];
  }

  const targetServer = mode === "server" ? serverId || "all" : "all";
  const rows = await searchCharactersByServer({
    serverId: targetServer,
    keyword: trimmedKeyword,
    limit: safeLimit,
  });

  const enriched = await enrichCharacters(rows, safeLimit);
  if (mode === "adventure") {
    return enriched.filter((character) => character.adventureName.includes(trimmedKeyword));
  }
  return enriched;
}

async function fetchTimelineRows(serverId, characterId) {
  const rows = [];
  const nowMs = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
  const windows = buildTimelineWindows(TIMELINE_SCAN_START_MS, nowMs);

  for (const window of windows) {
    let next = null;
    let page = 0;

    while (page < 200) {
      const query = next
        ? { next }
        : {
            code: TIMELINE_CODES.join(","),
            startDate: formatDateForNeople(window.startMs),
            endDate: formatDateForNeople(window.endMs),
            limit: "100",
          };

      try {
        const response = await callNeople(
          `/df/servers/${encodeURIComponent(serverId)}/characters/${encodeURIComponent(characterId)}/timeline`,
          query
        );
        const currentRows = Array.isArray(response.timeline?.rows) ? response.timeline.rows : [];
        rows.push(...currentRows);
        next = response.timeline?.next;
        if (!next || currentRows.length === 0) {
          break;
        }
        page += 1;
      } catch (error) {
        log("error", "timeline_window_failed", {
          serverId,
          characterId,
          startDate: formatDateForNeople(window.startMs),
          endDate: formatDateForNeople(window.endMs),
          next,
          code: error.code,
          status: error.status,
          message: error.message,
        });
        throw error;
      }
    }
  }

  return rows;
}

async function getOathStats(serverId, characterId) {
  const [basic, rows] = await Promise.all([
    getCharacterBasic(serverId, characterId),
    fetchTimelineRows(serverId, characterId),
  ]);

  const stats = normalizeTimeline(rows);
  return {
    ...stats,
    adventureName: typeof basic.adventureName === "string" ? basic.adventureName : "",
  };
}

module.exports = {
  SERVER_LABELS,
  getOathStats,
  getCharacterAvatarUrl,
  searchCharacters,
};
