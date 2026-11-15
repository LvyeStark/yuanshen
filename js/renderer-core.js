const EMBLEM_KEYS = Object.freeze([
  'mengdei',
  'liyue',
  'daoqi',
  'xuni',
  'fengdan',
  'nata',
  'nuodekalai',
  'zhidong',
  'dachishahai',
  'chenyugu',
  'youyoudujiacun',
  'kongzhishendian',
  'huanxiangzhenjinjushi',
]);

const DEFAULTS = {
  mode: '16:9',
  emblem: 'mengdei',
  outputWidth: 1920,
  outputHeight: 1080,
  line1: '序章 第一幕 完成',
  line2: '捕风的异乡人',
  line3: '任务完成',
  line4: '未完待续',
  overlayColor: '#12151f',
  overlayOpacity: 0.62,
  emblemFlashIntensity: 1.35,
  panelOpacity: 0.72,
};

const OUTPUT_SIZES = Object.freeze({
  '16:9': Object.freeze({ width: 1920, height: 1080 }),
  '4:3': Object.freeze({ width: 1440, height: 1080 }),
  '9:16': Object.freeze({ width: 1080, height: 1920 }),
  '8K': Object.freeze({ width: 7680, height: 4320 }),
});

const OVERLAY_DESIGN = Object.freeze({
  width: 1920,
  height: 1080,
  emblemSize: 178,
  emblemY: 216,
  line1Y: 365.04,
  line1Size: 35.52,
  line1MaxWidth: 806.4,
  line2Y: 442.8,
  line2Size: 65.28,
  line2MaxWidth: 902.4,
  dividerY: 529.2,
  dividerWidth: 652.8,
  taskBandY: 577.8,
  taskBandWidth: 620,
  taskBandHeight: 56,
  taskY: 577.8,
  taskWidth: 215.04,
  bottomY: 909.36,
  continuationWidth: 230.4,
  continuationGlowHeight: 34.56,
  continuationPanelWidth: 430,
  continuationPanelHeight: 52,
});

const VIDEO_EXPORT_SETTINGS = Object.freeze({
  durationMs: 3000,
  fps: 30,
  bitrate: 8_000_000,
  maxBitrate: 48_000_000,
  maxWidth: 7680,
  maxHeight: 4320,
  maxSourceWidth: 8256,
  maxSourceHeight: 5504,
  mp4Codec: 'avc1.42002A',
  mp4Codec4k: 'avc1.640033',
  mp4Codec8k: 'avc1.64003E',
  mp4Codec8kBaseline: 'avc1.42003E',
  mp4FileName: 'task-overlay-video.mp4',
  webmMimeType: 'video/webm;codecs=vp9',
  webmFileName: 'task-overlay-video.webm',
});

// Particle defaults are deliberately conservative so the effect stays subtle at 1080p
// and does not grow without bound for large source canvases.
const PARTICLE_DEFAULTS = Object.freeze({
  density: 1 / 30_000,
  minCount: 12,
  maxCount: 96,
  seed: 0x6d2b79f5,
});

function clampOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return DEFAULTS.overlayOpacity;
  }
  return Math.min(1, Math.max(0, number));
}

function clampProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.min(1, Math.max(0, number));
}

function easeOutCubic(value) {
  const progress = clampProgress(value);
  return 1 - Math.pow(1 - progress, 3);
}

