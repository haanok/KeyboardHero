// localStorage-backed top-10 high scores per difficulty.

window.KH = window.KH || {};
(function (KH) {

const MAX_ENTRIES = 10;
const keyFor = difficulty => `keyboardhero.highscores.${difficulty}`;

function loadScores(difficulty) {
  try {
    const raw = localStorage.getItem(keyFor(difficulty));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveScore(difficulty, entry) {
  const scores = loadScores(difficulty);
  scores.push({
    name: (entry.name || '---').slice(0, 3).toUpperCase(),
    score: entry.score | 0,
    accuracy: entry.accuracy | 0,
    date: entry.date || new Date().toISOString().slice(0, 10),
  });
  scores.sort((a, b) => b.score - a.score);
  const trimmed = scores.slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(keyFor(difficulty), JSON.stringify(trimmed));
  } catch {
    // Storage full or disabled — silently ignore.
  }
  return trimmed;
}

function qualifiesForHighScore(difficulty, score) {
  const scores = loadScores(difficulty);
  if (scores.length < MAX_ENTRIES) return true;
  return score > scores[scores.length - 1].score;
}

KH.loadScores = loadScores;
KH.saveScore = saveScore;
KH.qualifiesForHighScore = qualifiesForHighScore;

})(window.KH);
