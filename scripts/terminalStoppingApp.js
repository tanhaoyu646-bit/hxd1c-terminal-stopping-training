import { CAB, PROJECT_ID, SCENARIO } from './terminalStoppingConfig.js?v=terminal-station-7';
import { TerminalStoppingSimulation } from './terminalStoppingSimulation.js?v=terminal-station-7';
import { TerminalStoppingAssessment } from './terminalStoppingAssessment.js?v=terminal-station-7';
import { TerminalStoppingScene } from './terminalStoppingScene.js?v=terminal-station-7';
import { LkjRuntime } from './lkjRuntime.js?v=terminal-station-7';
import {
  clearCandidateDraft,
  createCandidateAttempt,
  formatAttemptTime,
  loadCandidateDraft,
  saveCandidateDraft,
  validateCandidate,
} from './terminalStoppingCandidate.js?v=terminal-station-7';

const $ = (selector) => document.querySelector(selector);
const pct = (value, total) => `${value / total * 100}%`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const views = { front: 'HXD1C_front.png', left: 'HXD1C_left_full.png', right: 'HXD1C_right_full.png', rearLeft: 'HXD1C_left.png', rearRight: 'HXD1C_right.png' };
const brakeNames = ['运转位', '初制位', '常用Ⅱ', '常用Ⅲ', '常用Ⅳ', '紧急位'];
const autoBrakeFrames = [0, 1, 2, 9, 10, 11];
const signalFrames = { green: 7, greenYellow: 6, yellow: 5, red: 0 };

let simulation = new TerminalStoppingSimulation('training');
let assessment = new TerminalStoppingAssessment(simulation);
let routeScene = null;
let lkj = new LkjRuntime($('#lkj-dock'), simulation);
let selectedView = 'front';
let lastFrame = performance.now();
let resultShown = false;
let activeDrag = null;
let suppressControlClickUntil = 0;
let routeLoadStartedAt = 0;
let audioContext = null;
let lastAlertLevel = 'normal';
let currentCandidate = loadCandidateDraft();
let currentAttempt = null;
const overlay = $('#cab-overlay');
const elements = {};

function syncVisualViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--visual-height', `${Math.round(viewport?.height || window.innerHeight)}px`);
  document.documentElement.style.setProperty('--visual-offset-top', `${Math.round(viewport?.offsetTop || 0)}px`);
}
syncVisualViewport();
window.visualViewport?.addEventListener('resize', syncVisualViewport);
window.visualViewport?.addEventListener('scroll', syncVisualViewport);

function makeSprite(id, image, x, y, width, height, columns, rows, label) {
  const element = document.createElement('div');
  element.className = `sprite ${id}`;
  element.setAttribute('aria-label', label);
  Object.assign(element.style, {
    left: pct(x, CAB.width), top: pct(y, CAB.height), width: pct(width, CAB.width), height: pct(height, CAB.height),
    backgroundImage: `url("./assets/archive-cabview/${image}")`, backgroundSize: `${columns * 100}% ${rows * 100}%`,
  });
  overlay.append(element);
  return element;
}

function makeBadge(id, label, x, y, width = 82) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'control-position-badge';
  element.innerHTML = `<b>${label}</b><span>—</span>`;
  Object.assign(element.style, { left: pct(x, CAB.width), top: pct(y, CAB.height), width: pct(width, CAB.width) });
  overlay.append(element);
  return element;
}

function makePhysical(label, x, y, width, height, handler, className = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `physical-control ${className}`;
  element.setAttribute('aria-label', label);
  Object.assign(element.style, { left: pct(x, CAB.width), top: pct(y, CAB.height), width: pct(width, CAB.width), height: pct(height, CAB.height) });
  element.addEventListener('click', handler);
  overlay.append(element);
  return element;
}

function makeTouchTarget(id, x, y, width, height, label, handler) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `touch-target ${id}-touch-target`;
  element.setAttribute('aria-label', label);
  Object.assign(element.style, {
    left: pct(x, CAB.width), top: pct(y, CAB.height), width: pct(width, CAB.width), height: pct(height, CAB.height),
  });
  element.addEventListener('pointerdown', handler);
  overlay.append(element);
  return element;
}

