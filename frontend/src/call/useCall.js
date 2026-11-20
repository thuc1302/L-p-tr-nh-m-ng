import { useCallback, useEffect, useRef, useState } from 'react';

// STUN giup hai may sau NAT tim duong ket noi; cung mang LAN thi khong can.
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const END_TEXT = {
  ended: 'Cuộc gọi đã kết thúc',
  rejected: 'Cuộc gọi bị từ chối',
  missed: 'Không có người trả lời',
  busy: 'Người nhận đang bận',
  cancelled: 'Cuộc gọi đã kết thúc',
};

function mediaError(err) {
  if (!navigator.mediaDevices?.getUserMedia) return 'Trình duyệt chỉ cho phép gọi trên HTTPS hoặc localhost';
  if (err?.name === 'NotAllowedError') return 'Bạn chưa cấp quyền dùng micro/camera';
  if (err?.name === 'NotFoundError') return 'Không tìm thấy micro/camera';
  if (err?.name === 'NotReadableError') return 'Micro/camera đang được ứng dụng khác sử dụng';
  return 'Không mở được micro/camera';
}

const isLive = (call) => Boolean(call && call.phase !== 'ended');

export function useCall(socket) {
  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const callRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const pendingIce = useRef([]);
  const accepting = useRef(false);
  const closeTimer = useRef(null);

  const show = useCallback((value) => {
    clearTimeout(closeTimer.current);
    callRef.current = value;
    setCall(value);
  }, []);
  const patch = useCallback((changes) => {
    if (!callRef.current) return;
    show({ ...callRef.current, ...changes });
  }, [show]);

  const stopMedia = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    pendingIce.current = [];
    accepting.current = false;
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  // Co thong bao: giu man hinh 2 giay de nguoi dung doc, sau do dong.
  const finish = useCallback((message) => {
    stopMedia();
    if (message && callRef.current) {
      show({ ...callRef.current, phase: 'ended', message });
      closeTimer.current = setTimeout(() => show(null), 2000);
    } else {
      show(null);
    }
  }, [stopMedia, show]);

  const openMedia = useCallback(async (type) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(mediaError());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      streamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (err) {
      throw new Error(mediaError(err));
    }
  }, []);

  const createPeer = useCallback((callId) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    streamRef.current.getTracks().forEach((t) => pc.addTrack(t, streamRef.current));
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('call:signal', { callId, data: { candidate: e.candidate.toJSON() } });
    };
    pc.ontrack = (e) => setRemoteStream(e.streams[0] ?? new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      if (pc.connectionState === 'connected' && callRef.current?.phase !== 'connected') {
        patch({ phase: 'connected', connectedAt: Date.now() });
      }
      if (pc.connectionState === 'failed') {
        socket.emit('call:end', { callId });
        finish('Kết nối cuộc gọi thất bại');
      }
    };
    return pc;
  }, [socket, patch, finish]);

  const startCall = useCallback(async (conversation, type) => {
    if (!socket?.connected || isLive(callRef.current)) return;
    show({ id: null, peer: conversation.peer, type, direction: 'outgoing', phase: 'preparing', muted: false, cameraOff: false });
    let stream;
    try {
      stream = await openMedia(type);
    } catch (err) {
      finish(err.message);
      return;
    }
    if (callRef.current?.phase !== 'preparing') {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    patch({ phase: 'ringing' });
    const res = await socket.timeout(10000).emitWithAck('call:start', { conversationId: conversation.id, type })
      .catch(() => ({ error: 'Mất kết nối máy chủ' }));
    if (res.error) {
      if (isLive(callRef.current)) finish(res.error);
      return;
    }
    if (!isLive(callRef.current)) {
      socket.emit('call:end', { callId: res.callId });
      return;
    }
    patch({ id: res.callId });
  }, [socket, show, patch, openMedia, finish]);

  const acceptCall = useCallback(async () => {
    const current = callRef.current;
    if (current?.direction !== 'incoming' || current.phase !== 'ringing') return;
    accepting.current = true;
    patch({ phase: 'connecting' });
    let stream;
    try {
      stream = await openMedia(current.type);
    } catch (err) {
      socket.emit('call:reject', { callId: current.id });
      finish(err.message);
      return;
    }
    if (callRef.current?.id !== current.id || !isLive(callRef.current)) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    createPeer(current.id);
    const res = await socket.timeout(10000).emitWithAck('call:accept', { callId: current.id })
      .catch(() => ({ error: 'Mất kết nối máy chủ' }));
    if (res.error) finish(res.error);
  }, [socket, patch, openMedia, createPeer, finish]);

  const hangUp = useCallback(() => {
    const current = callRef.current;
    if (!current) return;
    if (current.id && current.phase !== 'ended') {
      const rejecting = current.direction === 'incoming' && current.phase === 'ringing';
      socket.emit(rejecting ? 'call:reject' : 'call:end', { callId: current.id });
    }
    finish();
  }, [socket, finish]);

  const toggleMute = useCallback(() => {
    const muted = !callRef.current?.muted;
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    patch({ muted });
  }, [patch]);

  const toggleCamera = useCallback(() => {
    const cameraOff = !callRef.current?.cameraOff;
    streamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !cameraOff; });
    patch({ cameraOff });
  }, [patch]);

  useEffect(() => {
    if (!socket) return undefined;
    const isCurrent = (id) => isLive(callRef.current) && callRef.current.id === id;

    const onIncoming = (p) => {
      if (isLive(callRef.current)) return;
      show({ id: p.callId, peer: p.from, type: p.type, direction: 'incoming', phase: 'ringing', muted: false, cameraOff: false });
    };
    const onAccepted = async ({ callId }) => {
      if (!isCurrent(callId)) return;
      patch({ phase: 'connecting' });
      const pc = createPeer(callId);
      await pc.setLocalDescription(await pc.createOffer());
      socket.emit('call:signal', { callId, data: { sdp: pc.localDescription.toJSON() } });
    };
    const onSignal = async ({ callId, data }) => {
      const pc = pcRef.current;
      if (!isCurrent(callId) || !pc) return;
      try {
        if (data.sdp) {
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer());
            socket.emit('call:signal', { callId, data: { sdp: pc.localDescription.toJSON() } });
          }
          for (const candidate of pendingIce.current.splice(0)) await pc.addIceCandidate(candidate);
        } else if (data.candidate) {
          // ICE co the den truoc SDP; giu lai cho den khi co remote description.
          if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
          else pendingIce.current.push(data.candidate);
        }
      } catch (err) {
        console.error(err);
      }
    };
    const onEnded = ({ callId, status }) => {
      if (isCurrent(callId)) finish(END_TEXT[status] ?? END_TEXT.ended);
    };
    const onHandled = ({ callId }) => {
      if (isCurrent(callId) && callRef.current.direction === 'incoming' && !accepting.current) finish();
    };
    const onDisconnect = () => {
      if (isLive(callRef.current)) finish('Mất kết nối máy chủ');
    };

    const handlers = {
      'call:incoming': onIncoming,
      'call:accepted': onAccepted,
      'call:signal': onSignal,
      'call:ended': onEnded,
      'call:handled': onHandled,
      disconnect: onDisconnect,
    };
    Object.entries(handlers).forEach(([event, fn]) => socket.on(event, fn));
    return () => Object.entries(handlers).forEach(([event, fn]) => socket.off(event, fn));
  }, [socket, show, patch, createPeer, finish]);

  useEffect(() => () => {
    clearTimeout(closeTimer.current);
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return { call, localStream, remoteStream, startCall, acceptCall, hangUp, toggleMute, toggleCamera };
}
