import { prepareAudio, startMetronome, playNote, eventTimeToAudioTime } from './audio.js';
import { mountResult, pickRank } from './result.js';
import { average, randomInt } from './util.js';

// 16分音符でも指が追いつく、ゆったりめのテンポ
const BPM = 90;
const BEATS_PER_BAR = 4;
// カウント1小節 → お手本1小節 → あなたの番1小節
const COUNT_IN_BAR = 0;
const DEMO_BAR = 1;
const ANSWER_BAR = 2;
const TOTAL_BEATS = BEATS_PER_BAR * 3;
// subdivision: 1拍をいくつに割るか（2 = 8分音符、4 = 16分音符）。後半ほど細かく、音数も増やす
const ROUNDS = [
  { subdivision: 2, minHits: 3, maxHits: 4 },
  { subdivision: 2, minHits: 4, maxHits: 6 },
  { subdivision: 4, minHits: 4, maxHits: 6 },
  { subdivision: 4, minHits: 5, maxHits: 8 },
];
// 余計なタップ1回につき、ぴったりの1音の半分を差し引く。連打でごまかせないようにするため
const EXTRA_TAP_PENALTY = 0.5;
const PATTERN_HZ = 660;
const HIT_FLASH_MS = 90;

const RANKS = [
  { max: 49, label: 'これから' },
  { max: 69, label: 'もう少し' },
  { max: 84, label: 'いいノリ' },
  { max: 94, label: 'グルーヴの達人' },
  { max: 100, label: 'リズムマシン' },
];

/** 1小節の中で音を鳴らすマス目の番号（昇順）。1拍目の頭は必ず鳴らして、始まりを分かりやすくする */
function createPattern({ subdivision, minHits, maxHits }) {
  const slotCount = BEATS_PER_BAR * subdivision;
  const hitCount = randomInt(minHits, maxHits);
  const slots = new Set([0]);
  while (slots.size < hitCount) slots.add(randomInt(1, slotCount - 1));
  return [...slots].sort((a, b) => a - b);
}

/**
 * お手本の各音に、いちばん近い未使用のタップを割り当てて採点する（0〜100点）。
 * 許容幅はマス目の半分。それより広いと隣の音のタップと取り違えるため。
 */
function scoreRound(expectedSec, tapsSec, windowSec) {
  const unusedTaps = [...tapsSec];
  let accuracySum = 0;
  for (const expected of expectedSec) {
    let bestIndex = -1;
    for (const [index, tap] of unusedTaps.entries()) {
      const distance = Math.abs(tap - expected);
      if (distance <= windowSec && (bestIndex === -1 || distance < Math.abs(unusedTaps[bestIndex] - expected))) bestIndex = index;
    }
    if (bestIndex === -1) continue;
    accuracySum += 1 - Math.abs(unusedTaps[bestIndex] - expected) / windowSec;
    unusedTaps.splice(bestIndex, 1);
  }
  const rawScore = (accuracySum - unusedTaps.length * EXTRA_TAP_PENALTY) / expectedSec.length;
  return Math.round(Math.max(0, rawScore) * 100);
}

