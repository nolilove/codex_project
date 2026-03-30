const state = {
  latest: null,
};

const participantsEl = document.getElementById("participants");
const template = document.getElementById("card-template");
const progressLabelEl = document.getElementById("progress-label");
const progressBarEl = document.getElementById("progress-bar");
const resultTextEl = document.getElementById("result-text");

function formatKst(iso) {
  if (!iso) {
    return "미기록";
  }
  const date = new Date(iso);
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function buildResultText(currentState) {
  if (!currentState.stats?.loser) {
    return "아직 4명 모두 확정되지 않았습니다.";
  }

  const loser = currentState.stats.loser;
  const acquiredAt = formatKst(loser.firstAcquiredAt);
  return `현재 가장 늦게 확정된 인원: ${loser.name} (${acquiredAt}) - 기프티콘 지급 대상`;
}

async function updateCount(participantId, count, buttonEl) {
  buttonEl.disabled = true;
  buttonEl.textContent = "저장 중...";

  try {
    const response = await fetch("/api/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: participantId, count }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({ error: "요청 실패" }));
      throw new Error(errorPayload.error || "저장 실패");
    }

    const updatedState = await response.json();
    state.latest = updatedState;
    render();
  } catch (error) {
    alert(`저장 실패: ${error.message}`);
  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = "저장";
  }
}

function render() {
  const currentState = state.latest;
  if (!currentState) {
    return;
  }

  const completed = currentState.stats.completedParticipants;
  const total = currentState.stats.totalParticipants;
  const ratio = total > 0 ? Math.round((completed / total) * 100) : 0;

  progressLabelEl.textContent = `${completed} / ${total}`;
  progressBarEl.style.width = `${ratio}%`;
  resultTextEl.textContent = buildResultText(currentState);

  participantsEl.innerHTML = "";
  for (const participant of currentState.participants) {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    const nameEl = fragment.querySelector(".name");
    const firstAcquiredEl = fragment.querySelector(".first-acquired");
    const inputEl = fragment.querySelector(".count-input");
    const buttonEl = fragment.querySelector(".save-btn");

    nameEl.textContent = participant.name;
    firstAcquiredEl.textContent = formatKst(participant.firstAcquiredAt);
    inputEl.value = participant.count;

    if (participant.firstAcquiredAt) {
      card.classList.add("completed");
    }

    if (currentState.stats.loser?.id === participant.id) {
      card.classList.add("loser");
    }

    buttonEl.addEventListener("click", () => {
      const nextCount = Number(inputEl.value);
      if (!Number.isInteger(nextCount) || nextCount < 0) {
        alert("수량은 0 이상의 정수만 가능합니다.");
        return;
      }
      updateCount(participant.id, nextCount, buttonEl);
    });

    participantsEl.appendChild(fragment);
  }
}

async function init() {
  try {
    const response = await fetch("/api/state");
    if (!response.ok) {
      throw new Error("상태 조회 실패");
    }
    state.latest = await response.json();
    render();
  } catch (error) {
    resultTextEl.textContent = `초기 로딩 실패: ${error.message}`;
  }
}

init();
