let initializeApp;
let getAuth;
let onAuthStateChanged;
let signInAnonymously;
let get;
let getDatabase;
let onDisconnect;
let onValue;
let ref;
let runTransaction;
let set;
let update;

function createSilentAudioManager() {
  return {
    isEnabled: () => false,
    isSupported: () => false,
    unlock: () => Promise.resolve(),
    toggle: () => {},
    setEnabled: () => {},
    isUnlocked: () => true,
    playSpin: () => {},
    stopSpin: () => {},
    playReveal: () => {},
    playShuffle: () => {},
    playResetLaugh: () => {},
    playVictory: () => {},
  };
}

const firebaseConfig = {
  apiKey: "AIzaSyDXJgtdIxVTghU_o-gQ_B3PVfyudMxSn9I",
  authDomain: "display-panel-eb884.firebaseapp.com",
  databaseURL: "https://display-panel-eb884-default-rtdb.firebaseio.com",
  projectId: "display-panel-eb884",
  storageBucket: "display-panel-eb884.firebasestorage.app",
  messagingSenderId: "999575050619",
  appId: "1:999575050619:web:e0e2f1df9ad804f63d85de",
  measurementId: "G-8SVB7ZSV1Q",
};

const TOTAL_NUMBERS = 100;
const CARD_SIZE = 5;
const REQUIRED_LINES = 5;
const SPIN_DURATION = 3200;
const TAU = Math.PI * 2;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const wheelCanvas = document.querySelector("#wheelCanvas");
const boardElement = document.querySelector("#board");
const spinButton = document.querySelector("#spinButton");
const newCardButton = document.querySelector("#newCardButton");
const resetButton = document.querySelector("#resetButton");
const soundButton = document.querySelector("#soundButton");
const soundButtonLabel = document.querySelector("#soundButtonLabel");
const soundPrompt = document.querySelector("#soundPrompt");
const createRoomButton = document.querySelector("#createRoomButton");
const joinRoomButton = document.querySelector("#joinRoomButton");
const copyRoomButton = document.querySelector("#copyRoomButton");
const playerNameInput = document.querySelector("#playerNameInput");
const roomCodeInput = document.querySelector("#roomCodeInput");
const activeRoomCodeElement = document.querySelector("#activeRoomCode");
const roomMessageElement = document.querySelector("#roomMessage");
const connectionStatusElement = document.querySelector("#connectionStatus");
const playerCountElement = document.querySelector("#playerCount");
const playerListElement = document.querySelector("#playerList");
const currentNumberElement = document.querySelector("#currentNumber");
const lineCountElement = document.querySelector("#lineCount");
const remainingCountElement = document.querySelector("#remainingCount");
const calledCountElement = document.querySelector("#calledCount");
const calledListElement = document.querySelector("#calledList");
const lineMeterElement = document.querySelector("#lineMeter");
const statusTextElement = document.querySelector("#statusText");
const awardOverlay = document.querySelector("#awardOverlay");
const awardCloseButton = document.querySelector("#awardCloseButton");
const awardWinnerName = document.querySelector("#awardWinnerName");
const awardWinnerDetail = document.querySelector("#awardWinnerDetail");
const ctx = wheelCanvas.getContext("2d");

let app = null;
let db = null;
let auth = null;
let audio = window.createAudioManager ? window.createAudioManager() : createSilentAudioManager();
const palette = ["#dc3f45", "#f3b735", "#008f8a", "#7257bd", "#5e9f45"];

let cardNumbers = [];
let calledNumbers = [];
let calledSet = new Set();
let completedLineKeys = new Set();
let winningCellIndexes = new Set();
let lastHitNumber = null;
let wheelRotation = 0;
let isSpinning = false;
let gameOver = false;
let currentUser = null;
let roomId = null;
let roomState = null;
let unsubscribeRoom = null;
let lastCurrentNumber = null;
let lastAnimatedSpinId = null;
let lastSyncedLineCount = null;
let lastCelebratedWinnerKey = null;
let dismissedWinnerKey = null;
let lastRoomSoundEventId = null;
let firebaseReady = false;
let authReady = false;

function range(count) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function normalizeNumbers(values) {
  const list = Array.isArray(values) ? values : Object.values(values || {});
  const clean = list
    .map((number) => Number(number))
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= TOTAL_NUMBERS);
  return [...new Set(clean)];
}

function normalizeCard(values) {
  const clean = normalizeNumbers(values);
  return clean.length === CARD_SIZE * CARD_SIZE ? clean : [];
}

function createCard() {
  cardNumbers = shuffle(range(TOTAL_NUMBERS)).slice(0, CARD_SIZE * CARD_SIZE);
  lastHitNumber = null;
  return [...cardNumbers];
}

