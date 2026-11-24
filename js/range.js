import { prepareAudio } from './audio.js';
import { openMic } from './mic.js';
import { hzToMidi, midiToHz, formatNote, formatNoteEn } from './music.js';
import { mountResult, pickRank } from './result.js';
import { average, wait } from './util.js';

const MEASURE_SEC = 6;
const SAMPLE_INTERVAL_MS = 50;
// 一瞬の裏返りや雑音で記録が伸びないよう、同じ高さが 0.2 秒続いたときだけ採用する
const STABLE_SAMPLES = 4;
const STABLE_TOLERANCE_SEMITONES = 0.5;

// 音域の広さ（半音の数）で判定。一般に2オクターブ前後がよくある広さ
const RANKS = [
  { max: 17, label: 'ひかえめな音域' },
  { max: 23, label: 'ふつうの音域' },
  { max: 29, label: '広い音域' },
  { max: 35, label: 'かなり広い音域' },
  { max: Infinity, label: '歌手級の音域' },
];

const MEASUREMENTS = {
  low: { label: 'いちばん低い声', instruction: '出せるいちばん低い声で「あー」', isBetter: (candidate, record) => candidate < record },
  high: { label: 'いちばん高い声', instruction: '出せるいちばん高い声で「あー」（裏声もOK）', isBetter: (candidate, record) => candidate > record },
};

function describeSpan(semitones) {
  const octaves = Math.floor(semitones / 12);
  const rest = semitones % 12;
  if (octaves === 0) return `${rest}半音`;
  return rest === 0 ? `${octaves}オクターブ` : `${octaves}オクターブと${rest}半音`;
}

export function initRangeGame(panel) {
  const measureButtons = [...panel.querySelectorAll('[data-range-measure]')];
  const recordOutputs = Object.fromEntries(
    [...panel.querySelectorAll('[data-range-record]')].map((output) => [output.dataset.rangeRecord, output]),
  );
  const phaseLabel = panel.querySelector('[data-range-phase]');
  const voiceOutput = panel.querySelector('[data-range-voice]');
  const progress = panel.querySelector('[data-range-progress]');
  const feedback = panel.querySelector('[data-feedback]');
  const errorMessage = panel.querySelector('[data-error]');
  const result = mountResult(panel.querySelector('[data-result-slot]'), {
    gameId: 'range',
    gameTitle: '音域チェック',
    onRetry: reset,
  });

  /** 測った記録（小数の MIDI ノート番号） */
  let records = { low: null, high: null };
  let mic = null;
  let sessionId = 0;

  function renderRecords() {
    for (const [kind, output] of Object.entries(recordOutputs)) {
      output.value = records[kind] === null ? '未計測' : formatNote(records[kind]);
    }
  }

  function closeMic() {
    mic?.close();
    mic = null;
    measureButtons.forEach((button) => (button.disabled = false));
  }

  function showResultIfReady() {
    if (records.low === null || records.high === null) return;
    const lowMidi = Math.round(Math.min(records.low, records.high));
    const highMidi = Math.round(Math.max(records.low, records.high));
    const span = highMidi - lowMidi;
    result.show({
      big: `${formatNoteEn(lowMidi)} 〜 ${formatNoteEn(highMidi)}`,
      rank: pickRank(span, RANKS),
      details: [
        `音域 ${describeSpan(span)}`,
        `${Math.round(midiToHz(lowMidi))} Hz 〜 ${Math.round(midiToHz(highMidi))} Hz`,
      ],
    });
  }

  async function measure(kind) {
    const ctx = await prepareAudio(errorMessage);
    if (!ctx) return;
    try {
      mic = await openMic(ctx);
    } catch (error) {
      errorMessage.textContent = error.message;
      errorMessage.hidden = false;
      return;
    }
    errorMessage.hidden = true;
    sessionId += 1;
    const currentSession = sessionId;
    const { label, instruction, isBetter } = MEASUREMENTS[kind];
    measureButtons.forEach((button) => (button.disabled = true));
    result.hide();
    feedback.textContent = '';
    phaseLabel.textContent = instruction;

    let record = null;
    const recentMidis = [];
    const startMs = performance.now();
    while (performance.now() - startMs < MEASURE_SEC * 1000) {
      if (currentSession !== sessionId) return;
      const hz = mic.readPitchHz();
      voiceOutput.value = hz === null ? '—' : formatNote(hzToMidi(hz));
      recentMidis.push(hz === null ? null : hzToMidi(hz));
      if (recentMidis.length > STABLE_SAMPLES) recentMidis.shift();
      const isStable =
        recentMidis.length === STABLE_SAMPLES &&
        recentMidis.every((midi) => midi !== null && Math.abs(midi - recentMidis[0]) <= STABLE_TOLERANCE_SEMITONES);
      if (isStable) {
        const candidate = average(recentMidis);
        if (record === null || isBetter(candidate, record)) record = candidate;
      }
      progress.value = (performance.now() - startMs) / (MEASURE_SEC * 1000);
      await wait(SAMPLE_INTERVAL_MS);
    }

    closeMic();
    voiceOutput.value = '—';
    progress.value = 0;
    if (record === null) {
      phaseLabel.textContent = '声が聞き取れませんでした';
      feedback.textContent = 'マイクに少し近づいて、同じ高さを1秒ほど伸ばしてみてください。';
      return;
    }
    records[kind] = record;
    renderRecords();
    phaseLabel.textContent = `${label}: ${formatNote(record)}`;
    const nextKind = kind === 'low' ? 'high' : 'low';
    if (records[nextKind] === null) {
      feedback.textContent = `次は「${MEASUREMENTS[nextKind].label}」を測りましょう。`;
      panel.querySelector(`[data-range-measure="${nextKind}"]`).focus();
      return;
    }
    showResultIfReady();
  }

  function reset() {
    records = { low: null, high: null };
    renderRecords();
    result.hide();
    feedback.textContent = '';
    phaseLabel.textContent = 'どちらからでも測れます';
    measureButtons[0].focus();
  }

  measureButtons.forEach((button) => button.addEventListener('click', () => measure(button.dataset.rangeMeasure)));
  renderRecords();

  return {
    stop() {
      sessionId += 1;
      // 画面を離れたら必ずマイクを止める
      if (mic === null) return;
      closeMic();
      voiceOutput.value = '—';
      progress.value = 0;
      phaseLabel.textContent = 'どちらからでも測れます';
    },
  };
}
