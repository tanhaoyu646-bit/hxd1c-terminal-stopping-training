import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SCENARIO, TRACTION_MAX, brakingDistanceForSpeed, lkjCurvesAt, targetCurveSpeed, trainingBand } from '../scripts/terminalStoppingConfig.js';
import { TerminalStoppingSimulation } from '../scripts/terminalStoppingSimulation.js';
import { TerminalStoppingAssessment } from '../scripts/terminalStoppingAssessment.js';
import {
  createCandidateAttempt,
  loadCandidateDraft,
  saveCandidateDraft,
  validateCandidate,
} from '../scripts/terminalStoppingCandidate.js';

function runStandard(mode = 'assessment') {
  const simulation = new TerminalStoppingSimulation(mode);
  simulation.start();
  simulation.command('lkj-open');
  simulation.command('callout');
  let tractionZero = false;
  let initialBrake = false;
  let secured = false;
  for (let index = 0; index < 40_000 && !simulation.state.completed; index += 1) {
    const state = simulation.state;
    if (state.distance >= SCENARIO.brakingPoint - 50 && !tractionZero) {
      simulation.command('traction', 0);
      tractionZero = true;
    }
    if (state.distance >= SCENARIO.brakingPoint && !initialBrake) {
      simulation.command('auto-brake', 1);
      simulation.command('side-release', true);
      simulation.command('side-release', false);
      initialBrake = true;
    }
    if (state.stopped && !secured) {
      simulation.command('auto-brake', 3);
      simulation.command('independent-brake', 5);
      secured = true;
    }
    simulation.tick(.05);
  }
  return simulation;
}

test('教学基线采用40公里50千帕280米及30/20公里观速点', () => {
  assert.equal(SCENARIO.initialSpeed, 40);
  assert.equal(SCENARIO.targetDistance - SCENARIO.brakingPoint, 280);
  assert.equal(SCENARIO.targetDistance - SCENARIO.checkPoint, 120);
  assert.equal(SCENARIO.targetDistance - SCENARIO.lowSpeedPoint, 50);
  assert.equal(targetCurveSpeed(280), 40);
  assert.equal(targetCurveSpeed(120), 30);
  assert.equal(targetCurveSpeed(50), 20);
  assert.equal(brakingDistanceForSpeed(40), 280);
  assert.equal(brakingDistanceForSpeed(41), 300);
  assert.equal(brakingDistanceForSpeed(42), 320);
  assert.deepEqual(trainingBand(120), { target: 30, minimum: 27, maximum: 33 });
  assert.equal(SCENARIO.exitSignalDistance - SCENARIO.brakingPoint, 841);
  assert.equal(SCENARIO.exitSignalDistance - SCENARIO.checkPoint, 681);
  assert.equal(SCENARIO.exitSignalDistance - SCENARIO.lowSpeedPoint, 611);
  assert.equal(SCENARIO.exitSignalDistance - SCENARIO.targetDistance, 561);
});

test('牵引4级给定40公里且达到给定速度后不继续加速', () => {
  const simulation = new TerminalStoppingSimulation('assessment');
  simulation.start();
  assert.equal(simulation.state.traction, 4);
  assert.equal(simulation.state.tractionTargetSpeed, 40);
  let maximumSpeed = simulation.state.speed;
  for (let index = 0; index < 1_200; index += 1) {
    simulation.tick(.05);
    maximumSpeed = Math.max(maximumSpeed, simulation.state.speed);
  }
  assert.ok(maximumSpeed <= 40.05, `maximum speed ${maximumSpeed}`);
  assert.ok(simulation.state.speed >= 39.8, `held speed ${simulation.state.speed}`);
});

test('LKJ在进站信号机处将站内线路限速切换为45公里', () => {
  assert.equal(lkjCurvesAt(SCENARIO.entryDistance - .1).lineLimit, 80);
  assert.equal(lkjCurvesAt(SCENARIO.entryDistance - .1).activeLimit, 80);
  assert.equal(lkjCurvesAt(SCENARIO.entryDistance).lineLimit, 45);
  assert.equal(lkjCurvesAt(SCENARIO.entryDistance).activeLimit, 45);
  assert.equal(lkjCurvesAt(SCENARIO.targetDistance).activeLimit, 45);
});