function resetDraws() {
  audio.stopSpin();
  calledNumbers = [];
  calledSet = new Set();
  completedLineKeys = new Set();
  winningCellIndexes = new Set();
  lastHitNumber = null;
  lastCurrentNumber = null;
  lastCelebratedWinnerKey = null;
  dismissedWinnerKey = null;
  gameOver = false;
  wheelRotation = 0;
  awardOverlay.hidden = true;
  currentNumberElement.textContent = "--";
  statusTextElement.textContent = roomId ? "房間已連線" : "單機模式";
  statusTextElement.classList.remove("win");
}

function buildLineDefinitions() {
  const lines = [];

  for (let row = 0; row < CARD_SIZE; row += 1) {
    lines.push({
      key: `row-${row}`,
      cells: range(CARD_SIZE).map((column) => row * CARD_SIZE + column - 1),
    });
  }

  for (let column = 0; column < CARD_SIZE; column += 1) {
    lines.push({
      key: `column-${column}`,
      cells: range(CARD_SIZE).map((row) => (row - 1) * CARD_SIZE + column),
    });
  }

  lines.push({
    key: "diagonal-main",
    cells: range(CARD_SIZE).map((index) => (index - 1) * CARD_SIZE + index - 1),
  });
  lines.push({
    key: "diagonal-cross",
    cells: range(CARD_SIZE).map((index) => (index - 1) * CARD_SIZE + (CARD_SIZE - index)),
  });

  return lines;
}

const lineDefinitions = buildLineDefinitions();

function getLineResult(card, called) {
  const numberSet = new Set(called);
  const lineKeys = new Set();
  const cellIndexes = new Set();

  lineDefinitions.forEach((line) => {
    const isComplete = line.cells.every((cellIndex) => numberSet.has(card[cellIndex]));
    if (isComplete) {
      lineKeys.add(line.key);
      line.cells.forEach((cellIndex) => cellIndexes.add(cellIndex));
    }
  });

  return { lineKeys, cellIndexes };
}

function calculateLines() {
  const result = getLineResult(cardNumbers, calledNumbers);
  completedLineKeys = result.lineKeys;
  winningCellIndexes = result.cellIndexes;
}

function countCompletedLines(card, called) {
  return getLineResult(normalizeCard(card), normalizeNumbers(called)).lineKeys.size;
}

function getPotentialWinningNumbers(card, called) {
  const cleanCard = normalizeCard(card);
  const cleanCalled = normalizeNumbers(called);
  const calledNumberSet = new Set(cleanCalled);

  if (!cleanCard.length || countCompletedLines(cleanCard, cleanCalled) >= REQUIRED_LINES) {
    return [];
  }

  return cleanCard.filter((number) => {
    if (calledNumberSet.has(number)) {
      return false;
    }
    return countCompletedLines(cleanCard, [...cleanCalled, number]) >= REQUIRED_LINES;
  });
}

function getNearWinPlayers() {
  if (isRoomMode() && roomState?.players) {
    return Object.entries(roomState.players)
      .map(([uid, player]) => ({
        uid,
        name: player?.name || `玩家${uid.slice(0, 4).toUpperCase()}`,
        numbers: getPotentialWinningNumbers(player?.cardNumbers, calledNumbers),
      }))
      .filter((player) => player.numbers.length > 0);
  }

  const numbers = getPotentialWinningNumbers(cardNumbers, calledNumbers);
  return numbers.length ? [{ uid: "local", name: getPlayerName(), numbers }] : [];
}

function isAnyoneCloseToWin() {
  return getNearWinPlayers().length > 0;
}

function getPlayerName() {
  const clean = playerNameInput.value.trim().slice(0, 12);
  if (clean) {
    return clean;
  }
  return currentUser ? `玩家${currentUser.uid.slice(0, 4).toUpperCase()}` : "玩家";
}

function savePlayerName() {
  localStorage.setItem("bingoPlayerName", getPlayerName());
}

function setRoomMessage(message) {
  roomMessageElement.textContent = message;
}

