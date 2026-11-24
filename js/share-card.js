// SNS のリンクプレビュー（OGP）と同じ比率にして、共有先で切れにくくする
const CARD_WIDTH_PX = 1200;
const CARD_HEIGHT_PX = 630;
const MARGIN_PX = 48;
const SHADOW_OFFSET_PX = 12;
const PADDING_PX = 56;

// 画面がダークモードでも、共有画像は見る人の環境を選ばない明るい配色で固定する
const COLORS = {
  paper: '#f6f1e7',
  surface: '#fffdf8',
  ink: '#1d1b19',
  muted: '#5e5850',
  accent: '#ffcc33',
};
const SANS = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
}

/** 文字が枠からはみ出す場合だけ、収まるまでフォントを小さくする */
function fitFontSize(ctx, text, { weight, maxSizePx, family, maxWidthPx }) {
  let sizePx = maxSizePx;
  ctx.font = `${weight} ${sizePx}px ${family}`;
  while (sizePx > 24 && ctx.measureText(text).width > maxWidthPx) {
    sizePx -= 4;
    ctx.font = `${weight} ${sizePx}px ${family}`;
  }
}

function drawWave(ctx, startX, endX, centerY) {
  const amplitudePx = 14;
  const wavelengthPx = 66;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += 2) {
    const y = centerY - amplitudePx * Math.sin(((x - startX) / wavelengthPx) * Math.PI * 2);
    if (x === startX) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function pageUrl(gameId) {
  return `${location.origin}${location.pathname}#${gameId}`;
}

function displayUrl() {
  return `${location.host}${location.pathname}`.replace(/index\.html$/, '');
}

function drawCard({ gameTitle, big, rank, details }) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH_PX;
  canvas.height = CARD_HEIGHT_PX;
  const ctx = canvas.getContext('2d');

  const cardX = MARGIN_PX;
  const cardY = MARGIN_PX;
  const cardWidth = CARD_WIDTH_PX - MARGIN_PX * 2 - SHADOW_OFFSET_PX;
  const cardHeight = CARD_HEIGHT_PX - MARGIN_PX * 2 - SHADOW_OFFSET_PX;
  const contentX = cardX + PADDING_PX;
  const contentRight = cardX + cardWidth - PADDING_PX;

  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, CARD_WIDTH_PX, CARD_HEIGHT_PX);

  roundedRect(ctx, cardX + SHADOW_OFFSET_PX, cardY + SHADOW_OFFSET_PX, cardWidth, cardHeight, 28);
  ctx.fillStyle = COLORS.ink;
  ctx.fill();
  roundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 28);
  ctx.fillStyle = COLORS.surface;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();

  // 見出し: サイト名 ／ ゲーム名
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.ink;
  ctx.font = `800 36px ${SANS}`;
  ctx.fillText('おとあて', contentX, cardY + 82);
  const siteNameWidth = ctx.measureText('おとあて').width;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `700 30px ${SANS}`;
  ctx.fillText(`／ ${gameTitle}`, contentX + siteNameWidth + 16, cardY + 82);
  drawWave(ctx, contentRight - 230, contentRight, cardY + 70);

  // ランク（ピル）
  ctx.font = `800 36px ${SANS}`;
  const rankWidth = ctx.measureText(rank).width + 56;
  roundedRect(ctx, contentX, cardY + 116, rankWidth, 64, 32);
  ctx.fillStyle = COLORS.accent;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(rank, contentX + 28, cardY + 161);

  // メインの数値
  fitFontSize(ctx, big, { weight: 700, maxSizePx: 128, family: MONO, maxWidthPx: contentRight - contentX });
  ctx.fillText(big, contentX, cardY + 300);

  ctx.fillStyle = COLORS.muted;
  ctx.font = `600 30px ${SANS}`;
  details.forEach((line, index) => ctx.fillText(line, contentX, cardY + 352 + index * 42));

  // フッター: URL と日付
  const footerY = cardY + cardHeight - 30;
  ctx.font = `500 24px ${SANS}`;
  ctx.fillText(displayUrl(), contentX, footerY);
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleDateString('ja-JP'), contentRight, footerY);

  return canvas;
}

function buildFileName(gameId) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `otoate-${gameId}-${stamp}.png`;
}

/** @returns {Promise<Blob>} */
export function renderCardBlob(card) {
  const canvas = drawCard(card);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('画像を作れませんでした'))), 'image/png');
  });
}

export function canShareImages() {
  try {
    const probe = new File([], 'probe.png', { type: 'image/png' });
    return Boolean(navigator.canShare?.({ files: [probe] }));
  } catch {
    return false;
  }
}

export function saveCardImage(card, blob) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = buildFileName(card.gameId);
  document.body.append(link);
  link.click();
  link.remove();
  // ダウンロード開始前に URL を破棄すると保存に失敗するブラウザがあるため、少し待ってから解放する
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function shareCardImage(card, blob) {
  const file = new File([blob], buildFileName(card.gameId), { type: 'image/png' });
  return navigator.share({
    files: [file],
    text: `おとあて「${card.gameTitle}」${card.big}（${card.rank}）`,
    url: pageUrl(card.gameId),
  });
}
