// A timeline seek pauses only its simulation. It must not freeze the next
// sculpture or the empty clay, and a new physical experiment starts afresh.
export class PlaybackState {
  constructor(reduced = false) { this.artPaused = reduced; this.physicsPaused = reduced; this.active = false; this.signature = ''; }
  setWorld(world, reduced = false) {
    const physical = world.engine === 'world' && world.entities.some(e => e.physics?.kind !== 'none' && e.physics?.kind);
    const signature = physical ? JSON.stringify(world.entities.map(e => [e.label, e.physics, world.entities.find(t => t.id === e.target)?.label])) : '';
    const restart = !!physical && signature !== this.signature;
    if (restart) this.physicsPaused = reduced;
    this.active = !!physical; this.signature = signature;
    return { restart, paused: this.paused };
  }
  get paused() { return this.artPaused || this.active && this.physicsPaused; }
  setPaused(value) { if (this.active) this.physicsPaused = value; else this.artPaused = value; if (!value) this.artPaused = false; return this.paused; }
  toggle() { return this.setPaused(!this.paused); }
  toggleGlobal() { if (this.paused) { this.artPaused = false; this.physicsPaused = false; } else this.artPaused = true; return this.paused; }
  setReduced(value) { this.artPaused = value; this.physicsPaused = value; }
}