function sanitizeRoomCode(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function generateRoomCode() {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function roomNodeRef(code = roomId) {
  if (!db || !ref) {
    throw new Error("Firebase 尚未連線");
  }
  return ref(db, `rooms/${code}`);
}

function playerNodeRef(code = roomId, uid = currentUser?.uid) {
  if (!db || !ref) {
    throw new Error("Firebase 尚未連線");
  }
  return ref(db, `rooms/${code}/players/${uid}`);
}

function buildPlayer(card, isHost = false) {
  return {
    name: getPlayerName(),
    cardNumbers: card,
    lineCount: 0,
    isHost,
    online: true,
    joinedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function updateUrlRoom(code) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  window.history.replaceState(null, "", url);
}

function clearUrlRoom() {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState(null, "", url);
}

function isRoomHost() {
  return Boolean(roomState && currentUser && roomState.hostId === currentUser.uid);
}

function isRoomSpinning() {
  return roomState?.status === "spinning";
}

function isRoomMode() {
  return Boolean(roomId);
}

function getPlayers() {
  return Object.entries(roomState?.players || {}).map(([uid, player]) => ({
    uid,
    name: player?.name || `玩家${uid.slice(0, 4).toUpperCase()}`,
    lineCount: Number(player?.lineCount || 0),
    isHost: roomState?.hostId === uid || Boolean(player?.isHost),
    online: player?.online !== false,
  }));
}

function renderBoard() {
  boardElement.replaceChildren();

  cardNumbers.forEach((number, index) => {
    const cell = document.createElement("div");
    cell.className = "board-cell";
    cell.textContent = number;

    if (calledSet.has(number)) {
      cell.classList.add("marked");
    }

    if (winningCellIndexes.has(index)) {
      cell.classList.add("complete");
    }

    if (number === lastHitNumber) {
      cell.classList.add("just-hit");
    }

    boardElement.append(cell);
  });
}

function renderLineMeter() {
  const filledCount = Math.min(completedLineKeys.size, REQUIRED_LINES);
  [...lineMeterElement.children].forEach((segment, index) => {
    segment.classList.toggle("filled", index < filledCount);
  });
}

function renderHistory() {
  calledListElement.replaceChildren();

  calledNumbers
    .slice()
    .reverse()
    .forEach((number, index) => {
      const chip = document.createElement("div");
      chip.className = "called-number";
      chip.textContent = number;
      if (index === 0) {
        chip.classList.add("latest");
      }
      calledListElement.append(chip);
    });
}

function renderPlayers() {
  const players = getPlayers().sort((first, second) => {
    if (first.isHost !== second.isHost) {
      return first.isHost ? -1 : 1;
    }
    if (first.online !== second.online) {
      return first.online ? -1 : 1;
    }
    return first.name.localeCompare(second.name, "zh-Hant");
  });

  playerCountElement.textContent = players.length;
  playerListElement.replaceChildren();

  players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "player-row";
    if (roomState?.winner?.uid === player.uid) {
      row.classList.add("winner");
    }

    const main = document.createElement("div");
    main.className = "player-main";

    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = player.uid === currentUser?.uid ? `${player.name}（你）` : player.name;

    const meta = document.createElement("div");
    meta.className = "player-meta";

    if (player.isHost) {
      const tag = document.createElement("span");
      tag.className = "player-tag host";
      tag.textContent = "房主";
      meta.append(tag);
    }

    const onlineTag = document.createElement("span");
    onlineTag.className = `player-tag${player.online ? "" : " offline"}`;
    onlineTag.textContent = player.online ? "在線" : "離線";
    meta.append(onlineTag);

    const lines = document.createElement("div");
    lines.className = "player-lines";
    lines.textContent = `${Math.min(player.lineCount, REQUIRED_LINES)}/5`;

    main.append(name, meta);
    row.append(main, lines);
    playerListElement.append(row);
  });
}

function renderRoomControls() {
  activeRoomCodeElement.textContent = roomId || "------";
  roomCodeInput.value = roomId || roomCodeInput.value;
  connectionStatusElement.textContent = authReady
    ? (roomId ? "已連線" : "已登入")
    : (firebaseReady ? "登入中" : "單機模式");
  copyRoomButton.disabled = !roomId;
  createRoomButton.disabled = !firebaseReady || !authReady || isSpinning;
  joinRoomButton.disabled = !firebaseReady || !authReady || isSpinning;
  renderSoundButton();
}

function renderSoundButton() {
  const enabled = audio.isEnabled();
  const needsUnlock = enabled && audio.isSupported() && !audio.isUnlocked();
  soundButton.classList.toggle("muted", !enabled);
  soundButtonLabel.textContent = needsUnlock ? "點我開聲" : (enabled ? "音效開" : "音效關");
  soundButton.setAttribute("aria-pressed", enabled ? "true" : "false");
  soundButton.disabled = !audio.isSupported();
  soundPrompt.hidden = !needsUnlock;
}

function getCurrentWinner() {
  if (roomState?.winner) {
    return roomState.winner;
  }

  if (!isRoomMode() && completedLineKeys.size >= REQUIRED_LINES) {
    return {
      uid: "local",
      name: getPlayerName(),
      lineCount: completedLineKeys.size,
      wonAt: "local",
    };
  }

  return null;
}

function getWinnerKey(winner) {
  if (!winner) {
    return "";
  }
  return `${winner.uid || winner.name}-${winner.wonAt || ""}`;
}

function renderAward() {
  const winner = getCurrentWinner();
  if (!winner) {
    awardOverlay.hidden = true;
    lastCelebratedWinnerKey = null;
    dismissedWinnerKey = null;
    return;
  }

  const key = getWinnerKey(winner);
  awardWinnerName.textContent = winner.uid === currentUser?.uid ? `${winner.name || "你"}（你）` : winner.name || "玩家";
  awardWinnerDetail.textContent = `完成 ${Math.min(Number(winner.lineCount || REQUIRED_LINES), REQUIRED_LINES)} 條線`;

  if (lastCelebratedWinnerKey !== key && audio.isUnlocked()) {
    lastCelebratedWinnerKey = key;
    dismissedWinnerKey = null;
    audio.playVictory();
  }

  awardOverlay.hidden = dismissedWinnerKey === key;
}

function createRoomSoundEvent(type) {
  return {
    id: `${Date.now()}-${currentUser?.uid || "local"}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    by: currentUser?.uid || null,
    createdAt: Date.now(),
  };
}

async function emitRoomSoundEvent(type) {
  if (!roomId || !currentUser || !firebaseReady) {
    return;
  }

  await update(roomNodeRef(), {
    soundEvent: createRoomSoundEvent(type),
    updatedAt: Date.now(),
  });
}

function handleRoomSoundEvent(event) {
  if (!event?.id || event.id === lastRoomSoundEventId) {
    return;
  }

  lastRoomSoundEventId = event.id;
  const age = Date.now() - Number(event.createdAt || 0);
  if (age > 12000 || age < -5000) {
    return;
  }

  if (event.type === "shuffle") {
    audio.playShuffle();
  }

  if (event.type === "reset") {
    audio.playResetLaugh();
  }

  if (event.type === "spin") {
    audio.playSpin({
      danger: Boolean(event.danger),
      duration: Number(event.duration) || SPIN_DURATION,
    });
  }

  if (event.type === "reveal") {
    audio.stopSpin();
    const number = Number(event.number);
    audio.playReveal(cardNumbers.includes(number));
  }
}

function renderStatusText() {
  statusTextElement.classList.toggle("win", gameOver);

  if (roomState?.winner) {
    statusTextElement.textContent = `${roomState.winner.name || "玩家"} 勝利`;
    return;
  }

  if (isRoomSpinning() || isSpinning) {
    statusTextElement.textContent = "旋轉中";
    return;
  }

  if (gameOver) {
    statusTextElement.textContent = "勝利";
    return;
  }

  if (lastCurrentNumber) {
    statusTextElement.textContent = cardNumbers.includes(lastCurrentNumber) ? "命中卡片" : "未命中";
    return;
  }

  statusTextElement.textContent = roomId ? "房間已連線" : "單機模式";
}

function renderScore() {
  const remaining = TOTAL_NUMBERS - calledNumbers.length;
  const roomLocked = isRoomSpinning();
  const canHostSpin = !isRoomMode() || isRoomHost();
  const canChangeCard = !isRoomMode() || calledNumbers.length === 0;
  const canReset = !isRoomMode() || isRoomHost();

  lineCountElement.textContent = `${Math.min(completedLineKeys.size, REQUIRED_LINES)}/${REQUIRED_LINES}`;
  remainingCountElement.textContent = remaining;
  calledCountElement.textContent = calledNumbers.length;
  spinButton.disabled = isSpinning || roomLocked || gameOver || remaining === 0 || !canHostSpin;
  newCardButton.disabled = isSpinning || roomLocked || gameOver || !canChangeCard;
  resetButton.disabled = isSpinning || roomLocked || !canReset;
}

function renderGame() {
  calculateLines();
  gameOver = Boolean(roomState?.winner) || (!isRoomMode() && completedLineKeys.size >= REQUIRED_LINES);

  if (!isRoomMode() && completedLineKeys.size >= REQUIRED_LINES) {
    statusTextElement.classList.add("win");
  }

  renderBoard();
  renderLineMeter();
  renderHistory();
  renderPlayers();
  renderRoomControls();
  renderStatusText();
  renderScore();
  renderAward();
  syncPlayerProgress().catch((error) => setRoomMessage(`進度同步失敗：${error.message}`));
}

function drawWheel() {
  const ratio = window.devicePixelRatio || 1;
  const size = wheelCanvas.width / ratio;
  const center = size / 2;
  const radius = center - 18;
  const slice = TAU / TOTAL_NUMBERS;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(center, center);

  for (let index = 0; index < TOTAL_NUMBERS; index += 1) {
    const start = wheelRotation + index * slice - Math.PI / 2;
    const end = start + slice;
    const number = index + 1;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = calledSet.has(number) ? "#c7d0df" : palette[index % palette.length];
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.74)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const labelAngle = start + slice / 2;
    ctx.save();
    ctx.rotate(labelAngle);
    ctx.translate(radius * 0.82, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = calledSet.has(number) ? "#566174" : "#fff";
    ctx.font = `${size >= 480 ? 10 : 8}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(number, 0, 0);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.34, 0, TAU);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#172033";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, radius - 2, 0, TAU);
  ctx.lineWidth = 12;
  ctx.strokeStyle = "#172033";
  ctx.stroke();

  ctx.restore();
}

function resizeWheelCanvas() {
  const displaySize = Math.round(wheelCanvas.getBoundingClientRect().width);
  const ratio = window.devicePixelRatio || 1;
  const pixelSize = Math.max(360, displaySize * ratio);
  wheelCanvas.width = pixelSize;
  wheelCanvas.height = pixelSize;
  drawWheel();
}

function chooseNextNumberFrom(called) {
  const calledNumberSet = new Set(called);
  const remainingNumbers = range(TOTAL_NUMBERS).filter((number) => !calledNumberSet.has(number));
  return remainingNumbers[Math.floor(Math.random() * remainingNumbers.length)];
}

function chooseNextNumber() {
  return chooseNextNumberFrom(calledNumbers);
}

function targetRotationForNumber(number) {
  const index = number - 1;
  const slice = TAU / TOTAL_NUMBERS;
  const pointerAngle = -Math.PI / 2;
  const segmentCenter = index * slice + slice / 2 - Math.PI / 2;
  let target = pointerAngle - segmentCenter;

  while (target < wheelRotation + TAU * 5) {
    target += TAU;
  }

  return target + TAU * Math.floor(Math.random() * 3);
}

function easeOutCubic(progress) {
  return 1 - Math.pow(1 - progress, 3);
}

function animateWheelToNumber(nextNumber, onComplete, duration = SPIN_DURATION, options = {}) {
  const { playAudio = true } = options;
  isSpinning = true;
  lastHitNumber = null;
  statusTextElement.textContent = "旋轉中";
  statusTextElement.classList.remove("win");
  if (playAudio) {
    audio.playSpin({ danger: isAnyoneCloseToWin(), duration });
  }
  renderScore();
  renderBoard();

  const startRotation = wheelRotation;
  const endRotation = targetRotationForNumber(nextNumber);
  const startTime = performance.now();

  function animate(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    wheelRotation = startRotation + (endRotation - startRotation) * easeOutCubic(progress);
    drawWheel();

    if (progress < 1) {
      requestAnimationFrame(animate);
      return;
    }

    wheelRotation %= TAU;
    isSpinning = false;
    if (playAudio) {
      audio.stopSpin();
      audio.playReveal(cardNumbers.includes(nextNumber));
    }
    onComplete();
  }

  requestAnimationFrame(animate);
}

function localSpinWheel() {
  if (isSpinning || gameOver || calledNumbers.length >= TOTAL_NUMBERS) {
    return;
  }

  const nextNumber = chooseNextNumber();
  animateWheelToNumber(nextNumber, () => {
    calledNumbers.push(nextNumber);
    calledSet.add(nextNumber);
    lastHitNumber = nextNumber;
    lastCurrentNumber = nextNumber;
    currentNumberElement.textContent = nextNumber;
    drawWheel();
    renderGame();
  });
}

async function requestRoomSpin() {
  if (!roomId || !currentUser || !isRoomHost() || isRoomSpinning() || gameOver) {
    return;
  }

  setRoomMessage("送出旋轉");
  const result = await runTransaction(roomNodeRef(), (room) => {
    if (!room || room.status === "spinning" || room.winner) {
      return room;
    }

    const called = normalizeNumbers(room.calledNumbers);
    if (called.length >= TOTAL_NUMBERS) {
      return room;
    }

    const targetNumber = chooseNextNumberFrom(called);
    const spinId = Number(room.lastSpinId || room.spin?.id || 0) + 1;
    const startedAt = Date.now();
    room.status = "spinning";
    room.lastSpinId = spinId;
    room.spin = {
      id: spinId,
      targetNumber,
      startedBy: currentUser.uid,
      startedAt,
      duration: SPIN_DURATION,
    };
    room.soundEvent = {
      id: `spin-${spinId}-${startedAt}`,
      type: "spin",
      by: currentUser.uid,
      spinId,
      targetNumber,
      danger: isAnyoneCloseToWin(),
      duration: SPIN_DURATION,
      createdAt: startedAt,
    };
    room.updatedAt = Date.now();
    return room;
  });

  if (!result.committed) {
    setRoomMessage("目前不能旋轉");
  }
}

async function finishRoomSpin(spin) {
  if (!roomId || !currentUser) {
    return;
  }

  await runTransaction(roomNodeRef(), (room) => {
    if (!room || !room.spin || room.spin.id !== spin.id || room.status !== "spinning") {
      return room;
    }

    const targetNumber = Number(room.spin.targetNumber);
    const called = normalizeNumbers(room.calledNumbers);
    if (!called.includes(targetNumber)) {
      called.push(targetNumber);
    }

    room.calledNumbers = called;
    room.currentNumber = targetNumber;
    room.status = "playing";
    room.spin = null;
    room.soundEvent = {
      id: `reveal-${spin.id}-${Date.now()}`,
      type: "reveal",
      by: currentUser.uid,
      spinId: spin.id,
      number: targetNumber,
      createdAt: Date.now(),
    };
    room.updatedAt = Date.now();
    return room;
  });
}

function spinWheel() {
  if (isRoomMode()) {
    requestRoomSpin().catch((error) => setRoomMessage(`旋轉失敗：${error.message}`));
    return;
  }

  localSpinWheel();
}

async function startNewCard() {
  if (isRoomMode()) {
    if (!currentUser || calledNumbers.length > 0 || gameOver) {
      setRoomMessage("開號後不能換卡");
      return;
    }

    const nextCard = createCard();
    await update(playerNodeRef(), {
      cardNumbers: nextCard,
      lineCount: 0,
      updatedAt: Date.now(),
    });
    await emitRoomSoundEvent("shuffle");
    setRoomMessage("已更換你的數字卡");
    return;
  }

  createCard();
  resetDraws();
  audio.playShuffle();
  resizeWheelCanvas();
  renderGame();
}

async function restartSameCard() {
  if (isRoomMode()) {
    if (!currentUser || !isRoomHost()) {
      setRoomMessage("只有房主可以重開");
      return;
    }

    await runTransaction(roomNodeRef(), (room) => {
      if (!room) {
        return room;
      }

      const soundEvent = createRoomSoundEvent("reset");
      room.calledNumbers = [];
      room.currentNumber = null;
      room.status = "waiting";
      room.spin = null;
      room.winner = null;
      room.soundEvent = soundEvent;
      room.updatedAt = Date.now();

      Object.keys(room.players || {}).forEach((uid) => {
        room.players[uid].lineCount = 0;
        room.players[uid].updatedAt = Date.now();
      });

      return room;
    });

    setRoomMessage("房間已重開");
    return;
  }

  resetDraws();
  audio.playResetLaugh();
  resizeWheelCanvas();
  renderGame();
}

async function createRoom() {
  if (!currentUser) {
    setRoomMessage("Firebase 尚未登入");
    return;
  }

  savePlayerName();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateRoomCode();
    const card = createCard();
    const room = {
      version: 1,
      hostId: currentUser.uid,
      status: "waiting",
      currentNumber: null,
      calledNumbers: [],
      lastSpinId: 0,
      spin: null,
      soundEvent: null,
      winner: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      players: {
        [currentUser.uid]: buildPlayer(card, true),
      },
    };

    const result = await runTransaction(roomNodeRef(code), (existingRoom) => {
      if (existingRoom) {
        return undefined;
      }
      return room;
    });

    if (result.committed) {
      onDisconnect(playerNodeRef(code, currentUser.uid)).update({
        online: false,
        updatedAt: Date.now(),
      });
      connectToRoom(code);
      updateUrlRoom(code);
      setRoomMessage("房間已建立");
      return;
    }
  }

  setRoomMessage("房號產生失敗，請再試一次");
}

