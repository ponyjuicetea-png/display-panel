window.createAudioManager = function createAudioManager(storageKey = "bingoSoundEnabled") {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const supported = Boolean(AudioContextClass);
  let context = null;
  let master = null;
  let compressor = null;
  let activeSpinBus = null;
  let enabled = localStorage.getItem(storageKey) !== "false";

  function setup() {
    if (!supported) {
      return null;
    }

    if (context) {
      return context;
    }

    context = new AudioContextClass();
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.24;

    master = context.createGain();
    master.gain.value = enabled ? 0.72 : 0;
    compressor.connect(master);
    master.connect(context.destination);

    return context;
  }

  function unlock() {
    const ctx = setup();
    if (!ctx || ctx.state === "running") {
      return Promise.resolve();
    }
    return ctx.resume().catch(() => {});
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    localStorage.setItem(storageKey, enabled ? "true" : "false");

    if (master && context) {
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(enabled ? 0.72 : 0, now, 0.04);
    }
  }

  function toggle() {
    setEnabled(!enabled);
  }

  function scheduleTone({
    frequency,
    start,
    duration,
    type = "sine",
    gain = 0.12,
    attack = 0.008,
    release = 0.04,
    destination = compressor,
    glideTo = null,
  }) {
    if (!context || !destination) {
      return;
    }

    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);

    if (glideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), start + duration);
    }

    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration + release);
    oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + release + 0.03);
  }

  function scheduleNoise({
    start,
    duration,
    gain = 0.08,
    frequency = 1800,
    q = 0.8,
    filterType = "bandpass",
    destination = compressor,
  }) {
    if (!context || !destination) {
      return;
    }

    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);

    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = buffer;
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, start);
    filter.Q.value = q;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(destination);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  function makeSpinBus() {
    stopSpin();
    const ctx = setup();
    if (!ctx || !compressor) {
      return null;
    }
    activeSpinBus = ctx.createGain();
    activeSpinBus.gain.value = enabled ? 0.95 : 0;
    activeSpinBus.connect(compressor);
    return activeSpinBus;
  }

  function stopSpin() {
    if (!context || !activeSpinBus) {
      return;
    }

    const bus = activeSpinBus;
    const now = context.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setTargetAtTime(0.0001, now, 0.035);
    window.setTimeout(() => {
      try {
        bus.disconnect();
      } catch {
        // Already disconnected.
      }
    }, 260);
    activeSpinBus = null;
  }

  function playSpin({ danger = false, duration = 3200 } = {}) {
    if (!enabled || !supported) {
      return;
    }

    unlock();
    const bus = makeSpinBus();
    if (!context || !bus) {
      return;
    }

    const start = context.currentTime + 0.02;
    const seconds = duration / 1000;

    if (danger) {
      for (let t = 0; t < seconds; t += 0.135) {
        const pulse = start + t;
        const high = Math.floor(t / 0.135) % 2 === 0;
        scheduleTone({
          frequency: high ? 880 : 660,
          start: pulse,
          duration: 0.055,
          type: "square",
          gain: 0.09,
          attack: 0.004,
          release: 0.025,
          destination: bus,
        });
        scheduleTone({
          frequency: 120,
          start: pulse,
          duration: 0.04,
          type: "sine",
          gain: 0.035,
          attack: 0.003,
          release: 0.03,
          destination: bus,
        });
      }
      return;
    }

    let t = 0;
    let interval = 0.048;
    let tickIndex = 0;
    while (t < seconds) {
      const tickTime = start + t;
      const progress = Math.min(t / seconds, 1);
      scheduleNoise({
        start: tickTime,
        duration: 0.024,
        gain: 0.038 * (1 - progress * 0.42),
        frequency: 2600 - progress * 1200,
        q: 2.4,
        destination: bus,
      });
      scheduleTone({
        frequency: tickIndex % 2 === 0 ? 230 : 185,
        start: tickTime,
        duration: 0.028,
        type: "triangle",
        gain: 0.045 * (1 - progress * 0.35),
        attack: 0.002,
        release: 0.025,
        destination: bus,
      });
      t += interval;
      interval += 0.004;
      tickIndex += 1;
    }

    scheduleTone({
      frequency: 74,
      start,
      duration: seconds * 0.94,
      type: "sawtooth",
      gain: 0.012,
      attack: 0.03,
      release: 0.12,
      destination: bus,
      glideTo: 46,
    });
  }

  function playReveal(hit = false) {
    if (!enabled || !supported) {
      return;
    }

    unlock();
    const ctx = setup();
    if (!ctx) {
      return;
    }

    const start = ctx.currentTime + 0.015;
    scheduleTone({
      frequency: hit ? 784 : 196,
      start,
      duration: 0.12,
      type: hit ? "sine" : "triangle",
      gain: hit ? 0.12 : 0.08,
      release: 0.09,
    });
    scheduleTone({
      frequency: hit ? 1175 : 98,
      start: start + 0.045,
      duration: 0.12,
      type: "sine",
      gain: hit ? 0.08 : 0.055,
      release: 0.1,
    });
  }

  function playShuffle() {
    if (!enabled || !supported) {
      return;
    }

    unlock();
    const ctx = setup();
    if (!ctx) {
      return;
    }

    const start = ctx.currentTime + 0.02;
    for (let index = 0; index < 9; index += 1) {
      const time = start + index * 0.045;
      scheduleNoise({
        start: time,
        duration: 0.05,
        gain: 0.055,
        frequency: 1700 + index * 260,
        q: 1.5,
        filterType: "highpass",
      });
      scheduleTone({
        frequency: 320 + index * 22,
        start: time,
        duration: 0.035,
        type: "triangle",
        gain: 0.035,
        release: 0.04,
      });
    }
  }

  function playResetLaugh() {
    if (!enabled || !supported) {
      return;
    }

    unlock();
    const ctx = setup();
    if (!ctx) {
      return;
    }

    const start = ctx.currentTime + 0.02;
    [360, 330, 300, 260, 220].forEach((frequency, index) => {
      const time = start + index * 0.155;
      scheduleTone({
        frequency,
        start: time,
        duration: 0.095,
        type: "sawtooth",
        gain: 0.075,
        attack: 0.006,
        release: 0.07,
        glideTo: frequency * 0.74,
      });
      scheduleNoise({
        start: time,
        duration: 0.07,
        gain: 0.025,
        frequency: 720,
        q: 5,
      });
    });
    scheduleTone({
      frequency: 110,
      start: start + 0.82,
      duration: 0.2,
      type: "triangle",
      gain: 0.08,
      release: 0.12,
      glideTo: 72,
    });
  }

  function playVictory() {
    if (!enabled || !supported) {
      return;
    }

    unlock();
    stopSpin();
    const ctx = setup();
    if (!ctx) {
      return;
    }

    const start = ctx.currentTime + 0.02;
    const chords = [
      [523.25, 659.25, 783.99],
      [587.33, 739.99, 880],
      [659.25, 830.61, 987.77],
      [783.99, 987.77, 1174.66],
    ];

    chords.forEach((chord, chordIndex) => {
      chord.forEach((frequency, noteIndex) => {
        scheduleTone({
          frequency,
          start: start + chordIndex * 0.28 + noteIndex * 0.018,
          duration: chordIndex === chords.length - 1 ? 0.7 : 0.22,
          type: "triangle",
          gain: 0.055,
          attack: 0.012,
          release: 0.18,
        });
      });
    });

    for (let index = 0; index < 12; index += 1) {
      scheduleNoise({
        start: start + 0.16 + index * 0.07,
        duration: 0.045,
        gain: 0.022,
        frequency: 3600 + Math.random() * 1800,
        q: 1.2,
        filterType: "highpass",
      });
    }
  }

  return {
    isEnabled: () => enabled,
    isSupported: () => supported,
    unlock,
    toggle,
    setEnabled,
    playSpin,
    stopSpin,
    playReveal,
    playShuffle,
    playResetLaugh,
    playVictory,
  };
};
