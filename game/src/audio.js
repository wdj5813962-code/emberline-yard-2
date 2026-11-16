// Audio: every sound is synthesized with Web Audio, no audio files. A gunshot
// is a noise burst through a low-pass filter; a reload is two short clicks; an
// explosion is a low sine drop with noise; a plant beep is a square blip. The
// module is created lazily on the first user gesture (browsers block audio
// before one) and every sound is a short function, so the game never waits on
// a network fetch for a sound.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  function noiseBuffer(duration) {
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function playNoise(duration, filterFreq, gain, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(g).connect(master);
    source.start(t);
    source.stop(t + duration);
  }

  function playTone(freq, duration, type, gain, slideTo = 0, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration);
  }

  return {
    ensure,
    shot(kind) {
      if (kind === 'sniper') playNoise(0.28, 900, 0.9);
      else if (kind === 'smg') playNoise(0.08, 2200, 0.5);
      else playNoise(0.12, 1600, 0.7);
      playTone(160, 0.08, 'square', 0.25, 60);
    },
    enemyShot() {
      playNoise(0.1, 1200, 0.25);
    },
    reload() {
      playTone(900, 0.04, 'square', 0.2);
      playTone(600, 0.04, 'square', 0.2, 0, 0.18);
    },
    empty() {
      playTone(1200, 0.05, 'square', 0.15);
    },
    hit() {
      playTone(2000, 0.05, 'sine', 0.3);
    },
    kill() {
      playTone(2000, 0.05, 'sine', 0.3);
      playTone(2600, 0.07, 'sine', 0.3, 0, 0.06);
    },
    hurt() {
      playTone(220, 0.15, 'sawtooth', 0.3, 110);
    },
    explosion() {
      playNoise(0.9, 300, 1.0);
      playTone(90, 0.8, 'sine', 0.8, 30);
    },
    plant() {
      playTone(880, 0.08, 'square', 0.25);
      playTone(880, 0.08, 'square', 0.25, 0, 0.15);
    },
    beep() {
      playTone(1200, 0.09, 'square', 0.2);
    },
    defuse() {
      playTone(660, 0.08, 'square', 0.2);
      playTone(660, 0.08, 'square', 0.2, 0, 0.12);
    },
    buy() {
      playTone(520, 0.07, 'sine', 0.25);
      playTone(780, 0.09, 'sine', 0.25, 0, 0.08);
    },
    roundWin() {
      playTone(523, 0.12, 'sine', 0.3);
      playTone(659, 0.12, 'sine', 0.3, 0, 0.12);
      playTone(784, 0.2, 'sine', 0.3, 0, 0.24);
    },
    roundLose() {
      playTone(392, 0.15, 'sine', 0.3);
      playTone(330, 0.15, 'sine', 0.3, 0, 0.15);
      playTone(262, 0.25, 'sine', 0.3, 0, 0.3);
    },
    step() {
      playNoise(0.04, 500, 0.06);
    },
  };
}
