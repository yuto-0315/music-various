import { prepareAudio, startMetronome, eventTimeToAudioTime } from './audio.js';
import { mountResult, formatSigned, pickRank, renderDeviationBars } from './result.js';
import { average, pickRandom } from './util.js';

const COUNT_IN_BEATS = 4;
const TARGET_BEATS = 16;
const TEMPO_CHOICES_BPM = [80, 90, 100, 110, 120];
// 半分以上たたけていないと平均に意味がないので、結果を出さずにやり直してもらう
const MIN_HITS = TARGET_BEATS / 2;
// 100ms ずれたらバーが端まで届く。人が「ずれた」と感じ始めるのは数十 ms から
const CHART_FULL_SCALE_MS = 100;
// 平均してこれ以内なら、前のめり・うしろノリの癖はないとみなす
const TENDENCY_THRESHOLD_MS = 5;
const HIT_FLASH_MS = 90;

const RANKS = [
  { max: 10, label: 'ジャストの鬼' },
  { max: 20, label: 'タイトなグルーヴ' },
  { max: 35, label: 'ノリノリ' },
  { max: 60, label: 'まあまあ' },
  { max: Infinity, label: '自由なリズム' },
];

function describeTendency(meanOffsetMs) {
  if (meanOffsetMs < -TENDENCY_THRESHOLD_MS) return '前のめり';
  if (meanOffsetMs > TENDENCY_THRESHOLD_MS) return 'うしろノリ';
  return 'ど真ん中';
}

export function initTimingGame(panel) {
  const startButton = panel.querySelector('[data-timing-start]');
  const pad = panel.querySelector('[data-timing-pad]');
  const padLabel = panel.querySelector('[data-timing-pad-label]');
  const tempoOutput = panel.querySelector('[data-timing-tempo]');
  const dotList = panel.querySelector('[data-timing-dots]');
  const chart = panel.querySelector('[data-timing-chart]');
  const chartBars = panel.querySelector('[data-timing-bars]');
  const feedback = panel.querySelector('[data-feedback]');
  const errorMessage = panel.querySelector('[data-error]');
  const result = mountResult(panel.querySelector('[data-result-slot]'), {
    gameId: 'timing',
    gameTitle: 'ジャストタイミング',
    onRetry: () => start(),
  });

  const dots = Array.from({ length: TARGET_BEATS }, () => document.createElement('li'));
  dotList.append(...dots);

  let ctx = null;
  let metronome = null;
  let bpm = TEMPO_CHOICES_BPM[2];
  /** 拍ごとのずれ（ms）。叩かなかった拍は null */
  let offsetsMs = [];
  let finishTimerId = null;

  function flashPad() {
    pad.classList.add('is-hit');
    setTimeout(() => pad.classList.remove('is-hit'), HIT_FLASH_MS);
  }

  function handleBeat(beatIndex) {
    if (beatIndex < COUNT_IN_BEATS) {
      padLabel.textContent = String(COUNT_IN_BEATS - beatIndex);
      return;
    }
    padLabel.textContent = 'たたいて！';
    dots[beatIndex - COUNT_IN_BEATS].classList.add('is-filled');
  }

  function registerTap(eventTimeStampMs) {
    if (!metronome) return;
    flashPad();
    const tapSec = eventTimeToAudioTime(ctx, eventTimeStampMs);
    const beatIndex = Math.round((tapSec - metronome.firstBeatTimeSec) / metronome.beatIntervalSec);
    const targetIndex = beatIndex - COUNT_IN_BEATS;
    // カウント中の拍と、1拍に2回目以降のタップは数えない
    if (targetIndex < 0 || targetIndex >= TARGET_BEATS || offsetsMs[targetIndex] !== null) return;
    const beatSec = metronome.firstBeatTimeSec + beatIndex * metronome.beatIntervalSec;
    offsetsMs[targetIndex] = (tapSec - beatSec) * 1000;
  }

  function stopRhythm() {
    clearTimeout(finishTimerId);
    metronome?.stop();
    metronome = null;
    pad.disabled = true;
    padLabel.textContent = 'スタートを押してね';
  }

  function stop() {
    if (!metronome) return;
    stopRhythm();
    startButton.hidden = false;
  }

  function finish() {
    stopRhythm();
    const hitOffsetsMs = offsetsMs.filter((offset) => offset !== null);
    // 早い（マイナス）ほど上に伸ばす
    renderDeviationBars(chartBars, offsetsMs.map((offset) => (offset === null ? null : -offset / CHART_FULL_SCALE_MS)));
    chart.hidden = false;
    if (hitOffsetsMs.length < MIN_HITS) {
      feedback.textContent = `たたけたのは ${hitOffsetsMs.length} 拍でした。クリックに合わせて、もう一度どうぞ。`;
      startButton.hidden = false;
      return;
    }
    // 再挑戦は結果の「もう一回」から。同じ役割のボタンを2つ並べない
    padLabel.textContent = 'おつかれさま';
    feedback.textContent = '';
    const meanOffsetMs = average(hitOffsetsMs);
    const meanAbsoluteOffsetMs = average(hitOffsetsMs.map(Math.abs));
    result.show({
      big: `${Math.round(meanAbsoluteOffsetMs)} ms`,
      rank: pickRank(meanAbsoluteOffsetMs, RANKS),
      details: [
        `平均のずれ ${formatSigned(meanOffsetMs, 0)} ms（${describeTendency(meanOffsetMs)}）`,
        `ヒット ${hitOffsetsMs.length} / ${TARGET_BEATS} 拍 ・ ${bpm} BPM`,
      ],
    });
  }

  async function start() {
    ctx = await prepareAudio(errorMessage);
    if (!ctx) return;
    stopRhythm();
    result.hide();
    chart.hidden = true;
    feedback.textContent = '';
    dots.forEach((dot) => dot.classList.remove('is-filled'));
    offsetsMs = Array(TARGET_BEATS).fill(null);
    bpm = pickRandom(TEMPO_CHOICES_BPM);
    tempoOutput.value = String(bpm);
    startButton.hidden = true;
    pad.disabled = false;
    pad.focus();
    padLabel.textContent = 'よく聞いて…';
    const totalBeats = COUNT_IN_BEATS + TARGET_BEATS;
    metronome = startMetronome(ctx, bpm, { beats: totalBeats, onBeat: handleBeat });
    // 最後の拍のあと、半拍ぶん遅れたタップまで受け付けてから締める。
    // 実際に音が聞こえるのは出力遅延ぶん後なので、その余裕も足しておく
    const endSec = metronome.firstBeatTimeSec + (totalBeats - 0.5) * metronome.beatIntervalSec;
    const outputLatencyMs = (ctx.outputLatency ?? ctx.baseLatency ?? 0) * 1000;
    finishTimerId = setTimeout(finish, (endSec - ctx.currentTime) * 1000 + outputLatencyMs + 50);
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
  startButton.addEventListener('click', start);

  stopRhythm();
  return {
    stop,
    handleKey(event) {
      if (event.key !== ' ' || event.target !== document.body) return;
      event.preventDefault();
      registerTap(event.timeStamp);
    },
  };
}