export function initRhythmGame(panel) {
  const startButton = panel.querySelector('[data-rhythm-start]');
  const nextButton = panel.querySelector('[data-rhythm-next]');
  const pad = panel.querySelector('[data-rhythm-pad]');
  const padLabel = panel.querySelector('[data-rhythm-pad-label]');
  const roundOutput = panel.querySelector('[data-rhythm-round]');
  const scoreOutput = panel.querySelector('[data-rhythm-score]');
  const compare = panel.querySelector('[data-rhythm-compare]');
  const demoTrack = panel.querySelector('[data-rhythm-demo-track]');
  const answerTrack = panel.querySelector('[data-rhythm-answer-track]');
  const feedback = panel.querySelector('[data-feedback]');
  const errorMessage = panel.querySelector('[data-error]');
  const result = mountResult(panel.querySelector('[data-result-slot]'), {
    gameId: 'rhythm',
    gameTitle: 'リズムコピー',
    onRetry: () => start(),
  });

  let ctx = null;
  let metronome = null;
  let roundIndex = 0;
  let roundScores = [];
  let pattern = [];
  let tapsSec = [];
  let finishTimerId = null;

  const barSec = () => BEATS_PER_BAR * metronome.beatIntervalSec;
  const barStartSec = (bar) => metronome.firstBeatTimeSec + bar * barSec();
  const slotSec = () => metronome.beatIntervalSec / ROUNDS[roundIndex].subdivision;

  function flashPad() {
    pad.classList.add('is-hit');
    setTimeout(() => pad.classList.remove('is-hit'), HIT_FLASH_MS);
  }

  function handleBeat(beatIndex) {
    const bar = Math.floor(beatIndex / BEATS_PER_BAR);
    if (bar === COUNT_IN_BAR) padLabel.textContent = `${BEATS_PER_BAR - beatIndex}`;
    if (bar === DEMO_BAR) padLabel.textContent = 'お手本を聞いて…';
    if (bar === ANSWER_BAR) padLabel.textContent = 'まねして！';
  }

  /** 位置（小節の中の割合）に印を並べる。マス目の線は CSS の繰り返し背景で描く */
  function renderTrack(track, ratios, subdivision) {
    track.style.setProperty('--slots', String(BEATS_PER_BAR * subdivision));
    track.replaceChildren(
      ...ratios.map((ratio) => {
        const mark = document.createElement('span');
        mark.style.setProperty('--position', String(ratio));
        return mark;
      }),
    );
  }

  function stopRhythm() {
    clearTimeout(finishTimerId);
    metronome?.stop();
    metronome = null;
    pad.disabled = true;
  }

  function finishRound() {
    const { subdivision } = ROUNDS[roundIndex];
    const answerStartSec = barStartSec(ANSWER_BAR);
    const expectedSec = pattern.map((slot) => slot * slotSec());
    const relativeTapsSec = tapsSec.map((tap) => tap - answerStartSec);
    const roundScore = scoreRound(expectedSec, relativeTapsSec, slotSec() / 2);
    renderTrack(demoTrack, pattern.map((slot) => slot / (BEATS_PER_BAR * subdivision)), subdivision);
    renderTrack(answerTrack, relativeTapsSec.map((tap) => tap / barSec()).filter((ratio) => ratio >= -0.05 && ratio < 1), subdivision);
    stopRhythm();
    compare.hidden = false;
    roundScores.push(roundScore);
    scoreOutput.value = String(roundScore);
    padLabel.textContent = `${roundScore} 点`;

    if (roundIndex === ROUNDS.length - 1) {
      finishGame();
      return;
    }
    feedback.textContent = 'お手本（上）とあなた（下）を見比べてみてください。';
    nextButton.hidden = false;
    nextButton.focus();
  }

  function finishGame() {
    const averageScore = Math.round(average(roundScores));
    feedback.textContent = '';
    result.show({
      big: `${averageScore} 点`,
      rank: pickRank(averageScore, RANKS),
      details: [`ラウンド別 ${roundScores.join('・')} 点`, `${BPM} BPM ・ 後半は16分音符`],
    });
  }

  function playRound() {
    tapsSec = [];
    pattern = createPattern(ROUNDS[roundIndex]);
    roundOutput.value = String(roundIndex + 1);
    scoreOutput.value = '—';
    nextButton.hidden = true;
    compare.hidden = true;
    feedback.textContent = '';
    pad.disabled = false;
    pad.focus();

    metronome = startMetronome(ctx, BPM, { beats: TOTAL_BEATS, onBeat: handleBeat });
    const demoStartSec = barStartSec(DEMO_BAR);
    pattern.forEach((slot) =>
      playNote(ctx, PATTERN_HZ, { startSec: demoStartSec + slot * slotSec(), durationSec: 0.12, gain: 0.5 }),
    );
    // 最後の拍のあと、1マスぶん遅れたタップまで受け付けてから締める。出力遅延のぶんも待つ
    const endSec = barStartSec(ANSWER_BAR + 1) + slotSec();
    const outputLatencyMs = (ctx.outputLatency ?? ctx.baseLatency ?? 0) * 1000;
    finishTimerId = setTimeout(finishRound, (endSec - ctx.currentTime) * 1000 + outputLatencyMs);
  }

  function registerTap(eventTimeStampMs) {
    if (!metronome) return;
    flashPad();
    // 自分のタップ音が聞こえると、ずれに気づきやすい
    playNote(ctx, PATTERN_HZ, { durationSec: 0.1, gain: 0.35 });
    const tapSec = eventTimeToAudioTime(ctx, eventTimeStampMs);
    // お手本の途中で叩いたぶんは数えない
    if (tapSec >= barStartSec(ANSWER_BAR) - slotSec() / 2) tapsSec.push(tapSec);
  }

  async function start() {
    ctx = await prepareAudio(errorMessage);
    if (!ctx) return;
    stopRhythm();
    roundIndex = 0;
    roundScores = [];
    startButton.hidden = true;
    result.hide();
    playRound();
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
  nextButton.addEventListener('click', () => {
    roundIndex += 1;
    playRound();
  });

  stopRhythm();
  return {
    stop() {
      const isPlaying = metronome !== null;
      stopRhythm();
      if (!isPlaying) return;
      // ラウンドの途中で離れたら、最初からやり直せる状態に戻す
      startButton.hidden = false;
      padLabel.textContent = 'スタートを押してね';
    },
    handleKey(event) {
      if (event.key !== ' ' || event.target !== document.body) return;
      event.preventDefault();
      registerTap(event.timeStamp);
    },
  };
}
