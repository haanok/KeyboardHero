// Procedural song generator.
// Produces { bpm, key, scale, durationSec, notes: [{ time, durationSec, midi, lane }] }
// Notes are sorted ascending by time. Chord notes share the same time value.

window.KH = window.KH || {};
(function (KH) {

const DIFFICULTY = {
  easy:   { bpmRange: [90, 100],  notesPerBeat: 0.75, sustainProb: 0.05, chordProb: 0.0,  noteSpeed: 0.55 },
  medium: { bpmRange: [110, 125], notesPerBeat: 1.25, sustainProb: 0.15, chordProb: 0.05, noteSpeed: 0.70 },
  hard:   { bpmRange: [130, 140], notesPerBeat: 1.75, sustainProb: 0.25, chordProb: 0.18, noteSpeed: 0.85 },
};

const KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const KEY_MIDI = { C: 60, D: 62, E: 64, F: 65, G: 67, A: 69, B: 71 };
// Pentatonic intervals (semitones from root)
const PENT_MAJOR = [0, 2, 4, 7, 9];
const PENT_MINOR = [0, 3, 5, 7, 10];

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randRange = (min, max) => Math.random() * (max - min) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function generateSong(difficulty = 'medium', targetDurationSec = 75) {
  const cfg = DIFFICULTY[difficulty] ?? DIFFICULTY.medium;
  const bpm = randInt(cfg.bpmRange[0], cfg.bpmRange[1]);
  const beatSec = 60 / bpm;
  const key = pick(KEYS);
  const isMajor = Math.random() < 0.6;
  const scale = isMajor ? PENT_MAJOR : PENT_MINOR;
  const rootMidi = KEY_MIDI[key];

  // Use 5 pitches per octave × 2 octaves = 10 melody slots, mapped to 4 lanes.
  // Lower pitches → lane 0 (lowest fret), higher → lane 3 (highest fret).
  const pitches = [];
  for (let oct = 0; oct < 2; oct++) {
    for (const interval of scale) {
      pitches.push(rootMidi + interval + oct * 12);
    }
  }
  // pitches has 10 entries, sorted low→high. Split into 4 bands of 2-3 pitches each.

  const NUM_LANES = 4;
  const laneForPitchIndex = i =>
    Math.min(NUM_LANES - 1, Math.floor((i * NUM_LANES) / pitches.length));

  const notes = [];
  // Lead-in: give the player ~2 seconds before first note.
  let t = 2.0;
  let pitchIdx = randInt(2, 7); // start in middle range
  let lastLane = -1;

  while (t < targetDurationSec) {
    // Random walk: prefer stepwise motion, occasional leaps.
    const stepRoll = Math.random();
    let delta;
    if (stepRoll < 0.55) delta = (Math.random() < 0.5 ? -1 : 1);
    else if (stepRoll < 0.85) delta = (Math.random() < 0.5 ? -2 : 2);
    else delta = randInt(-4, 4);
    pitchIdx = Math.max(0, Math.min(pitches.length - 1, pitchIdx + delta));

    let lane = laneForPitchIndex(pitchIdx);
    // Avoid same lane back-to-back when possible — nudge if collision.
    if (lane === lastLane && Math.random() < 0.6) {
      const nudge = Math.random() < 0.5 ? -1 : 1;
      const newIdx = Math.max(0, Math.min(pitches.length - 1, pitchIdx + nudge));
      if (laneForPitchIndex(newIdx) !== lastLane) {
        pitchIdx = newIdx;
        lane = laneForPitchIndex(pitchIdx);
      }
    }

    const midi = pitches[pitchIdx];

    // Sustain or short note?
    let durationBeats;
    if (Math.random() < cfg.sustainProb) {
      durationBeats = pick([1.5, 2, 2.5, 3]);
    } else {
      durationBeats = pick([0.25, 0.5, 0.5, 0.75]);
    }
    const durationSec = durationBeats * beatSec;

    notes.push({ time: t, durationSec, midi, lane });

    // Chord? Add a second simultaneous note in another lane.
    if (Math.random() < cfg.chordProb) {
      // Pick a different lane, harmonize within the scale (3rd or 5th).
      const chordOffset = pick([2, 3, 4]);
      const cIdx = Math.max(0, Math.min(pitches.length - 1, pitchIdx + chordOffset));
      const cLane = laneForPitchIndex(cIdx);
      if (cLane !== lane) {
        notes.push({ time: t, durationSec, midi: pitches[cIdx], lane: cLane });
      }
    }

    lastLane = lane;

    // Advance time: gap to next note. notesPerBeat controls density.
    const beatsToNext = pick([0.5, 0.75, 1, 1, 1.5]) / cfg.notesPerBeat;
    t += beatsToNext * beatSec;
  }

  // Sort ascending by time (chord notes share time — stable enough).
  notes.sort((a, b) => a.time - b.time);

  return {
    bpm,
    key,
    scale: isMajor ? 'major' : 'minor',
    durationSec: t + 2.0, // tail
    notes,
    noteSpeed: cfg.noteSpeed, // lanes-per-second descent rate (relative; consumed by renderer)
  };
}

KH.DIFFICULTY = DIFFICULTY;
KH.generateSong = generateSong;

})(window.KH);
