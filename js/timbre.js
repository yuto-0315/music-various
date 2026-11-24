import { playNote } from './audio.js';
import { midiToHz } from './music.js';
import { initQuiz } from './quiz.js';
import { pickRandom, randomInt } from './util.js';

// 矩形波・のこぎり波は倍音が多く、同じ音量設定でも大きく聞こえる。
// 音量の差がヒントにならないよう、聞こえの大きさがそろう程度まで下げる
const WAVEFORMS = {
  sine: { label: '正弦波', gain: 0.3 },
  triangle: { label: '三角波', gain: 0.3 },
  square: { label: '矩形波', gain: 0.1 },
  sawtooth: { label: 'のこぎり波', gain: 0.12 },
};
// A3〜A4。低すぎると正弦波が聞こえにくく、高すぎると波形の違いが分かりにくい
const MIN_MIDI = 57;
const MAX_MIDI = 69;
const SAMPLE_MIDI = 64;
const TONE_SEC = 1.2;

// 4択なので当てずっぽうでも 2〜3問は当たる。それより上を段階づける
const RANKS = [
  { max: 3, label: 'ここから伸びる' },
  { max: 5, label: 'なんとなく分かる' },
  { max: 7, label: 'いい耳' },
  { max: 9, label: 'シンセ通' },
  { max: 10, label: '音色マスター' },
];

function playWaveform(ctx, type, midi) {
  playNote(ctx, midiToHz(midi), { type, gain: WAVEFORMS[type].gain, durationSec: TONE_SEC, decay: false });
}

export function initTimbreGame(panel) {
  return initQuiz(panel, {
    gameId: 'timbre',
    gameTitle: '音色あて',
    ranks: RANKS,
    createQuestion: () => ({ answer: pickRandom(Object.keys(WAVEFORMS)), midi: randomInt(MIN_MIDI, MAX_MIDI) }),
    playQuestion: (ctx, question) => playWaveform(ctx, question.answer, question.midi),
    playSample: (ctx, type) => playWaveform(ctx, type, SAMPLE_MIDI),
    describeAnswer: (answer) => WAVEFORMS[answer].label,
  });
}