test('正线进站停车使用黄灯且初始位置与进站信号保持足够距离', () => {
  const entry = SCENARIO.signals.find((signal) => signal.id === 'entry');
  const exit = SCENARIO.signals.find((signal) => signal.id === 'exit');
  assert.equal(entry.aspect, 'yellow');
  assert.equal(exit.aspect, 'redYellow');
  assert.ok(entry.distance >= 450);
  assert.equal(SCENARIO.startOffset + entry.distance, SCENARIO.routeWindow.entrySignalDistance);
  assert.equal(SCENARIO.startOffset + SCENARIO.targetDistance, 29600);
});

test('学员姓名学号校验并仅写入指定会话存储', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(validateCandidate({ name: '张三', studentId: '20260001' }).valid, true);
  assert.equal(validateCandidate({ name: '张三1', studentId: '20260001' }).valid, false);
  saveCandidateDraft({ name: ' 张三 ', studentId: '20260001' }, storage);
  assert.deepEqual(loadCandidateDraft(storage), { name: '张三', studentId: '20260001' });
  const attempt = createCandidateAttempt({ name: '张三', studentId: '20260001' }, new Date('2026-10-28T00:00:00Z'));
  assert.equal(attempt.startedAt, '2026-10-28T00:00:00.000Z');
});

test('训练与考核状态完全隔离', () => {
  const training = new TerminalStoppingSimulation('training');
  const assessment = new TerminalStoppingSimulation('assessment');
  training.command('traction', 0);
  assert.equal(training.state.traction, 0);
  assert.equal(assessment.state.traction, SCENARIO.initialTraction);
  assert.equal(training.state.mode, 'training');
  assert.equal(assessment.state.mode, 'assessment');
});

test('教学模式在讲解节点冻结且考评模式不冻结', () => {
  const teaching = new TerminalStoppingSimulation('training');
  teaching.start();
  assert.equal(teaching.state.status, 'teaching-paused');
  assert.equal(teaching.state.teachingPause?.id, 'brake-strength');
  teaching.command('teaching-continue');
  assert.equal(teaching.state.status, 'running');
  const assessment = new TerminalStoppingSimulation('assessment');
  assessment.start();
  assert.equal(assessment.state.status, 'running');
  assert.equal(assessment.state.teachingPause, null);
});

test('既有一段制动基线保持在0.5米内且旧的制动前回零顺序不再满分', () => {
  const simulation = runStandard();
  const result = new TerminalStoppingAssessment(simulation).result();
  assert.equal(simulation.state.completed, true);
  assert.ok(Math.abs(simulation.state.stopError) <= .5, `stop error ${simulation.state.stopError}`);
  assert.ok(result.checkpoints.initialBrakeSpeed >= 39 && result.checkpoints.initialBrakeSpeed <= 42);
  assert.ok(result.checkpoints.observe30Remaining >= 105 && result.checkpoints.observe30Remaining <= 135);
  assert.ok(result.checkpoints.observe20Remaining >= 40 && result.checkpoints.observe20Remaining <= 60);
  assert.equal(result.secured, true);
  assert.equal(result.redline, false);
  assert.equal(result.qualified, true);
  assert.equal(result.categories.find((item) => item.name === '制动前准备').score, 9);
  assert.equal(result.score, 94);
});

test('旅客列车先制动稳定5秒后逐级退回主手柄才取得退牵满分', () => {
  const correct = new TerminalStoppingSimulation('assessment');
  correct.start();
  correct.state.distance = SCENARIO.brakingPoint;
  correct.command('auto-brake', 1);
  for (let index = 0; index < 102; index += 1) correct.tick(.05);
  for (const notch of [3, 2, 1, 0]) correct.command('traction', notch);
  const correctResult = new TerminalStoppingAssessment(correct).result();
  assert.equal(correctResult.categories.find((item) => item.name === '制动前准备').score, 15);
  assert.equal(new TerminalStoppingAssessment(correct).progress().checks[2], true);

  const wrong = new TerminalStoppingSimulation('assessment');
  wrong.start();
  wrong.command('traction', 0);
  wrong.state.distance = SCENARIO.brakingPoint;
  wrong.command('auto-brake', 1);
  const wrongResult = new TerminalStoppingAssessment(wrong).result();
  assert.equal(wrongResult.categories.find((item) => item.name === '制动前准备').score, 9);
  assert.equal(new TerminalStoppingAssessment(wrong).progress().checks[2], false);
});