function easeInOutCubic(value) {
  const progress = clampProgress(value);
  return progress < 0.5
    ? 4 * Math.pow(progress, 3)
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function easeOutBack(value) {
  const progress = clampProgress(value);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(progress - 1, 3) + c1 * Math.pow(progress - 1, 2);
}

function rangeProgress(progress, start, end) {
  if (end <= start) {
    return clampProgress(progress >= end ? 1 : 0);
  }
  return clampProgress((clampProgress(progress) - start) / (end - start));
}

function pulseProgress(progress, start, end) {
  const pulse = rangeProgress(progress, start, end);
  if (pulse <= 0 || pulse >= 1) {
    return 0;
  }
  return Math.pow(Math.sin(pulse * Math.PI), 1.35);
}

function getAnimatedOverlayState(progress) {
  const clamped = clampProgress(progress);
  return {
    progress: clamped,
    overlayAlpha: easeOutCubic(rangeProgress(clamped, 0, 0.22)),
    emblemAlpha: easeOutCubic(rangeProgress(clamped, 0.05, 0.38)),
    emblemScale: 0.76 + easeOutBack(rangeProgress(clamped, 0.06, 0.44)) * 0.24,
    emblemFlash: pulseProgress(clamped, 0.16, 0.4),
    emblemRingProgress: easeOutCubic(rangeProgress(clamped, 0.04, 0.5)),
    emblemRingAlpha: pulseProgress(clamped, 0.03, 0.58),
    emblemSparkProgress: easeOutCubic(rangeProgress(clamped, 0.18, 0.6)),
    emblemSparkAlpha: pulseProgress(clamped, 0.15, 0.68),
    line1Alpha: easeOutCubic(rangeProgress(clamped, 0.28, 0.56)),
    line1OffsetY: (1 - easeOutCubic(rangeProgress(clamped, 0.28, 0.56))) * 16,
    line2Alpha: easeOutCubic(rangeProgress(clamped, 0.38, 0.66)),
    line2Scale: 0.94 + easeOutBack(rangeProgress(clamped, 0.38, 0.66)) * 0.06,
    dividerProgress: easeOutCubic(rangeProgress(clamped, 0.48, 0.72)),
    taskBandProgress: easeInOutCubic(rangeProgress(clamped, 0.68, 0.88)),
    continuationAlpha: easeInOutCubic(rangeProgress(clamped, 0.82, 0.99)),
  };
}

function normalizeParticleDimension(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return 1;
  }
  return Math.max(1, number);
}

function normalizeParticleInteger(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function normalizeParticleSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value) >>> 0;
  }

  const text = String(value ?? PARTICLE_DEFAULTS.seed);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
}

function createParticleGenerator(seed) {
  let state = normalizeParticleSeed(seed);
  return () => {
    state = (state + 1_835_511_229) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function normalizeParticleRequest(width, height, progress, options) {
  if (width && typeof width === 'object') {
    const request = { ...width };
    if (height && typeof height === 'object') {
      Object.assign(request, height);
    }
    return {
      width: request.width,
      height: request.height,
      progress: request.progress,
      options: request,
    };
  }

  if (progress && typeof progress === 'object') {
    const request = { ...progress };
    if (options && typeof options === 'object') {
      Object.assign(request, options);
    }
    return {
      width,
      height,
      progress: request.progress,
      options: request,
    };
  }

  if (options === undefined || options === null) {
    return { width, height, progress, options: {} };
  }
  if (typeof options !== 'object') {
    return { width, height, progress, options: { seed: options } };
  }
  return { width, height, progress, options };
}

function getParticleCount(width, height, options = {}) {
  const request = normalizeParticleRequest(width, height, undefined, options);
  const safeWidth = normalizeParticleDimension(request.width);
  const safeHeight = normalizeParticleDimension(request.height);
  const settings = request.options || {};
  const minCount = normalizeParticleInteger(
    settings.minCount,
    PARTICLE_DEFAULTS.minCount,
    0,
    PARTICLE_DEFAULTS.maxCount
  );
  const maxCount = Math.max(
    minCount,
    normalizeParticleInteger(settings.maxCount, PARTICLE_DEFAULTS.maxCount, minCount, 4096)
  );
  const density = Number(settings.density);
  const safeDensity = Number.isFinite(density) && density >= 0
    ? density
    : PARTICLE_DEFAULTS.density;
  const requestedCount = Number.isFinite(Number(settings.count))
    ? Number(settings.count)
    : safeWidth * safeHeight * safeDensity;
  return Math.min(maxCount, Math.max(minCount, Math.round(requestedCount)));
}

function getParticleState(width, height, progress = 1, options) {
  const request = normalizeParticleRequest(width, height, progress, options);
  const safeWidth = normalizeParticleDimension(request.width);
  const safeHeight = normalizeParticleDimension(request.height);
  const settings = request.options || {};
  const clampedProgress = clampProgress(request.progress ?? 1);
  const count = getParticleCount(safeWidth, safeHeight, settings);
  const random = createParticleGenerator(settings.seed ?? PARTICLE_DEFAULTS.seed);
  const elapsedMs = Number(settings.elapsedMs ?? settings.timeMs);
  const timeSeconds = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) / 1000 : 0;
  const scale = Math.max(0.5, Math.min(2.5, Math.min(safeWidth / 1920, safeHeight / 1080)));
  const particles = [];

  for (let index = 0; index < count; index += 1) {
    const baseX = random() * safeWidth;
    const baseY = random() * safeHeight;
    const radius = (0.65 + random() * 1.65) * scale;
    const driftX = (random() - 0.5) * safeWidth * 0.018;
    const driftY = (random() - 0.5) * safeHeight * 0.018;
    const speed = 0.12 + random() * 0.3;
    const phase = random() * Math.PI * 2;
    const revealDelay = random() * 0.28;
    const maxAlpha = 0.16 + random() * 0.34;
    const twinkle = 0.72 + random() * 0.28;
    const revealProgress = revealDelay >= 1
      ? 1
      : rangeProgress(clampedProgress, revealDelay, Math.min(1, revealDelay + 0.28));
    const revealAlpha = clampedProgress <= 0 ? 0 : easeOutCubic(revealProgress);
    const pulse = 0.88 + Math.sin(phase + timeSeconds * speed) * 0.12;
    const alpha = maxAlpha * revealAlpha * pulse;
    const driftPhase = phase + timeSeconds * speed;

    particles.push({
      x: Math.min(safeWidth, Math.max(0, baseX + Math.sin(driftPhase) * driftX)),
      y: Math.min(safeHeight, Math.max(0, baseY + Math.cos(driftPhase * 0.87) * driftY)),
      radius,
      alpha,
      maxAlpha,
      twinkle,
      phase,
      driftX,
      driftY,
      speed,
    });
  }

  return {
    width: safeWidth,
    height: safeHeight,
    progress: clampedProgress,
    elapsedMs: timeSeconds * 1000,
    count,
    particles,
  };
}

function getVideoExportSettings() {
  return { ...VIDEO_EXPORT_SETTINGS };
}

function makeEvenDimension(value) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function fitSizeWithin(width, height, maxWidth, maxHeight) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const scale = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight);
  return {
    width: makeEvenDimension(safeWidth * scale),
    height: makeEvenDimension(safeHeight * scale),
  };
}