async function joinRoom(code = roomCodeInput.value) {
  if (!currentUser) {
    setRoomMessage("Firebase 尚未登入");
    return;
  }

  const cleanCode = sanitizeRoomCode(code);
  if (cleanCode.length !== 6) {
    setRoomMessage("請輸入 6 碼房號");
    return;
  }

  savePlayerName();
  const snapshot = await get(roomNodeRef(cleanCode));
  if (!snapshot.exists()) {
    setRoomMessage("找不到這個房間");
    return;
  }

  const playerSnapshot = await get(playerNodeRef(cleanCode, currentUser.uid));
  const oldPlayer = playerSnapshot.val();
  const existingCard = normalizeCard(playerSnapshot.val()?.cardNumbers);
  const playerCard = existingCard.length ? existingCard : createCard();
  const lineCount = Number(oldPlayer?.lineCount ?? countCompletedLines(playerCard, snapshot.val()?.calledNumbers));

  if (!existingCard.length) {
    cardNumbers = playerCard;
  }

  await set(playerNodeRef(cleanCode, currentUser.uid), {
    ...buildPlayer(playerCard, snapshot.val()?.hostId === currentUser.uid),
    joinedAt: oldPlayer?.joinedAt || Date.now(),
    lineCount,
  });

  onDisconnect(playerNodeRef(cleanCode, currentUser.uid)).update({
    online: false,
    updatedAt: Date.now(),
  });

  connectToRoom(cleanCode);
  updateUrlRoom(cleanCode);
  setRoomMessage("已加入房間");
}

