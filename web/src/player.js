import { useEffect, useRef, useState, useCallback } from 'react';

// 通用帧播放器：播放/暂停/单步前进/单步后退/倍速/跳转。
// frames 变化时自动复位。
export function usePlayer(frames, { onFrame } = {}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1); // 0.5 / 1 / 2 / 4
  const timer = useRef(null);
  const frameCount = frames ? frames.length : 0;

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [frames]);

  useEffect(() => {
    if (onFrame) onFrame(index);
  }, [index, onFrame]);

  useEffect(() => {
    if (!playing) return undefined;
    if (index >= frameCount - 1) {
      setPlaying(false);
      return undefined;
    }
    const delay = 650 / speed;
    timer.current = setTimeout(() => {
      setIndex((i) => Math.min(i + 1, frameCount - 1));
    }, delay);
    return () => clearTimeout(timer.current);
  }, [playing, index, speed, frameCount]);

  const play = useCallback(() => {
    if (index >= frameCount - 1) setIndex(0);
    setPlaying(true);
  }, [index, frameCount]);
  const pause = useCallback(() => setPlaying(false), []);
  const next = useCallback(() => {
    setPlaying(false);
    setIndex((i) => Math.min(i + 1, frameCount - 1));
  }, [frameCount]);
  const prev = useCallback(() => {
    setPlaying(false);
    setIndex((i) => Math.max(i - 1, 0));
  }, []);
  const seek = useCallback(
    (i) => {
      setPlaying(false);
      setIndex(Math.max(0, Math.min(i, frameCount - 1)));
    },
    [frameCount],
  );
  const reset = useCallback(() => {
    setPlaying(false);
    setIndex(0);
  }, []);

  return { index, playing, speed, setSpeed, play, pause, next, prev, seek, reset, frameCount };
}
