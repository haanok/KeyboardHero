// Entry point: wires menu, gameplay, and results screens.

(function () {
const { generateSong, AudioEngine, Scorekeeper, Game, loadScores, saveScore, qualifiesForHighScore } = window.KH;

const canvas = document.getElementById('game');

const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
const results = document.getElementById('results');

const hsList = document.getElementById('hs-list');
const hsDifficultyLabel = document.getElementById('hs-difficulty-label');
const startBtn = document.getElementById('start-btn');
const diffButtons = document.querySelectorAll('.diff-btn');

const hudScore = document.getElementById('hud-score');
const hudMultiplier = document.getElementById('hud-multiplier');
const hudAccuracy = document.getElementById('hud-accuracy');
const hudProgressFill = document.getElementById('hud-progress-fill');
const hudCombo = document.getElementById('hud-combo');

const resScore = document.getElementById('res-score');
const resAccuracy = document.getElementById('res-accuracy');
const resCombo = document.getElementById('res-combo');
const resCounts = document.getElementById('res-counts');
const resNewHs = document.getElementById('res-newhs');
const resInitials = document.getElementById('res-initials');
const resSaveBtn = document.getElementById('res-save-btn');
const resMenuBtn = document.getElementById('res-menu-btn');

let currentDifficulty = 'medium';
let audio = null;
let game = null;
let scorekeeper = null;
let session = null; // { score, accuracy, bestCombo, perfect, good, miss, difficulty }

function show(...elements) {
  for (const el of [menu, hud, results]) el.classList.add('hidden');
  for (const el of elements) el.classList.remove('hidden');
}

function renderHighScores() {
  const list = loadScores(currentDifficulty);
  hsDifficultyLabel.textContent = capitalize(currentDifficulty);
  hsList.innerHTML = '';
  if (list.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No scores yet';
    hsList.appendChild(li);
    return;
  }
  list.forEach((entry, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span><span class="name">${escapeHtml(entry.name)}</span> &nbsp; ${entry.score.toLocaleString()}</span><span class="acc">${entry.accuracy}%</span>`;
    hsList.appendChild(li);
  });
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

diffButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    diffButtons.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    currentDifficulty = btn.dataset.difficulty;
    renderHighScores();
  });
});

startBtn.addEventListener('click', () => {
  startGame();
});

resMenuBtn.addEventListener('click', () => {
  cleanupGame();
  renderHighScores();
  show(menu);
});

resSaveBtn.addEventListener('click', () => {
  const name = (resInitials.value || '---').toUpperCase();
  saveScore(session.difficulty, {
    name,
    score: session.score,
    accuracy: session.accuracy,
  });
  resNewHs.classList.add('hidden');
});

function startGame() {
  cleanupGame();

  audio = new AudioEngine();
  // Must touch ctx on a user gesture — this click qualifies.
  audio.ensureContext();
  if (audio.ctx.state === 'suspended') audio.ctx.resume();

  const song = generateSong(currentDifficulty);
  scorekeeper = new Scorekeeper();

  game = new Game(canvas, audio, scorekeeper, song, {
    onTick: () => updateHud(song),
    onComboMilestone: (combo) => flashCombo(combo),
    onFinish: () => finishGame(song),
  });

  // Reset HUD
  hudScore.textContent = '0';
  hudMultiplier.textContent = '×1';
  hudAccuracy.textContent = '100%';
  hudProgressFill.style.width = '0%';
  hudCombo.classList.remove('show');

  show(hud);

  audio.startSong(song.notes);
  game.start();
}

function updateHud(song) {
  hudScore.textContent = Math.round(scorekeeper.score).toLocaleString();
  hudMultiplier.textContent = `×${scorekeeper.multiplier}`;
  hudAccuracy.textContent = `${scorekeeper.accuracyPct}%`;
  const t = Math.max(0, audio.songTime());
  const pct = Math.min(100, (t / song.durationSec) * 100);
  hudProgressFill.style.width = `${pct}%`;
}

function flashCombo(combo) {
  hudCombo.textContent = `${combo} COMBO`;
  hudCombo.classList.add('show');
  clearTimeout(flashCombo._timeout);
  flashCombo._timeout = setTimeout(() => hudCombo.classList.remove('show'), 900);
}

function finishGame(song) {
  // Capture session stats before tearing down.
  session = {
    score: Math.round(scorekeeper.score),
    accuracy: scorekeeper.accuracyPct,
    bestCombo: scorekeeper.bestCombo,
    perfect: scorekeeper.perfect,
    good: scorekeeper.good,
    miss: scorekeeper.miss,
    difficulty: currentDifficulty,
  };

  // Allow audio tail to play, then tear down.
  setTimeout(() => audio?.stop(), 500);
  game?.stop();

  resScore.textContent = session.score.toLocaleString();
  resAccuracy.textContent = `${session.accuracy}%`;
  resCombo.textContent = session.bestCombo;
  resCounts.textContent = `${session.perfect} / ${session.good} / ${session.miss}`;

  if (qualifiesForHighScore(session.difficulty, session.score) && session.score > 0) {
    resNewHs.classList.remove('hidden');
    resInitials.value = '';
    setTimeout(() => resInitials.focus(), 100);
  } else {
    resNewHs.classList.add('hidden');
  }

  show(results);
}

function cleanupGame() {
  if (game) { game.stop(); game = null; }
  if (audio) { audio.stop(); audio = null; }
  scorekeeper = null;
}

// Initial render
renderHighScores();
show(menu);

})();
