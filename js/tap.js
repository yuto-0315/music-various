import { prepareAudio, startMetronome } from './audio.js';
import { mountResult, formatSigned, pickRank, renderDeviationBars } from './result.js';
import { average, standardDeviation } from './util.js';

// 間隔が8つあれば平均が安定する。少なすぎるとまぐれで当たり、多すぎると集中が切れる
const TAP_COUNT = 9;
const MIN_TARGET_BPM = 70;
const MAX_TARGET_BPM = 160;
// 「120」「125」のような覚えやすい数字だけを出題する
const TARGET_BPM_STEP = 5;
const DEMO_BEATS = 4;
const HIT_FLASH_MS = 90;
// 間隔が目標から 20% ずれたらバーが端まで届く。それ以上は頭打ちにする
const CHART_FULL_SCALE_RATIO = 0.2;
// 1BPM の重みはテンポによって違うので、評価は目標に対するずれの割合（%）で行う
const RANKS = [
  { max: 1, label: '人間メトロノーム' },
  { max: 3, label: '安定のリズム感' },
  { max: 6, label: 'いい感じ' },
  { max: 12, label: 'あと一歩' },
  { max: Infinity, label: 'マイペース' },
];
// 間隔のばらつき（標準偏差 ÷ 平均間隔）
const STABILITY_LABELS = [
  { max: 0.03, label: 'とても安定' },
  { max: 0.06, label: 'まあまあ安定' },
  { max: Infinity, label: 'ゆれ大きめ' },
];

function randomTargetBpm() {
  const stepCount = (MAX_TARGET_BPM - MIN_TARGET_BPM) / TARGET_BPM_STEP;
  return MIN_TARGET_BPM + Math.floor(Math.random() * (stepCount + 1)) * TARGET_BPM_STEP;
}

function describeTendency(errorPercent) {
  if (Math.abs(errorPercent) < 0.05) return 'ぴったり';
  return errorPercent > 0 ? '走りぎみ' : 'もたりぎみ';
}

export function initTapGame(panel) {
  const targetOutput = panel.querySelector('[data-tap-target]');
  const demoButton = panel.querySelector('[data-tap-demo]');
  const resetButton = panel.querySelector('[data-tap-reset]');
  const pad = panel.querySelector('[data-tap-pad]');
  const dotList = panel.querySelector('[data-tap-dots]');
  const statusElement = panel.querySelector('[data-tap-status]');
  const chart = panel.querySelector('[data-tap-chart]');
  const chartBars = panel.querySelector('[data-tap-bars]');
  const errorMessage = panel.querySelector('[data-error]');
  const result = mountResult(panel.querySelector('[data-result-slot]'), {
    gameId: 'tap',
    gameTitle: 'テンポキープ',
    onRetry: () => {
      startRound();
      pad.focus();
    },
  });

  const dots = Array.from({ length: TAP_COUNT }, () => document.createElement('li'));
  dotList.append(...dots);

  let targetBpm = 0;
  let tapTimesMs = [];
  let demo = null;
  let isFinished = false;

  function renderProgress() {
    dots.forEach((dot, index) => dot.classList.toggle('is-filled', index < tapTimesMs.length));
    resetButton.hidden = tapTimesMs.length === 0 || isFinished;
    statusElement.textContent = tapTimesMs.length === 0 ? '' : `${tapTimesMs.length} / ${TAP_COUNT} 回`;
  }

  function flashPad() {
    pad.classList.add('is-hit');
    setTimeout(() => pad.classList.remove('is-hit'), HIT_FLASH_MS);
  }

  function stopDemo() {
    demo?.stop();
    demo = null;
  }

  async function playDemo() {
    const ctx = await prepareAudio(errorMessage);
    if (!ctx) return;
    stopDemo();
    demo = startMetronome(ctx, targetBpm, { beats: DEMO_BEATS, onBeat: flashPad });
  }

  function finish() {
    isFinished = true;
    pad.disabled = true;
    demoButton.disabled = true;
    renderProgress();

    const intervalsMs = tapTimesMs.slice(1).map((timeMs, index) => timeMs - tapTimesMs[index]);
    const averageIntervalMs = average(intervalsMs);
    const averageBpm = 60000 / averageIntervalMs;
    const deviationMs = standardDeviation(intervalsMs);
    const errorPercent = ((averageBpm - targetBpm) / targetBpm) * 100;
    const targetIntervalMs = 60000 / targetBpm;
    // 間隔が短い（走った）ほど上に伸ばす
    renderDeviationBars(
      chartBars,
      intervalsMs.map((intervalMs) => (targetIntervalMs - intervalMs) / targetIntervalMs / CHART_FULL_SCALE_RATIO),
    );
    chart.hidden = false;

    result.show({
      big: `${averageBpm.toFixed(1)} BPM`,
      rank: pickRank(Math.abs(errorPercent), RANKS),
      details: [
        `目標 ${targetBpm} BPM`,
        `ずれ ${formatSigned(errorPercent, 1)}%（${describeTendency(errorPercent)}）`,
        `ゆれ ±${Math.round(deviationMs)} ms（${pickRank(deviationMs / averageIntervalMs, STABILITY_LABELS)}）`,
      ],
    });
  }

  function registerTap(timeMs) {
    if (isFinished) return;
    stopDemo();
    tapTimesMs.push(timeMs);
    flashPad();
    if (tapTimesMs.length === TAP_COUNT) {
      finish();
      return;
    }
    renderProgress();
  }

  function resetTaps() {
    stopDemo();
    tapTimesMs = [];
    isFinished = false;
    pad.disabled = false;
    demoButton.disabled = false;
    chart.hidden = true;
    result.hide();
    renderProgress();
  }

  function startRound() {
    targetBpm = randomTargetBpm();
    targetOutput.value = String(targetBpm);
    resetTaps();
  }

  // click は指を離したときに発火して遅れるため、押した瞬間（pointerdown / keydown）の時刻を使う
  pad.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    registerTap(event.timeStamp);
  });
  pad.addEventListener('keydown', (event) => {
    if ((event.key !== ' ' && event.key !== 'Enter') || event.repeat) return;
    event.preventDefault();
    registerTap(event.timeStamp);
  });
  demoButton.addEventListener('click', playDemo);
  resetButton.addEventListener('click', () => {
    resetTaps();
    pad.focus();
  });

  startRound();
  return {
    stop: stopDemo,
    // パッドにフォーカスがなくても、ページ上でスペースを押せば遊べるようにする
    handleKey(event) {
      if (event.key !== ' ' || event.target !== document.body) return;
      event.preventDefault();
      registerTap(event.timeStamp);
    },
  };
}
