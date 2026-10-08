// Cloudflare Worker 진입점
//  - 정적 파일(public/)은 Workers Assets 가 서빙
//  - 룸 1개 = Durable Object 1개 (AuctionRoom): WebSocket 연결 + 알람으로 타이머 판정
//  - 프로필 사진 = Durable Object 저장소 (ImageStore)
import { DurableObject } from 'cloudflare:workers';
import { roomCode, uid, createRoom, publicState, tick, nextDeadline, registerDirector, handleAction } from './logic.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const roomStub = (env, code) => env.ROOMS.get(env.ROOMS.idFromName(code.toUpperCase()));
const imageStub = env => env.IMAGES.get(env.IMAGES.idFromName('images'));

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    let m;

    // 룸 생성
    if (p === '/api/rooms' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      for (let i = 0; i < 5; i++) {
        const code = roomCode();
        const r = await roomStub(env, code).init(body, code);
        if (r.error) return json({ error: r.error }, 400);
        if (r.ok) return json({ code, observerKey: r.observerKey });
      }
      return json({ error: '룸 코드 생성 실패. 다시 시도하세요.' }, 500);
    }

    // 룸 존재 확인
    if ((m = /^\/api\/rooms\/([A-Za-z0-9]+)$/.exec(p))) {
      return json({ exists: await roomStub(env, m[1]).exists() });
    }

    // 이미지 업로드 (클라이언트에서 512px 로 줄여서 보냄)
    if (p === '/api/upload' && req.method === 'POST') {
      const { dataUrl } = await req.json().catch(() => ({}));
      const mm = /^data:(image\/(?:png|jpe?g|gif|webp));base64,(.+)$/.exec(dataUrl || '');
      if (!mm) return json({ error: '이미지 형식이 아닙니다.' }, 400);
      const bytes = Uint8Array.from(atob(mm[2]), c => c.charCodeAt(0));
      if (bytes.length > 1_500_000) return json({ error: '이미지가 너무 큽니다.' }, 400);
      const id = uid(10);
      await imageStub(env).put(id, bytes, mm[1]);
      return json({ url: `/uploads/${id}` });
    }
    if ((m = /^\/uploads\/([a-f0-9]+)$/.exec(p))) {
      const img = await imageStub(env).get(m[1]);
      if (!img) return new Response('Not found', { status: 404 });
      return new Response(img.bytes, { headers: { 'Content-Type': img.type, 'Cache-Control': 'public, max-age=31536000, immutable' } });
    }

    // 실시간 연결
    if ((m = /^\/ws\/([A-Za-z0-9]+)$/.exec(p))) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket only', { status: 426 });
      return roomStub(env, m[1]).fetch(req);
    }

    // 페이지 라우트
    if (/^\/r\/[A-Za-z0-9]+$/.test(p)) return env.ASSETS.fetch(new Request(new URL('/room', url), req));
    if (/^\/overlay\/[A-Za-z0-9]+$/.test(p)) return env.ASSETS.fetch(new Request(new URL('/overlay', url), req));

    return env.ASSETS.fetch(req);
  },
};

// ── 경매 룸 ──────────────────────────────────────────────
export class AuctionRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // 클라이언트가 30초마다 보내는 'ping'에 DO를 깨우지 않고 응답
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || null;
    });
  }

  async init(body, code) {
    if (this.room) return { ok: false };   // 코드 충돌 → 다른 코드로 재시도
    const r = createRoom(body || {}, code, Date.now());
    if (r.error) return { error: r.error };
    this.room = r.room;
    await this.commit(false);
    return { ok: true, observerKey: this.room.observerKey };
  }

  async exists() { return !!this.room; }

  async fetch(req) {
    if (!this.room) return new Response('룸 없음', { status: 404 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: 'viewer', directorId: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  /** 저장 + 알람 재설정 + (선택) 전체 전송 */
  async commit(doBroadcast = true) {
    await this.ctx.storage.put('room', this.room);
    const t = nextDeadline(this.room);
    if (t) await this.ctx.storage.setAlarm(t);
    else await this.ctx.storage.deleteAlarm();
    if (doBroadcast) this.broadcast();
  }

  broadcast() {
    const msg = JSON.stringify({ ev: 'state', data: publicState(this.room, Date.now()) });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch { /* 끊긴 소켓 */ }
    }
  }

  async alarm() {
    if (!this.room) return;
    tick(this.room, Date.now());
    await this.commit();
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw === 'ping') return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { id, ev, payload = {} } = msg;
    const reply = res => id != null && ws.send(JSON.stringify({ id, res }));
    const room = this.room;
    const now = Date.now();
    const att = ws.deserializeAttachment() || { role: 'viewer', directorId: null };

    // 만료된 타이머가 있으면 먼저 처리 (알람보다 요청이 먼저 도착한 경우)
    const ticked = tick(room, now);

    if (ev === 'join') {
      let director = null;
      if (payload.key && payload.key === room.observerKey) att.role = 'observer';
      else if (payload.token) {
        director = room.directors.find(d => d.token === payload.token) || null;
        if (director) { att.role = 'director'; att.directorId = director.id; director.connected = true; }
      }
      ws.serializeAttachment(att);
      reply({ ok: true, role: att.role, directorId: att.directorId, state: publicState(room, now) });
      if (director || ticked) await this.commit();
      return;
    }

    if (ev === 'director:register') {
      if (att.role === 'director') return reply({ ok: false, error: '이미 등록되었습니다.' });
      const r = registerDirector(room, now, payload);
      if (r.error) { if (ticked) await this.commit(); return reply({ ok: false, error: r.error }); }
      att.role = 'director'; att.directorId = r.director.id;
      ws.serializeAttachment(att);
      await this.commit();
      return reply({ ok: true, token: r.director.token, directorId: r.director.id });
    }

    const err = handleAction(room, now, att, ev, payload);
    if (!err || ticked) await this.commit();
    reply(err ? { ok: false, error: err } : { ok: true });
  }

  async webSocketClose(ws) { await this.onLeave(ws); }
  async webSocketError(ws) { await this.onLeave(ws); }

  async onLeave(ws) {
    const att = ws.deserializeAttachment();
    if (!this.room || att?.role !== 'director') return;
    const stillHere = this.ctx.getWebSockets().some(o => o !== ws && o.readyState === WebSocket.OPEN && o.deserializeAttachment()?.directorId === att.directorId);
    const d = this.room.directors.find(x => x.id === att.directorId);
    if (d && !stillHere && d.connected) { d.connected = false; await this.commit(); }
  }
}

// ── 이미지 저장소 ─────────────────────────────────────────
export class ImageStore extends DurableObject {
  async put(id, bytes, type) {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS img (id TEXT PRIMARY KEY, type TEXT, bytes BLOB)');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO img VALUES (?, ?, ?)', id, type, bytes.buffer);
  }
  async get(id) {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS img (id TEXT PRIMARY KEY, type TEXT, bytes BLOB)');
    const row = this.ctx.storage.sql.exec('SELECT type, bytes FROM img WHERE id = ?', id).toArray()[0];
    return row ? { type: row.type, bytes: new Uint8Array(row.bytes) } : null;
  }
}