function connectToRoom(code) {
  if (unsubscribeRoom) {
    unsubscribeRoom();
  }

  roomId = code;
  roomCodeInput.value = code;
  lastAnimatedSpinId = null;
  lastCurrentNumber = null;
  lastSyncedLineCount = null;
  lastRoomSoundEventId = null;
  unsubscribeRoom = onValue(roomNodeRef(code), handleRoomSnapshot, (error) => {
    setRoomMessage(`同步失敗：${error.message}`);
  });
  renderRoomControls();
}

function leaveDeletedRoom() {
  roomId = null;
  roomState = null;
  resetDraws();
  clearUrlRoom();
  setRoomMessage("房間不存在或已被刪除");
  renderGame();
}

function handleRoomSnapshot(snapshot) {
  if (!snapshot.exists()) {
    leaveDeletedRoom();
    return;
  }

  const previousCurrent = lastCurrentNumber;
  roomState = snapshot.val();
  const player = roomState.players?.[currentUser?.uid];
  const roomCard = normalizeCard(player?.cardNumbers);

  if (roomCard.length) {
    cardNumbers = roomCard;
  }

  calledNumbers = normalizeNumbers(roomState.calledNumbers);
  calledSet = new Set(calledNumbers);
  handleRoomSoundEvent(roomState.soundEvent);
  lastCurrentNumber = Number(roomState.currentNumber) || null;
  currentNumberElement.textContent = lastCurrentNumber || "--";

  if (!lastCurrentNumber) {
    lastHitNumber = null;
  }

  if (lastCurrentNumber && lastCurrentNumber !== previousCurrent) {
    lastHitNumber = lastCurrentNumber;
  }

  if (roomState.status === "spinning" && roomState.spin?.targetNumber) {
    handleRemoteSpin(roomState.spin);
    return;
  }

  drawWheel();
  renderGame();
}

