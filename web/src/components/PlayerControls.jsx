import React from 'react';

const SPEEDS = [0.5, 1, 2, 4];

// 播放控制条：播放/暂停、单步后退、单步前进、复位、倍速、进度。
export default function PlayerControls({ player, caption, disabled }) {
  return (
    <div className="canvas-toolbar">
      <button className="btn" onClick={player.reset} disabled={disabled} title="回到开头">⏮</button>
      <button className="btn" onClick={player.prev} disabled={disabled || player.index === 0} title="单步后退">◀</button>
      {player.playing ? (
        <button className="btn primary" onClick={player.pause} disabled={disabled} title="暂停">⏸ 暂停</button>
      ) : (
        <button className="btn primary" onClick={player.play} disabled={disabled || player.frameCount <= 1} title="播放">▶ 播放</button>
      )}
      <button className="btn" onClick={player.next} disabled={disabled || player.index >= player.frameCount - 1} title="单步前进">▶|</button>
      <div className="speed-group">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`btn ${player.speed === s ? 'active' : ''}`}
            onClick={() => player.setSpeed(s)}
            title={`${s}x 倍速`}
          >
            {s}×
          </button>
        ))}
      </div>
      <span className="step-caption">{caption}</span>
      <span className="step-progress">
        {player.frameCount ? player.index + 1 : 0}/{player.frameCount}
      </span>
    </div>
  );
}
