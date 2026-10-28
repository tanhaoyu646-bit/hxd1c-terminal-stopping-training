import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCENARIO, targetCurveSpeed, trainingBand } from '../scripts/terminalStoppingConfig.js';
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
  let addition = false;
  let secured = false;
  for (let index = 0; index < 40_000 && !simulation.state.completed; index += 1) {
    const state = simulation.state;
    if (state.distance >= SCENARIO.tractionZeroPoint && !tractionZero) {
      simulation.command('traction', 0);
      tractionZero = true;
    }
    if (state.distance >= SCENARIO.brakingPoint && !initialBrake) {
      simulation.command('auto-brake', 1);
      simulation.command('side-release', true);
      initialBrake = true;
    }
    if (state.distance >= SCENARIO.checkPoint && !addition) {
      simulation.command('auto-brake', 2);
      addition = true;
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

test('教学基线包含40-400-100-30和50米低速观察点', () => {
  assert.equal(SCENARIO.targetDistance - SCENARIO.brakingPoint, 400);
  assert.equal(SCENARIO.targetDistance - SCENARIO.checkPoint, 100);
  assert.equal(SCENARIO.targetDistance - SCENARIO.lowSpeedPoint, 50);
  assert.equal(targetCurveSpeed(400), 40);
  assert.equal(targetCurveSpeed(100), 30);
  assert.equal(targetCurveSpeed(50), 20);
  assert.deepEqual(trainingBand(100), { target: 30, minimum: 27.5, maximum: 32.5 });
});

test('正线进站停车使用黄灯且初始位置与进站信号保持足够距离', () => {
  const entry = SCENARIO.signals.find((signal) => signal.id === 'entry');
  assert.equal(entry.aspect, 'yellow');
  assert.ok(entry.distance >= 300);
  assert.equal(SCENARIO.startOffset + entry.distance, SCENARIO.routeWindow.entrySignalDistance);
  assert.equal(SCENARIO.startOffset + SCENARIO.targetDistance, 29630);
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

test('标准一段制动轨迹可在0.5米内对标并完成停车防溜', () => {
  const simulation = runStandard();
  const result = new TerminalStoppingAssessment(simulation).result();
  assert.equal(simulation.state.completed, true);
  assert.ok(Math.abs(simulation.state.stopError) <= .5, `stop error ${simulation.state.stopError}`);
  assert.ok(result.checkpoints.braking >= 37 && result.checkpoints.braking <= 43);
  assert.ok(result.checkpoints.check >= 27 && result.checkpoints.check <= 32);
  assert.equal(result.secured, true);
  assert.equal(result.redline, false);
  assert.equal(result.qualified, true);
  assert.equal(result.score, 100);
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
  const scene = JSON.parse(readFileSync(new URL('../assets/msts-neiyi-corridor/neiyi-lookout-full-scene.json', import.meta.url), 'utf8'));
  const terrain = JSON.parse(readFileSync(new URL('../assets/msts-neiyi-corridor/neiyi-dashanpu-terrain-native.json', import.meta.url), 'utf8'));
  const platform = scene.instances.find((item) => item.uid === SCENARIO.sourcePlatform.uid);
  assert.equal(platform?.shape, SCENARIO.sourcePlatform.shape);
  assert.equal(terrain.summary.tileCount, 6);
  assert.equal(terrain.summary.resolution, 129);
  assert.equal(terrain.tiles.length, 6);
  assert.ok(terrain.tiles.every((tile) => tile.resolution === 129 && tile.heights.length === 129 * 129));
});

test('远景钢轨使用原生线段而非会产生鼓包的屏幕空间三角带', () => {
  const source = readFileSync(new URL('../scripts/mstsRouteScene.js', import.meta.url), 'utf8');
  assert.match(source, /new THREE\.Line\(geometry, material\)/);
  assert.doesNotMatch(source, /halfWidthPixels/);
  assert.match(source, /entrySignalDistance/);
  assert.match(source, /terminalEntrySignal && definition\.yellow \? 'yellow'/);
});
