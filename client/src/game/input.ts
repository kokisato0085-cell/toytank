// 入力：左バーチャルスティック（タッチ／マウス）＋キーボード（WASD・矢印）。
// axis() は [-1,1] の移動ベクトルを返す（大きさは最大1）。
// スティックは「触れた位置を中心に、引っ張った方向・量」で操作する。

const MAX_R = 60; // スティックの最大引っ張り半径(px)
const KNOB_R = 24;

export class Input {
  private keys = new Set<string>();
  private active = false;
  private anchor = { x: 0, y: 0 };
  private cur = { x: 0, y: 0 };
  private pointerId = -1;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
  }

  private toCanvas(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (this.canvas.width / r.width),
      y: (e.clientY - r.top) * (this.canvas.height / r.height),
    };
  }

  private onDown = (e: PointerEvent): void => {
    this.active = true;
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.anchor = this.toCanvas(e);
    this.cur = this.anchor;
  };
  private onMove = (e: PointerEvent): void => {
    if (this.active && e.pointerId === this.pointerId) this.cur = this.toCanvas(e);
  };
  private onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) {
      this.active = false;
      this.pointerId = -1;
    }
  };

  // 現在の移動ベクトル（スティック優先、なければキーボード）。
  axis(): { x: number; y: number } {
    if (this.active) {
      let dx = this.cur.x - this.anchor.x;
      let dy = this.cur.y - this.anchor.y;
      const m = Math.hypot(dx, dy);
      if (m > MAX_R) {
        dx = (dx / m) * MAX_R;
        dy = (dy / m) * MAX_R;
      }
      return { x: dx / MAX_R, y: dy / MAX_R };
    }
    let x = 0;
    let y = 0;
    if (this.keys.has("arrowleft") || this.keys.has("a")) x -= 1;
    if (this.keys.has("arrowright") || this.keys.has("d")) x += 1;
    if (this.keys.has("arrowup") || this.keys.has("w")) y -= 1;
    if (this.keys.has("arrowdown") || this.keys.has("s")) y += 1;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    return { x, y };
  }

  // スティックのUI（デバイス座標で描く。呼び出し側は transform をリセットしておく）。
  drawStick(ctx: CanvasRenderingContext2D): void {
    if (!this.active) return;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#888";
    ctx.beginPath();
    ctx.arc(this.anchor.x, this.anchor.y, MAX_R, 0, Math.PI * 2);
    ctx.fill();
    let dx = this.cur.x - this.anchor.x;
    let dy = this.cur.y - this.anchor.y;
    const m = Math.hypot(dx, dy);
    if (m > MAX_R) {
      dx = (dx / m) * MAX_R;
      dy = (dy / m) * MAX_R;
    }
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(this.anchor.x + dx, this.anchor.y + dy, KNOB_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