test('教学模式必须完成末节点讲解和停车防溜后才结束', () => {
  const teaching = new TerminalStoppingSimulation('training');
  teaching.start();
  teaching.command('teaching-continue');
  teaching.state.stopped = true;
  teaching.state.speed = 0;
  teaching.state.stopError = 0;
  teaching.state.status = 'running';
  teaching.pauseTeaching('stop-alignment');
  for (let index = 0; index < 400; index += 1) teaching.tick(.05);
  assert.equal(teaching.state.completed, false);
  teaching.command('teaching-continue');
  assert.equal(teaching.state.completed, false);
  teaching.command('auto-brake', 3);
  teaching.command('independent-brake', 5);
  for (let index = 0; index < 400 && !teaching.state.completed; index += 1) teaching.tick(.05);
  assert.equal(teaching.state.completed, true);
});

test('未按停车目标制动会越标并触发安全红线', () => {
  const simulation = new TerminalStoppingSimulation('assessment');
  simulation.start();
  simulation.command('traction', 0);
  for (let index = 0; index < 30_000 && !simulation.state.stopped; index += 1) simulation.tick(.05);
  const result = new TerminalStoppingAssessment(simulation).result();
  assert.ok(simulation.state.events.some((event) => event.type === 'target-overrun'));
  assert.equal(result.redline, true);
  assert.equal(result.qualified, false);
});

test('动力制动或运行中使用单阀会被记录并扣分', () => {
  const simulation = new TerminalStoppingSimulation('assessment');
  simulation.start();
  simulation.command('traction', -1);
  simulation.command('independent-brake', 1);
  const result = new TerminalStoppingAssessment(simulation).result();
  assert.ok(simulation.state.events.some((event) => event.type === 'electric-brake-use'));
  assert.ok(simulation.state.events.some((event) => event.type === 'independent-brake-moving'));
  assert.ok(result.categories.find((item) => item.name === '制动机操纵').score < 25);
});

test('运行中或牵引未回零时换向手柄受联锁阻止并记录红线尝试', () => {
  const simulation = new TerminalStoppingSimulation('assessment');
  simulation.start();
  assert.equal(simulation.command('direction', 'N'), false);
  assert.equal(simulation.state.direction, 'F');
  assert.ok(simulation.state.events.some((event) => event.type === 'direction-while-moving' && event.blocked));
});

test('单缓只缓解机车制动缸且松手后恢复自动制动作用', () => {
  const simulation = new TerminalStoppingSimulation('training');
  simulation.start();
  simulation.command('teaching-continue');
  simulation.command('traction', 0);
  simulation.command('auto-brake', 1);
  for (let index = 0; index < 200; index += 1) simulation.tick(.05);
  const beforeRelease = simulation.state.locomotiveCylinder;
  simulation.command('side-release', true);
  for (let index = 0; index < 80; index += 1) simulation.tick(.05);
  const duringRelease = simulation.state.locomotiveCylinder;
  assert.ok(duringRelease < beforeRelease * .35, `${beforeRelease} -> ${duringRelease}`);
  assert.ok(simulation.state.brakeCylinder > duringRelease);
  simulation.command('side-release', false);
  for (let index = 0; index < 80; index += 1) simulation.tick(.05);
  assert.ok(simulation.state.locomotiveCylinder > duringRelease);
});

test('停车标位于原大山铺站台有效范围内', () => {
  const targetWorldDistance = SCENARIO.startOffset + SCENARIO.targetDistance;
  assert.equal(SCENARIO.sourcePlatform.shape, 'platform-300m-no-awning.s');
  assert.equal(SCENARIO.sourcePlatform.uid, 50695);
  assert.ok(targetWorldDistance >= SCENARIO.sourcePlatform.worldStart);
  assert.ok(targetWorldDistance <= SCENARIO.sourcePlatform.worldEnd);
  assert.ok(SCENARIO.routeWindow.start < SCENARIO.startOffset);
  assert.ok(SCENARIO.routeWindow.end > SCENARIO.exitSignalDistance + SCENARIO.startOffset);
});