function makeNeedle(id, image, x, y, width, height, pivot, start, end) {
  const element = document.createElement('img');
  element.className = 'original-game-needle';
  element.src = `./assets/archive-cabview/${image}`;
  element.alt = '';
  element.setAttribute('aria-hidden', 'true');
  element.dataset.start = start;
  element.dataset.end = end;
  Object.assign(element.style, {
    left: pct(x, CAB.width), top: pct(y, CAB.height), width: pct(width, CAB.width), height: pct(height, CAB.height),
    transformOrigin: `50% ${pivot / height * 100}%`,
  });
  overlay.append(element);
  elements[id] = element;
  return element;
}

function makeStateSprite(id, image, x, y, width, height, columns, rows) {
  const element = document.createElement('div');
  element.className = `state-sprite ${id}`;
  Object.assign(element.style, {
    left: pct(x, CAB.width), top: pct(y, CAB.height), width: pct(width, CAB.width), height: pct(height, CAB.height),
    backgroundImage: `url("./assets/archive-cabview/${image}")`, backgroundSize: `${columns * 100}% ${rows * 100}%`,
  });
  overlay.append(element);
  elements[id] = element;
  return element;
}

function setNeedle(element, value, maximum) {
  if (!element) return;
  const ratio = clamp(Number(value) / maximum, 0, 1);
  element.style.transform = `rotate(${Number(element.dataset.start) + (Number(element.dataset.end) - Number(element.dataset.start)) * ratio}deg)`;
}

function frame(element, index, columns, rows) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  element.style.backgroundPosition = `${columns === 1 ? 0 : column / (columns - 1) * 100}% ${rows === 1 ? 0 : row / (rows - 1) * 100}%`;
}

function tractionFrame(value) {
  return value > 0 ? Math.max(0, 7 - Math.min(7, value)) : value === 0 ? 7 : Math.min(15, 7 + Math.min(8, Math.abs(value)));
}

