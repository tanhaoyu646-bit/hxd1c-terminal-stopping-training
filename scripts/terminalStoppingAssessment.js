import { SCENARIO } from './terminalStoppingConfig.js?v=terminal-station-7';

const between = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const clampScore = (value, maximum) => Math.max(0, Math.min(maximum, Math.round(value)));

export class TerminalStoppingAssessment {
  constructor(simulation) {
    this.simulation = simulation;
  }

  progress(state = this.simulation.state) {
    const events = state.events;
    const firstBrake = events.find((event) => event.type === 'brake-application');
    const checks = [
      events.some((event) => event.type === 'lkj-open'),
      events.some((event) => event.type === 'callout'),
      events.some((event) => event.type === 'traction' && event.value === 0 && event.distance < SCENARIO.brakingPoint),
      Boolean(firstBrake),
      events.some((event) => event.type === 'side-release' && event.value && firstBrake && Math.abs(event.distance - firstBrake.distance) <= 80),
      events.some((event) => event.type === 'check-point'),
      events.some((event) => event.type === 'brake-addition'),
      events.some((event) => event.type === 'train-stop'),
      events.some((event) => event.type === 'attempt-complete' && event.secured),
      state.completed,
    ];
    return { done: checks.filter(Boolean).length, total: checks.length, checks };
  }

  result(state = this.simulation.state) {
    const events = state.events;
    const firstBrake = events.find((event) => event.type === 'brake-application');
    const brakingPoint = events.find((event) => event.type === 'braking-point');
    const checkPoint = events.find((event) => event.type === 'check-point');
    const lowSpeedPoint = events.find((event) => event.type === 'low-speed-point');
    const additions = events.filter((event) => event.type === 'brake-addition');
    const releasesAfterBrake = firstBrake
      ? events.filter((event) => event.type === 'auto-brake' && event.elapsed > firstBrake.elapsed && event.value === 0)
      : [];
    const secured = events.some((event) => event.type === 'attempt-complete' && event.secured);

    let confirmation = 10;
    if (!events.some((event) => event.type === 'lkj-open')) confirmation -= 4;
    if (!events.some((event) => event.type === 'callout')) confirmation -= 6;

    let preparation = 15;
    const tractionZero = events.find((event) => event.type === 'traction' && event.value === 0);
    if (!tractionZero || tractionZero.distance >= SCENARIO.brakingPoint) preparation -= 6;
    if (!firstBrake || !between(firstBrake.remaining, 370, 430)) preparation -= 5;
    if (!firstBrake || !between(firstBrake.speed, 37, 43)) preparation -= 4;

    let brakeUse = 25;
    if (!firstBrake) brakeUse = 0;
    else if (firstBrake.value !== 1) brakeUse -= 6;
    if (additions.length > 2) brakeUse -= Math.min(6, (additions.length - 2) * 3);
    if (additions.some((event) => event.to - event.from > 1)) brakeUse -= 5;
    if (releasesAfterBrake.length) brakeUse -= 4;
    if (events.some((event) => event.type === 'electric-brake-use')) brakeUse -= 5;
    if (events.some((event) => event.type === 'independent-brake-moving')) brakeUse -= 4;
    const sideRelease = events.find((event) => event.type === 'side-release' && event.value);
    if (!sideRelease || !firstBrake || Math.abs(sideRelease.distance - firstBrake.distance) > 80) brakeUse -= 3;

    let checkpoints = 20;
    if (!brakingPoint || !between(brakingPoint.speed, 37, 43)) checkpoints -= 6;
    if (!checkPoint || !between(checkPoint.speed, 27, 32)) checkpoints -= 9;
    if (!lowSpeedPoint || !between(lowSpeedPoint.speed, 14, 24)) checkpoints -= 5;

    const absoluteError = Math.abs(state.stopError ?? Number.POSITIVE_INFINITY);
    let accuracy = 0;
    if (absoluteError <= 0.5) accuracy = 20;
    else if (absoluteError <= 1) accuracy = 18;
    else if (absoluteError <= 2) accuracy = 15;
    else if (absoluteError <= 5) accuracy = 8;
    else if (absoluteError <= 10) accuracy = 3;

    let smoothness = 10;
    const samples = state.samples;
    const maxDeceleration = Math.abs(Math.min(0, ...samples.map((sample) => sample.acceleration || 0)));
    if (maxDeceleration > 0.7) smoothness -= 3;
    if (maxDeceleration > 1) smoothness -= 3;
    if (!secured) smoothness -= 4;

    const categories = [
      { name: '瞭望确认', score: clampScore(confirmation, 10), maximum: 10 },
      { name: '制动前准备', score: clampScore(preparation, 15), maximum: 15 },
      { name: '制动机操纵', score: clampScore(brakeUse, 25), maximum: 25 },
      { name: '速度距离控制', score: clampScore(checkpoints, 20), maximum: 20 },
      { name: '停车精度', score: clampScore(accuracy, 20), maximum: 20 },
      { name: '平稳与防溜', score: clampScore(smoothness, 10), maximum: 10 },
    ];

    const safetyEvents = events.filter((event) => (
      event.type === 'target-overrun'
      || event.type === 'restart-attempt'
      || event.type === 'direction-while-moving'
      || (event.type === 'lkj-level' && ['service', 'emergency'].includes(event.to))
    ));
    const redline = safetyEvents.length > 0 || absoluteError > 10;
    let score = categories.reduce((sum, category) => sum + category.score, 0);
    if (redline) score = Math.min(score, 59);
    const qualified = state.stopped && !redline && absoluteError <= SCENARIO.passTolerance && score >= 80;

    return {
      score,
      qualified,
      redline,
      categories,
      stopError: state.stopError,
      stopDistance: state.stopDistance,
      duration: state.elapsed,
      maxDeceleration,
      secured,
      summary: qualified ? '考评合格' : '考评不合格',
      safetyEvents,
      checkpoints: {
        braking: brakingPoint?.speed ?? null,
        check: checkPoint?.speed ?? null,
        low: lowSpeedPoint?.speed ?? null,
      },
    };
  }
}