test('终到场景包含原站台和移动端兼容的原地形资产', () => {
  const sceneUrl = new URL('../assets/msts-neiyi-corridor/neiyi-dashanpu-terminal-scene.json', import.meta.url);
  const scene = JSON.parse(readFileSync(sceneUrl, 'utf8'));
  const terrain = JSON.parse(readFileSync(new URL('../assets/msts-neiyi-corridor/neiyi-dashanpu-terrain-native.json', import.meta.url), 'utf8'));
  const platform = scene.instances.find((item) => item.uid === SCENARIO.sourcePlatform.uid);
  assert.equal(platform?.shape, SCENARIO.sourcePlatform.shape);
  assert.ok(scene.summary.instanceCount < 1_000, `terminal instances ${scene.summary.instanceCount}`);
  assert.ok(statSync(sceneUrl).size < 1_500_000, `terminal scene bytes ${statSync(sceneUrl).size}`);
  assert.equal(terrain.summary.tileCount, 6);
  assert.equal(terrain.summary.resolution, 129);
  assert.equal(terrain.tiles.length, 6);
  assert.ok(terrain.tiles.every((tile) => tile.resolution === 129 && tile.heights.length === 129 * 129));
});

test('终到裁剪场景引用的全部纹理均可发布', () => {
  const scene = JSON.parse(readFileSync(new URL('../assets/msts-neiyi-corridor/neiyi-dashanpu-terminal-scene.json', import.meta.url), 'utf8'));
  const textureRoot = fileURLToPath(new URL('../assets/msts-neiyi-corridor/textures/', import.meta.url));
  const aliases = {
    'acleanttrack1.png': 'ACleanTrack1.png',
    'acleanttrack2.png': 'ACleanTrack2.png',
    'acleantrack1.png': 'ACleanTrack1.png',
    'acleantrack2.png': 'ACleanTrack2.png',
    'sign.png': 'Sign.png',
  };
  const textures = [...new Set(Object.values(scene.shapes).flatMap((shape) => (
    (shape.materials || []).map((material) => material.texture).filter(Boolean)
  )))];
  const missing = textures.filter((name) => !existsSync(join(textureRoot, aliases[name.toLowerCase()] || name)));
  assert.deepEqual(missing, []);
});

test('远景钢轨使用原生线段而非会产生鼓包的屏幕空间三角带', () => {
  const source = readFileSync(new URL('../scripts/mstsRouteScene.js', import.meta.url), 'utf8');
  assert.match(source, /new THREE\.Line\(geometry, material\)/);
  assert.doesNotMatch(source, /halfWidthPixels/);
  assert.match(source, /entrySignalDistance/);
  assert.match(source, /terminalEntrySignal && definition\.yellow \? 'yellow'/);
});

