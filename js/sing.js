import { prepareAudio, playNote } from './audio.js';
import { openMic } from './mic.js';
import { midiToHz, hzToMidi, formatNote } from './music.js';
import { mountResult, formatSigned, pickRank } from './result.js';
import { average, randomInt, wait } from './util.js';

const ROUND_COUNT = 5;
// お手本は真ん中のド〜シ。歌うのはどのオクターブでもよい（男声・女声どちらでも遊べるように）
const MIN_TARGET_MIDI = 60;
const MAX_TARGET_MIDI = 71;
const EXAMPLE_SEC = 1.2;
// お手本の余韻をマイクが拾わないよう、鳴り終わってから少し待って聞き始める
const LISTEN_DELAY_MS = 300;
const LISTEN_SEC = 3;
const SAMPLE_INTERVAL_MS = 50;
// 0.5秒ぶん以上の声がないと判定しない
const MIN_VOICED_SAMPLES = 10;
// メーターの端。半音の半分ずれたら、もう隣の音
const METER_RANGE_CENTS = 50;
const NEXT_ROUND_DELAY_MS = 1600;

const RANKS = [
  { max: 5, label: 'チューナー声' },
  { max: 15, label: '音程ばっちり' },
  { max: 30, label: 'いい音感' },
  { max: 50, label: 'おしい' },
  { max: Infinity, label: 'のびしろあり' },
];

/** オクターブ違いは同じ音とみなし、ずれを -600〜+600 cent に折りたたむ */
function foldCents(cents) {
  return ((((cents + 600) % 1200) + 1200) % 1200) - 600;
}

/** 歌い出しの揺れを除くため、後半だけの中央値をとる */
function settledMedian(values) {
  const sorted = values.slice(Math.floor(values.length / 2)).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function initSingGame(panel) {
  const startButton = panel.querySelector('[data-sing-start]');
  const retryRoundButton = panel.querySelector('[data-sing-retry-round]');
  const roundOutput = panel.querySelector('[data-sing-round]');
  const lastOutput = panel.querySelector('[data-sing-last]');
  const phaseLabel = panel.querySelector('[data-sing-phase]');
  const progress = panel.querySelector('[data-sing-progress]');
  const meter = panel.querySelector('[data-sing-meter]');
  const voiceOutput = panel.querySelector('[data-sing-voice]');
  const centsOutput = panel.querySelector('[data-sing-cents]');
  const feedback = panel.querySelector('[data-feedback]');
  const errorMessage = panel.querySelector('[data-error]');
  const result = mountResult(panel.querySelector('[data-result-slot]'), {
    gameId: 'sing',
    gameTitle: 'この音、歌える？',
    onRetry: () => start(),
  });

  let ctx = null;
  let mic = null;
  let roundIndex = 0;
  let targetMidi = 0;
  let roundErrors = [];
  let sessionId = 0;

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
  }

  function renderMeter(hz) {
    meter.classList.toggle('is-silent', hz === null);
    if (hz === null) {
      voiceOutput.value = '—';
      centsOutput.value = '';
      return;
    }
    const cents = foldCents((hzToMidi(hz) - targetMidi) * 100);
    const clamped = Math.max(-METER_RANGE_CENTS, Math.min(METER_RANGE_CENTS, cents));
    meter.style.setProperty('--needle', String((clamped + METER_RANGE_CENTS) / (METER_RANGE_CENTS * 2)));
    voiceOutput.value = formatNote(hzToMidi(hz));
    centsOutput.value = `${formatSigned(cents, 0)} cent`;
  }

  function closeMic() {
    mic?.close();
    mic = null;
  }

  async function listen(currentSession) {
    const centsSamples = [];
    const listenStartMs = performance.now();
    while (performance.now() - listenStartMs < LISTEN_SEC * 1000) {
      if (currentSession !== sessionId) return null;
      const hz = mic.readPitchHz();
      renderMeter(hz);
      if (hz !== null) centsSamples.push(foldCents((hzToMidi(hz) - targetMidi) * 100));
      progress.value = (performance.now() - listenStartMs) / (LISTEN_SEC * 1000);
      await wait(SAMPLE_INTERVAL_MS);
    }
    renderMeter(null);
    return centsSamples;
  }

  async function playRound() {
    const currentSession = sessionId;
    retryRoundButton.hidden = true;
    feedback.textContent = '';
    roundOutput.value = String(roundIndex + 1);
    progress.value = 0;
    phaseLabel.textContent = 'お手本を聞いて…';
    playNote(ctx, midiToHz(targetMidi), { durationSec: EXAMPLE_SEC, decay: false, gain: 0.25 });
    await wait(EXAMPLE_SEC * 1000 + LISTEN_DELAY_MS);
    if (currentSession !== sessionId) return;

    phaseLabel.textContent = '同じ高さで「あー」と歌って！';
    const centsSamples = await listen(currentSession);
    if (centsSamples === null) return;
    if (centsSamples.length < MIN_VOICED_SAMPLES) {
      phaseLabel.textContent = '声が聞き取れませんでした';
      feedback.textContent = 'マイクに少し近づいて、まっすぐ伸ばすように歌ってみてください。';
      retryRoundButton.hidden = false;
      retryRoundButton.focus();
      return;
    }

    const errorCents = settledMedian(centsSamples);
    roundErrors.push(errorCents);
    lastOutput.value = `${formatSigned(errorCents, 0)} cent`;
    phaseLabel.textContent = Math.abs(errorCents) <= 15 ? 'いい感じ！' : errorCents > 0 ? 'ちょっと高かった' : 'ちょっと低かった';
    await wait(NEXT_ROUND_DELAY_MS);
    if (currentSession !== sessionId) return;
    if (roundErrors.length === ROUND_COUNT) {
      finish();
      return;
    }
    roundIndex += 1;
    targetMidi = randomInt(MIN_TARGET_MIDI, MAX_TARGET_MIDI);
    playRound();
  }

  function finish() {
    closeMic();
    phaseLabel.textContent = 'おつかれさま';
    const averageAbsoluteCents = average(roundErrors.map(Math.abs));
    result.show({
      big: `±${Math.round(averageAbsoluteCents)} cent`,
      rank: pickRank(averageAbsoluteCents, RANKS),
      details: [`ラウンド別 ${roundErrors.map((cents) => formatSigned(cents, 0)).join('・')} cent`, 'オクターブ違いで歌ってもOKで判定'],
    });
  }

  async function start() {
    ctx = await prepareAudio(errorMessage);
    if (!ctx) return;
    try {
      mic ??= await openMic(ctx);
    } catch (error) {
      showError(error.message);
      return;
    }
    errorMessage.hidden = true;
    sessionId += 1;
    roundIndex = 0;
    roundErrors = [];
    lastOutput.value = '—';
    targetMidi = randomInt(MIN_TARGET_MIDI, MAX_TARGET_MIDI);
    startButton.hidden = true;
    result.hide();
    playRound();
  }

  startButton.addEventListener('click', start);
  retryRoundButton.addEventListener('click', playRound);
  renderMeter(null);

  return {
    stop() {
      sessionId += 1;
      // 画面を離れたら必ずマイクを止める（使っていないのにマイクがオンのままにしない）
      const wasRunning = mic !== null;
      closeMic();
      if (!wasRunning) return;
      renderMeter(null);
      retryRoundButton.hidden = true;
      startButton.hidden = false;
      phaseLabel.textContent = 'スタートを押してね';
      feedback.textContent = '';
    },
  };
}
