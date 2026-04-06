const state = {
  latest: null,
  searchRows: [],
  loading: {
    state: false,
    search: false,
    refreshAll: false,
  },
};

const ui = {
  participants: document.getElementById("participants"),
  progressLabel: document.getElementById("progress-label"),
  progressBar: document.getElementById("progress-bar"),
  resultText: document.getElementById("result-text"),
  baselineLabel: document.getElementById("baseline-label"),
  modeSelect: document.getElementById("mode-select"),
  serverSelect: document.getElementById("server-select"),
  keywordInput: document.getElementById("keyword-input"),
  searchBtn: document.getElementById("search-btn"),
  refreshAllBtn: document.getElementById("refresh-all-btn"),
  searchResults: document.getElementById("search-results"),
  searchTemplate: document.getElementById("search-card-template"),
  participantTemplate: document.getElementById("participant-card-template"),
};

function formatKst(iso) {
  if (!iso) {
    return "미확인";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(new Date(iso));
}

function setBusy(button, busyText, isBusy) {
  button.disabled = isBusy;
  if (isBusy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

async function fetchState() {
  const response = await fetch("/api/state");
  if (!response.ok) {
    const errorPayload = await response
      .json()
      .catch(() => ({ error: `상태 조회 실패 (HTTP ${response.status})` }));
    throw new Error(errorPayload.error || "상태 조회 실패");
  }
  return response.json();
}

async function callParticipantsApi(body) {
  const response = await fetch("/api/participants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({ error: "요청 실패" }));
    throw new Error(errorPayload.error || "요청 실패");
  }
  return response.json();
}

async function searchCharacters() {
  const mode = ui.modeSelect.value;
  const serverId = ui.serverSelect.value;
  const keyword = ui.keywordInput.value.trim();
  if (!keyword) {
    alert("검색어를 입력하세요.");
    return;
  }

  setBusy(ui.searchBtn, "검색 중...", true);
  try {
    const params = new URLSearchParams({
      mode,
      serverId,
      keyword,
      limit: "20",
    });
    const response = await fetch(`/api/search?${params.toString()}`);
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({ error: "검색 실패" }));
      throw new Error(errorPayload.error || "검색 실패");
    }
    const payload = await response.json();
    state.searchRows = Array.isArray(payload.rows) ? payload.rows : [];
    renderSearchRows();
  } catch (error) {
    alert(`검색 실패: ${error.message}`);
  } finally {
    setBusy(ui.searchBtn, "검색 중...", false);
  }
}

async function addParticipant(row, button) {
  setBusy(button, "추가 중...", true);
  try {
    state.latest = await callParticipantsApi({
      action: "add",
      participant: {
        serverId: row.serverId,
        characterId: row.characterId,
        characterName: row.characterName,
        adventureName: row.adventureName,
        avatarImageUrl: row.avatarImageUrl,
      },
    });
    render();
  } catch (error) {
    alert(`참가자 추가 실패: ${error.message}`);
  } finally {
    setBusy(button, "추가 중...", false);
  }
}

async function removeParticipant(participantId, button) {
  setBusy(button, "삭제 중...", true);
  try {
    state.latest = await callParticipantsApi({
      action: "remove",
      participantId,
    });
    render();
  } catch (error) {
    alert(`참가자 삭제 실패: ${error.message}`);
  } finally {
    setBusy(button, "삭제 중...", false);
  }
}

async function refreshParticipant(participantId, button) {
  setBusy(button, "동기화 중...", true);
  try {
    state.latest = await callParticipantsApi({
      action: "refresh",
      participantId,
    });
    render();
  } catch (error) {
    alert(`동기화 실패: ${error.message}`);
  } finally {
    setBusy(button, "동기화 중...", false);
  }
}

async function refreshAll() {
  setBusy(ui.refreshAllBtn, "전체 동기화 중...", true);
  try {
    state.latest = await callParticipantsApi({ action: "refresh", force: true });
    render();
  } catch (error) {
    alert(`전체 동기화 실패: ${error.message}`);
  } finally {
    setBusy(ui.refreshAllBtn, "전체 동기화 중...", false);
  }
}

async function autoRefreshOnInit() {
  const participantCount = state.latest?.participants?.length || 0;
  if (participantCount === 0) {
    return;
  }

  setBusy(ui.refreshAllBtn, "자동 동기화 중...", true);
  try {
    state.latest = await callParticipantsApi({
      action: "refresh",
      force: false,
      ttlMs: 5 * 60 * 1000,
    });
    render();
  } catch (error) {
    console.warn("auto_refresh_failed", error);
  } finally {
    setBusy(ui.refreshAllBtn, "자동 동기화 중...", false);
  }
}

function renderServerOptions() {
  const servers = state.latest?.meta?.servers || {};
  const rows = Object.entries(servers);
  const previousValue = ui.serverSelect.value || "all";
  ui.serverSelect.innerHTML = "";
  for (const [serverId, label] of rows) {
    const option = document.createElement("option");
    option.value = serverId;
    option.textContent = `${label} (${serverId})`;
    ui.serverSelect.appendChild(option);
  }
  ui.serverSelect.value = rows.some(([serverId]) => serverId === previousValue) ? previousValue : "all";
}

function renderResult() {
  const current = state.latest;
  if (!current) {
    return;
  }
  const completed = current.stats.completedParticipants;
  const total = current.stats.totalParticipants;
  const ratio = total > 0 ? Math.round((completed / total) * 100) : 0;

  ui.progressLabel.textContent = `${completed} / ${total}`;
  ui.progressBar.style.width = `${ratio}%`;
  ui.baselineLabel.textContent = `기준 시각: ${current.bet.baselineKst} 이후 태초서약 선취득 기준`;

  if (!current.stats.loser) {
    ui.resultText.textContent = "참가자 전원에게 태초서약 최초 획득 시각이 기록되면 꼴찌가 판정됩니다.";
    return;
  }
  const loser = current.stats.loser;
  ui.resultText.textContent = `현재 꼴찌: ${loser.characterName}(${loser.serverId}) / 최초 획득 ${formatKst(
    loser.firstOathAcquiredAt
  )}`;
}

function renderSearchRows() {
  ui.searchResults.innerHTML = "";
  if (state.searchRows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "stamp";
    empty.textContent = "검색 결과가 없습니다.";
    ui.searchResults.appendChild(empty);
    return;
  }

  const participantSet = new Set((state.latest?.participants || []).map((row) => row.id));

  for (const row of state.searchRows) {
    const fragment = ui.searchTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    const avatarEl = fragment.querySelector(".char-avatar");
    const nameEl = fragment.querySelector(".name");
    const metaEl = fragment.querySelector(".search-meta");
    const addBtn = fragment.querySelector(".add-btn");

    avatarEl.src = row.avatarImageUrl || "";
    avatarEl.alt = `${row.characterName} 아바타`;
    nameEl.textContent = `${row.characterName} (${row.serverName})`;
    metaEl.textContent = `모험단: ${row.adventureName || "미확인"} / 명성: ${
      row.fame || 0
    } / 직업: ${row.jobGrowName || "-"}`;

    if (participantSet.has(row.id)) {
      addBtn.disabled = true;
      addBtn.textContent = "이미 참가자";
      card.classList.add("completed");
    } else {
      addBtn.addEventListener("click", () => addParticipant(row, addBtn));
    }
    ui.searchResults.appendChild(fragment);
  }
}

function renderParticipants() {
  ui.participants.innerHTML = "";
  const participants = state.latest?.participants || [];

  if (participants.length === 0) {
    const empty = document.createElement("p");
    empty.className = "stamp";
    empty.textContent = "등록된 참가자가 없습니다.";
    ui.participants.appendChild(empty);
    return;
  }

  for (const participant of participants) {
    const fragment = ui.participantTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    const avatarEl = fragment.querySelector(".char-avatar");
    const nameEl = fragment.querySelector(".name");
    const adventureEl = fragment.querySelector(".adventure");
    const oathCountEl = fragment.querySelector(".oath-count");
    const crystalCountEl = fragment.querySelector(".crystal-count");
    const firstOathEl = fragment.querySelector(".first-oath");
    const listEl = fragment.querySelector(".timeline-list");
    const syncBtn = fragment.querySelector(".sync-btn");
    const removeBtn = fragment.querySelector(".remove-btn");

    avatarEl.src = participant.avatarImageUrl || "";
    avatarEl.alt = `${participant.characterName} 아바타`;
    nameEl.textContent = `${participant.characterName} (${participant.serverId})`;
    adventureEl.textContent = `모험단: ${participant.adventureName || "미확인"}`;
    oathCountEl.textContent =
      `태초서약 획득(전체/기준후): ${participant.stats.oathCountTotal}회 / ` +
      `${participant.stats.oathCountAfterBaseline}회`;
    crystalCountEl.textContent =
      `태초서약결정 획득(전체/기준후): ${participant.stats.oathCrystalCountTotal}회 / ` +
      `${participant.stats.oathCrystalCountAfterBaseline}회`;
    firstOathEl.textContent = `기준시각 이후 최초 태초서약 획득: ${formatKst(
      participant.stats.firstOathAcquiredAtAfterBaseline
    )}`;

    if (participant.stats.firstOathAcquiredAtAfterBaseline) {
      card.classList.add("completed");
    }
    if (state.latest?.stats?.loser?.id === participant.id) {
      card.classList.add("loser");
    }

    const timeline = Array.isArray(participant.stats.timeline) ? participant.stats.timeline : [];
    if (timeline.length === 0) {
      const li = document.createElement("li");
      li.textContent = "타임라인 기록 없음";
      listEl.appendChild(li);
    } else {
      for (const event of timeline) {
        const li = document.createElement("li");
        li.textContent = `${formatKst(event.date)} / ${event.itemName}`;
        listEl.appendChild(li);
      }
    }

    syncBtn.addEventListener("click", () => refreshParticipant(participant.id, syncBtn));
    removeBtn.addEventListener("click", () => removeParticipant(participant.id, removeBtn));
    ui.participants.appendChild(fragment);
  }
}

function render() {
  renderResult();
  renderServerOptions();
  renderSearchRows();
  renderParticipants();
}

async function init() {
  try {
    state.latest = await fetchState();
    render();
    await autoRefreshOnInit();
  } catch (error) {
    ui.resultText.textContent = `초기 로딩 실패: ${error.message}`;
  }
}

ui.searchBtn.addEventListener("click", searchCharacters);
ui.keywordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    searchCharacters();
  }
});
ui.refreshAllBtn.addEventListener("click", refreshAll);

init();