function getVideoCanvasSize(mode, media) {
  const requested = getCanvasSize(mode, media);
  const maxWidth = mode === 'source'
    ? VIDEO_EXPORT_SETTINGS.maxSourceWidth
    : VIDEO_EXPORT_SETTINGS.maxWidth;
  const maxHeight = mode === 'source'
    ? VIDEO_EXPORT_SETTINGS.maxSourceHeight
    : VIDEO_EXPORT_SETTINGS.maxHeight;
  return fitSizeWithin(
    requested.width,
    requested.height,
    maxWidth,
    maxHeight
  );
}

function getVideoBitrate(width, height) {
  const basePixels = DEFAULTS.outputWidth * DEFAULTS.outputHeight;
  const outputPixels = Math.max(1, Number(width) * Number(height));
  const scale = Math.sqrt(outputPixels / basePixels);
  return Math.round(Math.min(
    VIDEO_EXPORT_SETTINGS.maxBitrate,
    Math.max(VIDEO_EXPORT_SETTINGS.bitrate, VIDEO_EXPORT_SETTINGS.bitrate * scale)
  ));
}

function getMp4CodecCandidates(width, height) {
  if (width > 3840 || height > 2160) {
    return [VIDEO_EXPORT_SETTINGS.mp4Codec8k, VIDEO_EXPORT_SETTINGS.mp4Codec8kBaseline];
  }
  if (width > 1920 || height > 1080) {
    return [VIDEO_EXPORT_SETTINGS.mp4Codec4k, VIDEO_EXPORT_SETTINGS.mp4Codec];
  }
  return [VIDEO_EXPORT_SETTINGS.mp4Codec];
}

function getTimelineProgress(elapsedMs, durationMs, mediaType = 'image') {
  const total = Math.max(1, Number(durationMs) || VIDEO_EXPORT_SETTINGS.durationMs);
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (mediaType === 'video') {
    const animationStart = Math.max(0, total - VIDEO_EXPORT_SETTINGS.durationMs);
    return clampProgress((elapsed - animationStart) / VIDEO_EXPORT_SETTINGS.durationMs);
  }
  return clampProgress(elapsed / VIDEO_EXPORT_SETTINGS.durationMs);
}

function normalizeEmblem(value) {
  return EMBLEM_KEYS.includes(value) ? value : DEFAULTS.emblem;
}

function getMediaDimensions(media) {
  if (media?.videoWidth > 0 && media?.videoHeight > 0) {
    return {
      width: Math.round(media.videoWidth),
      height: Math.round(media.videoHeight),
    };
  }
  if (media?.width > 0 && media?.height > 0) {
    return {
      width: Math.round(media.width),
      height: Math.round(media.height),
    };
  }
  return null;
}