function createCabControls() {
  overlay.replaceChildren();
  elements.auto = makeSprite('auto-brake', 'HXD1C_DZ.png', 35, 341, 45, 60, 4, 3, '上下拖动自动制动阀换位');
  elements.independent = makeSprite('independent-brake', 'HXD1C_XZ.png', 138, 341, 35, 60, 4, 3, '上下拖动单独制动阀；向右滑动并保持为单缓');
  elements.traction = makeSprite('traction', 'HXD1C_GL.png', 464, 345, 46, 81, 2, 8, '上下拖动牵引和电制动手柄');
  elements.direction = makeSprite('direction', 'HXD1C_HX.png', 530, 366, 60, 40, 3, 1, '点击切换换向手柄');
  elements.autoBadge = makeBadge('auto', '自阀', 20, 321, 80);
  elements.independentBadge = makeBadge('independent', '单阀', 116, 321, 78);
  elements.tractionBadge = makeBadge('traction', '牵引手柄', 438, 323, 86);
  elements.directionBadge = makeBadge('direction', '换向手柄', 521, 342, 88);
  elements.sideRelease = makeBadge('side-release', '单缓（按住）', 107, 404, 82);
  elements.sideRelease.classList.add('side-release-control');
  const beginSideRelease = (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    simulation.command('side-release', true);
  };
  const endSideRelease = () => simulation.command('side-release', false);
  elements.sideRelease.addEventListener('pointerdown', beginSideRelease);
  elements.sideRelease.addEventListener('pointerup', endSideRelease);
  elements.sideRelease.addEventListener('pointercancel', endSideRelease);
  makePhysical('放大LKJ监控装置', 210, 226, 101, 94, () => lkj.show(), 'lkj-hotspot');

  makeNeedle('speedNeedle', 'HXD1C_SDZ.png', 493, 277, 3, 18, 2, 68, 300);
  makeNeedle('mainNeedle', 'HXD1C_red.png', 154, 253, 7, 21, 14, 230, 100);
  makeNeedle('pipeNeedle', 'HXD1C_black.png', 154, 253, 7, 21, 14, 230, 130);
  makeNeedle('equalizingNeedle', 'HXD1C_black.png', 162, 295, 7, 21, 14, 224, 136);
  makeNeedle('cylinderNeedle', 'HXD1C_red.png', 162, 295, 7, 21, 14, 230, 130);
  makeStateSprite('locomotive-signal', 'HXD1C_jx.png', 540, 0, 100, 162, 4, 2);

  const controls = [
    ['auto', elements.auto, 0, 5],
    ['independent', elements.independent, 0, 5],
    ['traction', elements.traction, -8, 7],
  ];
  for (const [id, sprite, min, max] of controls) {
    const begin = (event) => {
      event.preventDefault();
      const stateKey = id === 'auto' ? 'autoBrake' : id === 'independent' ? 'independentBrake' : 'traction';
      const range = max - min;
      const step = id === 'traction'
        ? Math.max(18, Math.min(24, sprite.getBoundingClientRect().height / 4))
        : Math.max(10, sprite.getBoundingClientRect().height / range);
      activeDrag = {
        id, stateKey, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
        startValue: simulation.state[stateKey], min, max, step, moved: false, sideReleaseEngaged: false,
      };
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* window listeners keep the drag active */ }
    };
    sprite.addEventListener('pointerdown', begin);
    const badge = id === 'auto' ? elements.autoBadge : id === 'independent' ? elements.independentBadge : elements.tractionBadge;
    badge.addEventListener('pointerdown', begin);
    badge.addEventListener('click', () => {
      if (activeDrag || performance.now() < suppressControlClickUntil) return;
      const key = id === 'auto' ? 'autoBrake' : id === 'independent' ? 'independentBrake' : 'traction';
      const next = simulation.state[key] >= max ? (id === 'traction' ? 0 : min) : simulation.state[key] + 1;
      simulation.command(id === 'auto' ? 'auto-brake' : id === 'independent' ? 'independent-brake' : 'traction', next);
    });
    if (id === 'auto') makeTouchTarget(id, 23, 326, 70, 91, '拖动自动制动阀', begin);
    if (id === 'independent') {
      makeTouchTarget(id, 122, 326, 35, 91, '上下拖动单阀；向右滑动并保持为单缓', begin);
      makeTouchTarget(id, 157, 380, 31, 37, '上下拖动单阀；向右滑动并保持为单缓', begin);
    }
    if (id === 'traction') makeTouchTarget(id, 447, 326, 80, 116, '拖动牵引和电制动手柄', begin);
  }
  const setDirection = () => simulation.command('direction', simulation.state.direction === 'F' ? 'N' : simulation.state.direction === 'N' ? 'R' : 'F');
  elements.direction.addEventListener('click', setDirection);
  elements.directionBadge.addEventListener('click', setDirection);
  makeTouchTarget('direction', 516, 350, 88, 70, '切换换向手柄', (event) => {
    event.preventDefault();
    setDirection();
  });
  elements.traction.addEventListener('dblclick', (event) => {
    event.preventDefault();
    simulation.command('traction', 0);
  });
}

window.addEventListener('pointermove', (event) => {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
  event.preventDefault();
  const dx = event.clientX - activeDrag.startX;
  const dy = event.clientY - activeDrag.startY;
  if (activeDrag.sideReleaseEngaged) return;
  if (activeDrag.id === 'independent' && dx > 16 && Math.abs(dx) > Math.abs(dy) * 1.1) {
    if (!activeDrag.sideReleaseEngaged) {
      activeDrag.sideReleaseEngaged = true;
      activeDrag.moved = true;
      simulation.command('side-release', true);
    }
    return;
  }
  const change = Math.round((activeDrag.startY - event.clientY) / activeDrag.step);
  const value = clamp(activeDrag.startValue + change, activeDrag.min, activeDrag.max);
  if (value === simulation.state[activeDrag.stateKey]) return;
  activeDrag.moved = true;
  simulation.command(activeDrag.id === 'auto' ? 'auto-brake' : activeDrag.id === 'independent' ? 'independent-brake' : 'traction', value);
}, { passive: false });
function finishControlDrag(event) {
  if (!activeDrag || (event?.pointerId !== undefined && activeDrag.pointerId !== event.pointerId)) return;
  if (activeDrag.sideReleaseEngaged) simulation.command('side-release', false);
  if (activeDrag.moved) suppressControlClickUntil = performance.now() + 350;
  activeDrag = null;
}
window.addEventListener('pointerup', finishControlDrag);
window.addEventListener('pointercancel', finishControlDrag);

