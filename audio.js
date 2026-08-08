window.createAudioManager = function createAudioManager(storageKey = "bingoSoundEnabled") {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const supported = Boolean(AudioContextClass);
  const masterVolume = 1.75;
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
    master.gain.value = enabled ? masterVolume : 0;
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
      master.gain.setTargetAtTime(enabled ? masterVolume : 0, now, 0.04);
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
    activeSpinBus.gain.value = enabled ? 1.42 : 0;
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
    const carnivalNotes = [523.25, 659.25, 783.99, 987.77, 1174.66, 1318.51];

    if (danger) {
      for (let t = 0; t < seconds; t += 0.115) {
        const pulse = start + t;
        const pulseIndex = Math.floor(t / 0.115);
        const high = pulseIndex % 2 === 0;
        scheduleTone({
          frequency: high ? 1174.66 : 880,
          start: pulse,
          duration: 0.058,
          type: "square",
          gain: 0.28,
          attack: 0.004,
          release: 0.025,
          destination: bus,
        });
        scheduleTone({
          frequency: carnivalNotes[pulseIndex % carnivalNotes.length],
          start: pulse + 0.026,
          duration: 0.052,
          type: "triangle",
          gain: 0.16,
          attack: 0.003,
          release: 0.032,
          destination: bus,
        });
        scheduleTone({
          frequency: 146.83,
          start: pulse,
          duration: 0.04,
          type: "sine",
          gain: 0.1,
          attack: 0.003,
          release: 0.03,
          destination: bus,
        });
        scheduleNoise({
          start: pulse,
          duration: 0.026,
          gain: 0.07,
          frequency: 4200,
          q: 1.6,
          filterType: "highpass",
          destination: bus,
        });
      }
      return;
    }

    let t = 0;
    let interval = 0.044;
    let tickIndex = 0;
    while (t < seconds) {
      const tickTime = start + t;
      const progress = Math.min(t / seconds, 1);
      scheduleNoise({
        start: tickTime,
        duration: 0.022,
        gain: 0.11 * (1 - progress * 0.32),
        frequency: 3400 - progress * 1200,
        q: 2.8,
        destination: bus,
      });
      scheduleTone({
        frequency: carnivalNotes[tickIndex % carnivalNotes.length],
        start: tickTime,
        duration: 0.033,
        type: "triangle",
        gain: 0.13 * (1 - progress * 0.25),
        attack: 0.002,
        release: 0.025,
        destination: bus,
      });

      if (tickIndex % 3 === 0) {
        scheduleTone({
          frequency: 130.81,
          start: tickTime,
          duration: 0.032,
          type: "sine",
          gain: 0.075,
          attack: 0.003,
          release: 0.03,
          destination: bus,
        });
      }

      t += interval;
      interval += 0.0035;
      tickIndex += 1;
    }

    scheduleTone({
      frequency: 98,
      start,
      duration: seconds * 0.94,
      type: "sawtooth",
      gain: 0.045,
      attack: 0.03,
      release: 0.12,
      destination: bus,
      glideTo: 65.41,
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
      frequency: hit ? 880 : 261.63,
      start,
      duration: hit ? 0.15 : 0.11,
      type: hit ? "sine" : "triangle",
      gain: hit ? 0.32 : 0.18,
      release: 0.09,
    });
    scheduleTone({
      frequency: hit ? 1318.51 : 392,
      start: start + 0.045,
      duration: hit ? 0.16 : 0.09,
      type: "sine",
      gain: hit ? 0.22 : 0.11,
      release: 0.1,
    });

    if (hit) {
      scheduleTone({
        frequency: 1760,
        start: start + 0.105,
        duration: 0.13,
        type: "triangle",
        gain: 0.16,
        release: 0.12,
      });
      scheduleNoise({
        start: start + 0.03,
        duration: 0.12,
        gain: 0.075,
        frequency: 5200,
        q: 1.4,
        filterType: "highpass",
      });
    }
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
    for (let index = 0; index < 12; index += 1) {
      const time = start + index * 0.04;
      scheduleNoise({
        start: time,
        duration: 0.052,
        gain: 0.16,
        frequency: 2100 + index * 310,
        q: 1.35,
        filterType: "highpass",
      });
      scheduleTone({
        frequency: 392 + index * 38,
        start: time,
        duration: 0.038,
        type: "triangle",
        gain: 0.12,
        release: 0.04,
      });
    }

    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      scheduleTone({
        frequency,
        start: start + 0.5 + index * 0.055,
        duration: 0.12,
        type: "sine",
        gain: 0.15,
        release: 0.1,
      });
    });
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
    [523.25, 493.88, 392, 349.23, 293.66, 246.94].forEach((frequency, index) => {
      const time = start + index * 0.13;
      scheduleTone({
        frequency,
        start: time,
        duration: 0.105,
        type: "sawtooth",
        gain: 0.21,
        attack: 0.006,
        release: 0.07,
        glideTo: frequency * 0.72,
      });
      scheduleNoise({
        start: time,
        duration: 0.065,
        gain: 0.085,
        frequency: 920,
        q: 5,
      });
    });
    scheduleTone({
      frequency: 110,
      start: start + 0.84,
      duration: 0.24,
      type: "triangle",
      gain: 0.2,
      release: 0.12,
      glideTo: 72,
    });
  }

  function playLineParty() {
    if (!enabled || !supported) {
      return;
    }

    unlock();
    stopSpin();
    const ctx = setup();
    if (!ctx) {
      return;
    }

    const start = ctx.currentTime + 0.018;
    const melody = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];

    melody.forEach((frequency, index) => {
      const time = start + index * 0.075;
      scheduleTone({
        frequency,
        start: time,
        duration: 0.16,
        type: "triangle",
        gain: 0.2,
        attack: 0.006,
        release: 0.1,
      });
      scheduleTone({
        frequency: frequency / 2,
        start: time,
        duration: 0.08,
        type: "sine",
        gain: 0.075,
        release: 0.06,
      });
    });

    for (let index = 0; index < 8; index += 1) {
      scheduleNoise({
        start: start + 0.08 + index * 0.034,
        duration: 0.085,
        gain: 0.12,
        frequency: 900 + index * 190,
        q: 1.7,
        filterType: "bandpass",
      });
    }

    [0.42, 0.56, 0.74, 0.92].forEach((offset, index) => {
      scheduleNoise({
        start: start + offset,
        duration: 0.12,
        gain: 0.13,
        frequency: 4200 + index * 560,
        q: 1.2,
        filterType: "highpass",
      });
      scheduleTone({
        frequency: [1046.5, 1318.51, 1567.98, 2093][index],
        start: start + offset,
        duration: 0.18,
        type: "sine",
        gain: 0.13,
        attack: 0.004,
        release: 0.12,
      });
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
      [1046.5, 1318.51, 1567.98],
    ];

    chords.forEach((chord, chordIndex) => {
      chord.forEach((frequency, noteIndex) => {
        scheduleTone({
          frequency,
          start: start + chordIndex * 0.26 + noteIndex * 0.018,
          duration: chordIndex === chords.length - 1 ? 0.86 : 0.22,
          type: "triangle",
          gain: 0.17,
          attack: 0.012,
          release: 0.18,
        });
      });
    });

    [392, 523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98].forEach((frequency, index) => {
      scheduleTone({
        frequency,
        start: start + 1.08 + index * 0.075,
        duration: 0.18,
        type: "sine",
        gain: 0.15,
        release: 0.13,
      });
    });

    for (let index = 0; index < 18; index += 1) {
      scheduleNoise({
        start: start + 0.14 + index * 0.065,
        duration: 0.06,
        gain: 0.09,
        frequency: 3800 + Math.random() * 2400,
        q: 1.2,
        filterType: "highpass",
      });
    }
  }

  return {
    isEnabled: () => enabled,
    isSupported: () => supported,
    isUnlocked: () => !supported || context?.state === "running",
    unlock,
    toggle,
    setEnabled,
    playSpin,
    stopSpin,
    playReveal,
    playShuffle,
    playResetLaugh,
    playLineParty,
    playVictory,
  };
};
