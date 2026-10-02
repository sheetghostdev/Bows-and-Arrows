/** World (metres, y up) <-> screen (CSS px, y down). */
export class Camera {
  x = 0;
  y = 0;
  zoom = 20;
  shake = 0;
  private sx = 0;
  private sy = 0;
  private target = { x: 0, y: 0, zoom: 20 };

  setTarget(x: number, y: number, zoom: number) {
    this.target.x = x;
    this.target.y = y;
    this.target.zoom = zoom;
  }

  snap() {
    this.x = this.target.x;
    this.y = this.target.y;
    this.zoom = this.target.zoom;
  }

  update(dt: number, speed: number) {
    const k = 1 - Math.exp(-dt * speed);
    this.x += (this.target.x - this.x) * k;
    this.y += (this.target.y - this.y) * k;
    this.zoom = Math.exp(Math.log(this.zoom) + (Math.log(this.target.zoom) - Math.log(this.zoom)) * k);
    this.shake *= Math.exp(-dt * 9);
    if (this.shake < 0.2) this.shake = 0;
    this.sx = (Math.random() * 2 - 1) * this.shake;
    this.sy = (Math.random() * 2 - 1) * this.shake;
  }

  /** Canvas transform for drawing in world space. */
  apply(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) {
    const z = this.zoom * dpr;
    ctx.setTransform(z, 0, 0, -z, (w / 2 - this.x * this.zoom + this.sx) * dpr, (h / 2 + this.y * this.zoom + this.sy) * dpr);
  }

  toScreen(x: number, y: number, w: number, h: number): { x: number; y: number } {
    return { x: w / 2 + (x - this.x) * this.zoom + this.sx, y: h / 2 - (y - this.y) * this.zoom + this.sy };
  }

  toWorld(sx: number, sy: number, w: number, h: number): { x: number; y: number } {
    return { x: this.x + (sx - w / 2) / this.zoom, y: this.y - (sy - h / 2) / this.zoom };
  }
}
