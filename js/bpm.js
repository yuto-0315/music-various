import { prepareAudio, startMetronome } from './audio.js';
import { mountResult, formatSigned, pickRank } from './result.js';
import { randomInt } from './util.js';

// ポップスやクラシックの多くが収まる範囲から出題する
const MIN_TARGET_BPM = 60;
const MAX_TARGET_BPM = 180;
const LAMP_ON_MS = 110;

const RANKS = [
  { max: 0, label: 'ぴったり' },
  { max: 2, label: 'メトロノーム級' },
  { max: 5, label: 'いい感覚' },
  { max: 10, label: 'だいたい合ってる' },
  { max: 20, label: 'もう少し' },
  { max: Infinity, label: 'のびしろあり' },
];

export function initBpmGame(panel) {
  const toggleButton = panel.querySelector('[data-bpm-toggle]');
  const slider = panel.querySelector('[data-bpm-slider]');
  const guessOutput = panel.querySelector('[data-bpm-output]');
  const slowerButton = panel.querySelector('[data-bpm-slower]');
  const fasterButton = panel.querySelector('[data-bpm-faster]');
  const submitButton = panel.querySelector('[data-bpm-submit]');
  const lamps = panel.querySelectorAll('[data-bpm-lamp]');
  const errorMessage = panel.querySelector('[data-error]');
  const result = mountResult(panel.querySelector('[data-result-slot]'), {
    gameId: 'bpm',
    gameTitle: 'BPMあて',
    onRetry: () => {
      startRound();
      toggleButton.focus();
    },
  });

  let targetBpm = 0;
  let metronome = null;

  function setPlaying(playing) {
    toggleButton.textContent = playing ? 'クリックを止める' : 'クリックを再生';
    toggleButton.setAttribute('aria-pressed', String(playing));
  }

  function flashLamp(beatIndex) {
    const lamp = lamps[beatIndex % lamps.length];
    lamp.classList.add('is-on');
    setTimeout(() => lamp.classList.remove('is-on'), LAMP_ON_MS);
  }

  async function play() {
    const ctx = await prepareAudio(errorMessage);
    if (!ctx) return;
    metronome?.stop();
    metronome = startMetronome(ctx, targetBpm, { onBeat: flashLamp });
    setPlaying(true);
  }

  function stop() {
    metronome?.stop();
    metronome = null;
    setPlaying(false);
  }

  function showGuess() {
    guessOutput.value = slider.value;
  }

  function nudge(deltaBpm) {
    slider.value = String(Number(slider.value) + deltaBpm);
    showGuess();
  }

  function setControlsEnabled(enabled) {
    for (const control of [toggleButton, slider, slowerButton, fasterButton, submitButton]) {
      control.disabled = !enabled;
    }
  }

  function submit() {
    stop();
    setControlsEnabled(false);
    const guessBpm = Number(slider.value);
    const errorBpm = guessBpm - targetBpm;
    result.show({
      big: `${guessBpm} BPM`,
      rank: pickRank(Math.abs(errorBpm), RANKS),
      details: [`正解 ${targetBpm} BPM`, `ずれ ${formatSigned(errorBpm, 0)} BPM`],
    });
  }

  // 前回の答えはスライダーに残す。次の問題でも近い値から探し始められるように
  function startRound() {
    stop();
    targetBpm = randomInt(MIN_TARGET_BPM, MAX_TARGET_BPM);
    setControlsEnabled(true);
    result.hide();
  }

  toggleButton.addEventListener('click', () => (metronome ? stop() : play()));
  slider.addEventListener('input', showGuess);
  slowerButton.addEventListener('click', () => nudge(-1));
  fasterButton.addEventListener('click', () => nudge(1));
  submitButton.addEventListener('click', submit);

  startRound();
  showGuess();
  return { stop };
}
