// ToyTank 段階2 Co-op の「部屋＝リレー」サーバー（BasicDesign §12-a/b/f）。
// Cloudflare Workers + Durable Objects。1部屋 = RoomDO 1インスタンス。
// host/guest の2本の WebSocket を保持し、相手へメッセージを「そのまま中継」する（simは持たない）。
// ロビー制御（created/joined/peer-joined/peer-left/error）だけ DO が生成する。

export interface Env {
  ROOM: DurableObjectNamespace;
}

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
// host/guest の区別は acceptWebSocket のタグで持ち、ハイバネーション復帰後も getWebSockets(tag) で取り戻せる。
export class RoomDO implements DurableObject {
  constructor(private state: DurableObjectState) {}

  private peers(tag: "host" | "guest"): WebSocket[] {
    return this.state.getWebSockets(tag);
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
      if (guests.length > 0) send(server, { t: "peer-joined" });
    } else if (role === "guest") {
      if (hosts.length === 0) return this.reject(client, server, "notfound");
      if (guests.length > 0) return this.reject(client, server, "full");
      this.state.acceptWebSocket(server, ["guest"]);
      send(server, { t: "joined", code });
      for (const h of hosts) send(h, { t: "peer-joined" });
    } else {
      return this.reject(client, server, "badrole");
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // 一方の peer から来たメッセージを、もう一方へそのまま中継する。
  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    const isHost = this.peers("host").includes(ws);
    const targets = this.peers(isHost ? "guest" : "host");
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
    const others = this.peers(isHost ? "guest" : "host");
    for (const o of others) {
      send(o, { t: "peer-left" });
      try {
        o.close(1000, "peer-left"); // 片方が抜けたら相手も終了（中12-f）
      } catch {
        /* 無視 */
      }
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
