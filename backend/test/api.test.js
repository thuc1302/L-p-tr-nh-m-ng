// Kiem thu tich hop tren he thong dang chay: docker compose up -d && npm test
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const ADMIN = { identifier: process.env.ADMIN_EMAIL ?? 'admin@chatly.local', password: process.env.ADMIN_PASSWORD ?? 'Admin@123456' };
const run = randomUUID().slice(0, 8);
const sockets = [];

class Client {
  cookie = '';
  async req(method, path, body) {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: this.cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  async upload(path, form) {
    const res = await fetch(`${BASE}/api${path}`, { method: 'POST', headers: { Cookie: this.cookie }, body: form });
    return { status: res.status, body: await res.json() };
  }
  async raw(path) {
    return fetch(`${BASE}${path}`, { headers: { Cookie: this.cookie } });
  }
  socket() {
    const s = io(BASE, { transports: ['websocket'], extraHeaders: { Cookie: this.cookie }, reconnection: false });
    sockets.push(s);
    return new Promise((resolve, reject) => {
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  }
}

const once = (s, event, ms = 3000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Het gio cho ${event}`)), ms);
    s.once(event, (p) => { clearTimeout(t); resolve(p); });
  });

async function newUser(name) {
  const c = new Client();
  const username = `${name}_${run}`;
  const { status, body } = await c.req('POST', '/auth/register', {
    email: `${username}@test.local`, username, displayName: `Test ${name}`, password: 'Matkhau@123',
  });
  assert.equal(status, 201);
  c.user = body.user;
  return c;
}

const send = (c, convId, content, clientMessageId = randomUUID()) =>
  c.req('POST', `/conversations/${convId}/messages`, { clientMessageId, content });

let a, b, stranger, admin, conv;

before(async () => {
  a = await newUser('a');
  b = await newUser('b');
  stranger = await newUser('x');
  admin = new Client();
  assert.equal((await admin.req('POST', '/auth/login', ADMIN)).status, 200);
  conv = (await a.req('POST', '/conversations', { userId: b.user.id })).body.conversation;
});
after(() => sockets.forEach((s) => s.disconnect()));

test('dang ky: tu choi trung email/username va du lieu sai', async () => {
  const c = new Client();
  const dup = await c.req('POST', '/auth/register', { email: a.user.email, username: `z_${run}`, displayName: 'Z', password: 'Matkhau@123' });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /Email/);
  assert.equal((await c.req('POST', '/auth/register', { email: 'sai', username: 'ab', displayName: '', password: '1' })).status, 400);
});

test('dang nhap, dang xuat va phien bi thu hoi', async () => {
  const c = new Client();
  assert.equal((await c.req('POST', '/auth/login', { identifier: a.user.username, password: 'sai-mat-khau' })).status, 401);
  assert.equal((await c.req('POST', '/auth/login', { identifier: a.user.email, password: 'Matkhau@123' })).status, 200);
  const old = c.cookie;
  assert.equal((await c.req('GET', '/auth/me')).status, 200);
  await c.req('POST', '/auth/logout');
  c.cookie = old;
  assert.equal((await c.req('GET', '/auth/me')).status, 401);
});

test('cap nhat ho so va khong lo mat khau', async () => {
  const r = await a.req('PATCH', '/users/me', { displayName: 'Tên mới', bio: 'Xin chào' });
  assert.equal(r.body.user.displayName, 'Tên mới');
  assert.equal(r.body.user.password_hash, undefined);
});

test('tim kiem: tim thay nguoi dung, khong tra email, khong tra admin', async () => {
  const r = await a.req('GET', `/users/search?q=${b.user.username}`);
  assert.equal(r.body.users.length, 1);
  assert.equal(r.body.users[0].email, undefined);
  assert.equal((await a.req('GET', '/users/search?q=admin')).body.users.length, 0);
  assert.equal((await a.req('GET', '/users/search?q=%25')).body.users.length, 0);
});

test('hoi thoai: moi cap chi co mot, khong tu nhan voi minh', async () => {
  const again = await b.req('POST', '/conversations', { userId: a.user.id });
  assert.equal(again.body.conversation.id, conv.id);
  assert.equal((await a.req('POST', '/conversations', { userId: a.user.id })).status, 400);
});

test('tin nhan rong hoac qua dai bi tu choi', async () => {
  assert.equal((await send(a, conv.id, '   ')).status, 400);
  assert.equal((await send(a, conv.id, 'x'.repeat(4001))).status, 400);
});

test('nguoi ngoai khong doc hay gui duoc vao hoi thoai', async () => {
  assert.equal((await stranger.req('GET', `/conversations/${conv.id}/messages`)).status, 404);
  assert.equal((await send(stranger, conv.id, 'xam nhap')).status, 404);
  assert.equal((await new Client().req('GET', '/conversations')).status, 401);
});

test('thoi gian thuc: nhan tin, trang thai da nhan va da xem', async () => {
  const sb = await b.socket();
  const sa = await a.socket();
  const incoming = once(sb, 'message:new');
  const delivered = once(sa, 'message:status');
  const { status, body } = await send(a, conv.id, 'Xin chào realtime');
  assert.equal(status, 201);
  assert.equal((await incoming).content, 'Xin chào realtime');
  assert.equal((await delivered).lastDeliveredMessageId, body.message.id);

  const read = once(sa, 'message:status');
  await b.req('POST', `/conversations/${conv.id}/read`, { messageId: body.message.id });
  assert.equal((await read).lastReadMessageId, body.message.id);
  sa.disconnect();
  sb.disconnect();
});

test('gui lai cung clientMessageId khong tao tin trung', async () => {
  const id = randomUUID();
  const first = await send(a, conv.id, 'Mot lan thoi', id);
  const second = await send(a, conv.id, 'Mot lan thoi', id);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(first.body.message.id, second.body.message.id);
});

test('gui lien tiep giu dung thu tu, phan trang lich su', async () => {
  for (let i = 0; i < 35; i += 1) assert.equal((await send(a, conv.id, `tin ${i}`)).status, 201);
  const page1 = (await b.req('GET', `/conversations/${conv.id}/messages?limit=30`)).body;
  assert.equal(page1.hasMore, true);
  assert.equal(page1.messages.at(-1).content, 'tin 34');
  const ids = page1.messages.map((m) => m.id);
  assert.deepEqual(ids, [...ids].sort((x, y) => x - y));
  const page2 = (await b.req('GET', `/conversations/${conv.id}/messages?limit=30&before=${ids[0]}`)).body;
  assert.ok(page2.messages.at(-1).id < ids[0]);
});

test('nguoi nhan ngoai tuyen: tin duoc luu, dem chua doc, da nhan khi online lai', async () => {
  const before_ = (await b.req('GET', '/conversations')).body.conversations[0];
  assert.ok(before_.unread > 0);
  const { body } = await send(a, conv.id, 'Khi ban offline');
  const mine = (await a.req('GET', '/conversations')).body.conversations[0];
  assert.ok(mine.peerDeliveredId < body.message.id);
  const sa = await a.socket();
  const status = once(sa, 'message:status');
  await b.socket();
  assert.equal((await status).lastDeliveredMessageId, body.message.id);
  sa.disconnect();
});

test('thu hoi chi voi tin cua minh', async () => {
  const { body } = await send(a, conv.id, 'Se thu hoi');
  const path = `/conversations/${conv.id}/messages/${body.message.id}`;
  assert.equal((await b.req('DELETE', path)).status, 404);
  assert.equal((await a.req('DELETE', path)).status, 204);
  const list = (await b.req('GET', `/conversations/${conv.id}/messages?limit=1`)).body.messages;
  assert.equal(list[0].content, null);
  assert.equal(list[0].deleted, true);
});

test('an hoi thoai, tu hien lai khi co tin moi', async () => {
  await b.req('DELETE', `/conversations/${conv.id}`);
  assert.ok(!(await b.req('GET', '/conversations')).body.conversations.some((c) => c.id === conv.id));
  await send(a, conv.id, 'Hien lai nhe');
  assert.ok((await b.req('GET', '/conversations')).body.conversations.some((c) => c.id === conv.id));
});

test('nguoi dung thuong khong vao duoc API quan tri', async () => {
  assert.equal((await a.req('GET', '/admin/stats')).status, 403);
  assert.equal((await new Client().req('GET', '/admin/stats')).status, 401);
});

test('admin: thong ke va tim nguoi dung', async () => {
  const stats = (await admin.req('GET', '/admin/stats')).body;
  assert.ok(stats.users >= 3 && stats.messages > 0);
  assert.equal((await admin.req('GET', '/admin/stats/activity?days=14')).body.activity.length, 14);
  const r = await admin.req('GET', `/admin/users?q=${a.user.username}&status=active`);
  assert.equal(r.body.total, 1);
  assert.equal(r.body.users[0].messageCount > 0, true);
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const imageForm = (bytes, clientMessageId = randomUUID(), type = 'image/png') => {
  const form = new FormData();
  form.append('clientMessageId', clientMessageId);
  form.append('image', new Blob([bytes], { type }), 'anh.png');
  return form;
};

test('gui anh: chi thanh vien xem duoc, chan file gia, thu hoi thi mat anh', async () => {
  const clientId = randomUUID();
  const sent = await a.upload(`/conversations/${conv.id}/images`, imageForm(PNG, clientId));
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.type, 'image');
  const url = sent.body.message.image.url;

  const again = await a.upload(`/conversations/${conv.id}/images`, imageForm(PNG, clientId));
  assert.equal(again.status, 200);
  assert.equal(again.body.message.id, sent.body.message.id);

  const ok = await b.raw(url);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), PNG);
  assert.equal((await stranger.raw(url)).status, 404);
  assert.equal((await new Client().raw(url)).status, 401);

  const fake = await a.upload(`/conversations/${conv.id}/images`, imageForm(Buffer.from('<svg onload=alert(1)>xxxxxxxx'), randomUUID(), 'image/png'));
  assert.equal(fake.status, 400);
  const big = await a.upload(`/conversations/${conv.id}/images`, imageForm(Buffer.alloc(11 * 1024 * 1024), randomUUID()));
  assert.ok([400, 413].includes(big.status));

  const list = (await b.req('GET', '/conversations')).body.conversations.find((c) => c.id === conv.id);
  assert.equal(list.lastMessage.type, 'image');

  await a.req('DELETE', `/conversations/${conv.id}/messages/${sent.body.message.id}`);
  assert.equal((await b.raw(url)).status, 404);
});

test('goi video: do chuong, nhan may, chuyen tin hieu, ket thuc va luu lich su', async () => {
  const sa = await a.socket();
  const sb = await b.socket();
  const incoming = once(sb, 'call:incoming');
  const start = await sa.emitWithAck('call:start', { conversationId: conv.id, type: 'video' });
  assert.ok(start.callId);
  const ring = await incoming;
  assert.equal(ring.type, 'video');
  assert.equal(ring.from.id, a.user.id);

  // Nguoi nhan dang ban thi nguoi thu ba khong goi duoc.
  const busy = await stranger.socket();
  const strangerConv = (await stranger.req('POST', '/conversations', { userId: b.user.id })).body.conversation;
  assert.match((await busy.emitWithAck('call:start', { conversationId: strangerConv.id, type: 'audio' })).error, /cuộc gọi khác/);
  busy.disconnect();

  const accepted = once(sa, 'call:accepted');
  assert.deepEqual(await sb.emitWithAck('call:accept', { callId: start.callId }), { ok: true });
  await accepted;

  const offer = once(sb, 'call:signal');
  sa.emit('call:signal', { callId: start.callId, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
  assert.equal((await offer).data.sdp.type, 'offer');
  const answer = once(sa, 'call:signal');
  sb.emit('call:signal', { callId: start.callId, data: { sdp: { type: 'answer', sdp: 'v=0' } } });
  assert.equal((await answer).data.sdp.type, 'answer');

  // Nguoi ngoai khong chen tin hieu vao cuoc goi.
  const outsider = await stranger.socket();
  outsider.emit('call:signal', { callId: start.callId, data: { candidate: 'x' } });

  const endedB = once(sb, 'call:ended');
  const record = once(sb, 'message:new');
  sa.emit('call:end', { callId: start.callId });
  assert.equal((await endedB).status, 'ended');
  const msg = await record;
  assert.equal(msg.type, 'call');
  assert.equal(msg.call.type, 'video');
  assert.equal(msg.call.status, 'ended');
  [sa, sb, outsider].forEach((s) => s.disconnect());
});

test('goi nguoi dang ngoai tuyen: bao loi va ghi cuoc goi nho', async () => {
  const offline = await newUser('off');
  const offConv = (await a.req('POST', '/conversations', { userId: offline.user.id })).body.conversation;
  const sa = await a.socket();
  const res = await sa.emitWithAck('call:start', { conversationId: offConv.id, type: 'audio' });
  assert.match(res.error, /không trực tuyến/);
  await new Promise((r) => setTimeout(r, 100));
  const msgs = (await offline.req('GET', `/conversations/${offConv.id}/messages?limit=1`)).body.messages;
  assert.equal(msgs[0].call.status, 'missed');
  assert.equal((await sa.emitWithAck('call:start', { conversationId: randomUUID(), type: 'audio' })).error, 'Không tìm thấy hội thoại');
  sa.disconnect();
});

test('bao cao -> admin xu ly -> khoa: mat phien ngay, mo khoa dang nhap lai duoc', async () => {
  const { body } = await send(a, conv.id, 'Noi dung vi pham');
  assert.equal((await b.req('POST', '/reports', { conversationId: conv.id, messageId: body.message.id, reason: 'spam' })).status, 201);
  assert.equal((await stranger.req('POST', '/reports', { conversationId: conv.id, reason: 'spam' })).status, 404);

  const open = (await admin.req('GET', '/admin/reports?status=open')).body.reports;
  const report = open.find((r) => r.reported.id === a.user.id);
  assert.equal(report.messageSnapshot, 'Noi dung vi pham');

  const sa = await a.socket();
  const locked = once(sa, 'account:locked');
  assert.equal((await admin.req('POST', `/admin/reports/${report.id}/resolve`, { status: 'resolved', note: 'Spam', lockUser: true })).status, 204);
  assert.equal((await locked).reason, 'Spam');
  assert.equal((await a.req('GET', '/auth/me')).status, 401);

  const again = new Client();
  const denied = await again.req('POST', '/auth/login', { identifier: a.user.email, password: 'Matkhau@123' });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'ACCOUNT_LOCKED');
  assert.equal((await send(b, conv.id, 'Con do khong?')).status, 403);
  assert.equal((await admin.req('POST', `/admin/reports/${report.id}/resolve`, { status: 'resolved' })).status, 404);

  assert.equal((await admin.req('POST', `/admin/users/${a.user.id}/unlock`)).status, 204);
  assert.equal((await again.req('POST', '/auth/login', { identifier: a.user.email, password: 'Matkhau@123' })).status, 200);
  const logs = (await admin.req('GET', '/admin/audit-logs')).body.logs;
  assert.ok(logs.some((l) => l.action === 'user.lock' && l.target === a.user.username));
});

test('socket khong co phien hoac sai origin bi tu choi', async () => {
  await assert.rejects(new Client().socket());
  const s = io(BASE, { transports: ['websocket'], extraHeaders: { Cookie: b.cookie, Origin: 'http://evil.example' }, reconnection: false });
  sockets.push(s);
  await assert.rejects(new Promise((resolve, reject) => { s.on('connect', resolve); s.on('connect_error', reject); }));
});

test('thong tin ca nhan: thong ke va ho so cong khai khong lo email', async () => {
  const me = (await b.req('GET', '/users/me')).body;
  assert.equal(me.user.id, b.user.id);
  assert.ok(me.stats.conversations >= 1);
  const pub = await stranger.req('GET', `/users/${b.user.id}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.user.username, b.user.username);
  assert.equal(pub.body.user.email, undefined);
  assert.equal((await stranger.req('GET', '/users/khong-phai-uuid')).status, 404);
});

test('doi ten dang nhap: trung/sai bi tu choi, nguoi dang chat thay ten moi ngay', async () => {
  const u = await newUser('ren');
  const peer = await newUser('rpeer');
  await u.req('POST', '/conversations', { userId: peer.user.id });
  await send(u, (await u.req('GET', '/conversations')).body.conversations[0].id, 'xin chao');

  assert.equal((await u.req('PATCH', '/users/me/username', { username: b.user.username })).status, 409);
  assert.equal((await u.req('PATCH', '/users/me/username', { username: 'co dau cach' })).status, 400);

  const sp = await peer.socket();
  const updated = once(sp, 'user:updated');
  const newName = `doiten_${run}`;
  const r = await u.req('PATCH', '/users/me/username', { username: newName });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.username, newName);
  assert.equal((await updated).username, newName);
  sp.disconnect();

  const c = new Client();
  assert.equal((await c.req('POST', '/auth/login', { identifier: newName, password: 'Matkhau@123' })).status, 200);
});

