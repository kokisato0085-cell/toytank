// ToyTank 段階2 Co-op の「部屋＝リレー」サーバー（BasicDesign §12-a/b/f/l）。
// Cloudflare Workers + Durable Objects。1部屋 = RoomDO 1インスタンス。
// host 1本＋guest 最大3本の WebSocket を保持し、メッセージを「そのまま中継」する（simは持たない）。
//   ・host → 全ゲストへブロードキャスト
//   ・各ゲスト → host のみ（ゲスト同士は直接通信しない＝ホスト権威）
// ロビー制御（created/joined(+id)/peer-joined(+id)/peer-left(+id)/error）だけ DO が生成する。
// ゲストにはスロットid（1〜3）を割り当て、joined.id で本人へ・peer-joined.id でホストへ通知する。

import { nextFreeSlot } from "./slot";

export interface Env {
  ROOM: DurableObjectNamespace;
}

// 協力の最大ゲスト数（host id0 ＋ guest id1〜3 ＝ 最大4人。小12-6）。
const MAX_GUESTS = 3;

// 合言葉の文字種：紛らわしい文字（0/O/1/I）を除いた英数字。
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 4;

function genCode(): string {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function send(ws: WebSocket, obj: unknown): void {
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    /* 送信失敗（切断直後など）は無視 */
  }
}

// Worker エントリ：/ws の WebSocket アップグレードを、合言葉に対応する部屋(DO)へ振り分ける。
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/ws") {
      return new Response("ToyTank relay", { status: 200 });
    }
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const role = url.searchParams.get("role");
    let code = (url.searchParams.get("room") ?? "").toUpperCase();
    if (role === "host") {
      if (!code) code = genCode(); // ホストは合言葉を発行（指定があればそれを使う）
    } else if (role === "guest") {
      if (!code) return new Response("room code required", { status: 400 });
    } else {
      return new Response("role required (host|guest)", { status: 400 });
    }

    // 合言葉から部屋(DO)を一意に決める。
    const id = env.ROOM.idFromName(code);
    const stub = env.ROOM.get(id);
    const fwd = new URL(req.url);
    fwd.searchParams.set("room", code); // 生成した合言葉を DO へ渡す
    return stub.fetch(new Request(fwd.toString(), req));
  },
} satisfies ExportedHandler<Env>;

// 部屋本体。WebSocket Hibernation API を使い、待機中は無課金で接続を保持する。
// host/guest の区別・ゲストのスロットidは acceptWebSocket のタグで持つ（`host` / `guest` / `s1`〜`s3`）。
// ハイバネーション復帰後も getWebSockets(tag) / getTags(ws) で取り戻せる。
export class RoomDO implements DurableObject {
  constructor(private state: DurableObjectState) {}

  private peers(tag: "host" | "guest"): WebSocket[] {
    return this.state.getWebSockets(tag);
  }

  // ゲストWSに割り当てられたスロットid（1〜3）をタグから取り出す。
  private slotOf(ws: WebSocket): number {
    for (const t of this.state.getTags(ws)) {
      if (t[0] === "s") {
        const n = Number(t.slice(1));
        if (n >= 1) return n;
      }
    }
    return -1;
  }

  // 空いている最小のスロット（1〜MAX_GUESTS）。満室なら -1。
  private freeSlot(guests: WebSocket[]): number {
    return nextFreeSlot(guests.map((g) => this.slotOf(g)), MAX_GUESTS);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const role = url.searchParams.get("role") as "host" | "guest" | null;
    const code = url.searchParams.get("room") ?? "";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const hosts = this.peers("host");
    const guests = this.peers("guest");

    if (role === "host") {
      if (hosts.length > 0) return this.reject(client, server, "full"); // 合言葉衝突など（稀）
      this.state.acceptWebSocket(server, ["host"]);
      send(server, { t: "created", code });
      for (const g of guests) send(server, { t: "peer-joined", id: this.slotOf(g) }); // 既存ゲスト（稀）
    } else if (role === "guest") {
      if (hosts.length === 0) return this.reject(client, server, "notfound");
      const slot = this.freeSlot(guests);
      if (slot < 0) return this.reject(client, server, "full");
      this.state.acceptWebSocket(server, ["guest", `s${slot}`]);
      send(server, { t: "joined", code, id: slot });
      for (const h of hosts) send(h, { t: "peer-joined", id: slot });
    } else {
      return this.reject(client, server, "badrole");
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // host からのメッセージ → 全ゲストへブロードキャスト。ゲストからのメッセージ → host のみ。
  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    const isHost = this.peers("host").includes(ws);
    const targets = isHost ? this.peers("guest") : this.peers("host");
    for (const t of targets) {
      try {
        t.send(msg);
      } catch {
        /* 無視 */
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    const isHost = this.peers("host").includes(ws);
    if (isHost) {
      // ホスト離脱＝権威が消える → 全ゲストを終了させ部屋を閉じる（中12-f）。
      for (const g of this.peers("guest")) {
        send(g, { t: "peer-left", host: true });
        try {
          g.close(1000, "host-left");
        } catch {
          /* 無視 */
        }
      }
    } else {
      // ゲスト離脱＝そのプレイヤーのみ退場 → ホストへ id を通知（他ゲストは巻き込まない・中12-f）。
      const slot = this.slotOf(ws);
      for (const h of this.peers("host")) send(h, { t: "peer-left", id: slot });
    }
    try {
      ws.close();
    } catch {
      /* 無視 */
    }
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws);
  }

  // 接続を拒否する（エラー理由を伝えてすぐ閉じる）。
  private reject(client: WebSocket, server: WebSocket, reason: string): Response {
    server.accept();
    send(server, { t: "error", reason });
    try {
      server.close(1008, reason);
    } catch {
      /* 無視 */
    }
    return new Response(null, { status: 101, webSocket: client });
  }
}