function getCanvasSize(mode, media) {
  const dimensions = getMediaDimensions(media);
  if (mode === 'source' && dimensions) {
    return dimensions;
  }
  const preset = OUTPUT_SIZES[mode] || OUTPUT_SIZES[DEFAULTS.mode];
  return { ...preset };
}

function getCoverRect(imageWidth, imageHeight, canvasWidth, canvasHeight) {
  const scale = Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const dw = imageWidth * scale;
  const dh = imageHeight * scale;
  return {
    dx: (canvasWidth - dw) / 2,
    dy: (canvasHeight - dh) / 2,
    dw,
    dh,
  };
}

function createRenderState(overrides = {}) {
  const emblemFlashIntensity = Number(overrides.emblemFlashIntensity ?? DEFAULTS.emblemFlashIntensity);
  const panelOpacity = Number(overrides.panelOpacity ?? DEFAULTS.panelOpacity);
  return {
    mode: overrides.mode || DEFAULTS.mode,
    emblem: normalizeEmblem(overrides.emblem),
    line1: overrides.line1 ?? DEFAULTS.line1,
    line2: overrides.line2 ?? DEFAULTS.line2,
    line3: DEFAULTS.line3,
    line4: DEFAULTS.line4,
    overlayColor: overrides.overlayColor || DEFAULTS.overlayColor,
    overlayOpacity: clampOpacity(overrides.overlayOpacity ?? DEFAULTS.overlayOpacity),
    emblemFlashIntensity: Number.isFinite(emblemFlashIntensity)
      ? Math.min(2, Math.max(0, emblemFlashIntensity))
      : DEFAULTS.emblemFlashIntensity,
    panelOpacity: Number.isFinite(panelOpacity)
      ? Math.min(1, Math.max(0, panelOpacity))
      : DEFAULTS.panelOpacity,
  };
}

function getOverlayLayout(width, height) {
  const scale = Math.min(width / OVERLAY_DESIGN.width, height / OVERLAY_DESIGN.height);
  const originY = (height - OVERLAY_DESIGN.height * scale) / 2;
  const scaled = (value) => value * scale;
  const y = (value) => originY + scaled(value);
  return {
    scale,
    cx: width / 2,
    emblemSize: scaled(OVERLAY_DESIGN.emblemSize),
    emblemY: y(OVERLAY_DESIGN.emblemY),
    line1Y: y(OVERLAY_DESIGN.line1Y),
    line1Size: scaled(OVERLAY_DESIGN.line1Size),
    line1MaxWidth: scaled(OVERLAY_DESIGN.line1MaxWidth),
    line2Y: y(OVERLAY_DESIGN.line2Y),
    line2Size: scaled(OVERLAY_DESIGN.line2Size),
    line2MaxWidth: scaled(OVERLAY_DESIGN.line2MaxWidth),
    dividerY: y(OVERLAY_DESIGN.dividerY),
    dividerWidth: scaled(OVERLAY_DESIGN.dividerWidth),
    taskBandY: y(OVERLAY_DESIGN.taskBandY),
    taskBandWidth: scaled(OVERLAY_DESIGN.taskBandWidth),
    taskBandHeight: scaled(OVERLAY_DESIGN.taskBandHeight),
    taskY: y(OVERLAY_DESIGN.taskY),
    taskWidth: scaled(OVERLAY_DESIGN.taskWidth),
    bottomY: y(OVERLAY_DESIGN.bottomY),
    continuationWidth: scaled(OVERLAY_DESIGN.continuationWidth),
    continuationGlowHeight: scaled(OVERLAY_DESIGN.continuationGlowHeight),
    continuationPanelWidth: scaled(OVERLAY_DESIGN.continuationPanelWidth),
    continuationPanelHeight: scaled(OVERLAY_DESIGN.continuationPanelHeight),
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    DEFAULTS,
    EMBLEM_KEYS,
    OUTPUT_SIZES,
    PARTICLE_DEFAULTS,
    clampOpacity,
    clampProgress,
    createRenderState,
    getAnimatedOverlayState,
    getParticleCount,
    getParticleState,
    getMediaDimensions,
    getMp4CodecCandidates,
    getTimelineProgress,
    getVideoBitrate,
    getVideoCanvasSize,
    getVideoExportSettings,
    getOverlayLayout,
    getCanvasSize,
    getCoverRect,
    normalizeEmblem,
  };
}
