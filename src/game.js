// Game loop: canvas rendering of falling notes, keyboard input, sustain handling.
// Time is anchored to AudioEngine.songTime() so video/audio stay in sync.

window.KH = window.KH || {};
(function (KH) {

const { judgeHit, HIT_WINDOW } = KH;

const LANES = 5;
const LANE_KEYS = ['a', 's', 'd', 'f', 'g'];
const LANE_COLORS = ['#44d36a', '#e8443a', '#f3c93b', '#3aa7ff', '#ff8a2a'];

// Time (seconds) from the moment a note appears at the top to when it should be hit.
// Lower = faster scroll. Easy ≈ 1.8s, Hard ≈ 1.1s.
const APPROACH_TIME_BY_SPEED = speed => 1.0 + (1.0 - speed) * 1.2;

class Game {
  constructor(canvas, audio, scorekeeper, song, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audio = audio;
    this.scorekeeper = scorekeeper;
    this.song = song;
    this.callbacks = callbacks ?? {};

    this.approachTime = APPROACH_TIME_BY_SPEED(song.noteSpeed ?? 0.7);

    // Note runtime state. Each gets: hit, missed, sustainActive, sustainCounted.
    this.notes = song.notes.map(n => ({
      ...n,
      hit: false,
      missed: false,
      sustainActive: false,   // true while held legitimately
      sustainCountedTo: 0,    // seconds of sustain already scored (relative to note.time)
    }));
    this.scorekeeper.totalNotes = this.notes.length;

    this.laneState = Array.from({ length: LANES }, () => ({
      held: false,
      flashUntil: 0,
      activeSustain: null, // reference to a note object being held
    }));

    this.running = false;
    this._rafId = null;
    this._lastTime = 0;
    this._missAnnounced = [];
    this._comboPopupTimer = 0;
    this._lastComboShown = 0;

    this._handleKeyDown = this._handleKeyDown.bind(this);
    this._handleKeyUp = this._handleKeyUp.bind(this);
    this._frame = this._frame.bind(this);
  }

  start() {
    this.running = true;
    window.addEventListener('keydown', this._handleKeyDown);
    window.addEventListener('keyup', this._handleKeyUp);
    this._lastTime = this.audio.songTime();
    this._rafId = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.removeEventListener('keydown', this._handleKeyDown);
    window.removeEventListener('keyup', this._handleKeyUp);
  }

  _handleKeyDown(e) {
    if (e.repeat) return;
    const lane = LANE_KEYS.indexOf(e.key.toLowerCase());
    if (lane < 0) return;
    e.preventDefault();

    const lstate = this.laneState[lane];
    lstate.held = true;

    const t = this.audio.songTime();

    // Find the closest unhit note in this lane within the hit window.
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.lane !== lane || n.hit || n.missed) continue;
      const delta = Math.abs(n.time - t);
      if (delta > HIT_WINDOW.good) {
        // Notes are sorted; once we pass too far ahead, we can break.
        if (n.time - t > HIT_WINDOW.good) break;
        continue;
      }
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const n = this.notes[bestIdx];
      const quality = judgeHit(n.time, t);
      if (quality) {
        n.hit = true;
        this.scorekeeper.registerHit(quality);
        this.audio.playHit(lane);
        lstate.flashUntil = t + 0.15;

        // If this is a sustain (>= 0.25s), latch the lane to accumulate sustain points.
        if (n.durationSec >= 0.25) {
          n.sustainActive = true;
          lstate.activeSustain = n;
        }
        this._showCombo();
      }
    } else {
      // Stray press: penalize lightly (break combo, no points).
      if (this.scorekeeper.combo > 0) {
        this.scorekeeper.combo = 0;
        this.audio.playMiss();
      }
    }
  }

  _handleKeyUp(e) {
    const lane = LANE_KEYS.indexOf(e.key.toLowerCase());
    if (lane < 0) return;
    const lstate = this.laneState[lane];
    lstate.held = false;

    const active = lstate.activeSustain;
    if (active) {
      const t = this.audio.songTime();
      const noteEnd = active.time + active.durationSec;
      // If released significantly before the note ends, break combo.
      if (t < noteEnd - 0.08) {
        this.scorekeeper.registerSustainBreak();
      }
      active.sustainActive = false;
      lstate.activeSustain = null;
    }
  }

  _showCombo() {
    const combo = this.scorekeeper.combo;
    // Show popup at every 10-combo milestone.
    if (combo > 0 && combo % 10 === 0 && combo !== this._lastComboShown) {
      this._lastComboShown = combo;
      this._comboPopupTimer = 1.0;
      this.callbacks.onComboMilestone?.(combo);
    }
  }

  _frame() {
    if (!this.running) return;

    const t = this.audio.songTime();
    const dt = Math.max(0, t - this._lastTime);
    this._lastTime = t;

    // Process misses and sustain ticks.
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (!n.hit && !n.missed) {
        if (t > n.time + HIT_WINDOW.good) {
          n.missed = true;
          this.scorekeeper.registerHit('miss');
        }
      }
      // Sustain tick scoring.
      if (n.sustainActive) {
        const lstate = this.laneState[n.lane];
        if (!lstate.held) {
          // Lost the hold; deactivate (handled in keyUp but defensive here).
          n.sustainActive = false;
          continue;
        }
        const noteEnd = n.time + n.durationSec;
        const elapsedTotal = Math.min(noteEnd, t) - n.time;
        const tickSec = Math.max(0, elapsedTotal - n.sustainCountedTo);
        if (tickSec > 0) {
          this.scorekeeper.registerSustainTick(tickSec);
          n.sustainCountedTo = elapsedTotal;
        }
        if (t >= noteEnd) {
          n.sustainActive = false;
          this.laneState[n.lane].activeSustain = null;
        }
      }
    }

    if (this._comboPopupTimer > 0) this._comboPopupTimer -= dt;

    this._render(t);
    this.callbacks.onTick?.(t);

    // Song end?
    if (t >= this.song.durationSec) {
      this.running = false;
      this.callbacks.onFinish?.();
      return;
    }

    this._rafId = requestAnimationFrame(this._frame);
  }

  _render(t) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;

    // Background
    ctx.fillStyle = '#070b18';
    ctx.fillRect(0, 0, W, H);

    // Note highway region
    const highwayLeft = W * 0.1;
    const highwayRight = W * 0.9;
    const highwayWidth = highwayRight - highwayLeft;
    const laneWidth = highwayWidth / LANES;
    const hitLineY = H * 0.85;

    // Lane backgrounds
    for (let i = 0; i < LANES; i++) {
      const x = highwayLeft + i * laneWidth;
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(255,255,255,0.02)');
      grad.addColorStop(1, 'rgba(255,255,255,0.06)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, laneWidth, H);
      // Lane divider
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    // Far-right divider
    ctx.beginPath();
    ctx.moveTo(highwayRight, 0);
    ctx.lineTo(highwayRight, H);
    ctx.stroke();

    // Hit line
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(highwayLeft, hitLineY);
    ctx.lineTo(highwayRight, hitLineY);
    ctx.stroke();

    // Lane targets (circles on hit line) + flashes + key labels
    for (let i = 0; i < LANES; i++) {
      const cx = highwayLeft + (i + 0.5) * laneWidth;
      const lstate = this.laneState[i];
      const flashing = t < lstate.flashUntil;
      const held = lstate.held;

      ctx.beginPath();
      ctx.arc(cx, hitLineY, 22, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = LANE_COLORS[i];
      ctx.fillStyle = flashing
        ? LANE_COLORS[i]
        : (held ? hexToRgba(LANE_COLORS[i], 0.5) : 'rgba(0,0,0,0.5)');
      ctx.fill();
      ctx.stroke();

      // Key letter
      ctx.fillStyle = flashing ? '#0a0d18' : '#fff';
      ctx.font = 'bold 18px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(LANE_KEYS[i].toUpperCase(), cx, hitLineY);
    }

    // Notes — visible window: those approaching the hit line, plus ones in their hit window.
    // y maps from time-to-hit. At noteTime = t, y = hitLineY. At noteTime = t + approachTime, y = 0.
    const speed = (hitLineY - 0) / this.approachTime;
    for (const n of this.notes) {
      if (n.hit && !n.sustainActive) continue;
      const tToHit = n.time - t;
      // Cull: not visible yet (too far in future) or long past.
      if (tToHit > this.approachTime + 0.1) continue;
      if (n.time + n.durationSec < t - 0.1) continue;

      const cx = highwayLeft + (n.lane + 0.5) * laneWidth;
      const headY = hitLineY - tToHit * speed;
      const sustainPx = n.durationSec * speed;

      // Sustain tail (drawn beneath head)
      if (n.durationSec >= 0.25) {
        const tailTop = headY - sustainPx;
        ctx.fillStyle = n.sustainActive
          ? hexToRgba(LANE_COLORS[n.lane], 0.85)
          : hexToRgba(LANE_COLORS[n.lane], 0.55);
        roundRect(ctx, cx - 10, tailTop, 20, headY - tailTop, 6);
        ctx.fill();
      }

      // Note head
      if (!n.missed) {
        ctx.beginPath();
        ctx.arc(cx, headY, 18, 0, Math.PI * 2);
        ctx.fillStyle = LANE_COLORS[n.lane];
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.stroke();
      } else {
        // Missed: faded gray
        ctx.beginPath();
        ctx.arc(cx, headY, 14, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120,120,140,0.4)';
        ctx.fill();
      }
    }

    // Combo popup
    if (this._comboPopupTimer > 0) {
      const alpha = Math.min(1, this._comboPopupTimer);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffd34d';
      ctx.font = 'bold 56px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${this._lastComboShown} COMBO`, W / 2, H * 0.35);
      ctx.globalAlpha = 1;
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  if (w < 1 || h < 1) return;
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

KH.Game = Game;

})(window.KH);
