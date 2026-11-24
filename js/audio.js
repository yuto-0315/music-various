let sharedContext = null;

// 0 から一気に音量を変えると「プツッ」とノイズが出るため、短い時定数で滑らかに変える
const VOLUME_FADE_SEC = 0.02;
// 正弦波は耳に刺さりやすいので控えめにする
const SINE_GAIN = 0.2;
// スライダーの段差を滑らかにしつつ、追従の遅れは感じない程度
const FREQUENCY_GLIDE_SEC = 0.01;
const NOTE_ATTACK_SEC = 0.01;

const CLICK_LENGTH_SEC = 0.05;
const CLICK_GAIN = 0.5;
const CLICK_HZ = 1000;
// 小節の頭だけ高くして、4拍の区切りを分かるようにする
const ACCENT_CLICK_HZ = 1500;

// setInterval は数十 ms 単位でずれるため、少し先の拍を AudioContext の時計で予約しておく
const SCHEDULE_AHEAD_SEC = 0.1;
const SCHEDULER_INTERVAL_MS = 25;
// 開始直後の拍が予約に間に合わず欠けないよう、最初の拍だけ少し遅らせる
const FIRST_BEAT_DELAY_SEC = 0.1;

const A4_MIDI = 69;
const A4_HZ = 440;

export const midiToHz = (midi) => A4_HZ * 2 ** ((midi - A4_MIDI) / 12);

/**
 * 自動再生制限があるため、ユーザー操作のハンドラ内で最初の await より前に呼ぶこと。
 */
export async function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('このブラウザでは音を鳴らせません。最新の Chrome・Safari・Firefox で開いてください。');
  }
  // iPhone のマナーモードでも Web Audio が鳴るようにする（Safari 17 以降）
  if (navigator.audioSession) navigator.audioSession.type = 'playback';
  sharedContext ??= new AudioContextClass();
  if (sharedContext.state === 'suspended') await sharedContext.resume();
  return sharedContext;
}

/** 音が使えないときは errorElement にエラーを出して null を返す */
export async function prepareAudio(errorElement) {
  try {
    const ctx = await getAudioContext();
    errorElement.hidden = true;
    return ctx;
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
    return null;
  }
}

/** 鳴らしっぱなしの正弦波。音量の上げ下げで再生・停止を表す。 */
export function createSineVoice(ctx, { gain = SINE_GAIN } = {}) {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = 'sine';
  gainNode.gain.value = 0;
  oscillator.connect(gainNode).connect(ctx.destination);
  oscillator.start();

  return {
    oscillator,
    setFrequency(hz, { immediate = false } = {}) {
      const frequency = oscillator.frequency;
      if (immediate) {
        frequency.cancelScheduledValues(ctx.currentTime);
        frequency.setValueAtTime(hz, ctx.currentTime);
        return;
      }
      frequency.setTargetAtTime(hz, ctx.currentTime, FREQUENCY_GLIDE_SEC);
    },
    fadeIn() {
      gainNode.gain.setTargetAtTime(gain, ctx.currentTime, VOLUME_FADE_SEC);
    },
    fadeOut() {
      gainNode.gain.setTargetAtTime(0, ctx.currentTime, VOLUME_FADE_SEC);
    },
  };
}

/**
 * 単発の音を鳴らす。
 * decay: true なら叩いた楽器のように減衰、false なら一定の音量で鳴らして最後だけ消す（聞き比べ用）。
 */
export function playNote(ctx, hz, { startSec = ctx.currentTime, durationSec = 0.6, type = 'triangle', gain = 0.25, decay = true } = {}) {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const endSec = startSec + durationSec;
  oscillator.type = type;
  oscillator.frequency.value = hz;
  gainNode.gain.setValueAtTime(0, startSec);
  gainNode.gain.linearRampToValueAtTime(gain, startSec + NOTE_ATTACK_SEC);
  if (decay) {
    gainNode.gain.exponentialRampToValueAtTime(0.001, endSec);
  } else {
    gainNode.gain.setValueAtTime(gain, endSec - VOLUME_FADE_SEC * 2);
    gainNode.gain.linearRampToValueAtTime(0, endSec);
  }
  oscillator.connect(gainNode).connect(ctx.destination);
  oscillator.start(startSec);
  oscillator.stop(endSec);
}

function scheduleClick(ctx, timeSec, isAccent) {
  playNote(ctx, isAccent ? ACCENT_CLICK_HZ : CLICK_HZ, {
    startSec: timeSec,
    durationSec: CLICK_LENGTH_SEC,
    type: 'sine',
    gain: CLICK_GAIN,
  });
}

/**
 * クリック音を一定のテンポで鳴らす。
 * @param {{ beats?: number, onBeat?: (beatIndex: number) => void }} options
 */
export function startMetronome(ctx, bpm, { beats = Infinity, onBeat } = {}) {
  const beatIntervalSec = 60 / bpm;
  const firstBeatTimeSec = ctx.currentTime + FIRST_BEAT_DELAY_SEC;
  let nextBeatTimeSec = firstBeatTimeSec;
  let beatIndex = 0;
  let isStopped = false;
  let timerId = null;

  function scheduleUpcomingBeats() {
    while (beatIndex < beats && nextBeatTimeSec < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      const currentIndex = beatIndex;
      scheduleClick(ctx, nextBeatTimeSec, currentIndex % 4 === 0);
      const delayMs = Math.max(0, (nextBeatTimeSec - ctx.currentTime) * 1000);
      setTimeout(() => !isStopped && onBeat?.(currentIndex), delayMs);
      nextBeatTimeSec += beatIntervalSec;
      beatIndex += 1;
    }
    if (beatIndex >= beats) clearInterval(timerId);
  }

  timerId = setInterval(scheduleUpcomingBeats, SCHEDULER_INTERVAL_MS);
  scheduleUpcomingBeats();

  return {
    firstBeatTimeSec,
    beatIntervalSec,
    stop() {
      isStopped = true;
      clearInterval(timerId);
    },
  };
}

/**
 * 入力イベントの時刻（performance.now 基準）を、その瞬間にスピーカーから出ていた音の AudioContext 時刻へ換算する。
 * 出力の遅延ぶんを差し引かないと、全員が「遅れて叩いた」判定になってしまう。
 */
export function eventTimeToAudioTime(ctx, eventTimeStampMs) {
  const outputStamp = ctx.getOutputTimestamp?.();
  if (outputStamp?.performanceTime) {
    return outputStamp.contextTime + (eventTimeStampMs - outputStamp.performanceTime) / 1000;
  }
  const outputLatencySec = ctx.outputLatency ?? ctx.baseLatency ?? 0;
  return ctx.currentTime - (performance.now() - eventTimeStampMs) / 1000 - outputLatencySec;
}