function handleRemoteSpin(spin) {
  renderGame();

  if (lastAnimatedSpinId === spin.id) {
    const startedAt = Number(spin.startedAt || 0);
    const duration = Number(spin.duration) || SPIN_DURATION;
    if (Date.now() - startedAt > duration + 1000) {
      finishRoomSpin(spin).catch((error) => setRoomMessage(`開號失敗：${error.message}`));
    }
    return;
  }

  lastAnimatedSpinId = spin.id;
  const targetNumber = Number(spin.targetNumber);
  animateWheelToNumber(targetNumber, () => {
    finishRoomSpin(spin).catch((error) => setRoomMessage(`開號失敗：${error.message}`));
  }, Number(spin.duration) || SPIN_DURATION, { playAudio: false });
}

async function syncPlayerProgress() {
  if (!roomId || !currentUser || !roomState?.players?.[currentUser.uid] || isRoomSpinning()) {
    return;
  }

  const lineCount = completedLineKeys.size;
  const currentPlayer = roomState.players[currentUser.uid];

  if (lineCount !== currentPlayer.lineCount && lineCount !== lastSyncedLineCount) {
    lastSyncedLineCount = lineCount;
    await update(playerNodeRef(), {
      lineCount,
      updatedAt: Date.now(),
    });
  }

  if (!roomState.winner && lineCount >= REQUIRED_LINES) {
    claimWin().catch((error) => setRoomMessage(`勝利同步失敗：${error.message}`));
  }
}

