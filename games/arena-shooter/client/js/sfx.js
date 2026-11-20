/**
 * Prozedurale Sounds (WebAudio-Synthese, keine Audiodateien) + einfache Hintergrundmusik.
 * Lautstärke: Master → (Musik | Effekte). Ausgabegerät über AudioContext.setSinkId.
 * Positionsabhängige Effekte: Lautstärke nach Entfernung, Stereo-Panorama nach Richtung.
 */
export class Sfx {
  constructor(audioSettings) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.music = this.ctx.createGain();
    this.fx = this.ctx.createGain();
    this.music.connect(this.master);
    this.fx.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.noise = this.makeNoise();
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.apply(audioSettings);
  }

  async apply(a) {
    this.master.gain.value = a.master;
    this.music.gain.value = a.music * 0.25;
    this.fx.gain.value = a.sfx;
    if (this.ctx.setSinkId) {
      try { await this.ctx.setSinkId(!a.outputDeviceId || a.outputDeviceId === 'default' ? '' : a.outputDeviceId); } catch (e) { console.warn('Audio-Ausgabegerät nicht verfügbar:', e.message); }
    }
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 1.0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Ausgangsknoten für eine Weltposition (oder ohne Position: direkt, "im Kopf"). */
  out(pos, vol = 1) {
    const g = this.ctx.createGain();
    if (!pos) {
      g.gain.value = vol;
      g.connect(this.fx);
      return g;
    }
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dz);
    g.gain.value = vol / (1 + d / 10);
    const pan = this.ctx.createStereoPanner();
    // Richtung relativ zum Blick: rechts = positiv
    const ang = Math.atan2(-dx, -dz) - this.listener.yaw;
    pan.pan.value = Math.max(-1, Math.min(1, -Math.sin(ang) * Math.min(1, d / 3)));
    g.connect(pan).connect(this.fx);
    return g;
  }

  noiseBurst(dest, dur, freq, q = 0.7, type = 'lowpass', attack = 0.002, start = 0) {
    const t = this.ctx.currentTime + start;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.25), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(dest, freq, dur, type = 'sine', vol = 0.5, endFreq = null, start = 0) {
    const t = this.ctx.currentTime + start;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  shot(weapon, pos) {
    const o = this.out(pos, pos ? 1.2 : 0.7);
    if (weapon === 'pistol') {
      this.noiseBurst(o, 0.18, 4200, 0.8);
      this.tone(o, 180, 0.1, 'triangle', 0.6, 60);
    } else if (weapon === 'rifle') {
      this.noiseBurst(o, 0.14, 5200, 1.0);
      this.tone(o, 140, 0.08, 'square', 0.25, 50);
    } else if (weapon === 'smg') {
      this.noiseBurst(o, 0.08, 3600, 1.4, 'bandpass');
      this.tone(o, 220, 0.05, 'square', 0.15, 90);
    } else if (weapon === 'sniper') {
      this.noiseBurst(o, 0.7, 3000, 0.4);
      this.tone(o, 70, 0.5, 'sawtooth', 0.6, 30);
      this.noiseBurst(o, 0.08, 2500, 5, 'bandpass', 0.001, 0.55); // Repetieren
      this.noiseBurst(o, 0.08, 1800, 5, 'bandpass', 0.001, 0.75);
    } else if (weapon === 'knife') {
      this.noiseBurst(o, 0.18, 6000, 2, 'bandpass', 0.06);
      return;
    } else if (weapon === 'rocket') {
      this.noiseBurst(o, 0.6, 1400, 0.6, 'lowpass', 0.01);
      this.tone(o, 120, 0.5, 'sawtooth', 0.3, 300);
    } else {
      this.noiseBurst(o, 0.45, 2600, 0.5);
      this.tone(o, 90, 0.3, 'sawtooth', 0.5, 35);
      this.noiseBurst(o, 0.12, 1200, 1, 'bandpass', 0.002, 0.28); // Pump-Klack
    }
  }

  reload(weapon) {
    const o = this.out(null, 0.5);
    const steps = {
      shotgun: [0.4, 0.85, 1.3, 1.75, 2.3, 2.45], rifle: [0.5, 1.1, 1.7, 1.85], smg: [0.4, 0.9, 1.4], sniper: [0.6, 1.3, 2.3, 2.5],
      rocket: [0.5, 1.2, 1.5], pistol: [0.35, 0.8, 1.1],
    }[weapon] || [0.3, 0.7, 1.0];
    for (const s of steps) this.noiseBurst(o, 0.06, 3000, 4, 'bandpass', 0.001, s);
  }

  explosion(pos, small = false) {
    const o = this.out(pos, small ? 0.8 : 2.2);
    this.noiseBurst(o, small ? 0.4 : 1.4, small ? 2500 : 1800, 0.5, 'lowpass', 0.003);
    this.tone(o, small ? 120 : 70, small ? 0.3 : 1.0, 'sine', 0.9, 25);
  }
  knifeHit() { this.noiseBurst(this.out(null, 0.5), 0.1, 1500, 2, 'bandpass'); this.tone(this.out(null, 0.3), 300, 0.08, 'triangle', 0.4, 120); }
  roulette() { this.tone(this.out(null, 0.25), 900 + Math.random() * 600, 0.04, 'square', 0.15); }
  itemGot() { const o = this.out(null, 0.4); [784, 988, 1175].forEach((f, i) => this.tone(o, f, 0.12, 'triangle', 0.35, null, i * 0.05)); }
  lightning() { const o = this.out(null, 0.7); this.noiseBurst(o, 0.9, 6000, 0.3, 'highpass', 0.001); this.tone(o, 60, 0.8, 'sawtooth', 0.6, 20); }
  inkSplat() { const o = this.out(null, 0.6); this.noiseBurst(o, 0.25, 600, 3, 'bandpass'); this.tone(o, 200, 0.3, 'sine', 0.4, 60); }
  star() { const o = this.out(null, 0.4); [1046, 1318, 1568, 2093, 1568, 2093].forEach((f, i) => this.tone(o, f, 0.1, 'square', 0.12, null, i * 0.07)); }
  turbo() { this.tone(this.out(null, 0.4), 200, 0.5, 'sawtooth', 0.25, 900); }
  slip() { this.tone(this.out(null, 0.4), 900, 0.4, 'sine', 0.4, 200); }
  chatPing() { this.tone(this.out(null, 0.2), 1200, 0.06, 'sine', 0.3); }
  throwItem() { this.noiseBurst(this.out(null, 0.3), 0.15, 2000, 1, 'bandpass', 0.02); }

  empty() { this.noiseBurst(this.out(null, 0.4), 0.04, 4000, 6, 'bandpass'); }
  hitmarker(head) { this.tone(this.out(null, 0.35), head ? 1700 : 1250, 0.07, 'square', 0.25); }
  kill() { const o = this.out(null, 0.4); this.tone(o, 880, 0.12, 'triangle', 0.4); this.tone(o, 1320, 0.2, 'triangle', 0.4, null, 0.08); }
  hurt() { const o = this.out(null, 0.6); this.tone(o, 160, 0.18, 'sawtooth', 0.4, 80); this.noiseBurst(o, 0.1, 800); }
  pickup() { const o = this.out(null, 0.4); this.tone(o, 660, 0.08, 'triangle', 0.4); this.tone(o, 990, 0.12, 'triangle', 0.4, null, 0.07); }
  powerup() { const o = this.out(null, 0.45); [523, 659, 784, 1046].forEach((f, i) => this.tone(o, f, 0.14, 'triangle', 0.35, null, i * 0.06)); }
  step(pos, sprint) { this.noiseBurst(this.out(pos, sprint ? 0.25 : 0.15), 0.07, 900, 1.2); }
  jump() { this.noiseBurst(this.out(null, 0.15), 0.1, 700); }
  spawn() { this.tone(this.out(null, 0.3), 300, 0.4, 'sine', 0.4, 900); }
  death() { const o = this.out(null, 0.5); this.tone(o, 330, 0.6, 'triangle', 0.4, 110); }

  /** Lockerer Loop: Bass + Arpeggio + leichte Percussion, läuft endlos. */
  startMusic() {
    if (this.musicTimer) return;
    const bpm = 104, beat = 60 / bpm;
    const prog = [[110, 220, 277, 330], [98, 196, 247, 294], [87, 174, 220, 262], [98, 196, 247, 330]];
    let bar = 0;
    const scheduleBar = () => {
      const chord = prog[bar % prog.length];
      for (let b = 0; b < 4; b++) {
        this.tone(this.music, chord[0], beat * 0.9, 'triangle', 0.5, null, b * beat);
        for (let s = 0; s < 2; s++) this.tone(this.music, chord[1 + ((b * 2 + s) % 3)] * 2, beat * 0.4, 'sine', 0.18, null, b * beat + s * beat / 2);
        this.noiseBurst(this.music, 0.05, 7000, 1, 'highpass', 0.001, b * beat + beat / 2);
        if (b % 2 === 0) this.tone(this.music, 70, 0.18, 'sine', 0.7, 40, b * beat);
      }
      bar++;
    };
    scheduleBar();
    this.musicTimer = setInterval(scheduleBar, beat * 4 * 1000);
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}
