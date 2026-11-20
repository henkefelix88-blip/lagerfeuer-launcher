/**
 * Launcher-Audio: UI-Klicks und ruhige Menümusik (prozedural erzeugt – keine Audiodateien nötig).
 * Respektiert Master-/Musik-/Effekt-Lautstärke und das gewählte Ausgabegerät (AudioContext.setSinkId).
 */
export class LauncherAudio {
  constructor() {
    this.ctx = null;
    this.musicOn = false;
    this.settings = { master: 0.8, music: 0.5, sfx: 0.8, outputDeviceId: 'default' };
  }

  ensure() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.music = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.apply(this.settings);
  }

  /** Lautstärken + Ausgabegerät übernehmen. */
  async apply(a) {
    this.settings = { ...a };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(a.master, t, 0.05);
    this.music.gain.setTargetAtTime(a.music * 0.35, t, 0.05);
    this.sfx.gain.setTargetAtTime(a.sfx, t, 0.05);
    if (this.ctx.setSinkId) {
      try { await this.ctx.setSinkId(a.outputDeviceId === 'default' ? '' : a.outputDeviceId); } catch (e) { console.warn('Ausgabegerät nicht verfügbar:', e.message); }
    }
  }

  blip(freq = 660, dur = 0.07, type = 'triangle', vol = 0.25) {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  click() { this.blip(520, 0.06); }
  hover() { this.blip(880, 0.03, 'sine', 0.06); }
  success() { this.blip(523, 0.1); setTimeout(() => this.blip(784, 0.14), 90); }
  error() { this.blip(220, 0.18, 'square', 0.12); }

  /** Sanfte Lagerfeuer-Akkorde, endlos. */
  startMusic() {
    this.ensure();
    if (this.musicOn) return;
    this.musicOn = true;
    const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 329.6]];
    let i = 0;
    const play = () => {
      if (!this.musicOn) return;
      const t = this.ctx.currentTime;
      for (const f of chords[i % chords.length]) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        o.type = 'triangle';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12, t + 1.2);
        g.gain.linearRampToValueAtTime(0, t + 4.2);
        o.connect(lp).connect(g).connect(this.music);
        o.start(t);
        o.stop(t + 4.3);
      }
      i++;
      this.musicTimer = setTimeout(play, 3800);
    };
    if (this.ctx.state === 'suspended') this.ctx.resume();
    play();
  }

  stopMusic() {
    this.musicOn = false;
    clearTimeout(this.musicTimer);
  }
}