async function claimWin() {
  await runTransaction(roomNodeRef(), (room) => {
    if (!room || room.winner) {
      return room;
    }

    const player = room.players?.[currentUser.uid];
    if (!player) {
      return room;
    }

    const lineCount = countCompletedLines(player.cardNumbers, room.calledNumbers);
    if (lineCount < REQUIRED_LINES) {
      return room;
    }

    room.players[currentUser.uid].lineCount = lineCount;
    room.players[currentUser.uid].updatedAt = Date.now();
    room.winner = {
      uid: currentUser.uid,
      name: player.name || getPlayerName(),
      lineCount,
      wonAt: Date.now(),
    };
    room.status = "finished";
    room.updatedAt = Date.now();
    return room;
  });
}

async function copyRoomLink() {
  if (!roomId) {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);

  try {
    await navigator.clipboard.writeText(url.toString());
    setRoomMessage("房間連結已複製");
  } catch {
    setRoomMessage(url.toString());
  }
}

function initializePlayerName() {
  const storedName = localStorage.getItem("bingoPlayerName");
  if (storedName) {
    playerNameInput.value = storedName;
  }
}

async function loadFirebase() {
  if (window.location.protocol === "file:") {
    firebaseReady = false;
    authReady = false;
    setRoomMessage("直接開檔案：單機模式；多人請用 localhost 或 GitHub Pages");
    renderRoomControls();
    return false;
  }

  try {
    const [appModule, authModule, databaseModule] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.17.0/firebase-database.js"),
    ]);

    initializeApp = appModule.initializeApp;
    getAuth = authModule.getAuth;
    onAuthStateChanged = authModule.onAuthStateChanged;
    signInAnonymously = authModule.signInAnonymously;
    get = databaseModule.get;
    getDatabase = databaseModule.getDatabase;
    onDisconnect = databaseModule.onDisconnect;
    onValue = databaseModule.onValue;
    ref = databaseModule.ref;
    runTransaction = databaseModule.runTransaction;
    set = databaseModule.set;
    update = databaseModule.update;

    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    auth = getAuth(app);
    firebaseReady = true;
    renderRoomControls();
    return true;
  } catch (error) {
    firebaseReady = false;
    authReady = false;
    connectionStatusElement.textContent = "連線失敗";
    setRoomMessage(`多人連線載入失敗：${error.message}`);
    renderRoomControls();
    return false;
  }
}

