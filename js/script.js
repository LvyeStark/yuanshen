(function () {
  const EMBLEM_ASSETS = Object.freeze({
    mengdei: { label: '蒙德', src: 'assets/mengdei.png', previewSrc: 'assets/preview/mengdei.png' },
    liyue: { label: '璃月', src: 'assets/liyue.png', previewSrc: 'assets/preview/liyue.png' },
    daoqi: { label: '稻妻', src: 'assets/daoqi.png', previewSrc: 'assets/preview/daoqi.png' },
    xuni: { label: '须弥', src: 'assets/xuni.png', previewSrc: 'assets/preview/xuni.png' },
    fengdan: { label: '枫丹', src: 'assets/fengdan.png', previewSrc: 'assets/preview/fengdan.png' },
    nata: { label: '纳塔', src: 'assets/nata.png', previewSrc: 'assets/preview/nata.png' },
    nuodekalai: { label: '空月之歌', src: 'assets/nuodekalai.png', previewSrc: 'assets/preview/nuodekalai.png' },
    zhidong: { label: '至冬', src: 'assets/zhidong.png', previewSrc: 'assets/preview/zhidong.png' },
    dachishahai: { label: '大赤沙海', src: 'assets/dachishahai.png', previewSrc: 'assets/preview/dachishahai.png' },
    chenyugu: { label: '沉玉谷', src: 'assets/chenyugu.png', previewSrc: 'assets/preview/chenyugu.png' },
    youyoudujiacun: { label: '悠悠度假村', src: 'assets/youyoudujiacun.png', previewSrc: 'assets/preview/youyoudujiacun.png' },
    kongzhishendian: { label: '空之神殿', src: 'assets/kongzhishendian.png', previewSrc: 'assets/preview/kongzhishendian.png' },
    huanxiangzhenjinjushi: { label: '幻想真境剧诗', src: 'assets/huanxiangzhenjinjushi.png', previewSrc: 'assets/preview/huanxiangzhenjinjushi.png' },
  });
  const PREVIEW_EMBLEM_ASSETS = Object.freeze(Object.fromEntries(
    Object.entries(EMBLEM_ASSETS).map(([key, { label, previewSrc }]) => [key, { label, src: previewSrc }])
  ));
  const CONTINUATION_PATH = 'assets/weiwandaixu-clean.png';

  const imageInput = document.getElementById('imageInput');
  const line1Input = document.getElementById('line1Input');
  const line2Input = document.getElementById('line2Input');
  const overlayColorInput = document.getElementById('overlayColorInput');
  const overlayOpacityInput = document.getElementById('overlayOpacityInput');
  const opacityValue = document.getElementById('opacityValue');
  const emblemFlashInput = document.getElementById('emblemFlashInput');
  const emblemFlashValue = document.getElementById('emblemFlashValue');
  const emblemEffectSelect = document.getElementById('emblemEffectSelect');
  const emblemEntranceSelect = document.getElementById('emblemEntranceSelect');
  const panelOpacityInput = document.getElementById('panelOpacityInput');
  const panelOpacityValue = document.getElementById('panelOpacityValue');
  const emblemPicker = document.getElementById('emblemPicker');
  const previewAnimationButton = document.getElementById('previewAnimationButton');
  const exportButton = document.getElementById('exportButton');
  const statusText = document.getElementById('statusText');
  const downloadLink = document.getElementById('downloadLink');
  const importLivePhotoButton = document.getElementById('importLivePhotoButton');
  const canvasSize = document.getElementById('canvasSize');
  const canvas = document.getElementById('previewCanvas');
  const ctx = canvas.getContext('2d');
  const videoSettings = getVideoExportSettings();
  const MOTION_PRESETS = Object.freeze({
    off: Object.freeze({ strength: 0, particleCount: 0, streakCount: 0 }),
    soft: Object.freeze({ strength: 0.58, particleCount: 22, streakCount: 4 }),
    full: Object.freeze({ strength: 1, particleCount: 36, streakCount: 7 }),
  });

  const overlayAssets = {
    previewEmblems: {},
    highResEmblems: {},
    continuation: null,
  };
  let uploadedMedia = null;
  let uploadedMediaType = 'image';
  let uploadedMediaName = '';
  let uploadedSourceFile = null;
  let activityMessage = statusText.textContent;
  let assetWarning = '';
  let highResMessage = '';
  let previewAnimationFrame = null;
  let autoplayTestPreview = false;
  let videoCanvasSize = null;
  let activeDownloadUrl = '';
  let livePhotoImportUrl = '';

  function updateStatusText() {
    statusText.textContent = [activityMessage, highResMessage, assetWarning].filter(Boolean).join(' ');
  }

  const highResLoadState = {
    active: false,
    startedAt: 0,
    total: EMBLEM_KEYS.length,
    completed: 0,
    failed: 0,
  };

  function estimateHighResRemainingSeconds() {
    const remaining = Math.max(0, highResLoadState.total - highResLoadState.completed);
    if (remaining === 0) {
      return 0;
    }
    const elapsedSeconds = Math.max(0.5, (Date.now() - highResLoadState.startedAt) / 1000);
    const finished = highResLoadState.completed + highResLoadState.failed;
    if (finished === 0) {
      return Math.max(2, remaining * 2);
    }
    return Math.max(1, Math.ceil((elapsedSeconds / finished) * remaining));
  }

  function updateHighResMessage() {
    if (!highResLoadState.active) {
      highResMessage = '';
      updateStatusText();
      return;
    }
    if (highResLoadState.completed >= highResLoadState.total) {
      highResMessage = '高清大图标已加载完成，可导出高清图。';
      updateStatusText();
      return;
    }
    const remainingSeconds = estimateHighResRemainingSeconds();
    highResMessage = `高清大图标加载中：${highResLoadState.completed}/${highResLoadState.total}，预计约 ${remainingSeconds} 秒内完成。`;
    updateStatusText();
  }

  function currentMode() {
    return document.querySelector('input[name="sizeMode"]:checked')?.value || DEFAULTS.mode;
  }

  function selectedExportMode() {
    return document.querySelector('input[name="exportMode"]:checked')?.value || 'image';
  }

  function currentMotionMode() {
    const requested = document.querySelector('input[name="motionMode"]:checked')?.value || 'soft';
    return Object.hasOwn(MOTION_PRESETS, requested) ? requested : 'soft';
  }

  function currentEmblemEffect() {
    return normalizeEmblemEffect(emblemEffectSelect?.value || DEFAULTS.emblemEffect);
  }

  function currentEmblemEntrance() {
    return normalizeEmblemEntrance(emblemEntranceSelect?.value || DEFAULTS.emblemEntrance);
  }

  function getSelectedEmblem() {
    return emblemPicker.querySelector('input[name="emblem"]:checked')?.value || DEFAULTS.emblem;
  }

  function setSelectedEmblem(key) {
    const target = emblemPicker.querySelector(`input[name="emblem"][value="${key}"]`);
    if (!target || target.disabled) {
      return;
    }
    for (const input of emblemPicker.querySelectorAll('input[name="emblem"]')) {
      input.checked = input === target;
    }
  }

  function disableEmblemOption(key) {
    const input = emblemPicker.querySelector(`input[name="emblem"][value="${key}"]`);
    if (input) {
      input.disabled = true;
    }
  }

  function currentState() {
    return createRenderState({
      mode: currentMode(),
      emblem: getSelectedEmblem(),
      emblemEffect: currentEmblemEffect(),
      emblemEntrance: currentEmblemEntrance(),
      line1: line1Input.value.trim() || DEFAULTS.line1,
      line2: line2Input.value.trim() || DEFAULTS.line2,
      overlayColor: overlayColorInput.value,
      overlayOpacity: overlayOpacityInput.value,
      emblemFlashIntensity: emblemFlashInput.value,
      panelOpacity: panelOpacityInput.value,
    });
  }

  function resizeCanvas(state) {
    const size = videoCanvasSize || getCanvasSize(state.mode, uploadedMedia);
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    canvas.style.aspectRatio = `${size.width} / ${size.height}`;
    if (canvasSize) {
      canvasSize.textContent = `${size.width} x ${size.height}`;
    }
  }

  function render(options = {}) {
    const state = currentState();
    const emblems = options.emblems || overlayAssets.previewEmblems;
    const animation = getAnimatedOverlayState(options.progress ?? 1);
    const motionMode = options.motionMode || currentMotionMode();
    const elapsedMs = Number.isFinite(options.elapsedMs)
      ? Math.max(0, options.elapsedMs)
      : animation.progress * videoSettings.durationMs;
    const staticFrame = options.staticFrame ?? options.progress === undefined;
    resizeCanvas(state);
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    if (uploadedMedia) {
      drawMediaFrame(uploadedMedia, width, height);
    } else {
      drawPlaceholder(width, height);
    }

    ctx.fillStyle = colorToRgba(state.overlayColor, state.overlayOpacity * animation.overlayAlpha);
    ctx.fillRect(0, 0, width, height);
    drawVignette(width, height, animation.overlayAlpha);
    drawParticleField(width, height, animation, elapsedMs, motionMode, staticFrame);
    drawCenterOverlay(state, width, height, emblems, animation);
  }

  function drawMediaFrame(media, width, height) {
    const dimensions = getMediaDimensions(media);
    if (!dimensions) {
      drawPlaceholder(width, height);
      return;
    }
    const rect = getCoverRect(dimensions.width, dimensions.height, width, height);
    ctx.drawImage(media, rect.dx, rect.dy, rect.dw, rect.dh);
  }

  function drawPlaceholder(width, height) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#202634');
    gradient.addColorStop(1, '#18130f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function drawVignette(width, height, alpha = 1) {
    const gradient = ctx.createRadialGradient(
      width * 0.5,
      height * 0.42,
      width * 0.08,
      width * 0.5,
      height * 0.48,
      width * 0.62
    );
    gradient.addColorStop(0, 'rgba(255, 196, 92, 0.08)');
    gradient.addColorStop(0.52, 'rgba(0, 0, 0, 0.04)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  function drawParticleField(width, height, animation, elapsedMs, motionMode, staticFrame) {
    const preset = MOTION_PRESETS[motionMode] || MOTION_PRESETS.soft;
    if (preset.particleCount <= 0 || preset.strength <= 0) {
      return;
    }

    const count = staticFrame ? Math.min(5, preset.particleCount) : preset.particleCount;
    const particleState = getParticleState(width, height, animation.progress, {
      seed: `overlay-${motionMode}`,
      elapsedMs: staticFrame ? videoSettings.durationMs : elapsedMs,
      count,
      minCount: count,
      maxCount: count,
    });
    const reveal = Math.min(1, animation.progress / 0.96);
    const revealEase = 1 - Math.pow(1 - reveal, 3);
    const centerX = width * 0.5;
    const centerY = height * 0.31;
    const scale = Math.max(0.6, Math.min(2, Math.min(width / 1920, height / 1080)));

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let index = 0; index < particleState.particles.length; index += 1) {
      const particle = particleState.particles[index];
      const targetX = particle.x;
      const targetY = particle.y;
      const x = centerX + (targetX - centerX) * (0.16 + revealEase * 0.84);
      const y = centerY + (targetY - centerY) * (0.16 + revealEase * 0.84);
      const normalizedX = Math.abs(x / width - 0.5);
      const normalizedY = y / height;
      const textSafeZone = normalizedX < 0.25 && normalizedY > 0.27 && normalizedY < 0.62;
      const safeZoneAlpha = textSafeZone ? 0.16 : 1;
      const finalAlpha = particle.alpha * preset.strength * safeZoneAlpha * (staticFrame ? 0.42 : 0.82);
      if (finalAlpha <= 0.002) {
        continue;
      }

      ctx.globalAlpha = finalAlpha;
      ctx.fillStyle = index % 5 === 0 ? '#b8d7ff' : '#ead7aa';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.8, particle.radius * (index % 7 === 0 ? 1.45 : 1)), 0, Math.PI * 2);
      ctx.fill();
    }

    if (!staticFrame) {
      drawParticleStreaks(particleState, width, height, animation.progress, preset, scale);
      drawDividerGlint(width, height, animation.progress, preset.strength, scale);
    }
    ctx.restore();
  }

  function drawParticleStreaks(particleState, width, height, progress, preset, scale) {
    const streakProgress = clampProgress((progress - 0.08) / 0.68);
    const streakAlpha = Math.sin(streakProgress * Math.PI) * preset.strength;
    if (streakAlpha <= 0.002) {
      return;
    }

    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, scale * 1.2);
    for (let index = 0; index < preset.streakCount; index += 1) {
      const particle = particleState.particles[index * 2];
      if (!particle) {
        continue;
      }
      const direction = index % 2 === 0 ? 1 : -1;
      const length = (20 + index * 5) * scale;
      const x = width * 0.5 + (particle.x - width * 0.5) * streakProgress;
      const y = height * 0.3 + (particle.y - height * 0.3) * streakProgress;
      ctx.globalAlpha = streakAlpha * (0.12 + index * 0.018);
      ctx.strokeStyle = index % 3 === 0 ? '#b8d7ff' : '#ead7aa';
      ctx.beginPath();
      ctx.moveTo(x - length * direction, y + length * 0.18);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }

  function drawDividerGlint(width, height, progress, strength, scale) {
    const glintProgress = clampProgress((progress - 0.58) / 0.32);
    if (glintProgress <= 0 || glintProgress >= 1) {
      return;
    }

    const lineWidth = width * 0.34;
    const x = width * 0.5 - lineWidth * 0.5 + lineWidth * glintProgress;
    const y = height * 0.49;
    const glow = ctx.createLinearGradient(x - 44 * scale, y, x + 44 * scale, y);
    glow.addColorStop(0, 'rgba(234, 215, 170, 0)');
    glow.addColorStop(0.5, `rgba(255, 246, 218, ${0.48 * strength})`);
    glow.addColorStop(1, 'rgba(234, 215, 170, 0)');
    ctx.globalAlpha = Math.sin(glintProgress * Math.PI);
    ctx.fillStyle = glow;
    ctx.fillRect(x - 44 * scale, y - scale, 88 * scale, Math.max(1, scale * 2));
  }

  function drawCenterOverlay(state, width, height, emblems, animation = getAnimatedOverlayState(1)) {
    const layout = getOverlayLayout(width, height);
    const {
      cx,
      emblemSize,
      emblemY,
      line1Y,
      line1Size,
      line1MaxWidth,
      line2Y,
      line2Size,
      line2MaxWidth,
      dividerY,
      dividerWidth,
      taskBandY,
      taskBandWidth,
      taskBandHeight,
      taskY,
      taskWidth,
      bottomY,
      continuationWidth,
      continuationGlowHeight,
      continuationPanelWidth,
      continuationPanelHeight,
      scale,
    } = layout;

    const emblemEffect = resolveEmblemEffect(state.emblemEffect, state.emblem);
    const emblemMotion = getEmblemMotionState(animation.progress, state.emblemEntrance, state.emblem);
    const animatedEmblemX = cx + emblemMotion.offsetX * scale;
    const animatedEmblemY = emblemY + emblemMotion.offsetY * scale;
    const animatedEmblemSize = emblemSize * emblemMotion.scale;
    const emblemTransform = {
      rotation: emblemMotion.rotation,
      scaleX: emblemMotion.scaleX,
      scaleY: emblemMotion.scaleY,
    };
    const emblemEffectStrength = Math.max(0, state.emblemFlashIntensity);
    const compositeStrength = emblemEffect === 'ceremony' ? 0.58 : 1;
    const effectStrength = emblemEffectStrength * compositeStrength * animation.emblemAlpha;
    const emblemFlash = animation.emblemFlash * emblemEffectStrength;
    if (emblemEffect === 'smoke' || emblemEffect === 'ceremony') {
      drawEmblemSmokeRing(
        animatedEmblemX,
        animatedEmblemY,
        animatedEmblemSize,
        animation.emblemRingProgress,
        animation.emblemRingAlpha * effectStrength
      );
    }
    if (emblemEffect === 'ripple' || emblemEffect === 'ceremony') {
      drawEmblemRipples(
        animatedEmblemX,
        animatedEmblemY,
        animatedEmblemSize,
        animation.emblemEffectProgress,
        animation.emblemEffectAlpha * effectStrength
      );
    }
    if (emblemEffect === 'halo' || emblemEffect === 'ceremony') {
      drawEmblemHalo(
        animatedEmblemX,
        animatedEmblemY,
        animatedEmblemSize,
        animation.emblemEffectProgress,
        animation.emblemEffectAlpha * effectStrength
      );
    }
    if (emblemEffect === 'gather' || emblemEffect === 'ceremony') {
      drawEmblemGatherParticles(
        animatedEmblemX,
        animatedEmblemY,
        animatedEmblemSize,
        animation.emblemBurstProgress,
        animation.emblemBurstAlpha * effectStrength
      );
    }
    if (emblemEffect === 'starburst' || emblemEffect === 'ceremony') {
      drawEmblemRadialBurst(
        animatedEmblemX,
        animatedEmblemY,
        animatedEmblemSize,
        animation.emblemBurstProgress,
        animation.emblemBurstAlpha * effectStrength
      );
    }
    if (emblemEffect === 'twinkle' || emblemEffect === 'ceremony') {
      drawEmblemOrbitingTwinkles(
        animatedEmblemX,
        animatedEmblemY,
        animatedEmblemSize,
        animation.emblemEffectProgress,
        animation.emblemEffectAlpha * effectStrength
      );
    }
    drawEmblemGlow(
      animatedEmblemX,
      animatedEmblemY,
      animatedEmblemSize,
      animation.emblemAlpha,
      emblemFlash
    );
    drawLuminousEmblem(
      emblems[state.emblem],
      animatedEmblemX,
      animatedEmblemY,
      animatedEmblemSize * 1.16,
      animation.emblemAlpha,
      emblemFlash,
      emblemTransform
    );
    if (emblemEffect === 'sweep' || emblemEffect === 'ceremony') {
      drawEmblemSweep(
        emblems[state.emblem],
        animatedEmblemX,
        animatedEmblemY,
        animatedEmblemSize * 1.16,
        animation.emblemSweepProgress,
        animation.emblemSweepAlpha * effectStrength,
        emblemTransform
      );
    }
    drawEmblemFlash(
      animatedEmblemX,
      animatedEmblemY,
      animatedEmblemSize,
      emblemFlash * animation.emblemAlpha
    );
    if (emblemEffect === 'smoke' || emblemEffect === 'starburst' || emblemEffect === 'twinkle' || emblemEffect === 'ceremony') {
      drawEmblemSparkles(
        animatedEmblemX,
        animatedEmblemY,
        animatedEmblemSize,
        animation.emblemSparkProgress,
        animation.emblemSparkAlpha * effectStrength
      );
    }
    drawTextLine(
      state.line1,
      cx,
      line1Y + animation.line1OffsetY * scale,
      line1Size,
      600,
      '#efe5d1',
      0.95 * animation.line1Alpha,
      line1MaxWidth,
      { variant: 'eyebrow' }
    );
    drawTextLine(
      state.line2,
      cx,
      line2Y,
      line2Size,
      720,
      '#fffaf2',
      animation.line2Alpha,
      line2MaxWidth,
      { scale: animation.line2Scale, variant: 'title' }
    );
    drawOrnamentDivider(cx, dividerY, dividerWidth * animation.dividerProgress, scale, animation.dividerProgress);
    drawTaskBand(
      cx,
      taskBandY,
      taskBandWidth * animation.taskBandProgress,
      taskBandHeight,
      state.panelOpacity * animation.taskBandProgress
    );
    drawTaskCompleteText(state.line3, cx, taskY, taskWidth, animation.taskBandProgress);
    drawTaskBand(
      cx,
      bottomY,
      continuationPanelWidth * animation.continuationAlpha,
      continuationPanelHeight,
      state.panelOpacity * animation.continuationAlpha,
      'continuation'
    );
    drawTaskGlow(cx, bottomY, continuationWidth * 1.05, continuationGlowHeight, '#d7bb86', 0.14 * animation.continuationAlpha);
    drawCenteredAsset(overlayAssets.continuation, cx, bottomY, continuationWidth, null, 0.9 * animation.continuationAlpha);
  }

  function drawEmblemSmokeRing(cx, cy, size, progress, strength) {
    if (progress <= 0 || strength <= 0) {
      return;
    }
    const alpha = Math.min(1.25, strength);
    const radius = size * (0.42 + progress * 0.54);
    const thickness = size * (0.21 - progress * 0.055);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.min(0.92, alpha * 0.74);
    ctx.filter = `blur(${Math.max(3, size * (0.038 + progress * 0.018))}px)`;

    const ring = ctx.createRadialGradient(
      cx,
      cy,
      Math.max(0, radius - thickness),
      cx,
      cy,
      radius + thickness
    );
    ring.addColorStop(0, 'rgba(109, 57, 18, 0)');
    ring.addColorStop(0.31, 'rgba(146, 79, 25, 0.1)');
    ring.addColorStop(0.5, 'rgba(238, 183, 91, 0.48)');
    ring.addColorStop(0.68, 'rgba(180, 103, 35, 0.2)');
    ring.addColorStop(1, 'rgba(105, 54, 18, 0)');
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + thickness, 0, Math.PI * 2);
    ctx.fill();

    const cloudCount = 12;
    for (let index = 0; index < cloudCount; index += 1) {
      const angle = (index / cloudCount) * Math.PI * 2 + index * 0.37;
      const drift = Math.sin(index * 2.41) * thickness * 0.32;
      const cloudRadius = thickness * (0.38 + ((index * 7) % 5) * 0.075);
      const cloudX = cx + Math.cos(angle) * (radius + drift);
      const cloudY = cy + Math.sin(angle) * (radius * 0.86 + drift);
      const cloud = ctx.createRadialGradient(cloudX, cloudY, 0, cloudX, cloudY, cloudRadius);
      cloud.addColorStop(0, `rgba(246, 191, 96, ${0.22 + (index % 3) * 0.04})`);
      cloud.addColorStop(0.48, 'rgba(181, 100, 32, 0.16)');
      cloud.addColorStop(1, 'rgba(113, 57, 18, 0)');
      ctx.fillStyle = cloud;
      ctx.beginPath();
      ctx.arc(cloudX, cloudY, cloudRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEmblemRipples(cx, cy, size, progress, strength) {
    if (progress <= 0 || strength <= 0) {
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineWidth = Math.max(1, size * 0.012);
    for (let index = 0; index < 3; index += 1) {
      const phase = clampProgress(progress * 1.34 - index * 0.19);
      if (phase <= 0 || phase >= 1) {
        continue;
      }
      const radius = size * (0.3 + phase * 0.78);
      ctx.globalAlpha = Math.min(1, strength) * Math.pow(1 - phase, 1.35) * (0.72 - index * 0.1);
      ctx.strokeStyle = index === 1 ? '#fff0bd' : '#d8a852';
      ctx.shadowColor = 'rgba(235, 181, 81, 0.72)';
      ctx.shadowBlur = Math.max(3, size * 0.045);
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius, radius * (0.82 + index * 0.025), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEmblemHalo(cx, cy, size, progress, strength) {
    if (progress <= 0 || strength <= 0) {
      return;
    }
    const eased = clampProgress(progress);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 221, 137, 0.7)';
    ctx.shadowBlur = Math.max(4, size * 0.05);
    for (let index = 0; index < 2; index += 1) {
      const radius = size * (0.58 + index * 0.17);
      const rotation = (index === 0 ? 1 : -1) * eased * Math.PI * 1.65 + index * 0.7;
      ctx.globalAlpha = Math.min(1, strength) * (0.82 - index * 0.2);
      ctx.strokeStyle = index === 0 ? '#ffe8ac' : '#c9913f';
      ctx.lineWidth = Math.max(1.1, size * (0.014 - index * 0.003));
      ctx.setLineDash([size * (0.2 - index * 0.035), size * (0.11 + index * 0.03)]);
      ctx.lineDashOffset = -eased * size * (1.9 + index * 0.5);
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius, radius * 0.78, rotation * 0.08, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawEmblemRadialBurst(cx, cy, size, progress, strength) {
    if (progress <= 0 || strength <= 0) {
      return;
    }
    const eased = clampProgress(progress);
    const rayCount = 16;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 229, 166, 0.78)';
    ctx.shadowBlur = Math.max(3, size * 0.032);
    for (let index = 0; index < rayCount; index += 1) {
      const angle = (index / rayCount) * Math.PI * 2 + eased * 0.16;
      const longRay = index % 4 === 0;
      const inner = size * (0.48 + eased * 0.08);
      const outer = size * ((longRay ? 1.06 : 0.82) + eased * (longRay ? 0.32 : 0.2));
      ctx.globalAlpha = Math.min(1, strength) * (longRay ? 0.72 : 0.34) * (1 - eased * 0.32);
      ctx.strokeStyle = longRay ? '#fff4cc' : '#d6a24b';
      ctx.lineWidth = Math.max(1, size * (longRay ? 0.012 : 0.006));
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner * 0.86);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer * 0.86);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEmblemGatherParticles(cx, cy, size, progress, strength) {
    if (progress <= 0 || strength <= 0) {
      return;
    }
    const eased = clampProgress(progress);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.shadowColor = 'rgba(255, 217, 132, 0.8)';
    ctx.shadowBlur = Math.max(3, size * 0.04);
    for (let index = 0; index < 18; index += 1) {
      const angle = index * 2.399963229728653 + 0.42;
      const startDistance = size * (1.15 + (index % 5) * 0.12);
      const endDistance = size * (0.42 + (index % 3) * 0.045);
      const distance = startDistance + (endDistance - startDistance) * eased;
      const spiral = angle + (1 - eased) * (index % 2 === 0 ? 0.58 : -0.58);
      const x = cx + Math.cos(spiral) * distance;
      const y = cy + Math.sin(spiral) * distance * 0.75;
      const particleSize = size * (0.012 + (index % 4) * 0.005) * (0.7 + eased * 0.55);
      ctx.globalAlpha = Math.min(1, strength) * (0.45 + (index % 4) * 0.1);
      drawFilledDiamond(x, y, particleSize, index % 5 === 0 ? '#fff3c7' : '#d5a24d');
    }
    ctx.restore();
  }

  function drawEmblemOrbitingTwinkles(cx, cy, size, progress, strength) {
    if (progress <= 0 || strength <= 0) {
      return;
    }
    const eased = clampProgress(progress);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.shadowColor = 'rgba(255, 235, 184, 0.9)';
    ctx.shadowBlur = Math.max(3, size * 0.045);
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2 + eased * Math.PI * 1.45;
      const orbit = size * (0.64 + (index % 3) * 0.12);
      const x = cx + Math.cos(angle) * orbit;
      const y = cy + Math.sin(angle) * orbit * 0.68;
      const flicker = 0.42 + Math.pow(Math.sin((eased * 5.5 + index * 0.73) * Math.PI), 2) * 0.58;
      ctx.globalAlpha = Math.min(1, strength) * flicker;
      const sparkleSize = size * (0.012 + (index % 4) * 0.006);
      drawFourPointStar(x, y, sparkleSize, index % 3 === 0 ? '#fff8dc' : '#dfb35c');
    }
    ctx.restore();
  }

  function drawFourPointStar(cx, cy, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 1.9);
    ctx.lineTo(cx + size * 0.34, cy - size * 0.34);
    ctx.lineTo(cx + size * 1.9, cy);
    ctx.lineTo(cx + size * 0.34, cy + size * 0.34);
    ctx.lineTo(cx, cy + size * 1.9);
    ctx.lineTo(cx - size * 0.34, cy + size * 0.34);
    ctx.lineTo(cx - size * 1.9, cy);
    ctx.lineTo(cx - size * 0.34, cy - size * 0.34);
    ctx.closePath();
    ctx.fill();
  }

  function drawEmblemSweep(asset, cx, cy, height, progress, strength, transform = {}) {
    if (!asset || progress <= 0 || strength <= 0) {
      return;
    }
    const metrics = getAssetDrawMetrics(asset, cx, cy, null, height);
    if (!metrics) {
      return;
    }
    const padding = Math.max(12, Math.max(metrics.drawWidth, metrics.drawHeight) * 0.08);
    const layer = document.createElement('canvas');
    layer.width = Math.ceil(metrics.drawWidth + padding * 2);
    layer.height = Math.ceil(metrics.drawHeight + padding * 2);
    const layerCtx = layer.getContext('2d');
    layerCtx.drawImage(
      metrics.source,
      metrics.bounds.x,
      metrics.bounds.y,
      metrics.bounds.width,
      metrics.bounds.height,
      padding,
      padding,
      metrics.drawWidth,
      metrics.drawHeight
    );
    layerCtx.globalCompositeOperation = 'source-in';
    const bandWidth = layer.width * 0.34;
    const bandX = -bandWidth + (layer.width + bandWidth * 2) * clampProgress(progress);
    const sweep = layerCtx.createLinearGradient(bandX - bandWidth, layer.height, bandX + bandWidth, 0);
    sweep.addColorStop(0, 'rgba(255, 236, 178, 0)');
    sweep.addColorStop(0.38, 'rgba(255, 245, 213, 0.18)');
    sweep.addColorStop(0.5, 'rgba(255, 255, 247, 1)');
    sweep.addColorStop(0.62, 'rgba(255, 225, 146, 0.34)');
    sweep.addColorStop(1, 'rgba(255, 211, 111, 0)');
    layerCtx.fillStyle = sweep;
    layerCtx.fillRect(0, 0, layer.width, layer.height);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.min(1, strength);
    ctx.filter = `brightness(1.4) blur(${Math.max(0.5, height * 0.006)}px)`;
    drawEmblemLayer(layer, cx, cy, transform);
    ctx.restore();
  }

  function drawEmblemGlow(cx, cy, size, alpha = 1, flash = 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha * (1 + flash * 0.28));
    const radius = size * (0.76 + Math.min(1.5, flash) * 0.28);
    const glow = ctx.createRadialGradient(cx, cy, size * 0.06, cx, cy, radius);
    glow.addColorStop(0, `rgba(255, 246, 218, ${0.34 + Math.min(1, flash) * 0.28})`);
    glow.addColorStop(0.42, `rgba(218, 183, 112, ${0.2 + Math.min(1, flash) * 0.16})`);
    glow.addColorStop(1, 'rgba(201, 169, 110, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEmblemLayer(layer, cx, cy, transform = {}) {
    ctx.translate(cx, cy);
    if (transform.rotation) {
      ctx.rotate(transform.rotation);
    }
    const scaleX = Number.isFinite(transform.scaleX) ? transform.scaleX : 1;
    const scaleY = Number.isFinite(transform.scaleY) ? transform.scaleY : 1;
    ctx.scale(scaleX, scaleY);
    ctx.drawImage(layer, -layer.width / 2, -layer.height / 2);
  }

  function drawLuminousEmblem(asset, cx, cy, height, alpha = 1, flash = 0, transform = {}) {
    if (!asset) {
      return;
    }
    drawEmblemBacklight(asset, cx, cy, null, height, alpha, flash, transform);
    drawGoldEmblemMask(asset, cx, cy, null, height, alpha, flash, transform);
  }

  function drawEmblemBacklight(
    asset,
    cx,
    cy,
    targetWidth,
    targetHeight,
    alpha = 1,
    flash = 0,
    transform = {}
  ) {
    const metrics = getAssetDrawMetrics(asset, cx, cy, targetWidth, targetHeight);
    const layer = createEmblemMaskLayer(metrics, [
      [0, 'rgba(255, 239, 198, 0.78)'],
      [0.46, 'rgba(224, 183, 96, 0.72)'],
      [1, 'rgba(161, 112, 42, 0.18)'],
    ]);
    if (!layer) {
      return;
    }

    ctx.save();
    ctx.globalAlpha = Math.min(1, (0.78 + flash * 0.22) * alpha);
    ctx.filter = `blur(${4 + Math.min(2, flash) * 8}px)`;
    ctx.globalCompositeOperation = 'screen';
    drawEmblemLayer(layer.canvas, cx, cy, transform);
    ctx.restore();
  }

  function drawGoldEmblemMask(
    asset,
    cx,
    cy,
    targetWidth,
    targetHeight,
    alpha = 1,
    flash = 0,
    transform = {}
  ) {
    const metrics = getAssetDrawMetrics(asset, cx, cy, targetWidth, targetHeight);
    const layer = createEmblemMaskLayer(metrics, [
      [0, '#FFF2C8'],
      [0.42, '#F8E7B8'],
      [0.82, '#E8CB8A'],
      [0.96, '#C9A96E'],
      [1, '#8A672E'],
    ]);
    if (!layer) {
      return;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = 'drop-shadow(0 0 10px rgba(201, 169, 110, 0.6))';
    drawEmblemLayer(layer.canvas, cx, cy, transform);
    ctx.restore();

    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.82, flash * 0.56) * alpha;
      ctx.globalCompositeOperation = 'screen';
      ctx.filter = `brightness(${1.25 + Math.min(2, flash) * 0.6}) blur(${Math.min(4, flash * 2)}px)`;
      drawEmblemLayer(layer.canvas, cx, cy, transform);
      ctx.restore();
    }
  }

  function drawEmblemFlash(cx, cy, size, strength) {
    if (strength <= 0) {
      return;
    }
    const normalized = Math.min(1, strength);
    const radius = size * (0.95 + normalized * 0.4);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = normalized * 0.88;

    const burst = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    burst.addColorStop(0, 'rgba(255, 255, 242, 0.72)');
    burst.addColorStop(0.16, 'rgba(255, 238, 186, 0.38)');
    burst.addColorStop(0.58, 'rgba(226, 185, 102, 0.12)');
    burst.addColorStop(1, 'rgba(226, 185, 102, 0)');
    ctx.fillStyle = burst;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    const streak = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
    streak.addColorStop(0, 'rgba(255, 246, 216, 0)');
    streak.addColorStop(0.46, 'rgba(255, 249, 226, 0.08)');
    streak.addColorStop(0.5, 'rgba(255, 255, 246, 0.8)');
    streak.addColorStop(0.54, 'rgba(255, 249, 226, 0.08)');
    streak.addColorStop(1, 'rgba(255, 246, 216, 0)');
    ctx.fillStyle = streak;
    ctx.fillRect(cx - radius, cy - Math.max(1, size * 0.012), radius * 2, Math.max(2, size * 0.024));
    ctx.restore();
  }

  function drawEmblemSparkles(cx, cy, size, progress, strength) {
    if (progress <= 0 || strength <= 0) {
      return;
    }
    const alpha = Math.min(1, strength);
    const sideDistance = size * (0.5 + progress * 0.48);
    const glintWidth = size * (0.22 + progress * 0.18);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(255, 224, 153, 0.72)';
    ctx.shadowBlur = Math.max(4, size * 0.045);

    for (const direction of [-1, 1]) {
      const glintX = cx + sideDistance * direction;
      const glint = ctx.createLinearGradient(
        glintX - glintWidth,
        cy,
        glintX + glintWidth,
        cy
      );
      glint.addColorStop(0, 'rgba(255, 236, 188, 0)');
      glint.addColorStop(0.5, 'rgba(255, 248, 221, 0.9)');
      glint.addColorStop(1, 'rgba(255, 236, 188, 0)');
      ctx.fillStyle = glint;
      ctx.fillRect(glintX - glintWidth, cy - Math.max(1, size * 0.006), glintWidth * 2, Math.max(2, size * 0.012));
      drawFilledDiamond(glintX, cy, size * 0.035, 'rgba(255, 244, 211, 0.95)');
    }

    const sparkleAngles = [-2.78, -2.26, -1.72, -1.02, -0.38, 0.5, 1.18, 1.87, 2.55];
    sparkleAngles.forEach((angle, index) => {
      const stagger = 0.78 + (index % 4) * 0.085;
      const distance = size * (0.45 + progress * stagger);
      const x = cx + Math.cos(angle) * distance;
      const y = cy + Math.sin(angle) * distance * 0.78;
      const sparkleSize = size * (0.012 + (index % 3) * 0.007) * (0.78 + progress * 0.3);
      drawFilledDiamond(x, y, sparkleSize, index % 3 === 0 ? '#fff1c9' : '#e5b968');
    });
    ctx.restore();
  }

  function drawFilledDiamond(cx, cy, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size * 0.72, cy);
    ctx.lineTo(cx, cy + size);
    ctx.lineTo(cx - size * 0.72, cy);
    ctx.closePath();
    ctx.fill();
  }

  function createEmblemMaskLayer(metrics, colorStops) {
    if (!metrics) {
      return null;
    }
    const padding = Math.max(18, Math.max(metrics.drawWidth, metrics.drawHeight) * 0.18);
    const layerWidth = Math.ceil(metrics.drawWidth + padding * 2);
    const layerHeight = Math.ceil(metrics.drawHeight + padding * 2);
    const layer = document.createElement('canvas');
    layer.width = layerWidth;
    layer.height = layerHeight;

    const layerCtx = layer.getContext('2d');
    const offsetX = (layerWidth - metrics.drawWidth) / 2;
    const offsetY = (layerHeight - metrics.drawHeight) / 2;
    layerCtx.drawImage(
      metrics.source,
      metrics.bounds.x,
      metrics.bounds.y,
      metrics.bounds.width,
      metrics.bounds.height,
      offsetX,
      offsetY,
      metrics.drawWidth,
      metrics.drawHeight
    );

    layerCtx.globalCompositeOperation = 'source-in';
    const radius = Math.max(metrics.drawWidth, metrics.drawHeight) * 0.62;
    const gradient = layerCtx.createRadialGradient(
      layerWidth * 0.5,
      layerHeight * 0.38,
      radius * 0.05,
      layerWidth * 0.5,
      layerHeight * 0.52,
      radius
    );
    for (const [offset, color] of colorStops) {
      gradient.addColorStop(offset, color);
    }
    layerCtx.fillStyle = gradient;
    layerCtx.fillRect(0, 0, layerWidth, layerHeight);

    return {
      canvas: layer,
      width: layerWidth,
      height: layerHeight,
    };
  }

  function drawOrnamentDivider(cx, cy, width, scale, progress = 1) {
    if (width <= 0 || progress <= 0) {
      return;
    }
    const lineGap = width * 0.075;
    const diamond = 20.52 * scale * clampProgress(progress);
    const lineY = cy;
    const leftStart = cx - width / 2;
    const leftEnd = cx - lineGap;
    const rightStart = cx + lineGap;
    const rightEnd = cx + width / 2;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, 2.052 * scale);
    drawDividerLine(leftStart, lineY, leftEnd, lineY, false);
    drawDividerLine(rightStart, lineY, rightEnd, lineY, true);

    ctx.shadowColor = 'rgba(237, 220, 184, 0.5)';
    ctx.shadowBlur = Math.max(2, 7.56 * scale);
    ctx.strokeStyle = 'rgba(226, 210, 182, 0.88)';
    ctx.lineWidth = Math.max(1, 2.592 * scale);
    drawDiamond(cx - diamond * 0.32, cy, diamond);
    drawDiamond(cx + diamond * 0.32, cy, diamond);
    ctx.restore();
  }

  function drawDividerLine(x1, y1, x2, y2, reverse) {
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    if (reverse) {
      gradient.addColorStop(0, 'rgba(237, 220, 184, 0.8)');
      gradient.addColorStop(0.45, 'rgba(237, 220, 184, 0.46)');
      gradient.addColorStop(1, 'rgba(237, 220, 184, 0)');
    } else {
      gradient.addColorStop(0, 'rgba(237, 220, 184, 0)');
      gradient.addColorStop(0.55, 'rgba(237, 220, 184, 0.46)');
      gradient.addColorStop(1, 'rgba(237, 220, 184, 0.8)');
    }
    ctx.strokeStyle = gradient;
    ctx.shadowColor = 'rgba(237, 220, 184, 0.35)';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawDiamond(cx, cy, size) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.48);
    ctx.lineTo(cx + size * 0.7, cy);
    ctx.lineTo(cx, cy + size * 0.48);
    ctx.lineTo(cx - size * 0.7, cy);
    ctx.closePath();
    ctx.stroke();
  }

  function drawTaskBand(cx, cy, width, height, strength = 0.72, variant = 'task') {
    if (width <= 0 || height <= 0 || strength <= 0) {
      return;
    }
    const opacity = Math.min(1, Math.max(0, strength));
    ctx.save();
    const variantStrength = variant === 'task' ? 1 : 0.46;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = `rgba(238, 194, 112, ${opacity * variantStrength * 0.32})`;
    ctx.shadowBlur = height * 0.62;

    const panel = ctx.createLinearGradient(cx - width / 2, cy, cx + width / 2, cy);
    panel.addColorStop(0, 'rgba(241, 205, 139, 0)');
    panel.addColorStop(0.14, `rgba(220, 177, 99, ${opacity * variantStrength * 0.08})`);
    panel.addColorStop(0.34, `rgba(231, 190, 113, ${opacity * variantStrength * 0.2})`);
    panel.addColorStop(0.5, `rgba(246, 215, 157, ${opacity * variantStrength * 0.34})`);
    panel.addColorStop(0.66, `rgba(231, 190, 113, ${opacity * variantStrength * 0.2})`);
    panel.addColorStop(0.86, `rgba(220, 177, 99, ${opacity * variantStrength * 0.08})`);
    panel.addColorStop(1, 'rgba(241, 205, 139, 0)');
    ctx.fillStyle = panel;
    ctx.fillRect(cx - width / 2, cy - height / 2, width, height);

    ctx.shadowColor = 'transparent';
    const warmth = ctx.createLinearGradient(cx - width / 2, cy, cx + width / 2, cy);
    warmth.addColorStop(0, 'rgba(255, 218, 145, 0)');
    warmth.addColorStop(0.25, `rgba(244, 211, 150, ${opacity * variantStrength * 0.08})`);
    warmth.addColorStop(0.5, `rgba(255, 235, 190, ${opacity * variantStrength * 0.2})`);
    warmth.addColorStop(0.75, `rgba(244, 211, 150, ${opacity * variantStrength * 0.08})`);
    warmth.addColorStop(1, 'rgba(255, 218, 145, 0)');
    ctx.fillStyle = warmth;
    ctx.fillRect(cx - width / 2, cy - height / 2, width, height);

    const edge = ctx.createLinearGradient(cx - width / 2, cy, cx + width / 2, cy);
    edge.addColorStop(0, 'rgba(255, 234, 180, 0)');
    edge.addColorStop(0.22, `rgba(255, 231, 181, ${opacity * variantStrength * 0.06})`);
    edge.addColorStop(0.5, `rgba(255, 243, 211, ${opacity * variantStrength * 0.18})`);
    edge.addColorStop(0.78, `rgba(255, 231, 181, ${opacity * variantStrength * 0.06})`);
    edge.addColorStop(1, 'rgba(255, 234, 180, 0)');
    ctx.fillStyle = edge;
    const edgeHeight = Math.max(1, height * 0.045);
    ctx.fillRect(cx - width / 2, cy - height / 2, width, edgeHeight);
    ctx.globalAlpha = 0.58;
    ctx.fillRect(cx - width / 2, cy + height / 2 - edgeHeight, width, edgeHeight);
    ctx.restore();
  }

  function drawTaskCompleteText(text, x, y, maxWidth, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    let size = Math.max(18, maxWidth * 0.2);
    ctx.font = `700 ${Math.round(size)}px Microsoft YaHei, PingFang SC, sans-serif`;
    while (size > 14 && ctx.measureText(text).width > maxWidth) {
      size -= 1;
      ctx.font = `700 ${Math.round(size)}px Microsoft YaHei, PingFang SC, sans-serif`;
    }

    const gradient = ctx.createLinearGradient(x, y - size * 0.65, x, y + size * 0.65);
    gradient.addColorStop(0, '#fff1d0');
    gradient.addColorStop(0.52, '#efd39c');
    gradient.addColorStop(1, '#d0a061');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255, 230, 176, 0.36)';
    ctx.shadowBlur = Math.max(3, size * 0.12);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = 'rgba(255, 244, 218, 0.42)';
    ctx.lineWidth = Math.max(0.6, size * 0.018);
    ctx.strokeText(text, x, y);
    ctx.fillStyle = gradient;
    ctx.fillText(text, x, y);

    ctx.restore();
  }

  function drawTaskGlow(cx, cy, width, height, color, alpha) {
    ctx.save();
    const gradient = ctx.createLinearGradient(cx - width / 2, cy, cx + width / 2, cy);
    gradient.addColorStop(0, colorToRgba(color, 0));
    gradient.addColorStop(0.28, colorToRgba(color, alpha * 0.72));
    gradient.addColorStop(0.5, colorToRgba(color, alpha));
    gradient.addColorStop(0.72, colorToRgba(color, alpha * 0.72));
    gradient.addColorStop(1, colorToRgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(cx - width / 2, cy - height / 2, width, height);
    ctx.restore();
  }

  function drawCenteredAsset(asset, cx, cy, targetWidth, targetHeight, alpha, options = {}) {
    const metrics = getAssetDrawMetrics(asset, cx, cy, targetWidth, targetHeight);
    if (!metrics) {
      return;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = options.filter || 'none';
    ctx.globalCompositeOperation = options.compositeOperation || 'source-over';
    ctx.drawImage(
      metrics.source,
      metrics.bounds.x,
      metrics.bounds.y,
      metrics.bounds.width,
      metrics.bounds.height,
      metrics.x,
      metrics.y,
      metrics.drawWidth,
      metrics.drawHeight
    );
    ctx.restore();
  }

  function getAssetDrawMetrics(asset, cx, cy, targetWidth, targetHeight) {
    if (!asset) {
      return null;
    }
    const source = asset.image;
    const bounds = asset.bounds || {
      x: 0,
      y: 0,
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
    const aspect = bounds.width / bounds.height;
    const drawWidth = targetWidth || targetHeight * aspect;
    const drawHeight = targetHeight || targetWidth / aspect;
    return {
      source,
      bounds,
      x: cx - drawWidth / 2,
      y: cy - drawHeight / 2,
      drawWidth,
      drawHeight,
    };
  }

  function drawTextLine(text, x, y, size, weight, color, alpha, maxWidth, options = {}) {
    ctx.save();
    const scale = options.scale || 1;
    const fittedSize = fitFontSize(text, size, weight, maxWidth ? maxWidth / scale : maxWidth);
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.font = `${weight} ${Math.max(18, Math.round(fittedSize))}px Microsoft YaHei, PingFang SC, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = alpha;
    const isTitle = options.variant === 'title';
    const isEyebrow = options.variant === 'eyebrow';
    ctx.shadowColor = isEyebrow ? 'rgba(211, 169, 102, 0.28)' : 'rgba(0, 0, 0, 0.46)';
    ctx.shadowBlur = Math.max(3, fittedSize * (isTitle ? 0.09 : 0.07));
    ctx.shadowOffsetY = isTitle ? Math.max(1, fittedSize * 0.025) : 0;
    ctx.strokeStyle = isEyebrow ? 'rgba(255, 244, 218, 0.12)' : 'rgba(76, 58, 39, 0.34)';
    ctx.lineWidth = Math.max(0.7, fittedSize * (isTitle ? 0.018 : 0.012));
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function fitFontSize(text, size, weight, maxWidth) {
    if (!maxWidth) {
      return size;
    }
    let fitted = size;
    ctx.save();
    while (fitted > 18) {
      ctx.font = `${weight} ${Math.round(fitted)}px Microsoft YaHei, PingFang SC, sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) {
        break;
      }
      fitted -= 1;
    }
    ctx.restore();
    return fitted;
  }

  function colorToRgba(hex, opacity) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clampOpacity(opacity)})`;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`图片读取失败：${src}`));
      image.src = src;
    });
  }

  async function loadSingleEmblemAsset(key, failedKeys, sourceMap, targetMap, options = {}) {
    const { disableOnFailure = true, renderSelected = true } = options;
    const { src } = sourceMap[key];
    let image;
    let bounds;
    try {
      image = await loadImage(src);
      bounds = getVisibleBounds(image);
    } catch {
      failedKeys.add(key);
      if (disableOnFailure) {
        disableEmblemOption(key);
      }
      return;
    }

    targetMap[key] = { image, bounds };
    if (renderSelected && getSelectedEmblem() === key) {
      render();
    }
  }

  async function loadPreviewEmblemAssets(priorityKey = getSelectedEmblem()) {
    const failedKeys = new Set();
    const firstKey = normalizeEmblem(priorityKey);
    await loadSingleEmblemAsset(firstKey, failedKeys, PREVIEW_EMBLEM_ASSETS, overlayAssets.previewEmblems);

    await Promise.all(
      EMBLEM_KEYS
        .filter((key) => key !== firstKey)
        .map((key) => loadSingleEmblemAsset(key, failedKeys, PREVIEW_EMBLEM_ASSETS, overlayAssets.previewEmblems))
    );

    const availableKeys = EMBLEM_KEYS.filter((key) => overlayAssets.previewEmblems[key]);
    if (availableKeys.length > 0 && !availableKeys.includes(getSelectedEmblem())) {
      setSelectedEmblem(availableKeys[0]);
      render();
    }

    if (availableKeys.length === 0) {
      assetWarning = '大图标全部加载失败，请检查 assets 目录。';
    } else if (failedKeys.size > 0) {
      const failedLabels = EMBLEM_KEYS
        .filter((key) => failedKeys.has(key))
        .map((key) => PREVIEW_EMBLEM_ASSETS[key].label);
      assetWarning = `以下大图标加载失败：${failedLabels.join('、')}。`;
    } else {
      assetWarning = '';
    }
    updateStatusText();
  }

  async function loadHighResEmblemAssets(priorityKey = getSelectedEmblem()) {
    const failedKeys = new Set();
    const firstKey = normalizeEmblem(priorityKey);
    highResLoadState.active = true;
    highResLoadState.startedAt = Date.now();
    highResLoadState.completed = 0;
    highResLoadState.failed = 0;
    updateHighResMessage();

    async function loadTrackedHighResEmblem(key) {
      const beforeLoaded = Boolean(overlayAssets.highResEmblems[key]);
      await loadSingleEmblemAsset(key, failedKeys, EMBLEM_ASSETS, overlayAssets.highResEmblems, {
        disableOnFailure: false,
        renderSelected: false,
      });
      if (overlayAssets.highResEmblems[key] && !beforeLoaded) {
        highResLoadState.completed += 1;
      } else if (!overlayAssets.highResEmblems[key]) {
        highResLoadState.failed += 1;
      }
      updateHighResMessage();
    }

    await loadTrackedHighResEmblem(firstKey);

    await Promise.all(
      EMBLEM_KEYS
        .filter((key) => key !== firstKey)
        .map((key) => loadTrackedHighResEmblem(key))
    );
  }

  async function loadContinuationAsset() {
    const image = await loadImage(CONTINUATION_PATH);
    overlayAssets.continuation = { image, bounds: getVisibleBounds(image) };
    render();
  }

  async function loadOverlayAssets() {
    const continuationLoad = loadContinuationAsset().catch(() => {
      assetWarning = '固定素材加载失败，请检查 assets 目录。';
      updateStatusText();
    });
    loadHighResEmblemAssets(getSelectedEmblem());
    await loadPreviewEmblemAssets(getSelectedEmblem());
    render();
    await continuationLoad;
  }

  function getVisibleBounds(image) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const scanScale = Math.min(1, 512 / Math.max(width, height));
    const scanWidth = Math.max(1, Math.round(width * scanScale));
    const scanHeight = Math.max(1, Math.round(height * scanScale));
    const scratch = document.createElement('canvas');
    scratch.width = scanWidth;
    scratch.height = scanHeight;
    const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
    scratchCtx.drawImage(image, 0, 0, scanWidth, scanHeight);
    const data = scratchCtx.getImageData(0, 0, scanWidth, scanHeight).data;
    let minX = scanWidth;
    let minY = scanHeight;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < scanHeight; y += 1) {
      for (let x = 0; x < scanWidth; x += 1) {
        const alpha = data[(y * scanWidth + x) * 4 + 3];
        if (alpha > 8) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return { x: 0, y: 0, width, height };
    }

    const scaleX = width / scanWidth;
    const scaleY = height / scanHeight;
    const sourceMinX = Math.floor(minX * scaleX);
    const sourceMinY = Math.floor(minY * scaleY);
    const sourceMaxX = Math.ceil((maxX + 1) * scaleX);
    const sourceMaxY = Math.ceil((maxY + 1) * scaleY);
    const padding = Math.ceil(Math.min(width, height) * 0.012);
    const x = Math.max(0, sourceMinX - padding);
    const y = Math.max(0, sourceMinY - padding);
    return {
      x,
      y,
      width: Math.min(width, sourceMaxX + padding) - x,
      height: Math.min(height, sourceMaxY + padding) - y,
    };
  }

  function setUploadedMedia(media, type, name, sourceFile = null) {
    stopAnimationPreview({ renderFinal: false });
    uploadedMedia = media;
    uploadedMediaType = type;
    uploadedMediaName = name || '';
    uploadedSourceFile = sourceFile;
    const label = type === 'video' ? '视频' : '图片';
    activityMessage = `已加载 ${name} ${label}，可以预览动画或导出。`;
    updateStatusText();
    exportButton.disabled = false;
    previewAnimationButton.disabled = false;
    render();
    if (autoplayTestPreview) {
      autoplayTestPreview = false;
      requestAnimationFrame(() => playAnimationPreview());
    }
  }

  function setUploadedImage(image, name, sourceFile = null) {
    setUploadedMedia(image, 'image', name, sourceFile);
  }

  function loadImageSource(src, name, sourceFile = null) {
    loadImage(src)
      .then((image) => setUploadedImage(image, name, sourceFile))
      .catch(() => {
        activityMessage = '图片读取失败，请换一张图片重试。';
        updateStatusText();
      });
  }

  function loadVideoSource(src, name, sourceFile = null) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = 0;
    }, { once: true });
    video.addEventListener('loadeddata', () => {
      setUploadedMedia(video, 'video', name, sourceFile);
    }, { once: true });
    video.addEventListener('error', () => {
      activityMessage = '视频读取失败，请换一个视频重试。';
      updateStatusText();
    }, { once: true });
    video.src = src;
    video.load();
  }

  function waitForVideoSeek(video, timeSeconds) {
    return new Promise((resolve, reject) => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = Math.min(Math.max(0, timeSeconds), Math.max(0, duration - 0.001));
      if (Math.abs(video.currentTime - target) < 0.002 && video.readyState >= 2) {
        resolve();
        return;
      }
      const cleanup = () => {
        video.removeEventListener('seeked', handleSeeked);
        video.removeEventListener('error', handleError);
      };
      const handleSeeked = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error('Video seek failed.'));
      };
      video.addEventListener('seeked', handleSeeked, { once: true });
      video.addEventListener('error', handleError, { once: true });
      video.currentTime = target;
    });
  }

  function selectedHighResEmblemReady() {
    return Boolean(overlayAssets.highResEmblems[currentState().emblem]);
  }

  function getDerivedVideoFileName(extension = 'mp4') {
    const rawName = String(uploadedMediaName || uploadedSourceFile?.name || 'source-media')
      .replace(/\\/gu, '/')
      .split('/')
      .pop();
    const stem = rawName.replace(/\.[^.]+$/u, '') || 'source-media';
    const safeStem = stem
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-')
      .replace(/[.\s]+$/gu, '')
      .slice(0, 140) || 'source-media';
    const safeExtension = extension === 'webm' ? 'webm' : 'mp4';
    return `${safeStem}.${safeExtension}`;
  }

  function downloadBlob(blob, fileName) {
    if (activeDownloadUrl) {
      URL.revokeObjectURL(activeDownloadUrl);
    }
    activeDownloadUrl = URL.createObjectURL(blob);
    downloadLink.href = activeDownloadUrl;
    downloadLink.download = fileName;
    downloadLink.textContent = `保存 ${fileName}`;
    downloadLink.hidden = false;
    downloadLink.click();
  }

  function setServerDownload(downloadUrl, fileName, options = {}) {
    if (activeDownloadUrl) {
      URL.revokeObjectURL(activeDownloadUrl);
      activeDownloadUrl = '';
    }
    downloadLink.href = downloadUrl;
    downloadLink.download = fileName;
    downloadLink.textContent = options.label || `保存 ${fileName}`;
    downloadLink.hidden = false;
    if (options.autoDownload !== false) {
      downloadLink.click();
    }
  }

  function setLivePhotoImport(importUrl = '') {
    livePhotoImportUrl = importUrl;
    if (!importLivePhotoButton) {
      return;
    }
    if (importUrl) {
      importLivePhotoButton.textContent = '用 Mac“照片”打开并同步到 iPhone';
    }
    importLivePhotoButton.hidden = !importUrl;
    importLivePhotoButton.disabled = false;
  }

  async function importLivePhotoIntoPhotos() {
    if (!livePhotoImportUrl || !importLivePhotoButton) {
      return;
    }
    importLivePhotoButton.disabled = true;
    activityMessage = '正在解压 HEIC + MOV 配对文件并用 Mac“照片”打开...';
    updateStatusText();
    try {
      const response = await fetch(livePhotoImportUrl, { method: 'POST' });
      const result = await readJsonResponse(response);
      activityMessage = result.message || '已用 Mac“照片”打开。';
      importLivePhotoButton.textContent = '已交给“照片”';
    } catch (error) {
      activityMessage = `Live Photo 打开失败：${error.message}`;
      importLivePhotoButton.disabled = false;
    }
    updateStatusText();
  }

  async function readJsonResponse(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `本地视频服务返回 ${response.status}`);
    }
    return payload;
  }

  function canvasToJpegBlob() {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('浏览器无法读取当前视频帧。'));
      }, 'image/jpeg', 0.96);
    });
  }

  function exportHighResImage() {
    if (!selectedHighResEmblemReady()) {
      activityMessage = '高清大图标仍在加载，请稍等后再导出。';
      updateStatusText();
      return;
    }

    render({ emblems: overlayAssets.highResEmblems, staticFrame: true });
    canvas.toBlob((blob) => {
      if (!blob) {
        activityMessage = '导出失败，请重试。';
        updateStatusText();
        render();
        return;
      }
      downloadBlob(blob, 'task-overlay.png');
      activityMessage = '已生成并下载 task-overlay.png。';
      updateStatusText();
      render();
    }, 'image/png');
  }

  function getExportDurationMs() {
    if (uploadedMediaType === 'video' && Number.isFinite(uploadedMedia?.duration) && uploadedMedia.duration > 0) {
      return Math.round(uploadedMedia.duration * 1000);
    }
    return videoSettings.durationMs;
  }

  function getVideoFrameCount(durationMs = getExportDurationMs()) {
    return Math.max(1, Math.round((durationMs / 1000) * videoSettings.fps));
  }

  function renderAnimationFrame(
    frameIndex,
    frameCount,
    emblems,
    motionMode = currentMotionMode(),
    durationMs = getExportDurationMs()
  ) {
    const elapsedMs = (frameIndex / videoSettings.fps) * 1000;
    const progress = frameIndex >= frameCount - 1
      ? 1
      : getTimelineProgress(elapsedMs, durationMs, uploadedMediaType);
    render({ emblems, progress, elapsedMs, motionMode, staticFrame: false });
  }

  async function prepareMediaFrame(frameIndex) {
    if (uploadedMediaType !== 'video') {
      return;
    }
    await waitForVideoSeek(uploadedMedia, frameIndex / videoSettings.fps);
  }

  async function loadMp4Muxer() {
    return import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm');
  }

  async function waitForEncoderCapacity(encoder, maximumQueueSize = 2) {
    while (encoder.encodeQueueSize > maximumQueueSize) {
      await new Promise((resolve) => {
        const fallback = setTimeout(resolve, 100);
        encoder.addEventListener('dequeue', () => {
          clearTimeout(fallback);
          resolve();
        }, { once: true });
      });
    }
  }

  async function getSupportedMp4Config() {
    const bitrate = getVideoBitrate(canvas.width, canvas.height);
    for (const codec of getMp4CodecCandidates(canvas.width, canvas.height)) {
      const config = {
        codec,
        width: canvas.width,
        height: canvas.height,
        bitrate,
        framerate: videoSettings.fps,
        hardwareAcceleration: 'prefer-hardware',
        latencyMode: 'quality',
        avc: { format: 'avc' },
      };
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        return support.config;
      }
    }
    throw new Error(`No supported H.264 encoder for ${canvas.width}x${canvas.height}.`);
  }

  async function exportAnimatedMp4() {
    if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
      throw new Error('This browser does not support WebCodecs MP4 export.');
    }

    const { Muxer, ArrayBufferTarget } = await loadMp4Muxer();
    const frameCount = getVideoFrameCount();
    const frameDurationUs = Math.round(1_000_000 / videoSettings.fps);
    const motionMode = currentMotionMode();
    await prepareMediaFrame(0);
    renderAnimationFrame(0, frameCount, overlayAssets.highResEmblems, motionMode);

    if (canvas.width % 2 !== 0 || canvas.height % 2 !== 0) {
      throw new Error('MP4 export requires even canvas dimensions.');
    }

    const config = await getSupportedMp4Config();

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: 'avc',
        width: canvas.width,
        height: canvas.height,
        frameRate: videoSettings.fps,
      },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    let encoderError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (error) => {
        encoderError = error;
      },
    });
    encoder.configure(config);

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      await prepareMediaFrame(frameIndex);
      renderAnimationFrame(frameIndex, frameCount, overlayAssets.highResEmblems, motionMode);
      const frame = new VideoFrame(canvas, {
        timestamp: frameIndex * frameDurationUs,
        duration: frameDurationUs,
      });
      encoder.encode(frame);
      frame.close();
      await waitForEncoderCapacity(encoder);

      if (frameIndex % 8 === 0) {
        activityMessage = `正在生成 MP4 视频 ${frameIndex + 1}/${frameCount}...`;
        updateStatusText();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }

    await encoder.flush();
    encoder.close();
    if (encoderError) {
      throw encoderError;
    }
    muxer.finalize();
    const fileName = getDerivedVideoFileName('mp4');
    downloadBlob(new Blob([target.buffer], { type: 'video/mp4' }), fileName);
    activityMessage = `已生成并下载 ${fileName}。浏览器备用导出不支持完整继承 EXIF。`;
    updateStatusText();
  }

  async function exportAnimatedWebm() {
    if (!canvas.captureStream || !('MediaRecorder' in window)) {
      throw new Error('This browser does not support WebM recording.');
    }

    const frameCount = getVideoFrameCount();
    const frameDurationMs = 1000 / videoSettings.fps;
    const motionMode = currentMotionMode();
    const mimeType = MediaRecorder.isTypeSupported(videoSettings.webmMimeType)
      ? videoSettings.webmMimeType
      : 'video/webm';
    const chunks = [];
    const stream = canvas.captureStream(videoSettings.fps);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: getVideoBitrate(canvas.width, canvas.height),
    });
    const finished = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => reject(recorder.error || new Error('WebM recording failed.'));
      recorder.onstop = resolve;
    });

    recorder.start();
    if (uploadedMediaType === 'video') {
      uploadedMedia.currentTime = 0;
      await uploadedMedia.play().catch(() => {});
    }
    const track = stream.getVideoTracks()[0];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      renderAnimationFrame(frameIndex, frameCount, overlayAssets.highResEmblems, motionMode);
      track?.requestFrame?.();
      if (frameIndex % 8 === 0) {
        activityMessage = `正在生成 WebM 备用视频 ${frameIndex + 1}/${frameCount}...`;
        updateStatusText();
      }
      await new Promise((resolve) => setTimeout(resolve, frameDurationMs));
    }
    recorder.stop();
    if (uploadedMediaType === 'video') {
      uploadedMedia.pause();
    }
    await finished;
    for (const trackItem of stream.getTracks()) {
      trackItem.stop();
    }

    const fileName = getDerivedVideoFileName('webm');
    downloadBlob(new Blob(chunks, { type: mimeType }), fileName);
    activityMessage = `MP4 不可用，已生成并下载 ${fileName}。WebM 备用导出不支持完整继承 EXIF。`;
    updateStatusText();
  }

  async function exportAnimatedWithPython(exportFormat = 'mp4') {
    const isLivePhoto = exportFormat === 'livephoto';
    const exportDurationMs = isLivePhoto ? videoSettings.durationMs : getExportDurationMs();
    const frameCount = getVideoFrameCount(exportDurationMs);
    const motionMode = currentMotionMode();
    let sourceToken = '';
    let session = null;

    try {
      if (uploadedSourceFile) {
        activityMessage = `正在通过 127.0.0.1 读取 ${uploadedSourceFile.name} 的拍摄元数据...`;
        updateStatusText();
        const sourceResponse = await fetch('/api/source', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Source-Name': encodeURIComponent(uploadedSourceFile.name),
            'X-Source-Last-Modified': String(uploadedSourceFile.lastModified || ''),
          },
          body: uploadedSourceFile,
        });
        const sourceResult = await readJsonResponse(sourceResponse);
        sourceToken = sourceResult.sourceToken;
      }

      const startResponse = await fetch('/api/video/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          width: canvas.width,
          height: canvas.height,
          fps: videoSettings.fps,
          frameCount,
          exportFormat: exportFormat,
          sourceToken,
          sourceName: uploadedMediaName,
        }),
      });
      session = await readJsonResponse(startResponse);

      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        await prepareMediaFrame(frameIndex);
        renderAnimationFrame(
          frameIndex,
          frameCount,
          overlayAssets.highResEmblems,
          motionMode,
          exportDurationMs
        );
        const frameBlob = await canvasToJpegBlob();
        const frameResponse = await fetch(`/api/video/${session.sessionId}/frame`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: frameBlob,
        });
        await readJsonResponse(frameResponse);

        if (frameIndex % 4 === 0 || frameIndex === frameCount - 1) {
          activityMessage = `正在渲染${isLivePhoto ? ' Live Photo' : '并编码 H.265 MP4'} ${frameIndex + 1}/${frameCount}...`;
          updateStatusText();
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }

      activityMessage = isLivePhoto
        ? '画面帧已提交，正在写入 Apple 配对标识与静态帧时间...'
        : '画面帧已提交，正在完成 MP4 封装...';
      updateStatusText();
      const finishResponse = await fetch(`/api/video/${session.sessionId}/finish`, {
        method: 'POST',
      });
      const result = await readJsonResponse(finishResponse);
      setServerDownload(result.downloadUrl, result.fileName, {
        autoDownload: !isLivePhoto,
        label: isLivePhoto ? '下载 HEIC + MOV 配对备份' : undefined,
      });
      setLivePhotoImport(isLivePhoto ? result.importUrl : '');
      activityMessage = isLivePhoto
        ? `已生成 ${result.width} x ${result.height}、3.0 秒 iPhone Live Photo（HEIC + H.265 MOV）；可点击下方按钮直接导入“照片”。配对备份位于 ${result.outputPath}。`
        : `已生成 ${result.width} x ${result.height} H.265 MP4，文件名已参考原素材，兼容的拍摄元数据已写入；文件同时保存在 ${result.outputPath}。`;
      updateStatusText();
    } catch (error) {
      if (session?.sessionId) {
        fetch(`/api/video/${session.sessionId}/cancel`, { method: 'POST' }).catch(() => {});
      } else if (sourceToken) {
        fetch(`/api/source/${sourceToken}/cancel`, { method: 'POST' }).catch(() => {});
      }
      throw error;
    }
  }

  async function exportAnimatedVideo(exportFormat = 'mp4') {
    const isLivePhoto = exportFormat === 'livephoto';
    if (!selectedHighResEmblemReady()) {
      activityMessage = '高清大图标仍在加载，请稍等后再导出视频。';
      updateStatusText();
      return;
    }

    stopAnimationPreview({ renderFinal: false });
    videoCanvasSize = getVideoCanvasSize(currentMode(), uploadedMedia);
    exportButton.disabled = true;
    try {
      downloadLink.hidden = true;
      activityMessage = `正在准备 ${videoCanvasSize.width} x ${videoCanvasSize.height} ${isLivePhoto ? 'Apple Live Photo' : 'H.265 MP4 视频'}导出...`;
      updateStatusText();
      await exportAnimatedWithPython(exportFormat);
    } catch (pythonError) {
      console.warn(pythonError);
      if (isLivePhoto) {
        activityMessage = `Live Photo 导出失败：${pythonError.message} 请确认已在 macOS 上通过 python3 server.py 启动项目。`;
        updateStatusText();
        return;
      }
      const exceedsBrowserLimit = videoCanvasSize.width > videoSettings.maxWidth
        || videoCanvasSize.height > videoSettings.maxHeight;
      if (exceedsBrowserLimit) {
        activityMessage = `原尺寸 MP4 导出失败：${pythonError.message} 请使用 python3 server.py 启动项目。`;
        updateStatusText();
        return;
      }
      try {
        activityMessage = '本地 Python 编码服务不可用，正在尝试浏览器 MP4 编码...';
        updateStatusText();
        await exportAnimatedMp4();
      } catch (mp4Error) {
        console.warn(mp4Error);
        try {
          activityMessage = 'MP4 编码器不可用，正在生成 WebM 备用视频...';
          updateStatusText();
          await exportAnimatedWebm();
        } catch (webmError) {
          console.error(webmError);
          activityMessage = '视频导出失败：请确认已通过 python3 server.py 启动项目。';
          updateStatusText();
        }
      }
    } finally {
      videoCanvasSize = null;
      exportButton.disabled = false;
      render();
    }
  }

  function exportSelectedFormat() {
    stopAnimationPreview({ renderFinal: false });
    setLivePhotoImport('');
    const exportMode = selectedExportMode();
    if (exportMode === 'video' || exportMode === 'livephoto') {
      exportAnimatedVideo(exportMode === 'livephoto' ? 'livephoto' : 'mp4');
      return;
    }
    exportHighResImage();
  }

  function stopAnimationPreview(options = {}) {
    if (previewAnimationFrame !== null) {
      cancelAnimationFrame(previewAnimationFrame);
      previewAnimationFrame = null;
    }
    if (uploadedMediaType === 'video' && uploadedMedia) {
      uploadedMedia.pause();
    }
    previewAnimationButton.disabled = !uploadedMedia;
    previewAnimationButton.textContent = '预览动画';
    if (options.renderFinal !== false) {
      render();
    }
  }

  function playAnimationPreview() {
    if (!uploadedMedia) {
      activityMessage = '请先上传图片或视频，再预览动画。';
      updateStatusText();
      return;
    }

    stopAnimationPreview({ renderFinal: false });
    const startedAt = performance.now();
    const previewDurationMs = uploadedMediaType === 'video' ? getExportDurationMs() : videoSettings.durationMs;
    if (uploadedMediaType === 'video') {
      uploadedMedia.currentTime = 0;
      uploadedMedia.play().catch(() => {});
    }
    const emblems = selectedHighResEmblemReady()
      ? overlayAssets.highResEmblems
      : overlayAssets.previewEmblems;
    const motionMode = currentMotionMode();
    previewAnimationButton.disabled = true;
    previewAnimationButton.textContent = '预览中...';
    activityMessage = '正在预览动画效果。';
    updateStatusText();

    function tick(now) {
      const elapsedMs = now - startedAt;
      const progress = getTimelineProgress(elapsedMs, previewDurationMs, uploadedMediaType);
      render({ emblems, progress, elapsedMs, motionMode, staticFrame: false });
      if (elapsedMs < previewDurationMs) {
        previewAnimationFrame = requestAnimationFrame(tick);
        return;
      }
      previewAnimationFrame = null;
      if (uploadedMediaType === 'video') {
        uploadedMedia.pause();
      }
      previewAnimationButton.disabled = false;
      previewAnimationButton.textContent = '预览动画';
      activityMessage = '动画预览完成，可继续调整或导出视频。';
      updateStatusText();
      render();
    }

    previewAnimationFrame = requestAnimationFrame(tick);
  }

  function updateExportButtonLabel() {
    const labels = {
      image: '导出图片',
      video: '导出视频',
      livephoto: '导出 Live Photo',
    };
    exportButton.textContent = labels[selectedExportMode()] || labels.image;
  }

  function updateEffectValueLabels() {
    opacityValue.textContent = `${Math.round(Number(overlayOpacityInput.value) * 100)}%`;
    emblemFlashValue.textContent = `${Math.round(Number(emblemFlashInput.value) * 100)}%`;
    panelOpacityValue.textContent = `${Math.round(Number(panelOpacityInput.value) * 100)}%`;
  }

  function loadTestImageFromQuery() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('capture') === '1') {
      document.body.classList.add('capture-mode');
    }

    const testImage = params.get('testImage');
    if (!testImage) {
      return;
    }
    const safeName = testImage.replace(/[^a-zA-Z0-9._\-/]/g, '');
    if (!safeName || safeName.includes('..') || safeName.startsWith('/')) {
      return;
    }
    if (params.has('line1')) {
      line1Input.value = params.get('line1') || DEFAULTS.line1;
    }
    if (params.has('line2')) {
      line2Input.value = params.get('line2') || DEFAULTS.line2;
    }
    if (params.has('emblem')) {
      const requestedEmblem = params.get('emblem');
      setSelectedEmblem(normalizeEmblem(requestedEmblem));
    }
    if (params.has('emblemEffect') && emblemEffectSelect) {
      emblemEffectSelect.value = normalizeEmblemEffect(params.get('emblemEffect'));
    }
    if (params.has('emblemEntrance') && emblemEntranceSelect) {
      emblemEntranceSelect.value = normalizeEmblemEntrance(params.get('emblemEntrance'));
    }
    if (params.has('motionMode')) {
      const requestedMotion = params.get('motionMode');
      if (Object.hasOwn(MOTION_PRESETS, requestedMotion)) {
        const motionControl = document.querySelector(`input[name="motionMode"][value="${requestedMotion}"]`);
        if (motionControl) {
          motionControl.checked = true;
        }
      }
    }
    if (params.has('sizeMode')) {
      const requestedSize = params.get('sizeMode');
      const allowedSizes = new Set(['16:9', '4:3', '9:16', 'source']);
      if (allowedSizes.has(requestedSize)) {
        const sizeControl = document.querySelector(`input[name="sizeMode"][value="${requestedSize}"]`);
        if (sizeControl) {
          sizeControl.checked = true;
        }
      }
    }
    autoplayTestPreview = params.get('autoplay') === '1';
    loadImageSource(safeName, safeName);
  }

  function bindEvents() {
    imageInput.addEventListener('change', () => {
      const file = imageInput.files?.[0];
      if (!file) {
        return;
      }
      const url = URL.createObjectURL(file);
      if ((file.type || '').startsWith('video/') || /\.(mp4|webm|mov|m4v)$/iu.test(file.name)) {
        loadVideoSource(url, file.name, file);
        return;
      }
      loadImageSource(url, file.name, file);
    });

    [
      line1Input,
      line2Input,
      overlayColorInput,
      overlayOpacityInput,
      emblemFlashInput,
      panelOpacityInput,
      emblemEffectSelect,
      emblemEntranceSelect,
    ].forEach((control) => {
      if (!control) {
        return;
      }
      control.addEventListener('input', () => {
        stopAnimationPreview({ renderFinal: false });
        updateEffectValueLabels();
        render();
      });
    });

    document.querySelectorAll('input[name="sizeMode"]').forEach((control) => {
      control.addEventListener('change', () => {
        stopAnimationPreview({ renderFinal: false });
        render();
      });
    });

    emblemPicker.addEventListener('change', () => {
      stopAnimationPreview({ renderFinal: false });
      render();
    });

    document.querySelectorAll('input[name="exportMode"]').forEach((control) => {
      control.addEventListener('change', updateExportButtonLabel);
    });

    document.querySelectorAll('input[name="motionMode"]').forEach((control) => {
      control.addEventListener('change', () => {
        stopAnimationPreview({ renderFinal: false });
        render();
      });
    });

    previewAnimationButton.addEventListener('click', playAnimationPreview);
    exportButton.addEventListener('click', exportSelectedFormat);
    importLivePhotoButton?.addEventListener('click', importLivePhotoIntoPhotos);
  }

  exportButton.disabled = true;
  previewAnimationButton.disabled = true;
  window.addEventListener?.('beforeunload', () => {
    if (activeDownloadUrl) {
      URL.revokeObjectURL(activeDownloadUrl);
    }
  });
  updateExportButtonLabel();
  updateEffectValueLabels();
  bindEvents();
  loadOverlayAssets().catch(() => {
    assetWarning = '固定素材加载失败，请检查 assets 目录。';
    updateStatusText();
  });
  loadTestImageFromQuery();
  render();
})();
