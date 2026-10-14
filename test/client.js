// 테스트용 WebSocket 클라이언트 (브라우저 connect() 와 같은 프로토콜)
export const BASE = process.env.BASE || `http://localhost:${process.env.PORT || 8787}`;

export function client(code) {
  return new Promise(resolve => {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/${code}`);
    const pending = new Map();
    const handlers = {};
    let seq = 0;
    const c = {
      on: (ev, fn) => (handlers[ev] = fn),
      call: (ev, payload) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, ev, payload })); }),
      close: () => ws.close(),
      closed: false,
    };
    ws.onclose = () => { c.closed = true; };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id != null) { pending.get(m.id)?.(m.res); pending.delete(m.id); } else handlers[m.ev]?.(m.data);
    };
    ws.onopen = () => resolve(c);
  });
}

export async function createRoom(body) {
  return fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
}
