// Hit judgment and score accounting.

window.KH = window.KH || {};
(function (KH) {

const HIT_WINDOW = {
  perfect: 0.04,  // ±40 ms
  good:    0.10,  // ±100 ms
};

const NOTE_POINTS = {
  perfect: 100,
  good:    50,
};

// Score per second while a sustain is correctly held.
const SUSTAIN_POINTS_PER_SEC = 100;

class Scorekeeper {
  constructor() {
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.perfect = 0;
    this.good = 0;
    this.miss = 0;
    this.totalNotes = 0; // set externally before play
  }

  get multiplier() {
    if (this.combo >= 30) return 4;
    if (this.combo >= 20) return 3;
    if (this.combo >= 10) return 2;
    return 1;
  }

  get accuracyPct() {
    const judged = this.perfect + this.good + this.miss;
    if (judged === 0) return 100;
    return Math.round(((this.perfect + this.good * 0.5) / judged) * 100);
  }

  registerHit(quality) {
    if (quality === 'miss') {
      this.miss++;
      this.combo = 0;
      return 0;
    }
    if (quality === 'perfect') this.perfect++;
    else this.good++;
    const points = NOTE_POINTS[quality] * this.multiplier;
    this.score += points;
    this.combo++;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    return points;
  }

  registerSustainTick(seconds) {
    // Awarded while a sustain note is held within its active window.
    const points = SUSTAIN_POINTS_PER_SEC * seconds * this.multiplier;
    this.score += points;
    return points;
  }

  registerSustainBreak() {
    // Releasing early breaks combo (mild penalty — note already counted at head).
    this.combo = 0;
  }
}

// Given a hit time and a note's target time, classify the hit quality.
// Returns 'perfect' | 'good' | null (out of window).
function judgeHit(noteTime, hitTime) {
  const delta = Math.abs(hitTime - noteTime);
  if (delta <= HIT_WINDOW.perfect) return 'perfect';
  if (delta <= HIT_WINDOW.good) return 'good';
  return null;
}

KH.HIT_WINDOW = HIT_WINDOW;
KH.NOTE_POINTS = NOTE_POINTS;
KH.SUSTAIN_POINTS_PER_SEC = SUSTAIN_POINTS_PER_SEC;
KH.Scorekeeper = Scorekeeper;
KH.judgeHit = judgeHit;

})(window.KH);
