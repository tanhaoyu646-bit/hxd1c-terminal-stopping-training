import {
  BRAKE_POSITIONS,
  SCENARIO,
  lkjControlLimit,
  phaseAt,
  remainingToTarget,
  signalAt,
  trainingBand,
} from './terminalStoppingConfig.js?v=terminal-station-6';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class TerminalStoppingSimulation extends EventTarget {
  constructor(mode = 'training') {
    super();
    this.reset(mode);
  }

  reset(mode = this.state?.mode || 'training') {
    this.scenario = SCENARIO;
    this.state = {
      scenarioId: SCENARIO.id,
      mode: mode === 'assessment' ? 'assessment' : 'training',
      status: 'ready',
      workflowStage: 'confirm',
      elapsed: 0,
      secureElapsed: 0,
      distance: 0,
      speed: SCENARIO.initialSpeed,
      acceleration: 0,
      traction: SCENARIO.initialTraction,
      direction: 'F',
      autoBrake: 0,
      independentBrake: 0,
      sideRelease: false,
      equalizingReservoir: 600,
      trainPipe: 600,
      brakeCylinder: 0,
      locomotiveCylinder: 0,
      signal: signalAt(0),
      phase: phaseAt(0),
      targetBand: trainingBand(SCENARIO.targetDistance),
      lkjLimit: lkjControlLimit(0),
      lkjLevel: 'normal',
      lkjAcknowledged: true,
      lkjForcedBrake: 0,
      lkjOpenCount: 0,
      calloutCount: 0,
      stopped: false,
      stopDistance: null,
      stopError: null,
      stopSpeed: null,
      completed: false,
      events: [],
      samples: [],
    };
    this.lastSampleAt = -1;
    this.crossed = new Set();
    this.dispatchEvent(new CustomEvent('reset', { detail: this.state }));
    return this.state;
  }

  start() {
    if (this.state.status === 'ready') {
      this.state.status = 'running';
      this.log('attempt-start', { mode: this.state.mode });
      this.emitChange();
    }
  }

  command(type, value) {
    const s = this.state;
    if (s.completed) return false;
    if (s.status === 'ready' && type !== 'lkj-open') this.start();
    const previous = {
      traction: s.traction,
      autoBrake: s.autoBrake,
      independentBrake: s.independentBrake,
      sideRelease: s.sideRelease,
    };

    if (type === 'traction') {
      const next = clamp(Math.round(Number(value) || 0), -8, 7);
      if (s.stopped && next !== 0) this.log('restart-attempt', { value: next });
      if (!s.stopped) s.traction = next;
      if (next < 0 && s.speed > 1) this.log('electric-brake-use', { value: next });
    } else if (type === 'auto-brake') {
      s.autoBrake = clamp(Math.round(Number(value) || 0), 0, 5);
      const application = s.autoBrake > 0 && previous.autoBrake === 0;
      if (application) {
        const previousApplications = s.events.filter((event) => event.type === 'brake-application').length;
        this.log('brake-application', { ordinal: previousApplications + 1, value: s.autoBrake });
        if (previousApplications === 0) s.workflowStage = 'initial-brake';
      }
      if (s.autoBrake > previous.autoBrake && previous.autoBrake > 0) {
        this.log('brake-addition', { from: previous.autoBrake, to: s.autoBrake });
        s.workflowStage = 'correction';
      }
    } else if (type === 'independent-brake') {
      s.independentBrake = clamp(Math.round(Number(value) || 0), 0, 5);
      if (!s.stopped && s.speed >= 3 && s.independentBrake > previous.independentBrake) {
        this.log('independent-brake-moving', { value: s.independentBrake });
      }
    } else if (type === 'side-release') {
      s.sideRelease = Boolean(value);
    } else if (type === 'direction') {
      if (s.speed > 1) this.log('direction-while-moving', { value });
      s.direction = value;
    } else if (type === 'callout') {
      s.calloutCount += 1;
      this.log('callout', { signal: s.signal.id, aspect: s.signal.aspect });
    } else if (type === 'lkj-open') {
      s.lkjOpenCount += 1;
      this.log('lkj-open');
    } else if (type === 'lkj-ack') {
      s.lkjAcknowledged = true;
      this.log('lkj-ack', { level: s.lkjLevel });
    } else if (type === 'lkj-relief') {
      if (s.lkjLevel === 'normal' && s.speed <= s.lkjLimit + 1) {
        s.lkjForcedBrake = 0;
        this.log('lkj-relief', { accepted: true });
      } else this.log('lkj-relief', { accepted: false });
    } else return false;

    if (['traction', 'auto-brake', 'independent-brake', 'side-release'].includes(type)) {
      const key = type === 'auto-brake' ? 'autoBrake' : type === 'independent-brake' ? 'independentBrake' : type === 'side-release' ? 'sideRelease' : 'traction';
      this.log(type, { value: s[key], previous });
    }
    this.maybeCompleteSecure();
    this.emitChange();
    return true;
  }

  log(type, data = {}) {
    const s = this.state;
    s.events.push({ type, elapsed: s.elapsed, distance: s.distance, remaining: remainingToTarget(s.distance), speed: s.speed, ...data });
  }

  tick(dt) {
    const s = this.state;
    if (s.status !== 'running' || s.completed) return;
    dt = clamp(Number(dt) || 0, 0, 0.08);
    s.elapsed += dt;
    if (s.stopped) s.secureElapsed += dt;

    const requestedReduction = BRAKE_POSITIONS[Math.max(s.autoBrake, s.lkjForcedBrake)]?.reduction || 0;
    const targetPipe = Math.max(0, 600 - requestedReduction);
    const pipeTau = targetPipe < s.trainPipe ? 5.4 : 14;
    s.trainPipe += (targetPipe - s.trainPipe) * (1 - Math.exp(-dt / pipeTau));
    s.equalizingReservoir += (targetPipe - s.equalizingReservoir) * (1 - Math.exp(-dt / 2.4));
    const automaticCylinder = clamp((600 - s.trainPipe) / 170 * 350, 0, 430);
    const independentCylinder = s.independentBrake * 62;
    s.brakeCylinder += (Math.max(automaticCylinder, independentCylinder) - s.brakeCylinder) * (1 - Math.exp(-dt / 2.1));
    const desiredLoco = s.sideRelease ? independentCylinder : Math.max(automaticCylinder, independentCylinder);
    s.locomotiveCylinder += (desiredLoco - s.locomotiveCylinder) * (1 - Math.exp(-dt / 1.4));

    const previousDistance = s.distance;
    if (!s.stopped) {
      const speedMps = s.speed / 3.6;
      const tractionForce = s.traction > 0 && s.autoBrake === 0 && s.lkjForcedBrake === 0
        ? s.traction * 35_000 * clamp(1.08 - s.speed / 180, 0.45, 1)
        : 0;
      const electricBrake = s.traction < 0 ? Math.abs(s.traction) * 42_000 : 0;
      const rollingResistance = s.speed > 0.2 ? 28_000 + speedMps * speedMps * 8 : 0;
      const lowStageForce = automaticCylinder * 600;
      const highStageForce = Math.max(0, automaticCylinder - 110) * 4_000;
      const pneumaticForce = lowStageForce + highStageForce;
      const netForce = tractionForce - electricBrake - rollingResistance - pneumaticForce;
      const newAcceleration = netForce / 900_000;
      s.acceleration += (newAcceleration - s.acceleration) * (1 - Math.exp(-dt / 0.65));
      s.speed = Math.max(0, s.speed + s.acceleration * dt * 3.6);
      s.distance += s.speed / 3.6 * dt;
    } else {
      s.speed = 0;
      s.acceleration = 0;
    }

    const remaining = remainingToTarget(s.distance);
    s.targetBand = trainingBand(remaining);
    s.phase = phaseAt(s.distance, s.stopped);
    s.signal = signalAt(s.distance);
    s.lkjLimit = lkjControlLimit(s.distance);
    this.updateWorkflow(previousDistance);
    this.updateLkjProtection();

    if (s.elapsed - this.lastSampleAt >= 0.25) {
      this.lastSampleAt = s.elapsed;
      s.samples.push({
        elapsed: s.elapsed,
        distance: s.distance,
        remaining,
        speed: s.speed,
        target: s.targetBand.target,
        limit: s.lkjLimit,
        pipe: s.trainPipe,
        brake: s.autoBrake,
        traction: s.traction,
        acceleration: s.acceleration,
      });
      if (s.samples.length > 1_500) s.samples.shift();
    }

    if (!s.stopped && s.speed <= 0.18 && s.distance > SCENARIO.brakingPoint) this.registerStop();
    if (!s.stopped && s.distance > SCENARIO.targetDistance + 5 && s.speed > 3 && !this.crossed.has('overrun')) {
      this.crossed.add('overrun');
      this.log('target-overrun');
    }
    if (!s.stopped && s.distance > SCENARIO.finishDistance) s.lkjForcedBrake = 5;
    if (s.stopped) this.maybeCompleteSecure();
    if (s.stopped && s.secureElapsed >= 12) this.complete();
    this.emitChange();
  }

  updateWorkflow(previousDistance) {
    const s = this.state;
    const checkpoints = [
      ['braking-point', SCENARIO.brakingPoint],
      ['check-point', SCENARIO.checkPoint],
      ['low-speed-point', SCENARIO.lowSpeedPoint],
      ['target-point', SCENARIO.targetDistance],
    ];
    for (const [id, distance] of checkpoints) {
      if (!this.crossed.has(id) && previousDistance < distance && s.distance >= distance) {
        this.crossed.add(id);
        this.log(id, { checkpointDistance: distance });
      }
    }
    if (!s.stopped) {
      if (s.distance >= SCENARIO.lowSpeedPoint) s.workflowStage = 'alignment';
      else if (s.distance >= SCENARIO.checkPoint) s.workflowStage = 'correction';
      else if (s.distance >= SCENARIO.brakingPoint && s.workflowStage === 'confirm') s.workflowStage = 'observe';
      else if (s.distance >= 200 && s.workflowStage === 'confirm') s.workflowStage = 'prepare';
    }
  }

  registerStop() {
    const s = this.state;
    s.stopped = true;
    s.status = 'running';
    s.workflowStage = 'secure';
    s.stopDistance = s.distance;
    s.stopError = s.distance - SCENARIO.targetDistance;
    s.stopSpeed = s.speed;
    s.speed = 0;
    this.log('train-stop', { stopDistance: s.stopDistance, stopError: s.stopError });
    this.maybeCompleteSecure();
  }

  maybeCompleteSecure() {
    const s = this.state;
    if (!s.stopped || s.completed) return;
    const reduction = 600 - s.trainPipe;
    if (reduction >= 95 && s.independentBrake >= 5) this.complete();
  }

  complete() {
    const s = this.state;
    if (s.completed) return;
    s.completed = true;
    s.status = 'completed';
    this.log('attempt-complete', { secured: 600 - s.trainPipe >= 95 && s.independentBrake >= 5 });
    this.dispatchEvent(new CustomEvent('complete', { detail: s }));
  }

  updateLkjProtection() {
    const s = this.state;
    if (s.stopped) {
      s.lkjLevel = 'normal';
      return;
    }
    const excess = s.speed - s.lkjLimit;
    const previous = s.lkjLevel;
    if (excess >= 8) { s.lkjLevel = 'emergency'; s.lkjForcedBrake = 5; }
    else if (excess >= 5) { s.lkjLevel = 'service'; s.lkjForcedBrake = Math.max(s.lkjForcedBrake, 3); }
    else if (excess >= 3) s.lkjLevel = 'unload';
    else if (excess >= 2) s.lkjLevel = 'warning';
    else s.lkjLevel = 'normal';
    if (s.lkjLevel !== previous) {
      if (s.lkjLevel !== 'normal') s.lkjAcknowledged = false;
      this.log('lkj-level', { from: previous, to: s.lkjLevel, excess });
    }
  }

  trainingHint() {
    const s = this.state;
    if (s.mode !== 'training') return '考核模式仅记录操作，不显示答案';
    const remaining = remainingToTarget(s.distance);
    const hasInitialBrake = s.events.some((event) => event.type === 'brake-application');
    if (s.stopped) return 600 - s.trainPipe < 95 || s.independentBrake < 5
      ? '停车后：自阀追加至减压 100 kPa 以上，单阀置全制动位'
      : '停车防溜完成';
    if (remaining > SCENARIO.targetDistance - SCENARIO.tractionZeroPoint) {
      return '进站确认：查看 LKJ、确认进站黄灯并呼唤，距标约 720 m 前准备牵引回零';
    }
    if (remaining > 400) return s.traction === 0
      ? '牵引已回零：保持瞭望，控制 38–42 km/h，准备 400 m 初减'
      : '已到牵引回零点：立即将牵引手柄回零';
    if (!hasInitialBrake) return '已进入初减区：立即实施约 50 kPa 初减压，不要继续等待';
    if (remaining > 100) return `保持初减并观察减速，当前参考 ${s.targetBand.minimum.toFixed(0)}–${s.targetBand.maximum.toFixed(0)} km/h`;
    if (remaining > 50) return s.speed > 31
      ? '100 m 校速偏高：排风停止后追加，单次追加不得超过初减量'
      : s.speed < 27
        ? '100 m 校速偏低：稳住，不要急于追加或缓解'
        : '100 m 校速合适：小量追加，准备低速对标';
    return '低速接近：保持空气制动，禁止用单阀或动力制动代替列车制动';
  }

  emitChange() {
    this.dispatchEvent(new CustomEvent('change', { detail: this.state }));
  }
}
