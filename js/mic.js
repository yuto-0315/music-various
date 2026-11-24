// 2048サンプルあれば、低い男声（約65Hz）でも1周期以上をとらえられる
const FFT_SIZE = 2048;
// 人の声の基本周波数がおさまる範囲（低い男声〜高い女声・裏声）
const MIN_VOICE_HZ = 65;
const MAX_VOICE_HZ = 1100;
// これより小さい音は無音（息やまわりの雑音）とみなす
const SILENCE_RMS = 0.01;
// 自己相関のピークがこれより低いときは、音程がはっきりしない音として捨てる
const MIN_CLARITY = 0.9;
// 周期の2倍・3倍の位置にも同じくらいのピークが出るので、最大値のこの割合以上ある最初のピークを採用する
const PEAK_PICK_RATIO = 0.95;

/**
 * 正規化した自己相関で、声の基本周波数を推定する。声が小さい・音程がはっきりしないときは null。
 * @param {Float32Array} samples
 */
function detectPitchHz(samples, sampleRate) {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  if (Math.sqrt(energy / samples.length) < SILENCE_RMS) return null;

  const minLag = Math.floor(sampleRate / MAX_VOICE_HZ);
  const maxLag = Math.min(Math.ceil(sampleRate / MIN_VOICE_HZ), samples.length / 2);
  // ピーク判定で maxLag + 1 まで使うので、その分だけ窓を短くして配列の外を読まないようにする
  const windowLength = samples.length - maxLag - 1;
  const correlations = new Float32Array(maxLag + 2);
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let cross = 0;
    let energyA = 0;
    let energyB = 0;
    for (let i = 0; i < windowLength; i++) {
      const a = samples[i];
      const b = samples[i + lag];
      cross += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    correlations[lag] = cross / (Math.sqrt(energyA * energyB) || 1);
    bestCorrelation = Math.max(bestCorrelation, correlations[lag]);
  }
  if (bestCorrelation < MIN_CLARITY) return null;

  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    const [previous, current, next] = [correlations[lag - 1], correlations[lag], correlations[lag + 1]];
    const isPeak = current >= previous && current >= next;
    if (!isPeak || current < bestCorrelation * PEAK_PICK_RATIO) continue;
    // 前後の値から放物線で頂点を補間し、サンプル間隔より細かく周期を求める
    const curvature = previous - 2 * current + next;
    const shift = curvature === 0 ? 0 : (previous - next) / (2 * curvature);
    return sampleRate / (lag + shift);
  }
  return null;
}

/**
 * マイクを開いて、声の高さを読み取れるようにする。使い終わったら必ず close() でマイクを止める。
 * 音声はこの端末の中で解析するだけで、録音も送信もしない。
 */
export async function openMic(ctx) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('このブラウザではマイクを使えません。最新の Chrome・Safari・Firefox で開いてください。');
  }
  let stream;
  try {
    // 声の高さをそのまま測りたいので、ノイズ除去や自動音量調整は切る
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (error) {
    const isDenied = error.name === 'NotAllowedError' || error.name === 'SecurityError';
    throw new Error(
      isDenied
        ? 'マイクの使用が許可されませんでした。ブラウザのアドレスバー付近にあるマイクの設定から許可して、もう一度どうぞ。'
        : 'マイクを開けませんでした。マイクがつながっているか確かめて、もう一度どうぞ。',
    );
  }
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  source.connect(analyser);
  const samples = new Float32Array(FFT_SIZE);

  return {
    readPitchHz() {
      analyser.getFloatTimeDomainData(samples);
      return detectPitchHz(samples, ctx.sampleRate);
    },
    close() {
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