let routeWarmPromise = null;
function warmTerminalAssets() {
  if (routeWarmPromise) return routeWarmPromise;
  const urls = [
    new URL('../assets/msts-neiyi-corridor/neiyi-dashanpu-terminal-scene.json?v=terminal-station-7', import.meta.url),
    new URL('../assets/msts-neiyi/neiyi-5635-trackdb-path-aligned.json?v=terminal-station-7', import.meta.url),
    new URL('../assets/msts-neiyi-corridor/neiyi-dashanpu-terrain-native.json', import.meta.url),
  ];
  routeWarmPromise = Promise.all(urls.map((url) => fetch(url).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  }))).catch(() => null);
  return routeWarmPromise;
}

async function chooseMode(mode) {
  const validation = validateCandidate(currentCandidate);
  if (!validation.valid) {
    openCandidateGate();
    return;
  }
  currentCandidate = validation.candidate;
  currentAttempt = createCandidateAttempt(currentCandidate);
  simulation = new TerminalStoppingSimulation(mode);
  assessment = new TerminalStoppingAssessment(simulation);
  lkj.simulation = simulation;
  lkj.page = 'main';
  lkj.menuIndex = 0;
  routeScene?.dispose?.();
  const oldCanvas = $('#route-scene');
  const newCanvas = oldCanvas.cloneNode(false);
  oldCanvas.replaceWith(newCanvas);
  $('#route-loading-title').textContent = '正在加载终到站场';
  $('#route-loading-message').textContent = '正在读取原线路、站台和地形资源，加载完成后训练计时才会开始。';
  $('#route-loading-back').hidden = true;
  $('.loading-spinner').hidden = false;
  $('#route-loading').classList.add('open');
  $('#route-loading').setAttribute('aria-hidden', 'false');
  routeLoadStartedAt = performance.now();
  routeScene = new TerminalStoppingScene(newCanvas, SCENARIO, mode);
  simulation.addEventListener('change', render);
  simulation.addEventListener('complete', showResult);
  localStorage.setItem(`${PROJECT_ID}:last-mode`, mode);
  resultShown = false;
  $('#mode-name').textContent = mode === 'training' ? '教学训练' : '独立考核';
  $('#training-guide').classList.toggle('hidden', mode !== 'training');
  $('#progress-panel-note').textContent = mode === 'training'
    ? '训练模式显示参考速度带和纠偏提示。'
    : '考核模式只显示已记录项目，不提示下一步和阈值。';
  $('#mode-picker').classList.remove('open');
  $('#result-modal').classList.remove('open');
  $('#lkj-dock').classList.remove('open');
  selectedView = 'front';
  selectView('front');
  try {
    await routeScene.loadPromise;
    $('#route-loading').classList.remove('open');
    $('#route-loading').setAttribute('aria-hidden', 'true');
    simulation.start();
    lastFrame = performance.now();
    render();
    routeScene.canvas.dataset.loadMilliseconds = String(Math.round(performance.now() - routeLoadStartedAt));
  } catch (error) {
    $('#status-message').textContent = `线路加载失败：${error.message}`;
    $('#route-loading-title').textContent = '线路加载失败';
    $('#route-loading-message').textContent = `${error.message}。请检查网络后返回重试。`;
    $('#route-loading-back').hidden = false;
    $('.loading-spinner').hidden = true;
    $('#route-loading').classList.add('open');
  }
}

