import { useEffect, useRef, useState } from 'react';
import Avatar from '../components/Avatar.jsx';
import { HangUpIcon, MicIcon, MicOffIcon, PhoneIcon, VideoIcon, VideoOffIcon } from '../components/Icons.jsx';
import { duration } from '../format.js';

function useElapsed(since) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since ? duration(Math.max(0, Math.floor((now - since) / 1000))) : '';
}

// Chuong bao bang WebAudio, khong can file am thanh.
function useRingtone(active) {
  useEffect(() => {
    if (!active || !window.AudioContext) return undefined;
    const ctx = new AudioContext();
    const beep = () => {
      for (const offset of [0, 0.35]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 440;
        gain.gain.setValueAtTime(0.12, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.3);
      }
    };
    beep();
    const t = setInterval(beep, 2000);
    return () => {
      clearInterval(t);
      ctx.close();
    };
  }, [active]);
}

export default function CallOverlay({ state }) {
  const { call, localStream, remoteStream, acceptCall, hangUp, toggleMute, toggleCamera } = state;
  const remoteRef = useRef(null);
  const localRef = useRef(null);
  const isVideo = call.type === 'video';
  const live = call.phase === 'connected';
  const elapsed = useElapsed(call.connectedAt);
  useRingtone(call.phase === 'ringing');

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream;
  }, [remoteStream]);
  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream;
  }, [localStream, call.cameraOff]);

  const kind = isVideo ? 'Cuộc gọi video' : 'Cuộc gọi thoại';
  const status = {
    preparing: 'Đang mở micro/camera…',
    ringing: call.direction === 'incoming' ? `${kind} đến` : 'Đang đổ chuông…',
    connecting: 'Đang kết nối…',
    connected: elapsed,
    ended: call.message,
  }[call.phase];
  const showRemoteVideo = isVideo && live && remoteStream;

  return (
    <div className={`call ${showRemoteVideo ? 'live-video' : ''} ${call.phase === 'ringing' ? 'ringing' : ''}`} role="dialog" aria-label={kind}>
      {isVideo
        ? <video ref={remoteRef} className={`call-remote ${showRemoteVideo ? '' : 'hidden'}`} autoPlay playsInline />
        : <audio ref={remoteRef} autoPlay />}
      {isVideo && localStream && !call.cameraOff && call.phase !== 'ended' && (
        <video ref={localRef} className="call-local" autoPlay playsInline muted />
      )}

      <div className="call-info">
        {!showRemoteVideo && <Avatar name={call.peer.displayName} size={104} />}
        <h2>{call.peer.displayName}</h2>
        <p>{status}</p>
      </div>

      {call.phase !== 'ended' && (
        <div className="call-controls">
          {call.direction === 'incoming' && call.phase === 'ringing' ? (
            <>
              <button className="call-btn end" onClick={hangUp} aria-label="Từ chối" title="Từ chối"><HangUpIcon /></button>
              <button className="call-btn accept" onClick={acceptCall} aria-label="Trả lời" title="Trả lời">
                {isVideo ? <VideoIcon /> : <PhoneIcon />}
              </button>
            </>
          ) : (
            <>
              <button className={`call-btn ${call.muted ? 'on' : ''}`} onClick={toggleMute} aria-pressed={call.muted} title={call.muted ? 'Bật micro' : 'Tắt micro'} aria-label="Micro">
                {call.muted ? <MicOffIcon /> : <MicIcon />}
              </button>
              {isVideo && (
                <button className={`call-btn ${call.cameraOff ? 'on' : ''}`} onClick={toggleCamera} aria-pressed={call.cameraOff} title={call.cameraOff ? 'Bật camera' : 'Tắt camera'} aria-label="Camera">
                  {call.cameraOff ? <VideoOffIcon /> : <VideoIcon />}
                </button>
              )}
              <button className="call-btn end" onClick={hangUp} aria-label="Kết thúc" title="Kết thúc"><HangUpIcon /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
