// Co-op の通信クライアント（BasicDesign §12-b/g）。
// relay（Cloudflare DO）へ WebSocket でつなぎ、ロビー制御メッセージと
// ゲームメッセージ（入力・スナップショット）を送受信する土台。
// ※ ホスト権威。ここは「つなぐ・送る・受け取る」だけで、ゲームのsimは持たない。

export type RelayRole = "host" | "guest";

// サーバー（relay）が生成するロビー制御メッセージ。
export type LobbyMsg =
  | { t: "created"; code: string }
  | { t: "joined"; code: string }
  | { t: "peer-joined" }
  | { t: "peer-left" }
  | { t: "error"; reason: string };

const LOBBY_TYPES = new Set(["created", "joined", "peer-joined", "peer-left", "error"]);

// 接続先 relay の URL。本番は wss、ローカルは ws://localhost:8787/ws。
// 環境変数 VITE_RELAY_URL で切替（未設定ならローカル開発用の既定）。
export function relayUrl(): string {
  return (import.meta.env.VITE_RELAY_URL as string | undefined) ?? "ws://localhost:8787/ws";
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private closedByUs = false;

  role: RelayRole = "host";
  code = "";

  // コールバック（呼び出し側が差し替える）。
  onLobby: (m: LobbyMsg) => void = () => {};
  onGameMessage: (data: unknown) => void = () => {}; // ③以降で使用（入力/スナップショット）
  onClose: () => void = () => {};
  onError: (e: string) => void = () => {};

  // 接続する。guest は code 必須。host は code 省略でサーバーが発行。
  connect(role: RelayRole, code?: string): void {
    this.role = role;
    this.closedByUs = false;
    const base = relayUrl();
    const params = new URLSearchParams({ role });
    if (code) params.set("room", code.toUpperCase());
    const url = `${base}?${params.toString()}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.onError("connect-failed");
      return;
    }
    this.ws = ws;

    ws.addEventListener("message", (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return; // 不正なメッセージは無視
      }
      const t = (data as { t?: string })?.t;
      if (t && LOBBY_TYPES.has(t)) {
        const m = data as LobbyMsg;
        if (m.t === "created" || m.t === "joined") this.code = m.code;
        this.onLobby(m);
      } else {
        this.onGameMessage(data); // ゲームメッセージ（相手から中継されたもの）
      }
    });

    ws.addEventListener("error", () => {
      this.onError("socket-error");
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      if (!this.closedByUs) this.onClose();
    });
  }

  // ゲームメッセージを相手へ送る（relay が転送する）。③以降で使用。
  send(obj: unknown): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  // こちらから切断する（onClose は呼ばない）。
  close(): void {
    this.closedByUs = true;
    try {
      this.ws?.close(1000, "bye");
    } catch {
      /* 無視 */
    }
    this.ws = null;
  }
}