function selectView(view) {
  selectedView = view;
  $('#cab-view').src = `./assets/archive-cabview/${views[view]}`;
  overlay.classList.toggle('hidden', view !== 'front');
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  routeScene?.setView(view);
}

function render() {
  const s = simulation.state;
  frame(elements.auto, autoBrakeFrames[s.autoBrake], 4, 3);
  frame(elements.independent, s.independentBrake, 4, 3);
  frame(elements.traction, tractionFrame(s.traction), 2, 8);
  frame(elements.direction, s.direction === 'R' ? 0 : s.direction === 'N' ? 1 : 2, 3, 1);
  frame(elements['locomotive-signal'], signalFrames[s.signal?.aspect] ?? signalFrames.yellow, 4, 2);
  setNeedle(elements.speedNeedle, s.speed, 158);
  setNeedle(elements.mainNeedle, 1_000, 1_600);
  setNeedle(elements.pipeNeedle, s.trainPipe, 1_000);
  setNeedle(elements.equalizingNeedle, s.equalizingReservoir, 1_600);
  setNeedle(elements.cylinderNeedle, s.locomotiveCylinder, 1_600);
  elements.autoBadge.querySelector('span').textContent = brakeNames[s.autoBrake];
  elements.independentBadge.querySelector('span').textContent = s.independentBrake ? `${s.independentBrake}级` : '缓解位';
  elements.tractionBadge.querySelector('span').textContent = s.traction > 0 ? `牵引 ${s.traction}.0级` : s.traction < 0 ? `电制 ${Math.abs(s.traction)}级` : '零位';
  elements.directionBadge.querySelector('span').textContent = s.direction === 'F' ? '前进位' : s.direction === 'R' ? '后退位' : '中立位';
  elements.sideRelease.classList.toggle('active', s.sideRelease);
  elements.sideRelease.querySelector('span').textContent = s.sideRelease ? '已单缓' : '未动作';
  $('#phase-name').textContent = s.phase?.label || '进站对标';
  const remaining = SCENARIO.targetDistance - s.distance;
  const levelText = { normal: '监控正常', warning: 'LKJ报警', unload: 'LKJ卸载', service: 'LKJ常用制动', emergency: 'LKJ紧急制动' }[s.lkjLevel];
  $('#status-message').textContent = s.stopped
    ? `停稳位置 ${formatError(s.stopError)} · 等待防溜操作`
    : `${levelText} · 距停车标 ${Math.max(0, remaining).toFixed(0)} m`;
  $('#guide-speed').textContent = `${s.targetBand.target.toFixed(0)} km/h`;
  $('#guide-band').textContent = `${s.targetBand.minimum.toFixed(0)}–${s.targetBand.maximum.toFixed(0)} km/h`;
  $('#guide-remaining').textContent = `${Math.max(0, remaining).toFixed(0)} m`;
  $('#guide-hint').textContent = simulation.trainingHint();
  const progress = assessment.progress(s);
  $('#progress-count').textContent = `${progress.done}/${progress.total}`;
  renderProgress(progress);
  renderData(s);
  updateMobileLabels(s);
  if (lkj.open) lkj.render();
  if (s.lkjLevel !== lastAlertLevel && s.lkjLevel !== 'normal') alertTone(s.lkjLevel);
  lastAlertLevel = s.lkjLevel;
}

function renderProgress(progress) {
  const names = ['LKJ查看记录', '信号呼唤记录', '牵引回零记录', '初次制动记录', '单缓操作记录', '100 m断面记录', '追加操作记录', '停车记录', '防溜记录', '任务完成'];
  $('#progress-list').innerHTML = names.map((name, index) => `<li class="${progress.checks[index] ? 'done' : 'pending'}">${name}</li>`).join('');
}

