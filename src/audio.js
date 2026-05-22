// Web Audio engine: lookahead scheduler, lane-colored synth voices, SFX.
// Created lazily so a user gesture starts the AudioContext (browser autoplay rules).

window.KH = window.KH || {};
(function (KH) {

const LANE_WAVEFORM = ['triangle', 'square', 'sawtooth', 'triangle', 'square'];

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12; // seconds

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.pending = [];      // notes still to schedule, sorted by time
    this.startTime = 0;     // audioContext.currentTime corresponding to song t=0
    this.intervalId = null;
    this.running = false;
  }

  ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  // Returns the audioContext-time at which song t=0 begins.
  startSong(songNotes) {
    this.ensureContext();
    this.pending = songNotes.slice(); // already sorted ascending by time
    // Schedule the song to begin shortly after now so the first notes don't clip.
    this.startTime = this.ctx.currentTime + 0.2;
    this.running = true;
    this.intervalId = setInterval(() => this._tick(), LOOKAHEAD_MS);
    return this.startTime;
  }

  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.pending = [];
  }

  // Time within the song (seconds from t=0). Negative during lead-in.
  songTime() {
    if (!this.ctx) return 0;
    return this.ctx.currentTime - this.startTime;
  }

  _tick() {
    if (!this.running) return;
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD;
    while (this.pending.length && this.startTime + this.pending[0].time < horizon) {
      const n = this.pending.shift();
      this._scheduleNote(n, this.startTime + n.time);
    }
  }

  _scheduleNote(note, when) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3500;

    osc.type = LANE_WAVEFORM[note.lane] || 'triangle';
    const freq = midiToFreq(note.midi);
    osc.frequency.value = freq;

    const dur = Math.max(0.08, note.durationSec);
    const attack = 0.008;
    const decay = 0.05;
    const sustainLevel = 0.18;
    const release = 0.12;

    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.32, when + attack);
    gain.gain.linearRampToValueAtTime(sustainLevel, when + attack + decay);
    gain.gain.setValueAtTime(sustainLevel, when + dur);
    gain.gain.linearRampToValueAtTime(0, when + dur + release);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    osc.start(when);
    osc.stop(when + dur + release + 0.02);
  }

  // Short procedural SFX for hits/misses. Called immediately from input handler.
  playHit(lane) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800 + lane * 120, now);
    osc.frequency.exponentialRampToValueAtTime(400 + lane * 80, now + 0.08);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  playMiss() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.18);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.25);
  }
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

KH.AudioEngine = AudioEngine;

})(window.KH);