async function initializeAuth() {
  const canUseFirebase = await loadFirebase();
  if (!canUseFirebase) {
    return;
  }

  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    authReady = Boolean(user);

    if (user && !playerNameInput.value.trim()) {
      playerNameInput.value = `玩家${user.uid.slice(0, 4).toUpperCase()}`;
    }

    renderRoomControls();

    const urlRoom = sanitizeRoomCode(new URLSearchParams(window.location.search).get("room") || "");
    if (user && urlRoom && !roomId) {
      joinRoom(urlRoom).catch((error) => setRoomMessage(`加入失敗：${error.message}`));
      return;
    }

    if (user) {
      setRoomMessage("可以建立或加入房間");
    }
  });

  signInAnonymously(auth).catch((error) => {
    connectionStatusElement.textContent = "登入失敗";
    setRoomMessage(`匿名登入失敗：${error.message}`);
    renderRoomControls();
  });
}

function primeAudio() {
  audio.unlock().then(() => {
    renderSoundButton();
    renderAward();
  });
}

function dismissAward() {
  dismissedWinnerKey = getWinnerKey(getCurrentWinner());
  awardOverlay.hidden = true;
}

function loadAudioManager() {
  if (window.createAudioManager && !audio.isSupported()) {
    audio = window.createAudioManager();
  }
  renderSoundButton();
}

document.addEventListener("pointerdown", primeAudio, { capture: true });
document.addEventListener("keydown", primeAudio, { capture: true });
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = sanitizeRoomCode(roomCodeInput.value);
});
playerNameInput.addEventListener("change", () => {
  savePlayerName();
  if (roomId && currentUser) {
    update(playerNodeRef(), {
      name: getPlayerName(),
      updatedAt: Date.now(),
    }).catch((error) => setRoomMessage(`名稱同步失敗：${error.message}`));
  }
});
spinButton.addEventListener("click", spinWheel);
newCardButton.addEventListener("click", () => {
  startNewCard().catch((error) => setRoomMessage(`換卡失敗：${error.message}`));
});
resetButton.addEventListener("click", () => {
  restartSameCard().catch((error) => setRoomMessage(`重開失敗：${error.message}`));
});
createRoomButton.addEventListener("click", () => {
  createRoom().catch((error) => setRoomMessage(`建立失敗：${error.message}`));
});
joinRoomButton.addEventListener("click", () => {
  joinRoom().catch((error) => setRoomMessage(`加入失敗：${error.message}`));
});
copyRoomButton.addEventListener("click", copyRoomLink);
soundButton.addEventListener("click", () => {
  if (audio.isSupported() && !audio.isUnlocked()) {
    audio.setEnabled(true);
    primeAudio();
    window.setTimeout(() => audio.playReveal(true), 120);
    return;
  }
  audio.toggle();
  renderSoundButton();
});
soundPrompt.addEventListener("click", () => {
  audio.setEnabled(true);
  primeAudio();
  window.setTimeout(() => audio.playReveal(true), 120);
});
awardCloseButton.addEventListener("click", dismissAward);
awardOverlay.addEventListener("click", (event) => {
  if (event.target === awardOverlay) {
    dismissAward();
  }
});
window.addEventListener("resize", resizeWheelCanvas);

initializePlayerName();
createCard();
resetDraws();
resizeWheelCanvas();
renderGame();
loadAudioManager();
initializeAuth();
