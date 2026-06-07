// 入力（BasicDesign §5）。
// 画面左半分＝移動スティック、右半分＝エイムパッド（引いて離した瞬間に発射、
// ほぼ動かさず離す＝タップ＝進行方向へ即撃ち）。マルチタッチで移動と射撃を同時に行える。
// デスクトップ補助：WASD/矢印で移動、マウス右半ドラッグで照準、Space で即撃ち。

const MAX_R = 60; // スティックの最大引っ張り半径(px)
const KNOB_R = 24;
const TAP_THRESH = 14; // この距離未満のドラッグはタップ扱い
const AIM_MIN = 14; // この距離以上で照準線を表示
const MOVE_DEADZONE = 8; // これを超えたら最大速度で移動（少し入れたら全速）

interface Stick {
  id: number;
  anchor: { x: number; y: number };
  cur: { x: number; y: number };
  active: boolean;
}

// 発射要求。dir=null は「進行方向へ」（タップ／Space）。
export interface FireReq {
  dir: { x: number; y: number } | null;
  cursor?: boolean; // PC: マウスカーソルへ向けて発射
}

function emptyStick(): Stick {
  return { id: -1, anchor: { x: 0, y: 0 }, cur: { x: 0, y: 0 }, active: false };
}

export class Input {
  private keys = new Set<string>();
  private move = emptyStick();
  private aim = emptyStick();
  private fires: FireReq[] = [];
  private mineReqs = 0;
  private mode: "mobile" | "pc" = "mobile";
  private cursor: { x: number; y: number } | null = null; // PC: マウス位置（キャンバスpx）

  setMode(mode: "mobile" | "pc"): void {
    this.mode = mode;
    this.move.active = false;
    this.aim.active = false;
  }
  isPc(): boolean {
    return this.mode === "pc";
  }
  getCursor(): { x: number; y: number } | null {
    return this.cursor;
  }

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key === " " && !e.repeat) this.fires.push({ dir: null });
      if (e.key.toLowerCase() === "e" && !e.repeat) this.mineReqs++;
    });
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
    if (this.mode === "pc") {
      // PC：クリックでカーソル位置へ照準発射
      this.cursor = this.toCanvas(e);
      this.fires.push({ dir: null, cursor: true });
      return;
    }
    const p = this.toCanvas(e);
    const leftHalf = p.x < this.canvas.width / 2;
    const target = leftHalf ? this.move : this.aim;
    if (target.active) return; // その側は使用中
    target.id = e.pointerId;
    target.anchor = p;
    target.cur = p;
    target.active = true;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (this.mode === "pc") {
      this.cursor = this.toCanvas(e); // マウス追従
      return;
    }
    if (this.move.active && e.pointerId === this.move.id) this.move.cur = this.toCanvas(e);
    if (this.aim.active && e.pointerId === this.aim.id) this.aim.cur = this.toCanvas(e);
  };

  private onUp = (e: PointerEvent): void => {
    if (this.move.active && e.pointerId === this.move.id) {
      this.move.active = false;
      this.move.id = -1;
    } else if (this.aim.active && e.pointerId === this.aim.id) {
      const d = this.dragVec(this.aim);
      const m = Math.hypot(d.x, d.y);
      this.fires.push(m < TAP_THRESH ? { dir: null } : { dir: { x: d.x / m, y: d.y / m } });
      this.aim.active = false;
      this.aim.id = -1;
    }
  };

  private dragVec(s: Stick): { x: number; y: number } {
    return { x: s.cur.x - s.anchor.x, y: s.cur.y - s.anchor.y };
  }

  // 移動ベクトル（移動スティック優先、なければキーボード）。大きさ最大1。
  axis(): { x: number; y: number } {
    if (this.move.active) {
      const { x, y } = this.dragVec(this.move);
      const m = Math.hypot(x, y);
      if (m < MOVE_DEADZONE) return { x: 0, y: 0 }; // ごく僅かは無入力
      return { x: x / m, y: y / m }; // 少しでも入れたら方向そのままで最大速度
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

  // 現在の照準方向（エイムパッドを十分引いているとき）。なければ null。
  aimDir(): { x: number; y: number } | null {
    if (!this.aim.active) return null;
    const d = this.dragVec(this.aim);
    const m = Math.hypot(d.x, d.y);
    if (m < AIM_MIN) return null;
    return { x: d.x / m, y: d.y / m };
  }

  // たまった発射要求を取り出してクリア。
  takeFires(): FireReq[] {
    const f = this.fires;
    this.fires = [];
    return f;
  }

  // 地雷設置要求（キーボード "e"／外部ボタン）。
  requestMine(): void {
    this.mineReqs++;
  }
  takeMines(): number {
    const n = this.mineReqs;
    this.mineReqs = 0;
    return n;
  }

  // スティック／パッドのUI（デバイス座標。呼び出し側は transform をリセット済みのこと）。
  drawSticks(ctx: CanvasRenderingContext2D): void {
    if (this.mode === "pc") {
      if (this.cursor) this.drawCrosshair(ctx, this.cursor.x, this.cursor.y);
      return;
    }
    if (this.move.active) this.drawPad(ctx, this.move, "#888", "#333");
    if (this.aim.active) this.drawPad(ctx, this.aim, "#caa", "#a33");
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.strokeStyle = "rgba(192,57,43,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.moveTo(x - 14, y);
    ctx.lineTo(x + 14, y);
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x, y + 14);
    ctx.stroke();
    ctx.restore();
  }

  private drawPad(ctx: CanvasRenderingContext2D, s: Stick, baseCol: string, knobCol: string): void {
    let { x: dx, y: dy } = this.dragVec(s);
    const m = Math.hypot(dx, dy);
    if (m > MAX_R) {
      dx = (dx / m) * MAX_R;
      dy = (dy / m) * MAX_R;
    }
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = baseCol;
    ctx.beginPath();
    ctx.arc(s.anchor.x, s.anchor.y, MAX_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = knobCol;
    ctx.beginPath();
    ctx.arc(s.anchor.x + dx, s.anchor.y + dy, KNOB_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
