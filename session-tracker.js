(function () {
  const SESSION_KEY = "socialCreditAgentSessionV2";
  const HISTORY_KEY = "socialCreditAttemptHistoryV1";
  const PROFILE_KEY = "socialCreditAgentProfileV1";
  const TRUSTED_PROGRESS_KEY = "socialCreditTrustedProgressV1";
  const TRACKER_VERSION = "20260609f";
  const page = document.body.dataset.level || "unknown";
  const appRoot = new URL(".", document.currentScript?.src || window.location.href);
  const appUrl = path => new URL(String(path).replace(/^\/+/, ""), appRoot).href;
  const apiUrl = path => appUrl(path);
  const pageRequirements = {
    level2: { previous: "level1", label: "Level 1", href: "payment.html", minimumScore: 200000 },
    level3: { previous: "level2", label: "Level 2", href: "level2.html", minimumScore: 10 },
    boss: { previous: "level3", label: "Level 3", href: "level3.html", completed: true }
  };

  function createAgentCode() {
    const words = ["EMBER", "ORBIT", "VECTOR", "NOVA", "ECHO", "TIGER", "COBALT", "PHANTOM"];
    const word = words[Math.floor(Math.random() * words.length)];
    return `AGENT-${word}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  function readProfile() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function freshSession() {
    const profile = readProfile();
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      agent: profile.agent || createAgentCode(),
      startedAt: null,
      completedAt: null,
      activeLevel: null,
      levels: {},
      totalScore: 0,
      serverRun: null,
      officialResult: null,
      tampered: false,
      tamperReason: null,
      invalidRun: false,
      invalidReason: null,
      archived: false
    };
  }

  function readSession() {
    try {
      return { ...freshSession(), ...JSON.parse(localStorage.getItem(SESSION_KEY) || "{}") };
    } catch {
      return freshSession();
    }
  }

  let session = readSession();
  let leaderboardCache = [];
  let serverRunPromise = null;
  const levelScoreCaps = {
    level1: 50000000,
    level2: 10000,
    level3: 100000,
    boss: 100000000
  };
  const levelCompletionMinimums = {
    level1: 200000,
    level2: 10,
    level3: 100000,
    boss: 5000000
  };
  const watchedStorageScores = [
    { key: "socialCreditSkill", level: "level1", cap: 50000000 },
    { key: "flappyBest", level: "level2", cap: 10000 },
    { key: "bossScore", level: "boss", cap: 100000000 }
  ];
  const progressStorageKeys = [
    "socialCreditSkill",
    "socialCreditFastPopups",
    "socialCreditAutoClicker",
    "socialCreditClickPower",
    "socialCreditSigils",
    "flappyBest",
    "level2Complete",
    "level3Complete",
    "bossScore",
    "bossRunSave",
    "socialCreditBossLeaderboardV1"
  ];

  function requestJson(path, payload, options = {}) {
    const init = payload
      ? {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: Boolean(options.keepalive)
      }
      : { method: "GET" };
    return fetch(apiUrl(path), init).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
      return data;
    });
  }

  function canUseApi() {
    return typeof fetch === "function" && location.protocol !== "file:";
  }

  function ensureServerRun() {
    if (!canUseApi() || !session.startedAt || page === "index" || page === "unknown") return Promise.resolve(null);
    if (session.completedAt || session.tampered) return Promise.resolve(null);
    if (session.serverRun?.runId && session.serverRun?.token) return Promise.resolve(session.serverRun);
    if (serverRunPromise) return serverRunPromise;
    serverRunPromise = requestJson("api/run/start", { agent: session.agent })
      .then(data => {
        session.serverRun = {
          runId: data.runId,
          token: data.token,
          startedAt: data.startedAt
        };
        saveSession();
        return session.serverRun;
      })
      .catch(() => null)
      .finally(() => { serverRunPromise = null; });
    return serverRunPromise;
  }

  function syncCompletedLevel(name, keepalive = false) {
    if (!["level1", "level2", "level3"].includes(name)) return;
    const level = session.levels[name];
    if (!level?.completedAt) return;
    void ensureServerRun().then(serverRun => {
      if (!serverRun) return null;
      return requestJson("api/run/level", {
        runId: serverRun.runId,
        token: serverRun.token,
        agent: session.agent,
        level: name,
        score: level.score || 0
      }, { keepalive });
    }).catch(() => {});
  }

  function finishServerRun(score) {
    void ensureServerRun().then(serverRun => {
      if (!serverRun) return null;
      return requestJson("api/run/finish", {
        runId: serverRun.runId,
        token: serverRun.token,
        agent: session.agent,
        bossScore: score
      }, { keepalive: true });
    }).then(result => {
      if (!result) return;
      session.officialResult = result;
      saveSession();
      void refreshLeaderboard();
      render();
    }).catch(() => {});
  }

  function refreshLeaderboard() {
    if (!canUseApi()) return Promise.resolve();
    return requestJson("api/leaderboard")
      .then(data => {
        leaderboardCache = Array.isArray(data.leaders) ? data.leaders : [];
        render();
      })
      .catch(() => {});
  }

  function readTrustedProgress() {
    try {
      return JSON.parse(localStorage.getItem(TRUSTED_PROGRESS_KEY) || "null");
    } catch {
      return null;
    }
  }

  function writeTrustedProgress() {
    const levels = {};
    Object.entries(session.levels || {}).forEach(([name, level]) => {
      levels[name] = {
        score: Number(level?.score) || 0,
        completedAt: level?.completedAt || null
      };
    });
    localStorage.setItem(TRUSTED_PROGRESS_KEY, JSON.stringify({
      sessionId: session.id,
      levels,
      updatedAt: Date.now()
    }));
  }

  function storageNumber(key) {
    const number = Number(localStorage.getItem(key) || 0);
    return Number.isFinite(number) ? number : 0;
  }

  function sanitizeLocalProgress() {
    progressStorageKeys.forEach(key => localStorage.removeItem(key));
    localStorage.setItem("socialCreditSkill", "0");
    localStorage.setItem("flappyBest", "0");
    localStorage.setItem("bossScore", "0");
  }

  function markTampered(reason) {
    sanitizeLocalProgress();
    session.tampered = true;
    session.tamperReason = reason;
    session.totalScore = 0;
    session.officialResult = {
      finalScore: 0,
      elapsedMs: session.startedAt ? Math.max(0, Date.now() - session.startedAt) : 0,
      tampered: true,
      tamperReason: reason
    };
    Object.values(session.levels || {}).forEach(level => {
      level.score = 0;
      level.completedAt = null;
    });
    saveSession();
    writeTrustedProgress();
  }

  function markInvalidRun(reason) {
    sanitizeLocalProgress();
    session.invalidRun = true;
    session.invalidReason = reason;
    session.totalScore = 0;
    session.completedAt ||= Date.now();
    session.activeLevel = null;
    session.officialResult = {
      finalScore: 0,
      elapsedMs: session.startedAt ? Math.max(0, Date.now() - session.startedAt) : 0,
      tampered: false,
      tamperReason: reason
    };
    Object.values(session.levels || {}).forEach(level => {
      level.score = 0;
      level.completedAt = null;
    });
    saveSession();
    writeTrustedProgress();
  }

  function detectStorageTamper() {
    const trusted = readTrustedProgress();
    if (session.tampered) {
      sanitizeLocalProgress();
      writeTrustedProgress();
      return;
    }

    for (const item of watchedStorageScores) {
      const stored = storageNumber(item.key);
      const sessionScore = Number(session.levels?.[item.level]?.score) || 0;
      const trustedScore = Number(trusted?.levels?.[item.level]?.score) || 0;
      if (stored > item.cap || sessionScore > item.cap) {
        markTampered(`${item.key} exceeded the allowed score cap`);
        return;
      }
      if (trusted && stored > trustedScore) {
        markTampered(`${item.key} was increased outside the game`);
        return;
      }
    }

    for (const [name, cap] of Object.entries(levelScoreCaps)) {
      const sessionScore = Number(session.levels?.[name]?.score) || 0;
      const trustedScore = Number(trusted?.levels?.[name]?.score) || 0;
      if (sessionScore > cap) {
        markTampered(`${name} score exceeded the allowed cap`);
        return;
      }
      if (trusted && sessionScore > trustedScore && session.levels?.[name]?.completedAt) {
        markTampered(`${name} was increased outside the game`);
        return;
      }
    }

    if (!trusted) {
      const hasUnverifiedProgress = watchedStorageScores.some(item => storageNumber(item.key) > 0);
      if (hasUnverifiedProgress) {
        markTampered("unverified localStorage progress was found");
        return;
      }
      writeTrustedProgress();
    }
  }

  function importLegacyProgress() {
    if (session.tampered) return;
    const now = Date.now();
    const level1Score = Number(localStorage.getItem("socialCreditSkill") || 0);
    const level2Score = Number(localStorage.getItem("flappyBest") || 0);
    if (level1Score >= 200000) {
      session.levels.level1 ||= { startedAt: now, completedAt: now, score: level1Score };
      session.levels.level1.score = Math.max(session.levels.level1.score || 0, level1Score);
      session.levels.level1.completedAt ||= now;
    }
    if (localStorage.getItem("level2Complete") === "true" && level2Score >= 10) {
      session.levels.level2 ||= { startedAt: now, completedAt: now, score: level2Score };
      session.levels.level2.score = Math.max(session.levels.level2.score || 0, level2Score);
      session.levels.level2.completedAt ||= now;
    }
    if (localStorage.getItem("level3Complete") === "true") {
      session.levels.level3 ||= { startedAt: now, completedAt: now, score: 100000 };
      session.levels.level3.score = Math.max(session.levels.level3.score || 0, 100000);
      session.levels.level3.completedAt ||= now;
    }
  }

  function requirementMet(requirement) {
    const previous = session.levels[requirement.previous];
    if (!previous) return false;
    if (requirement.completed && !previous.completedAt) return false;
    if (requirement.minimumScore && (Number(previous.score) || 0) < requirement.minimumScore) return false;
    return true;
  }

  function renderAccessDenied(requirement) {
    document.title = "ACCESS DENIED";
    document.body.dataset.level = "locked";
    document.body.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;padding:24px;color:#fff;background:#050505;font-family:Arial,sans-serif">
        <section style="max-width:680px;padding:28px;border:4px solid #ff3b4f;background:#120000;box-shadow:10px 10px 0 #000;text-align:center">
          <h1 style="margin:0 0 14px;color:#ff3b4f;font-size:clamp(34px,8vw,72px)">ACCESS DENIED</h1>
          <p style="font-size:18px;font-weight:900">Direct path access is not allowed.</p>
          <p>Complete ${requirement.label} through the normal progression before entering this page.</p>
          <a href="${appUrl(requirement.href)}" style="display:inline-block;margin-top:16px;padding:12px 18px;border:3px solid #fff;color:#000;background:#ffe600;text-decoration:none;font-weight:900">RETURN TO ${requirement.label.toUpperCase()}</a>
        </section>
      </main>`;
    document.documentElement.style.background = "#050505";
  }

  function installTamperDeterrents() {
    document.designMode = "off";
    document.body.contentEditable = "false";
    const blockedShortcutCodes = new Set([
      "F12",
      "KeyI",
      "KeyJ",
      "KeyC",
      "KeyK",
      "KeyU",
      "KeyS"
    ]);
    function isInspectionShortcut(event) {
      const modifier = event.ctrlKey || event.metaKey;
      const devToolsCombo = modifier && event.shiftKey && blockedShortcutCodes.has(event.code);
      const sourceOrSaveCombo = modifier && !event.shiftKey && (event.code === "KeyU" || event.code === "KeyS");
      return event.code === "F12" || devToolsCombo || sourceOrSaveCombo;
    }
    const protectionStyle = document.createElement("style");
    protectionStyle.textContent = `
      body{user-select:none;-webkit-user-select:none}
      input,textarea{user-select:text;-webkit-user-select:text}
    `;
    document.head.appendChild(protectionStyle);
    document.addEventListener("contextmenu", event => event.preventDefault());
    document.addEventListener("dragstart", event => event.preventDefault());
    document.addEventListener("drop", event => event.preventDefault());
    document.addEventListener("keydown", event => {
      if (!isInspectionShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    document.addEventListener("beforeinput", event => {
      const target = event.target;
      const allowedInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (!allowedInput && event.inputType?.startsWith("insert")) event.preventDefault();
    }, true);
    document.querySelectorAll("[contenteditable]").forEach(element => element.removeAttribute("contenteditable"));
  }

  installTamperDeterrents();
  detectStorageTamper();
  importLegacyProgress();
  const activeRequirement = pageRequirements[page];
  if (activeRequirement && !requirementMet(activeRequirement)) {
    renderAccessDenied(activeRequirement);
    window.AgentSession = { accessDenied: true };
    return;
  }

  function readHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function archiveAttempt(reason) {
    if (session.archived || (!session.startedAt && !session.totalScore)) return;
    const history = readHistory();
    history.unshift({
      id: session.id,
      agent: session.agent,
      startedAt: session.startedAt,
      completedAt: session.completedAt || Date.now(),
      totalScore: session.totalScore,
      levels: session.levels,
      reason
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
    session.archived = true;
    saveSession();
  }

  function saveSession() {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem("socialCreditUserId", session.agent);
  }

  function ensureLevel(name) {
    session.levels[name] ||= { startedAt: null, completedAt: null, score: 0 };
    return session.levels[name];
  }

  function startLevel(name) {
    if (!name || name === "index" || name === "unknown") return;
    const now = Date.now();
    if (session.activeLevel && session.activeLevel !== name) {
      const previous = ensureLevel(session.activeLevel);
      previous.completedAt ||= now;
    }
    session.startedAt ||= now;
    session.activeLevel = name;
    ensureLevel(name).startedAt ||= now;
    saveSession();
    void ensureServerRun();
  }

  function completeLevel(name, score) {
    if (session.tampered) {
      render();
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(levelScoreCaps, name)) {
      markTampered(`unknown level "${name}" was completed`);
      render();
      return;
    }
    const numericScore = Number(score) || 0;
    if (levelScoreCaps[name] && numericScore > levelScoreCaps[name]) {
      markTampered(`${name} score exceeded the allowed cap`);
      render();
      return;
    }
    const level = ensureLevel(name);
    level.startedAt ||= Date.now();
    level.score = Math.max(level.score || 0, Number(score) || 0);
    if (level.score < levelCompletionMinimums[name]) {
      recalculateTotal();
      saveSession();
      writeTrustedProgress();
      render();
      return;
    }
    level.completedAt ||= Date.now();
    recalculateTotal();
    saveSession();
    writeTrustedProgress();
    syncCompletedLevel(name, true);
    render();
  }

  function setLevelScore(name, score) {
    if (!name || name === "index" || name === "unknown") return;
    if (session.tampered) return;
    if (!Object.prototype.hasOwnProperty.call(levelScoreCaps, name)) {
      markTampered(`unknown level "${name}" was modified`);
      render();
      return;
    }
    const numericScore = Number(score) || 0;
    if (levelScoreCaps[name] && numericScore > levelScoreCaps[name]) {
      markTampered(`${name} score exceeded the allowed cap`);
      render();
      return;
    }
    const level = ensureLevel(name);
    level.score = Math.max(level.score || 0, Number(score) || 0);
    recalculateTotal();
    saveSession();
    writeTrustedProgress();
  }

  function recalculateTotal() {
    if (session.tampered) {
      session.totalScore = 0;
      return;
    }
    if (session.invalidRun) {
      session.totalScore = 0;
      return;
    }
    session.totalScore = Object.values(session.levels).reduce((sum, level) => sum + (Number(level.score) || 0), 0);
  }

  function finishRun(score) {
    if (session.tampered) {
      session.completedAt ||= Date.now();
      session.activeLevel = null;
      session.totalScore = 0;
      saveSession();
      render();
      return;
    }
    const knownBossScore = Math.max(
      Number(score) || 0,
      Number(session.levels?.boss?.score) || 0,
      Number(localStorage.getItem("bossScore") || 0) || 0
    );
    const numericScore = knownBossScore;
    if (numericScore < levelCompletionMinimums.boss) {
      markInvalidRun("boss run was finished below the required score");
      archiveAttempt("invalid");
      render();
      return;
    }
    if (numericScore > levelScoreCaps.boss) {
      markTampered("boss score exceeded the allowed cap");
      session.completedAt ||= Date.now();
      session.activeLevel = null;
      saveSession();
      render();
      return;
    }
    completeLevel("boss", numericScore);
    session.completedAt ||= Date.now();
    session.activeLevel = null;
    saveSession();
    finishServerRun(numericScore);
    archiveAttempt("completed");
    render();
  }

  function resetFullRun() {
    if (!window.confirm("Archive this attempt and reset all game progress?")) return;
    archiveAttempt("reset");
    [
      "socialCreditSkill",
      "socialCreditFastPopups",
      "socialCreditAutoClicker",
      "socialCreditClickPower",
      "socialCreditSigils",
      "flappyBest",
      "level2Complete",
      "level3Complete",
      "bossScore",
      "bossRunSave",
      TRUSTED_PROGRESS_KEY
    ].forEach(key => localStorage.removeItem(key));
    session = freshSession();
    saveSession();
    window.location.href = appUrl("payment.html");
  }

  function updateAgentSuffix(value) {
    const suffix = String(value || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20) || "CADET";
    const agent = `AGENT-VECTOR-${suffix}`;
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ agent, suffix }));
    session.agent = agent;
    saveSession();
    writeTrustedProgress();
    render();
    return agent;
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return "00:00";
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = seconds % 60;
    return [hours, minutes, remaining].map(value => String(value).padStart(2, "0")).join(":");
  }

  function levelDuration(level) {
    if (!level.startedAt) return 0;
    return (level.completedAt || Date.now()) - level.startedAt;
  }

  function injectUi() {
    document.documentElement.dataset.agentTrackerVersion = TRACKER_VERSION;
    const style = document.createElement("style");
    style.textContent = `
      .agent-session-bar{position:fixed;right:12px;top:12px;z-index:9998;display:flex;align-items:center;gap:8px;padding:7px 9px;border:2px solid #fff;color:#fff;background:#080808;box-shadow:4px 4px 0 #000;font:800 12px Arial,sans-serif}
      .agent-session-bar button{width:34px;height:32px;padding:0;border:2px solid #fff;color:#fff;background:#c40000;font-size:20px;cursor:pointer}
      .agent-session-menu{position:fixed;right:12px;top:58px;z-index:9999;display:none;width:min(390px,calc(100vw - 24px));max-height:calc(100vh - 75px);overflow:auto;padding:14px;border:3px solid #ffe600;color:#fff;background:#080808;box-shadow:7px 7px 0 #000;font:700 13px Arial,sans-serif}
      .agent-session-menu.open{display:block}.agent-session-menu h2{margin:0 0 10px;color:#ffe600;font-size:19px}.agent-session-menu table{width:100%;border-collapse:collapse}.agent-session-menu th,.agent-session-menu td{border:1px solid #777;padding:6px;text-align:left}.agent-session-menu th{color:#ff5858}.agent-session-menu .complete{color:#35ff65}.agent-session-menu .active{color:#ffe600}
      .agent-session-menu .tampered{color:#ff9f9f}
      .agent-session-menu h3{margin:16px 0 7px;color:#ff5858}.agent-menu-actions,.agent-level-select{display:flex;flex-wrap:wrap;gap:7px}.agent-session-menu a,.agent-session-menu button{display:inline-flex;min-height:32px;align-items:center;padding:6px 9px;border:2px solid #fff;color:#000;background:#ffe600;text-decoration:none;font:800 12px Arial,sans-serif;cursor:pointer}.agent-session-menu .danger{color:#fff;background:#c40000}.agent-session-menu details{margin-top:12px;border:1px solid #777;padding:7px}.agent-session-menu summary{color:#ffe600;cursor:pointer}
    `;
    document.head.appendChild(style);

    const bar = document.createElement("div");
    bar.className = "agent-session-bar";
    bar.innerHTML = `<span id="agent-mini"></span><span id="score-mini"></span><span id="time-mini"></span><button type="button" aria-label="Open agent menu">☰</button>`;
    document.body.appendChild(bar);

    const menu = document.createElement("aside");
    menu.className = "agent-session-menu";
    menu.id = "agent-session-menu";
    document.body.appendChild(menu);
    bar.querySelector("button").addEventListener("click", () => menu.classList.toggle("open"));
  }

  function render() {
    const now = Date.now();
    const end = session.completedAt || now;
    const elapsed = session.startedAt ? end - session.startedAt : 0;
    document.getElementById("agent-mini").textContent = session.agent;
    document.getElementById("score-mini").textContent = `★ ${session.totalScore.toLocaleString()}`;
    document.getElementById("time-mini").textContent = formatDuration(elapsed);
    const rows = Object.entries(session.levels).map(([name, level]) => `
      <tr>
        <td>${name}</td>
        <td>${(level.score || 0).toLocaleString()}</td>
        <td>${formatDuration(levelDuration(level))}</td>
        <td class="${level.completedAt ? "complete" : "active"}">${level.completedAt ? "DONE" : "ACTIVE"}</td>
      </tr>`).join("");
    const attempts = readHistory();
    const level1Unlocked = true;
    const level2Unlocked = requirementMet(pageRequirements.level2);
    const level3Unlocked = requirementMet(pageRequirements.level3);
    const bossUnlocked = requirementMet(pageRequirements.boss);
    const levelLink = (href, label, unlocked) => unlocked
      ? `<a href="${appUrl(href)}">${label}</a>`
      : `<button type="button" disabled title="Locked">${label} 🔒</button>`;
    const attemptRows = attempts.map((attempt, index) => `
      <tr><td>${index + 1}</td><td>${attempt.agent}</td><td>${(attempt.totalScore || 0).toLocaleString()}</td><td>${formatDuration((attempt.completedAt || Date.now()) - (attempt.startedAt || attempt.completedAt || Date.now()))}</td></tr>
    `).join("");
    const previewRows = [
      { agent: "Ruler of North Korea", finalScore: 999999999, elapsedMs: 724000 },
      { agent: "AGENT-VECTOR-REDSTAR", finalScore: 48200000, elapsedMs: 2058000 },
      { agent: "AGENT-VECTOR-MOON", finalScore: 19600000, elapsedMs: 2943000 },
      { agent: session.agent, finalScore: session.totalScore, elapsedMs: elapsed }
    ].sort((a, b) => b.finalScore - a.finalScore || a.elapsedMs - b.elapsedMs);
    const worldEntries = leaderboardCache.length ? leaderboardCache : previewRows;
    const worldRows = worldEntries.map((entry, index) => {
      const score = Number(entry.finalScore ?? entry.score ?? 0);
      const time = Number(entry.elapsedMs || 0);
      const status = entry.tampered ? `0 - ${entry.tamperReason || "modified run"}` : score.toLocaleString();
      return `<tr class="${entry.tampered ? "tampered" : ""}"><td>${index + 1}</td><td>${entry.agent || entry.player}</td><td>${status}</td><td>${formatDuration(time)}</td></tr>`;
    }).join("");
    const official = session.officialResult;
    const officialLine = official
      ? `${official.finalScore.toLocaleString()} in ${formatDuration(official.elapsedMs)}${official.tamperReason ? ` (${official.tamperReason})` : ""}`
      : session.serverRun ? "Run is being verified on completion." : "Not connected yet. Start a level to create an official run.";
    const menu = document.getElementById("agent-session-menu");
    const detailsState = [...menu.querySelectorAll("details")].map(details => details.open);
    const menuScroll = menu.scrollTop;
    menu.innerHTML = `
      <h2>Agent Session</h2>
      <p><b>${session.agent}</b></p>
      <p>Current time: ${new Date().toLocaleTimeString()}</p>
      <p>Total score: ${session.totalScore.toLocaleString()}</p>
      <p>Total run time: ${formatDuration(elapsed)}</p>
      <p>Status: ${session.tampered ? `<span class="tampered">TAMPERED: ${session.tamperReason || "modified local storage"}</span>` : session.invalidRun ? `<span class="tampered">INVALID: ${session.invalidReason || "run failed validation"}</span>` : session.completedAt ? '<span class="complete">COMPLETED</span>' : session.startedAt ? '<span class="active">RUNNING</span>' : "NOT STARTED"}</p>
      <p>Official score: ${officialLine}</p>
      <div class="agent-menu-actions">
        <a href="${appUrl("profile.html")}">Edit Profile</a>
        <button class="danger" id="agent-reset-run" type="button">Reset Run</button>
      </div>
      <h3>Level Select</h3>
      <div class="agent-level-select">
        ${levelLink("payment.html", "Level 1", level1Unlocked)}
        ${levelLink("level2.html", "Level 2", level2Unlocked)}
        ${levelLink("level3.html", "Level 3", level3Unlocked)}
        ${levelLink("boss.html", "Boss", bossUnlocked)}
      </div>
      <p>Unlocks: Level 2 at 200,000 Level 1 points. Level 3 teleport after first completion. Boss after all requirements.</p>
      <h3>Current Attempt</h3>
      <table><thead><tr><th>Level</th><th>Score</th><th>Time</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No levels entered</td></tr>'}</tbody></table>
      <details><summary>Attempt Leaderboard (${attempts.length})</summary><table><thead><tr><th>#</th><th>Agent</th><th>Score</th><th>Time</th></tr></thead><tbody>${attemptRows || '<tr><td colspan="4">No archived attempts yet</td></tr>'}</tbody></table></details>
      <details><summary>${leaderboardCache.length ? "Official World Leaderboard" : "World Leaderboard Preview"}</summary><table><thead><tr><th>#</th><th>Agent</th><th>Score</th><th>Time</th></tr></thead><tbody>${worldRows}</tbody></table><p>${leaderboardCache.length ? "Server-verified ranking. Faster runs with more social credit rank higher; modified or impossible runs score 0." : "Preview only until the deployed API is available."}</p></details>`;
    [...menu.querySelectorAll("details")].forEach((details, index) => { details.open = Boolean(detailsState[index]); });
    menu.scrollTop = menuScroll;
    document.getElementById("agent-reset-run").addEventListener("click", resetFullRun);
  }

  injectUi();
  recalculateTotal();
  startLevel(page);
  saveSession();
  render();
  void refreshLeaderboard();
  window.setInterval(render, 1000);

  window.AgentSession = {
    version: TRACKER_VERSION,
    get agent() { return session.agent; },
    get data() { return session; },
    startLevel,
    completeLevel,
    setLevelScore,
    finishRun,
    resetFullRun,
    updateAgentSuffix,
    newSession() {
      session = freshSession();
      saveSession();
      writeTrustedProgress();
      startLevel(page);
      render();
    }
  };
})();