test('手机端只加载站场裁剪资源且轨道几何限制在终到窗口', () => {
  const sceneSource = readFileSync(new URL('../scripts/mstsRouteScene.js', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../scripts/terminalStoppingApp.js', import.meta.url), 'utf8');
  assert.match(sceneSource, /neiyi-dashanpu-terminal-scene\.json/);
  assert.match(sceneSource, /neiyi-5635-trackdb-path-aligned\.json/);
  assert.doesNotMatch(sceneSource, /fetch\([^\n]+cache:\s*'no-store'/);
  assert.match(sceneSource, /buildSelectedRouteTrack\(renderedRouteDistance, renderedRouteStart\)/);
  assert.match(sceneSource, /buildContinuousRailHeads\(renderedRouteDistance, renderedRouteStart\)/);
  assert.match(appSource, /await routeScene\.loadPromise/);
});

test('操作台、LKJ与CIR沿用途中调速项目的级位和设备逻辑', () => {
  const appSource = readFileSync(new URL('../scripts/terminalStoppingApp.js', import.meta.url), 'utf8');
  const lkjSource = readFileSync(new URL('../scripts/lkjRuntime.js', import.meta.url), 'utf8');
  const cirSource = readFileSync(new URL('../scripts/cirRuntime.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles/terminal-stopping.css', import.meta.url), 'utf8');
  assert.equal(TRACTION_MAX, 12);
  assert.match(appSource, /autoBrakeFrames = \[0, 1, 2, 9, 10, 11\]/);
  assert.match(appSource, /new CirRuntime\(simulation\)/);
  assert.match(appSource, /makePhysical\('打开CIR机车综合无线通信设备'/);
  assert.match(appSource, /dx > 16/);
  assert.match(appSource, /simulation\.command\('side-release', true\)/);
  assert.match(appSource, /simulation\.command\('side-release', false\)/);
  assert.match(appSource, /lostpointercapture/);
  assert.match(appSource, /document\.addEventListener\('pointerup', finishControlDrag, true\)/);
  assert.match(appSource, /window\.addEventListener\('blur'/);
  assert.match(appSource, /makeNeedle\('speedNeedle'/);
  assert.match(appSource, /makeStateSprite\('locomotive-signal'/);
  assert.match(lkjSource, /lkj-native-monitor/);
  assert.match(lkjSource, /routeFacilitiesForScenario/);
  assert.match(cirSource, /CIR-simulator\.html/);
  assert.match(cirSource, /tail-query/);
  assert.match(html, /data-mobile-command="cir"/);
  assert.doesNotMatch(html, /data-mobile-command="side-release"/);
  assert.doesNotMatch(html, /id="data-toggle"|id="data-panel"|运行数据/);
  assert.doesNotMatch(appSource, /renderData\(|#data-toggle|#run-data/);
  assert.doesNotMatch(html, /mobile-control-hint/);
  assert.doesNotMatch(html, /不读取或写入其他训练项目|不会上传到服务器|浏览器存储/);
  assert.match(css, /\.sprite, \.control-position-badge, \.physical-control, \.touch-target \{ pointer-events: auto; \}/);
  assert.match(css, /\.control-position-badge \{[\s\S]*?z-index:\s*9/);
  assert.doesNotMatch(css, /\.control-position-badge\s*\{\s*display:\s*none/);
  assert.match(css, /-webkit-touch-callout:\s*none/);
  assert.match(css, /\.independent-brake\.side-release-active/);
  assert.match(css, /\.lkj-native-speed-line\{stroke:#19df54/);
  assert.match(css, /\.cab-view\[data-view="left"\][\s\S]*?scale\(2\.2\)/);
  assert.match(css, /\.cab-view\[data-view="right"\][\s\S]*?scale\(2\.2\)/);
  assert.match(appSource, /makePhysical\('放大LKJ监控装置'[\s\S]+?\(\) => lkj\.show\(\)/);
});

test('手机场景清晰度与途中调速项目使用同一渲染基线', () => {
  const source = readFileSync(new URL('../scripts/mstsRouteScene.js', import.meta.url), 'utf8');
  assert.match(source, /antialias:\s*true/);
  assert.match(source, /coarse \? 1\.15 : 1\.5/);
  assert.match(source, /texture\.anisotropy = Math\.min\(4,/);
  assert.match(source, /terrainTexture\.anisotropy = Math\.min\(4,/);
});

test('教学界面采用LKJ起闸距离并保留距停车标辅助值', () => {
  const appSource = readFileSync(new URL('../scripts/terminalStoppingApp.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sceneSource = readFileSync(new URL('../scripts/terminalStoppingScene.js', import.meta.url), 'utf8');
  assert.match(html, /id="guide-signal-remaining"/);
  assert.match(html, /起闸时LKJ距出站约841 m/);
  assert.match(html, /id="teaching-pause"/);
  assert.match(html, /教学模式只讲解|不生成成绩/);
  assert.match(appSource, /LKJ距\$\{signalName\}/);
  assert.match(appSource, /距标 \$\{Math\.max\(0, remaining\)/);
  assert.match(sceneSource, /scenario\.targetDistance, -3\.25/);
  assert.match(sceneSource, /机车\\n停车\\n位置/);
  assert.match(sceneSource, /30 km\/h · 120 m/);
  assert.match(sceneSource, /20 km\/h · 50 m/);
});

test('登录、沉浸式全屏与成绩入口沿用途中调速项目流程', () => {
  const appSource = readFileSync(new URL('../scripts/terminalStoppingApp.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="candidate-submit"[\s\S]+?disabled/);
  assert.match(html, /id="candidate-load-status"/);
  assert.match(html, /id="landscape-gate"/);
  assert.match(html, /class="training-app"[^>]+inert/);
  assert.match(html, /id="result-name"/);
  assert.match(html, /id="result-student-id"/);
  assert.match(appSource, /async function enterImmersive\(\)/);
  assert.match(appSource, /requestFullscreen\(\{ navigationUI: 'hide' \}\)/);
  assert.match(appSource, /screen\.orientation\?\.lock\?\.\('landscape'\)/);
  assert.match(appSource, /closeCandidateGate\(\);[\s\S]+?await enterImmersive\(\)/);
  assert.match(appSource, /clearCandidateDraft\(\);[\s\S]+?location\.reload\(\)/);
});