test('doi email: can dung mat khau, chong trung, dang xuat thiet bi khac', async () => {
  const u = await newUser('mail');
  const other = new Client();
  await other.req('POST', '/auth/login', { identifier: u.user.email, password: 'Matkhau@123' });
  const newEmail = `moi_${run}@gmail.com`;

  assert.equal((await u.req('PATCH', '/users/me/email', { email: newEmail, currentPassword: 'sai' })).status, 400);
  assert.equal((await u.req('PATCH', '/users/me/email', { email: a.user.email, currentPassword: 'Matkhau@123' })).status, 409);
  assert.equal((await u.req('PATCH', '/users/me/email', { email: 'khong-hop-le', currentPassword: 'Matkhau@123' })).status, 400);

  const r = await u.req('PATCH', '/users/me/email', { email: `  ${newEmail.toUpperCase()} `, currentPassword: 'Matkhau@123' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.email, newEmail);
  assert.equal((await u.req('GET', '/auth/me')).status, 200);
  assert.equal((await other.req('GET', '/auth/me')).status, 401);
  assert.equal((await new Client().req('POST', '/auth/login', { identifier: newEmail, password: 'Matkhau@123' })).status, 200);
});

test('doi mat khau: sai/trung mat khau cu bi tu choi, mat khau moi dung duoc', async () => {
  const u = await newUser('pass');
  const other = new Client();
  await other.req('POST', '/auth/login', { identifier: u.user.email, password: 'Matkhau@123' });
  const path = '/users/me/password';
  assert.equal((await u.req('POST', path, { currentPassword: 'sai', newPassword: 'Moi@123456' })).status, 400);
  assert.equal((await u.req('POST', path, { currentPassword: 'Matkhau@123', newPassword: 'Matkhau@123' })).status, 400);
  assert.equal((await u.req('POST', path, { currentPassword: 'Matkhau@123', newPassword: 'ngan' })).status, 400);
  assert.equal((await u.req('POST', path, { currentPassword: 'Matkhau@123', newPassword: 'Moi@123456' })).status, 204);
  assert.equal((await other.req('GET', '/auth/me')).status, 401);
  const c = new Client();
  assert.equal((await c.req('POST', '/auth/login', { identifier: u.user.email, password: 'Matkhau@123' })).status, 401);
  assert.equal((await c.req('POST', '/auth/login', { identifier: u.user.email, password: 'Moi@123456' })).status, 200);
});
