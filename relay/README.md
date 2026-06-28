# toytank-relay

ToyTank 段階2 Co-op の「部屋＝リレー」サーバー（Cloudflare Workers + Durable Objects）。
2人の WebSocket を中継するだけで、ゲームのシミュレーションは**ホスト側のブラウザ**が持つ（ホスト権威）。
設計：[../docs/BasicDesign.md](../docs/BasicDesign.md) §12。

## 役割
- 1部屋 = Durable Object 1インスタンス（`RoomDO`）。
- host/guest の2本の WebSocket を保持し、片方のメッセージをもう片方へ**そのまま転送**。
- ロビー制御（合言葉発行・入室可否・退出通知）だけサーバーが生成する。
- WebSocket Hibernation 対応＝待機中は無課金。

## メッセージ（サーバー→クライアント）
- `{ "t": "created", "code": "ABCD" }` … ホストに合言葉を通知
- `{ "t": "joined", "code": "ABCD" }` … ゲストに入室成功を通知
- `{ "t": "peer-joined" }` … 相手が入室した
- `{ "t": "peer-left" }` … 相手が退出/切断した（この後 close）
- `{ "t": "error", "reason": "notfound" | "full" | "badrole" }`

ゲーム本体のメッセージ（入力・スナップショット）は中身を見ずにそのまま相手へ転送する。

## 接続
- ホスト: `wss://<relay>/ws?role=host`（合言葉はサーバーが発行して `created` で返す）
- ゲスト: `wss://<relay>/ws?role=guest&room=ABCD`

## 開発
```bash
cd relay
npm install
npm run dev        # ws://localhost:8787/ws
npm run typecheck
```

## デプロイ（当面手動）
```bash
cd relay
npx wrangler login   # 初回のみ（Cloudflareアカウント）
npm run deploy       # wss://toytank-relay.<account>.workers.dev/ws
```

クライアント側は接続先を `VITE_RELAY_URL` で切り替える（ローカル=`ws://localhost:8787/ws` / 本番=`wss://…workers.dev/ws`）。
