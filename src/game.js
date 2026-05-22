// Game loop: canvas rendering of falling notes, keyboard input, sustain handling.
// Time is anchored to AudioEngine.songTime() so video/audio stay in sync.

window.KH = window.KH || {};
(function (KH) {

const { judgeHit, HIT_WINDOW } = KH;

const LANES = 4;
const LANE_COLORS  = ['#44d36a', '#e8443a', '#f3c93b', '#3aa7ff']; // green / red / yellow / blue
const LANE_GLOW    = ['#7eff9d', '#ff7d72', '#ffe173', '#73c8ff'];

// Layout mode → physical keys per lane.
// 'flat':   hand laid on home row, left→right       (A=lane0 ... F=lane3)
// 'guitar': keyboard held like a guitar neck, frets descend toward you (F=lane0 ... A=lane3)
const LAYOUT_KEYS = {
  flat:   ['a', 's', 'd', 'f'],
  guitar: ['f', 'd', 's', 'a'],
};

// Time (seconds) from when a note appears at the top to when it should be hit.
// Lower = faster scroll.
const APPROACH_TIME_BY_SPEED = speed => 1.0 + (1.0 - speed) * 1.2;

class Game {
  constructor(canvas, audio, scorekeeper, song, callbacks, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audio = audio;
    this.scorekeeper = scorekeeper;
    this.song = song;
    this.callbacks = callbacks ?? {};
    this.options = options ?? {};
    this.layoutMode = this.options.layoutMode === 'guitar' ? 'guitar' : 'flat';
    this.laneKeys = LAYOUT_KEYS[this.layoutMode];

    this.approachTime = APPROACH_TIME_BY_SPEED(song.noteSpeed ?? 0.7);

    // Note runtime state. Each gets: hit, missed, sustainActive, sustainCountedTo.
    this.notes = song.notes.map(n => ({
      ...n,
      hit: false,
      missed: false,
      sustainActive: false,
      sustainCountedTo: 0,
    }));
    this.scorekeeper.totalNotes = this.notes.length;

    this.laneState = Array.from({ length: LANES }, () => ({
      held: false,
      pressStartTime: 0,
      activeSustain: null,
    }));

    // Visual effects pools.
    this.bursts  = [];   // { lane, startTime, quality }       — expanding rings on hit
    this.pops    = [];   // { lane, startTime, points, quality } — floating score text
    this.missFx  = Array(LANES).fill(0); // per-lane miss-flash end-time

    // Combo popup animation state.
    this._comboPopupStart = -Infinity;
    this._comboPopupValue = 0;

    this.running = false;
    this._rafId = null;
    this._lastTime = 0;

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
    const lane = this.laneKeys.indexOf(e.key.toLowerCase());
    if (lane < 0) return;
    e.preventDefault();

    const lstate = this.laneState[lane];
    if (lstate.held) return;
    lstate.held = true;
    const t = this.audio.songTime();
    lstate.pressStartTime = t;

    // Find the closest unhit note in this lane within the hit window.
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.lane !== lane || n.hit || n.missed) continue;
      const delta = Math.abs(n.time - t);
      if (delta > HIT_WINDOW.good) {
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
        const pointsBefore = this.scorekeeper.score;
        this.scorekeeper.registerHit(quality);
        const earned = this.scorekeeper.score - pointsBefore;
        this.audio.playHit(lane);

        this.bursts.push({ lane, startTime: t, quality });
        this.pops.push({ lane, startTime: t, points: earned, quality });

        if (n.durationSec >= 0.25) {
          n.sustainActive = true;
          lstate.activeSustain = n;
        }
        this._maybeShowComboMilestone(t);
      }
    } else {
      // Stray press: break combo lightly, no points; flash lane red.
      if (this.scorekeeper.combo > 0) {
        this.scorekeeper.combo = 0;
        this.audio.playMiss();
        this.missFx[lane] = t + 0.4;
      }
    }
  }

  _handleKeyUp(e) {
    const lane = this.laneKeys.indexOf(e.key.toLowerCase());
    if (lane < 0) return;
    const lstate = this.laneState[lane];
    lstate.held = false;

    const active = lstate.activeSustain;
    if (active) {
      const t = this.audio.songTime();
      const noteEnd = active.time + active.durationSec;
      if (t < noteEnd - 0.08) {
        this.scorekeeper.registerSustainBreak();
      }
      active.sustainActive = false;
      lstate.activeSustain = null;
    }
  }

  _maybeShowComboMilestone(t) {
    const combo = this.scorekeeper.combo;
    if (combo > 0 && combo % 10 === 0 && combo !== this._comboPopupValue) {
      this._comboPopupValue = combo;
      this._comboPopupStart = t;
      this.callbacks.onComboMilestone?.(combo);
    }
  }

  _frame() {
    if (!this.running) return;

    const t = this.audio.songTime();
    const dt = Math.max(0, t - this._lastTime);
    this._lastTime = t;

    // Misses + sustain ticks
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (!n.hit && !n.missed && t > n.time + HIT_WINDOW.good) {
        n.missed = true;
        this.scorekeeper.registerHit('miss');
        this.missFx[n.lane] = t + 0.4;
      }
      if (n.sustainActive) {
        const lstate = this.laneState[n.lane];
        if (!lstate.held) {
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

    // Prune expired effects
    const BURST_DUR = 0.4;
    const POP_DUR = 0.8;
    this.bursts = this.bursts.filter(b => t - b.startTime < BURST_DUR);
    this.pops   = this.pops.filter(p => t - p.startTime < POP_DUR);

    this._render(t);
    this.callbacks.onTick?.(t);

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

    // Highway region
    const highwayLeft  = W * 0.08;
    const highwayRight = W * 0.92;
    const highwayWidth = highwayRight - highwayLeft;
    const laneWidth = highwayWidth / LANES;
    const hitLineY = H * 0.85;

    // Lane backgrounds with perspective fade and held-glow.
    for (let i = 0; i < LANES; i++) {
      const x = highwayLeft + i * laneWidth;
      const lstate = this.laneState[i];
      const holdT = lstate.held ? (t - lstate.pressStartTime) : -1;
      const holdGlow = holdT >= 0 ? 0.10 + 0.06 * Math.sin(holdT * 12) : 0;

      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(255,255,255,0.02)');
      grad.addColorStop(1, lstate.held
        ? hexToRgba(LANE_GLOW[i], 0.15 + holdGlow)
        : 'rgba(255,255,255,0.05)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, laneWidth, H);

      // Sustain pulse: a brighter wash near hit line if a sustain is being held in this lane.
      if (lstate.activeSustain) {
        const pulse = 0.18 + 0.10 * Math.sin(t * 14);
        const sg = ctx.createLinearGradient(0, hitLineY - 200, 0, hitLineY);
        sg.addColorStop(0, hexToRgba(LANE_GLOW[i], 0));
        sg.addColorStop(1, hexToRgba(LANE_GLOW[i], pulse));
        ctx.fillStyle = sg;
        ctx.fillRect(x, hitLineY - 200, laneWidth, 200);
      }

      // Miss flash overlay near hit line.
      const missEnd = this.missFx[i];
      if (missEnd > t) {
        const remain = (missEnd - t) / 0.4;
        const mg = ctx.createLinearGradient(0, hitLineY - 120, 0, hitLineY + 40);
        mg.addColorStop(0, 'rgba(255, 60, 60, 0)');
        mg.addColorStop(1, `rgba(255, 60, 60, ${0.4 * remain})`);
        ctx.fillStyle = mg;
        ctx.fillRect(x, hitLineY - 120, laneWidth, 160);
      }

      // Lane divider
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    // Far-right divider
    ctx.beginPath();
    ctx.moveTo(highwayRight, 0); ctx.lineTo(highwayRight, H); ctx.stroke();

    // Hit line
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(highwayLeft, hitLineY); ctx.lineTo(highwayRight, hitLineY); ctx.stroke();

    // Notes — drawn before targets so target sits on top.
    const speed = hitLineY / this.approachTime;
    for (const n of this.notes) {
      if (n.hit && !n.sustainActive) continue;
      const tToHit = n.time - t;
      if (tToHit > this.approachTime + 0.1) continue;
      if (n.time + n.durationSec < t - 0.1) continue;

      const cx = highwayLeft + (n.lane + 0.5) * laneWidth;
      const headY = hitLineY - tToHit * speed;
      const sustainPx = n.durationSec * speed;

      if (n.durationSec >= 0.25) {
        const tailTop = headY - sustainPx;
        ctx.fillStyle = n.sustainActive
          ? hexToRgba(LANE_GLOW[n.lane], 0.95)
          : hexToRgba(LANE_COLORS[n.lane], 0.55);
        roundRect(ctx, cx - 12, tailTop, 24, headY - tailTop, 8);
        ctx.fill();
      }

      if (!n.missed) {
        // Outer glow
        ctx.beginPath();
        ctx.arc(cx, headY, 22, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(LANE_COLORS[n.lane], 0.35);
        ctx.fill();
        // Solid head
        ctx.beginPath();
        ctx.arc(cx, headY, 17, 0, Math.PI * 2);
        ctx.fillStyle = LANE_COLORS[n.lane];
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.stroke();
        // Inner highlight
        ctx.beginPath();
        ctx.arc(cx - 4, headY - 5, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, headY, 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120,120,140,0.35)';
        ctx.fill();
      }
    }

    // Lane targets (always drawn last beneath effects so they're crisp).
    for (let i = 0; i < LANES; i++) {
      const cx = highwayLeft + (i + 0.5) * laneWidth;
      const lstate = this.laneState[i];
      const held = lstate.held;

      // Outer ring
      ctx.beginPath();
      ctx.arc(cx, hitLineY, 26, 0, Math.PI * 2);
      ctx.strokeStyle = LANE_COLORS[i];
      ctx.lineWidth = 3;
      ctx.fillStyle = held ? hexToRgba(LANE_COLORS[i], 0.7) : 'rgba(0,0,0,0.55)';
      ctx.fill();
      ctx.stroke();

      // Key letter
      ctx.fillStyle = held ? '#0a0d18' : '#fff';
      ctx.font = 'bold 18px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.laneKeys[i].toUpperCase(), cx, hitLineY);
    }

    // Hit burst rings (drawn above targets)
    const BURST_DUR = 0.4;
    for (const b of this.bursts) {
      const age = t - b.startTime;
      const prog = age / BURST_DUR;
      if (prog >= 1) continue;
      const cx = highwayLeft + (b.lane + 0.5) * laneWidth;
      const r1 = 26 + prog * 44;
      const alpha1 = (1 - prog) * 0.9;
      ctx.beginPath();
      ctx.arc(cx, hitLineY, r1, 0, Math.PI * 2);
      ctx.lineWidth = 4 * (1 - prog) + 1;
      ctx.strokeStyle = hexToRgba(b.quality === 'perfect' ? '#ffd34d' : LANE_GLOW[b.lane], alpha1);
      ctx.stroke();
      // Inner solid flash early in the animation
      if (prog < 0.25) {
        ctx.beginPath();
        ctx.arc(cx, hitLineY, 26, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(b.quality === 'perfect' ? '#ffd34d' : LANE_COLORS[b.lane], (1 - prog / 0.25) * 0.55);
        ctx.fill();
      }
    }

    // Floating score pops
    const POP_DUR = 0.8;
    for (const p of this.pops) {
      const age = t - p.startTime;
      if (age >= POP_DUR) continue;
      const ease = age / POP_DUR;
      const cx = highwayLeft + (p.lane + 0.5) * laneWidth;
      const cy = hitLineY - 30 - ease * 80;
      const alpha = ease < 0.7 ? 1 : (1 - (ease - 0.7) / 0.3);

      ctx.globalAlpha = alpha;
      // Quality label
      ctx.font = 'bold 18px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = p.quality === 'perfect' ? '#ffd34d' : '#ffffff';
      ctx.fillText(p.quality === 'perfect' ? 'PERFECT' : 'GOOD', cx, cy - 14);
      // Points
      ctx.font = 'bold 22px -apple-system, sans-serif';
      ctx.fillText(`+${p.points}`, cx, cy + 10);
      ctx.globalAlpha = 1;
    }

    // Combo popup with scale-in
    const COMBO_DUR = 1.1;
    const comboAge = t - this._comboPopupStart;
    if (comboAge >= 0 && comboAge < COMBO_DUR) {
      const ease = comboAge / COMBO_DUR;
      // Scale: pop from 0.6 → 1.15 → 1.0; fade out in last 30%.
      let scale = 1;
      if (ease < 0.18) scale = 0.6 + (ease / 0.18) * 0.55;       // 0.6 → 1.15
      else if (ease < 0.28) scale = 1.15 - ((ease - 0.18) / 0.10) * 0.15; // 1.15 → 1.0
      const alpha = ease < 0.7 ? 1 : (1 - (ease - 0.7) / 0.3);

      ctx.save();
      ctx.translate(W / 2, H * 0.40);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffd34d';
      ctx.font = 'bold 56px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(255, 211, 77, 0.6)';
      ctx.shadowBlur = 24;
      ctx.fillText(`${this._comboPopupValue} COMBO`, 0, 0);
      ctx.restore();
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
