import { prepareAudio, createSineVoice } from './audio.js';
import { mountResult } from './result.js';

// 若い人でも聞こえにくい高さから始め、多くの人が聞こえる高さまで下げていく
const START_HZ = 20000;
const END_HZ = 6000;
// 速すぎると反応の遅れぶん低く出て、遅すぎると退屈になる
const SWEEP_SEC = 24;
// 高音はスピーカーによって急に大きく出ることがあるので、ほかのゲームより小さめにする
const SWEEP_GAIN = 0.12;
const PROGRESS_UPDATE_MS = 100;

// 年齢とともに高い音から聞こえにくくなる傾向をもとにした、よく使われるおおまかな目安。医学的な検査ではない
const AGE_GUIDES = [
  { minHz: 17000, label: '10代の耳' },
  { minHz: 16000, label: '20代の耳' },
  { minHz: 15000, label: '30代の耳' },
  { minHz: 14000, label: '40代の耳' },
  { minHz: 12000, label: '50代の耳' },
  { minHz: 10000, label: '60代の耳' },
  { minHz: 0, label: '70代以上の耳' },
];

const formatHz = (hz) => `${Math.round(hz).toLocaleString('ja-JP')} Hz`;

export function initMosquitoGame(panel) {
  const startButton = panel.querySelector('[data-mosquito-start]');
  const heardButton = panel.querySelector('[data-mosquito-heard]');
  const progress = panel.querySelector('[data-mosquito-progress]');
  const feedback = panel.querySelector('[data-feedback]');
  const errorMessage = panel.querySelector('[data-error]');
  const result = mountResult(panel.querySelector('[data-result-slot]'), {
    gameId: 'mosquito',
    gameTitle: '耳年齢チェック',
    onRetry: () => start(),
  });

  let voice = null;
  let ctx = null;
  let sweepStartSec = 0;
  let progressTimerId = null;

  // exponentialRamp と同じ式で、いま鳴っている周波数を計算する（frequency.value は自動変化を反映しないブラウザがある）
  function currentHz() {
    const elapsedRatio = Math.min((ctx.currentTime - sweepStartSec) / SWEEP_SEC, 1);
    return START_HZ * (END_HZ / START_HZ) ** elapsedRatio;
  }

  function endSweep() {
    clearInterval(progressTimerId);
    voice?.fadeOut();
    heardButton.disabled = true;
  }

  function updateProgress() {
    const elapsedRatio = (ctx.currentTime - sweepStartSec) / SWEEP_SEC;
    progress.value = Math.min(elapsedRatio, 1);
    if (elapsedRatio < 1) return;
    endSweep();
    startButton.hidden = false;
    feedback.textContent = `最後まで聞こえませんでした。音量やイヤホンの接続を確かめて、もう一度どうぞ。`;
  }

  async function start() {
    ctx = await prepareAudio(errorMessage);
    if (!ctx) return;
    voice ??= createSineVoice(ctx, { gain: SWEEP_GAIN });
    result.hide();
    feedback.textContent = '高い音が鳴っています。聞こえたらすぐ押してください。';
    startButton.hidden = true;
    heardButton.disabled = false;
    heardButton.focus();

    sweepStartSec = ctx.currentTime;
    const frequency = voice.oscillator.frequency;
    frequency.cancelScheduledValues(sweepStartSec);
    frequency.setValueAtTime(START_HZ, sweepStartSec);
    frequency.exponentialRampToValueAtTime(END_HZ, sweepStartSec + SWEEP_SEC);
    voice.fadeIn();
    progress.value = 0;
    progressTimerId = setInterval(updateProgress, PROGRESS_UPDATE_MS);
  }

  function heard() {
    const heardHz = currentHz();
    endSweep();
    feedback.textContent = '';
    const ageGuide = AGE_GUIDES.find((guide) => heardHz >= guide.minHz);
    result.show({
      big: formatHz(heardHz),
      rank: ageGuide.label,
      details: ['聞こえる高さの上限はこのあたり', 'スピーカーや音量でも変わる、遊びの目安です'],
    });
  }

  startButton.addEventListener('click', start);
  heardButton.addEventListener('click', heard);

  return {
    stop() {
      if (heardButton.disabled) return;
      endSweep();
      startButton.hidden = false;
      feedback.textContent = '';
    },
  };
}
