/** Particles and floating text, all in world space. */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
  /** Streak particles are drawn as short lines along their velocity. */
  streak?: boolean;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
  max: number;
}

export class Fx {
  particles: Particle[] = [];
  texts: FloatText[] = [];

  burst(x: number, y: number, n: number, color: string, speed: number, opts: Partial<Particle> = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      const max = 0.4 + Math.random() * 0.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.abs(Math.sin(a)) * s * 0.9 + speed * 0.2,
        life: max,
        max,
        size: 0.05 + Math.random() * 0.06,
        color,
        gravity: 6,
        ...opts,
      });
    }
  }

  text(x: number, y: number, text: string, color: string, size = 26, life = 1.1) {
    this.texts.push({ x, y, text, color, size, life, max: life });
  }

  update(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y += dt * 0.9;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  clear() {
    this.particles = [];
    this.texts = [];
  }

  drawWorld(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      if (p.streak) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.12, p.y - p.vy * 0.12);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