function renderData(s) {
  const rows = [
    ['速度', `${s.speed.toFixed(1)} km/h`], ['参考速度', s.mode === 'training' ? `${s.targetBand.target.toFixed(0)} km/h` : '已隐藏'],
    ['距停车标', `${Math.max(0, SCENARIO.targetDistance - s.distance).toFixed(0)} m`], ['停车误差', s.stopError == null ? '—' : formatError(s.stopError)],
    ['列车管', `${s.trainPipe.toFixed(0)} kPa`], ['减压量', `${Math.max(0, 600 - s.trainPipe).toFixed(0)} kPa`],
    ['机车制动缸', `${s.locomotiveCylinder.toFixed(0)} kPa`], ['自阀', brakeNames[s.autoBrake]],
  ];
  $('#run-data').innerHTML = rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join('');
}

function updateMobileLabels(s) {
  elements.sideRelease?.setAttribute('aria-pressed', String(s.sideRelease));
}

function formatError(error) {
  if (!Number.isFinite(error)) return '—';
  if (Math.abs(error) < .05) return '准确对标';
  return `${error > 0 ? '越标' : '欠标'} ${Math.abs(error).toFixed(2)} m`;
}

function showResult() {
  if (resultShown) return;
  resultShown = true;
  const result = assessment.result();
  $('#result-name').textContent = currentAttempt?.name || '—';
  $('#result-student-id').textContent = currentAttempt?.studentId || '—';
  $('#result-started-at').textContent = formatAttemptTime(currentAttempt?.startedAt);
  $('#result-finished-at').textContent = formatAttemptTime(new Date());
  $('#result-score').textContent = result.score;
  $('#result-grade').textContent = result.summary;
  $('.result-score').classList.toggle('fail', !result.qualified);
  $('#result-title').textContent = `${simulation.state.mode === 'training' ? '训练' : '考核'}结果`;
  $('#result-summary').textContent = `${formatError(result.stopError)}，用时 ${result.duration.toFixed(0)} s。${result.secured ? '停车后制动防溜完成。' : '停车后制动防溜未完成。'}${result.redline ? ' 本次触发安全红线。' : ''}`;
  $('#result-categories').innerHTML = result.categories.map((category) => `<div><span>${category.name}</span><b>${category.score}/${category.maximum}</b></div>`).join('');
  renderReplayCurve();
  $('#result-modal').classList.add('open');
  $('#result-modal').setAttribute('aria-hidden', 'false');
}

