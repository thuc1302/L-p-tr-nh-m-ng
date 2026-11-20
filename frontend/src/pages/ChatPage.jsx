import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, newId } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import Avatar from '../components/Avatar.jsx';
import ProfileView from '../components/ProfileView.jsx';
import PeerProfileModal from '../components/PeerProfileModal.jsx';
import NavRail, { FILTERS } from '../components/NavRail.jsx';
import SettingsModal from '../components/SettingsModal.jsx';
import CallOverlay from '../call/CallOverlay.jsx';
import { useCall } from '../call/useCall.js';
import { ImageIcon, PhoneIcon, VideoIcon } from '../components/Icons.jsx';
import ReportModal from '../components/ReportModal.jsx';
import { callLabel, dateLabel, lastSeen, shortTime, timeOf } from '../format.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Gop tin tu API, socket va tin dang gui; clientMessageId la khoa chong trung.
function mergeMessages(current, incoming) {
  const map = new Map(current.map((m) => [m.clientMessageId, m]));
  for (const m of incoming) map.set(m.clientMessageId, m);
  return [...map.values()].sort((a, b) => (a.id ?? Infinity) - (b.id ?? Infinity));
}

const preview = (c, meId) => {
  const m = c.lastMessage;
  if (!m) return 'Chưa có tin nhắn';
  const mine = m.senderId === meId;
  if (m.type === 'call' && m.call) return callLabel(m.call, mine);
  const text = m.deleted ? 'Tin nhắn đã thu hồi' : m.type === 'image' ? m.content || 'Đã gửi một ảnh' : m.content;
  return mine ? `Bạn: ${text}` : text;
};