function renderReplayCurve() {
  const samples = simulation.state.samples;
  const width = 720;
  const height = 180;
  const usable = height - 24;
  const point = (sample, key) => `${clamp(sample.distance / SCENARIO.targetDistance, 0, 1) * width},${usable - clamp(sample[key], 0, 50) / 50 * usable + 8}`;
  const actual = samples.map((sample) => point(sample, 'speed')).join(' ');
  const target = samples.map((sample) => point(sample, 'target')).join(' ');
  $('#result-curve').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="速度距离复盘曲线"><path d="M0 ${usable + 8}H${width}M0 8V${usable + 8}"/><polyline class="curve-target" points="${target}"/><polyline class="curve-actual" points="${actual}"/><line class="curve-check" x1="${SCENARIO.checkPoint / SCENARIO.targetDistance * width}" x2="${SCENARIO.checkPoint / SCENARIO.targetDistance * width}" y1="8" y2="${usable + 8}"/></svg><div><span>绿色：实际速度</span><span>黄色：教学参考曲线</span><span>虚线：100 m校速点</span></div>`;
}

function alertTone(level) {
  try {
    audioContext ||= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = level === 'emergency' ? 880 : level === 'service' ? 720 : 560;
    gain.gain.setValueAtTime(.05, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .22);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + .23);
  } catch { /* 浏览器可能在首次手势前禁止音频。 */ }
}

function togglePanel(panel) {
  document.querySelectorAll('.side-panel').forEach((item) => {
    const open = item === panel && !item.classList.contains('open');
    item.classList.toggle('open', open);
    item.setAttribute('aria-hidden', String(!open));
  });
}

function animationFrame(now) {
  const dt = Math.min(.08, (now - lastFrame) / 1000);
  lastFrame = now;
  simulation.tick(dt);
  if (routeScene) {
    routeScene.update(simulation.state.distance, simulation.state.speed, selectedView);
    routeScene.render();
  }
  requestAnimationFrame(animationFrame);
}

function changeAuto(delta) {
  simulation.command('auto-brake', clamp(simulation.state.autoBrake + delta, 0, 5));
}

function openCandidateGate(clear = false) {
  if (clear) {
    clearCandidateDraft();
    currentCandidate = { name: '', studentId: '' };
  }
  $('#candidate-name').value = currentCandidate.name || '';
  $('#candidate-student-id').value = currentCandidate.studentId || '';
  $('#candidate-error').textContent = '';
  $('#candidate-name').removeAttribute('aria-invalid');
  $('#candidate-student-id').removeAttribute('aria-invalid');
  $('#candidate-gate').hidden = false;
  document.body.classList.add('candidate-entry-active');
  requestAnimationFrame(() => $('#candidate-name').focus());
}

function closeCandidateGate() {
  $('#candidate-gate').hidden = true;
  document.body.classList.remove('candidate-entry-active');
}

createCabControls();
$('#candidate-name').value = currentCandidate.name;
$('#candidate-student-id').value = currentCandidate.studentId;
$('#candidate-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const validation = validateCandidate({
    name: $('#candidate-name').value,
    studentId: $('#candidate-student-id').value,
  });
  $('#candidate-name').toggleAttribute('aria-invalid', !validation.valid && validation.field === 'name');
  $('#candidate-student-id').toggleAttribute('aria-invalid', !validation.valid && validation.field === 'studentId');
  $('#candidate-error').textContent = validation.message;
  if (!validation.valid) {
    $(`#candidate-${validation.field === 'studentId' ? 'student-id' : 'name'}`).focus();
    return;
  }
  currentCandidate = saveCandidateDraft(validation.candidate);
  closeCandidateGate();
  warmTerminalAssets();
});
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => chooseMode(button.dataset.mode)));
$('#callout').addEventListener('click', () => simulation.command('callout'));
$('#progress-toggle').addEventListener('click', () => togglePanel($('#progress-panel')));
$('#rules-toggle').addEventListener('click', () => togglePanel($('#rules-panel')));
$('#data-toggle').addEventListener('click', () => togglePanel($('#data-panel')));
$('#view-toggle').addEventListener('click', () => $('#view-menu').classList.toggle('open'));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { selectView(button.dataset.view); $('#view-menu').classList.remove('open'); }));
document.querySelectorAll('[data-close-panel]').forEach((button) => button.addEventListener('click', () => togglePanel(button.closest('.side-panel'))));
$('#fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#stage').requestFullscreen(); } catch { /* 全屏权限由浏览器决定。 */ }
});
$('#retry').addEventListener('click', () => chooseMode(simulation.state.mode));
$('#choose-mode').addEventListener('click', () => { $('#result-modal').classList.remove('open'); $('#mode-picker').classList.add('open'); });
$('#change-candidate').addEventListener('click', () => {
  $('#result-modal').classList.remove('open');
  $('#mode-picker').classList.add('open');
  openCandidateGate(true);
});
$('#route-loading-back').addEventListener('click', () => {
  $('#route-loading').classList.remove('open');
  $('#route-loading').setAttribute('aria-hidden', 'true');
  $('#mode-picker').classList.add('open');
});
window.addEventListener('keydown', (event) => {
  if (!$('#candidate-gate').hidden || $('#mode-picker').classList.contains('open')) return;
  if (event.key === 'Escape') {
    document.querySelectorAll('.side-panel').forEach((panel) => panel.classList.remove('open'));
    $('#view-menu').classList.remove('open');
    lkj.close();
  }
  if (event.key === '0') simulation.command('traction', 0);
  if (event.key === 'ArrowUp') changeAuto(1);
  if (event.key === 'ArrowDown') changeAuto(-1);
});

window.__terminalStopping = {
  get simulation() { return simulation; },
  get assessment() { return assessment; },
  get routeScene() { return routeScene; },
  get candidate() { return currentAttempt; },
  chooseMode,
};
render();
requestAnimationFrame(animationFrame);