export default function ChatPage() {
  const { user, logout, setUser, setNotice } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [threads, setThreads] = useState({});
  const [connected, setConnected] = useState(true);
  const [typing, setTyping] = useState({});
  const [search, setSearch] = useState('');
  const [results, setResults] = useState(null);
  const [peerProfile, setPeerProfile] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState('chats');
  const [filter, setFilter] = useState('all');
  const [filterText, setFilterText] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('chatly-rail') === 'collapsed';
    } catch {
      return false;
    }
  });
  const [report, setReport] = useState(null);
  const socketRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const calls = useCall(socket);
  const activeRef = useRef(null);
  activeRef.current = activeId;

  const active = useMemo(() => conversations.find((c) => c.id === activeId), [conversations, activeId]);
  const visible = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter === 'unread' && !c.unread) return false;
      if (filter === 'online' && !c.peer.online) return false;
      return !q || c.peer.displayName.toLowerCase().includes(q) || c.peer.username.toLowerCase().includes(q);
    });
  }, [conversations, filter, filterText]);

  function toggleRail() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('chatly-rail', next ? 'collapsed' : 'open');
    } catch {
      // Khong luu duoc thi chi doi trong phien hien tai.
    }
  }
  const thread = threads[activeId] ?? { messages: [], loading: true, hasMore: false };

  const loadConversations = useCallback(async () => {
    try {
      const d = await api('/conversations');
      setConversations(d.conversations);
      setListError('');
    } catch (err) {
      setListError(err.message);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadThread = useCallback(async (id) => {
    try {
      const d = await api(`/conversations/${id}/messages`);
      setThreads((t) => {
        const old = t[id];
        return {
          ...t,
          [id]: {
            messages: mergeMessages(old?.messages ?? [], d.messages),
            hasMore: old?.messages?.length ? old.hasMore : d.hasMore,
            loading: false,
            error: '',
          },
        };
      });
    } catch (err) {
      setThreads((t) => ({ ...t, [id]: { messages: t[id]?.messages ?? [], hasMore: false, loading: false, error: err.message } }));
    }
  }, []);

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    setSocket(socket);
    const typingTimers = {};

    socket.on('connect', () => {
      setConnected(true);
      // Sau khi mat ket noi, tai lai de lay cac tin da lo.
      loadConversations();
      if (activeRef.current) loadThread(activeRef.current);
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      setConnected(false);
      if (err.message === 'unauthorized') setUser(null);
    });

    socket.on('message:new', (m) => {
      setThreads((t) => (t[m.conversationId]
        ? { ...t, [m.conversationId]: { ...t[m.conversationId], messages: mergeMessages(t[m.conversationId].messages, [m]) } }
        : t));
      setTyping((t) => ({ ...t, [m.conversationId]: false }));
      setConversations((list) => {
        const found = list.find((c) => c.id === m.conversationId);
        if (!found) {
          loadConversations();
          return list;
        }
        const isUnread = m.senderId !== user.id && (m.conversationId !== activeRef.current || document.hidden);
        const updated = { ...found, lastMessage: m, lastMessageAt: m.createdAt, unread: found.unread + (isUnread ? 1 : 0) };
        return [updated, ...list.filter((c) => c.id !== m.conversationId)];
      });
    });

    socket.on('message:status', (s) => {
      setConversations((list) => list.map((c) => (c.id === s.conversationId
        ? { ...c, peerDeliveredId: s.lastDeliveredMessageId, peerReadId: s.lastReadMessageId }
        : c)));
    });

    socket.on('conversation:read', ({ conversationId }) => {
      setConversations((list) => list.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)));
    });

    socket.on('message:deleted', ({ conversationId, messageId }) => {
      setThreads((t) => (t[conversationId]
        ? { ...t, [conversationId]: { ...t[conversationId], messages: t[conversationId].messages.map((m) => (m.id === messageId ? { ...m, content: null, deleted: true } : m)) } }
        : t));
      setConversations((list) => list.map((c) => (c.id === conversationId && c.lastMessage?.id === messageId
        ? { ...c, lastMessage: { ...c.lastMessage, content: null, deleted: true } }
        : c)));
    });

    socket.on('presence', ({ userId, online, lastSeenAt }) => {
      setConversations((list) => list.map((c) => (c.peer.id === userId
        ? { ...c, peer: { ...c.peer, online, lastSeenAt } }
        : c)));
    });

    socket.on('typing', ({ conversationId }) => {
      setTyping((t) => ({ ...t, [conversationId]: true }));
      clearTimeout(typingTimers[conversationId]);
      typingTimers[conversationId] = setTimeout(() => setTyping((t) => ({ ...t, [conversationId]: false })), 3000);
    });

    socket.on('user:updated', (u) => {
      if (u.id === user.id) {
        setUser((prev) => prev && { ...prev, username: u.username, displayName: u.displayName, bio: u.bio });
        return;
      }
      setConversations((list) => list.map((c) => (c.peer.id === u.id
        ? { ...c, peer: { ...c.peer, username: u.username, displayName: u.displayName, bio: u.bio } }
        : c)));
    });

    socket.on('account:locked', ({ reason }) => {
      setNotice(`Tài khoản đã bị khóa: ${reason}`);
      setUser(null);
    });

    return () => {
      Object.values(typingTimers).forEach(clearTimeout);
      socket.disconnect();
    };
  }, [user.id, loadConversations, loadThread, setUser, setNotice]);

  useEffect(() => {
    if (activeId && !threads[activeId]) loadThread(activeId);
  }, [activeId, threads, loadThread]);

  // Danh dau da doc khi dang mo hoi thoai co tin moi tu nguoi kia.
  const latestPeerId = useMemo(
    () => [...thread.messages].reverse().find((m) => m.id && m.senderId !== user.id)?.id,
    [thread.messages, user.id],
  );
  useEffect(() => {
    if (!activeId || !latestPeerId) return undefined;
    const markRead = () => {
      if (!document.hidden) api(`/conversations/${activeId}/read`, { method: 'POST', body: { messageId: latestPeerId } }).catch(() => {});
    };
    markRead();
    document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [activeId, latestPeerId]);

  useEffect(() => {
    if (view !== 'people') return undefined;
    const q = search.trim();
    const timer = setTimeout(() => {
      api(`/users/search?q=${encodeURIComponent(q)}`)
        .then((d) => setResults(d.users))
        .catch(() => setResults([]));
    }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [view, search]);

  async function openWith(peer) {
    try {
      const { conversation } = await api('/conversations', { method: 'POST', body: { userId: peer.id } });
      setConversations((list) => (list.some((c) => c.id === conversation.id) ? list : [conversation, ...list]));
      setActiveId(conversation.id);
      setView('chats');
      setFilter('all');
      setSearch('');
      setResults(null);
    } catch (err) {
      setListError(err.message);
    }
  }

  const deliver = useCallback(async (conversationId, draft) => {
    try {
      let message;
      if (draft.file) {
        const form = new FormData();
        form.append('clientMessageId', draft.clientMessageId);
        form.append('image', draft.file);
        ({ message } = await api(`/conversations/${conversationId}/images`, { method: 'POST', body: form }));
      } else {
        ({ message } = await api(`/conversations/${conversationId}/messages`, {
          method: 'POST',
          body: { clientMessageId: draft.clientMessageId, content: draft.content },
        }));
      }
      setThreads((t) => ({ ...t, [conversationId]: { ...t[conversationId], messages: mergeMessages(t[conversationId].messages, [message]) } }));
    } catch (err) {
      setThreads((t) => ({
        ...t,
        [conversationId]: { ...t[conversationId], messages: mergeMessages(t[conversationId].messages, [{ ...draft, pending: false, failed: err.message }]) },
      }));
    }
  }, []);

  function send(content) {
    const draft = { clientMessageId: newId(), type: 'text', content, senderId: user.id, createdAt: new Date().toISOString(), pending: true };
    setThreads((t) => ({ ...t, [activeId]: { ...t[activeId], messages: mergeMessages(t[activeId].messages, [draft]) } }));
    deliver(activeId, draft);
  }

  // Hien anh ngay tu may nguoi gui trong luc tai len.
  function sendImage(file) {
    const draft = {
      clientMessageId: newId(), type: 'image', content: '', file, localUrl: URL.createObjectURL(file),
      senderId: user.id, createdAt: new Date().toISOString(), pending: true,
    };
    setThreads((t) => ({ ...t, [activeId]: { ...t[activeId], messages: mergeMessages(t[activeId].messages, [draft]) } }));
    deliver(activeId, draft);
  }

  function retry(draft) {
    const next = { ...draft, pending: true, failed: undefined };
    setThreads((t) => ({ ...t, [activeId]: { ...t[activeId], messages: mergeMessages(t[activeId].messages, [next]) } }));
    deliver(activeId, next);
  }

  async function loadOlder() {
    const first = thread.messages.find((m) => m.id);
    if (!first) return;
    const d = await api(`/conversations/${activeId}/messages?before=${first.id}`);
    setThreads((t) => ({ ...t, [activeId]: { ...t[activeId], messages: mergeMessages(t[activeId].messages, d.messages), hasMore: d.hasMore } }));
  }

  async function hideConversation() {
    if (!window.confirm('Ẩn hội thoại này khỏi danh sách? Hội thoại sẽ hiện lại khi có tin nhắn mới.')) return;
    await api(`/conversations/${activeId}`, { method: 'DELETE' });
    setConversations((list) => list.filter((c) => c.id !== activeId));
    setActiveId(null);
  }

  const recall = (m) => api(`/conversations/${activeId}/messages/${m.id}`, { method: 'DELETE' }).catch((err) => window.alert(err.message));
  const counts = {
    all: conversations.length,
    unread: conversations.filter((c) => c.unread > 0).length,
    online: conversations.filter((c) => c.peer.online).length,
  };
  const filterName = Object.fromEntries(FILTERS)[filter];

  return (
    <div className={`chat ${activeId && view !== 'profile' ? 'has-active' : ''} ${collapsed ? 'rail-collapsed' : ''}`}>
      <NavRail
        user={user}
        connected={connected}
        collapsed={collapsed}
        onToggle={toggleRail}
        view={view}
        onView={setView}
        filter={filter}
        onFilter={(f) => {
          setFilter(f);
          setView('chats');
        }}
        counts={counts}
        onProfile={() => setView('profile')}
        onSettings={() => setShowSettings(true)}
        onLogout={logout}
      />

      {view === 'profile' ? <ProfileView onBack={() => setView('chats')} /> : (
      <>
      <aside className="sidebar">
        <header className="panel-head">
          <h2>{view === 'chats' ? 'Tin nhắn' : 'Tìm người'}</h2>
          {view === 'chats' && <small className="muted">{filterName}</small>}
        </header>
        {view === 'chats' ? (
          <>
            <div className="search-row">
              <input type="search" placeholder="Lọc theo tên…" aria-label="Lọc hội thoại theo tên" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
            </div>
            <div className="chips" role="group" aria-label="Lọc hội thoại">
              {FILTERS.map(([id, label]) => (
                <button key={id} className={`chip ${filter === id ? 'active' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
            {listError && <p className="alert slim">{listError}</p>}
            <ul className="list">
              {loadingList && <li className="empty">Đang tải hội thoại…</li>}
              {!loadingList && conversations.length === 0 && (
                <li className="empty">
                  Chưa có cuộc trò chuyện nào.<br />
                  <button className="link" onClick={() => setView('people')}>Tìm người để nhắn tin</button>
                </li>
              )}
              {!loadingList && conversations.length > 0 && visible.length === 0 && <li className="empty">Không có hội thoại phù hợp</li>}
              {visible.map((c) => (
                <li key={c.id}>
                  <button className={`row ${c.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(c.id)}>
                    <Avatar name={c.peer.displayName} online={c.peer.online} />
                    <span className="row-main">
                      <span className="row-top"><b>{c.peer.displayName}</b><time>{shortTime(c.lastMessage?.createdAt)}</time></span>
                      <span className="row-bottom">
                        <small className={c.unread ? 'strong' : ''}>{typing[c.id] ? 'Đang soạn tin…' : preview(c, user.id)}</small>
                        {c.unread > 0 && <em className="badge">{c.unread > 99 ? '99+' : c.unread}</em>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="search-row">
              <input type="search" autoFocus placeholder="Tên hoặc tên đăng nhập…" aria-label="Tìm người dùng" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {listError && <p className="alert slim">{listError}</p>}
            <ul className="list">
              {results === null && <li className="empty">Đang tìm…</li>}
              {results?.length === 0 && <li className="empty">Không tìm thấy người dùng</li>}
              {results?.map((u) => (
                <li key={u.id}>
                  <button className="row" onClick={() => openWith(u)}>
                    <Avatar name={u.displayName} online={u.online} />
                    <span className="row-main">
                      <span className="row-top"><b>{u.displayName}</b></span>
                      <small>@{u.username}{u.bio ? ` · ${u.bio}` : ''}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <main className="pane">
        {!connected && <div className="banner">Mất kết nối, đang thử kết nối lại…</div>}
        {active ? (
          <Thread
            key={active.id}
            conversation={active}
            thread={thread}
            meId={user.id}
            isTyping={typing[active.id]}
            onBack={() => setActiveId(null)}
            onShowPeer={() => setPeerProfile(active.peer.id)}
            onSend={send}
            onSendImage={sendImage}
            onCall={(type) => calls.startCall(active, type)}
            callBusy={!connected || Boolean(calls.call && calls.call.phase !== 'ended')}
            onRetry={retry}
            onRecall={recall}
            onReport={(message) => setReport({ conversation: active, message })}
            onHide={hideConversation}
            onLoadOlder={loadOlder}
            onReload={() => loadThread(active.id)}
            onTyping={() => socketRef.current?.emit('typing', { conversationId: active.id })}
          />
        ) : (
          <div className="pane-empty">
            <h2>Chọn một cuộc trò chuyện</h2>
            <p>Hoặc vào mục <b>Tìm người</b> để bắt đầu nhắn tin.</p>
          </div>
        )}
      </main>
      </>
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {peerProfile && <PeerProfileModal userId={peerProfile} onClose={() => setPeerProfile(null)} />}
      {report && <ReportModal {...report} onClose={() => setReport(null)} />}
      {calls.call && <CallOverlay state={calls} />}
    </div>
  );
}

function statusOf(m, c) {
  if (m.id <= c.peerReadId) return 'Đã xem';
  if (m.id <= c.peerDeliveredId) return 'Đã nhận';
  return 'Đã gửi';
}

function Thread({ conversation: c, thread, meId, isTyping, onBack, onShowPeer, onSend, onSendImage, onCall, callBusy, onRetry, onRecall, onReport, onHide, onLoadOlder, onReload, onTyping }) {
  const [text, setText] = useState('');
  const scroller = useRef(null);
  const lastTyping = useRef(0);
  const keepPosition = useRef(null);
  const fileRef = useRef(null);
  const [fileError, setFileError] = useState('');

  // Anh tai xong lam noi dung cao them; giu khung chat o cuoi neu dang o gan cuoi.
  const stickToBottom = () => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 500) el.scrollTop = el.scrollHeight;
  };

  function pickFiles(files) {
    setFileError('');
    for (const file of [...files].slice(0, 5)) {
      if (!IMAGE_TYPES.includes(file.type)) setFileError('Chỉ hỗ trợ ảnh JPG, PNG, GIF hoặc WEBP');
      else if (file.size > MAX_IMAGE_BYTES) setFileError('Ảnh tối đa 10 MB');
      else onSendImage(file);
    }
  }
  const lastKey = thread.messages.at(-1)?.clientMessageId;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastKey, isTyping]);

  useEffect(() => {
    const el = scroller.current;
    if (el && keepPosition.current !== null) {
      el.scrollTop = el.scrollHeight - keepPosition.current;
      keepPosition.current = null;
    }
  }, [thread.messages.length]);

  function submit(e) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    onSend(content);
    setText('');
  }

  function older() {
    keepPosition.current = scroller.current.scrollHeight - scroller.current.scrollTop;
    onLoadOlder();
  }

  const lastOwn = [...thread.messages].reverse().find((m) => m.id && m.senderId === meId);
  let prevDay = '';

  return (
    <>
      <header className="thread-head">
        <button className="icon-btn back" onClick={onBack} aria-label="Quay lại">←</button>
        <button className="peer-btn" onClick={onShowPeer} title="Xem thông tin">
          <Avatar name={c.peer.displayName} online={c.peer.online} />
          <span className="thread-title">
            <b>{c.peer.displayName}</b>
            <small>{c.peer.locked ? 'Tài khoản đã bị khóa' : c.peer.online ? 'Đang trực tuyến' : lastSeen(c.peer.lastSeenAt)}</small>
          </span>
        </button>
        <button className="icon-btn tool" onClick={() => onCall('audio')} disabled={callBusy || c.peer.locked} title="Gọi thoại" aria-label="Gọi thoại"><PhoneIcon /></button>
        <button className="icon-btn tool" onClick={() => onCall('video')} disabled={callBusy || c.peer.locked} title="Gọi video" aria-label="Gọi video"><VideoIcon /></button>
        <button className="btn small" onClick={() => onReport(null)}>Báo cáo</button>
        <button className="btn small" onClick={onHide}>Ẩn</button>
      </header>
      <div className="messages" ref={scroller}>
        {thread.loading && <p className="empty">Đang tải tin nhắn…</p>}
        {thread.error && <p className="empty">{thread.error} <button className="link" onClick={onReload}>Thử lại</button></p>}
        {thread.hasMore && <button className="btn small older" onClick={older}>Xem tin nhắn cũ hơn</button>}
        {!thread.loading && !thread.error && thread.messages.length === 0 && <p className="empty">Hãy gửi lời chào đầu tiên!</p>}
        {thread.messages.map((m) => {
          const mine = m.senderId === meId;
          const day = dateLabel(m.createdAt);
          const showDay = day !== prevDay;
          prevDay = day;
          return (
            <div key={m.clientMessageId}>
              {showDay && <div className="day"><span>{day}</span></div>}
              <div className={`msg ${mine ? 'mine' : ''}`}>
                <MessageBody m={m} mine={mine} onCall={onCall} callBusy={callBusy} onImageLoad={stickToBottom} />
                {m.id && !m.deleted && m.type !== 'call' && (
                  <span className="msg-actions">
                    {mine
                      ? <button className="link" onClick={() => onRecall(m)}>Thu hồi</button>
                      : <button className="link" onClick={() => onReport(m)}>Báo cáo</button>}
                  </span>
                )}
                <small className="meta">
                  {timeOf(m.createdAt)}
                  {m.pending && ' · Đang gửi…'}
                  {m.failed && <> · <span className="fail">Gửi thất bại</span> <button className="link" onClick={() => onRetry(m)}>Gửi lại</button></>}
                  {m.id === lastOwn?.id && ` · ${statusOf(m, c)}`}
                </small>
              </div>
            </div>
          );
        })}
        {isTyping && <p className="typing">{c.peer.displayName} đang soạn tin…</p>}
      </div>
      {fileError && <p className="alert slim">{fileError}</p>}
      <form className="composer" onSubmit={submit}>
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          multiple
          hidden
          onChange={(e) => {
            pickFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button type="button" className="icon-btn tool" onClick={() => fileRef.current.click()} disabled={c.peer.locked} title="Gửi ảnh" aria-label="Gửi ảnh">
          <ImageIcon />
        </button>
        <textarea
          onPaste={(e) => {
            const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
            if (images.length) {
              e.preventDefault();
              pickFiles(images);
            }
          }}
          rows={1}
          value={text}
          maxLength={4000}
          disabled={c.peer.locked}
          placeholder={c.peer.locked ? 'Không thể gửi tin cho tài khoản đã bị khóa' : 'Nhập tin nhắn…'}
          onChange={(e) => {
            setText(e.target.value);
            if (Date.now() - lastTyping.current > 2000) {
              lastTyping.current = Date.now();
              onTyping();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
        />
        <button className="btn primary" disabled={!text.trim() || c.peer.locked}>Gửi</button>
      </form>
    </>
  );
}

function MessageBody({ m, mine, onCall, callBusy, onImageLoad }) {
  const state = `${m.failed ? 'failed' : ''}`;
  if (m.deleted) return <div className="bubble deleted">Tin nhắn đã thu hồi</div>;
  if (m.type === 'call' && m.call) {
    return (
      <div className="bubble call-bubble">
        {m.call.type === 'video' ? <VideoIcon /> : <PhoneIcon />}
        <span>{callLabel(m.call, mine)}</span>
        <button className="link" disabled={callBusy} onClick={() => onCall(m.call.type)}>Gọi lại</button>
      </div>
    );
  }
  if (m.type === 'image') {
    const src = m.image?.url ?? m.localUrl;
    return (
      <>
        <a className={`msg-img ${state}`} href={m.image?.url} target="_blank" rel="noreferrer" onClick={(e) => !m.image && e.preventDefault()}>
          <img src={src} alt="Ảnh đã gửi" onLoad={onImageLoad} />
        </a>
        {m.content && <div className="bubble">{m.content}</div>}
      </>
    );
  }
  return <div className={`bubble ${state}`}>{m.content}</div>;
}
