export const PROJECT_ID = 'hxd1c-terminal-stopping-v1';

export const CAB = Object.freeze({ width: 640, height: 480 });

// 与“途中调速虚拟实训系统”保持同一主手柄级位定义：
// 0位为零位，正向1—12级分别对应10—120 km/h速度给定。
export const TRACTION_MAX = 12;
export const DYNAMIC_BRAKE_MAX = 8;
export const TRACTION_TARGET_SPEEDS = Object.freeze([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);

export function tractionTargetSpeed(notch) {
  return TRACTION_TARGET_SPEEDS[Math.max(0, Math.min(TRACTION_MAX, Math.round(Number(notch) || 0)))] || 0;
}

export const SCENARIO = Object.freeze({
  id: 'standardPassenger',
  title: '终到站一段制动精准对标',
  shortTitle: '终到对标',
  initialSpeed: 40,
  initialTraction: 4,
  operatingGrade: 0,
  startOffset: 28497,
  targetDistance: 1103,
  platformStart: 877,
  platformEnd: 1187,
  tractionZeroPoint: 773,
  brakingPoint: 823,
  checkPoint: 983,
  lowSpeedPoint: 1053,
  exitSignalDistance: 1664,
  finishDistance: 1125,
  entryDistance: 500,
  maximumEntrySpeed: 45,
  baselineSpeed: 40,
  baselineReduction: 50,
  standardBrakeDistance: 280,
  speedIncrementDistance: 20,
  observation30Remaining: 120,
  observation20Remaining: 50,
  targetTolerance: 0.5,
  passTolerance: 2,
  stationName: '大山铺',
  entrySignalName: '大山铺站进站信号机',
  targetName: '旅客列车停车位置标',
  routeLabel: '区间—大山铺站 Ⅰ 道',
  lkj: Object.freeze({
    lineName: '内宜线',
    sectionCode: '226',
    trainNumber: '57001',
    trainKind: '客本',
    trainWeight: 900,
    carCount: 18,
    trainLength: 42.0,
    speedGrade: 80,
    locomotive: 'HXD1C',
    startKilometer: 225.591,
  }),
  lineLimits: Object.freeze([
    Object.freeze({ start: -1_000, end: 500, limit: 80 }),
    Object.freeze({ start: 500, end: 1_713, limit: 45 }),
  ]),
  controlTargets: Object.freeze([
    Object.freeze({ distance: 1_664, speed: 0, holdUntil: 1_713, serviceDeceleration: 0.56 }),
  ]),
  sourcePlatform: {
    shape: 'platform-300m-no-awning.s',
    uid: 50695,
    worldStart: 29373.7,
    worldEnd: 29683.7,
  },
  routeWindow: {
    start: 27900,
    end: 30550,
    lateral: 650,
    entrySignalDistance: 28997,
    redSignalDistance: 30161,
  },
  signals: [
    { id: 'entry', label: '进站信号机', distance: 500, aspect: 'yellow' },
    { id: 'exit', label: '出站信号机', distance: 1664, aspect: 'redYellow' },
  ],
  phases: [
    { id: 'confirm', start: 0, end: 500, label: '进站确认' },
    { id: 'prepare', start: 500, end: 823, label: '起闸准备' },
    { id: 'observe', start: 823, end: 983, label: '30 km/h观速' },
    { id: 'correct', start: 983, end: 1053, label: '20 km/h观速' },
    { id: 'align', start: 1053, end: 1125, label: '低速对标' },
  ],
});

export const BRAKE_POSITIONS = Object.freeze([
  { value: 0, label: '运转位', reduction: 0 },
  { value: 1, label: '初制位', reduction: 50 },
  { value: 2, label: '常用Ⅱ', reduction: 90 },
  { value: 3, label: '常用Ⅲ', reduction: 130 },
  { value: 4, label: '常用Ⅳ', reduction: 170 },
  { value: 5, label: '紧急位', reduction: 600 },
]);

export const LKJ_KEYS = Object.freeze([
  ['alarm', '警惕', 12, 533, 61, 59],
  ['unlock', '解锁', 91, 520, 62, 40], ['relief', '缓解', 91, 563, 62, 40],
  ['digit-1', '向前／1', 161, 520, 63, 40], ['digit-6', '向后／6', 161, 563, 63, 40],
  ['digit-2', '调车／2', 231, 520, 63, 40], ['digit-7', '开车／7', 231, 563, 63, 40],
  ['digit-3', '车位／3', 301, 520, 63, 40], ['digit-8', '自动校正／8', 301, 563, 63, 40],
  ['digit-4', '进路号／4', 371, 520, 63, 40], ['digit-9', '出入库／9', 371, 563, 63, 40],
  ['digit-5', '定标／5', 441, 520, 63, 40], ['digit-0', '巡检／0', 441, 563, 63, 40],
  ['query', '查询', 511, 520, 63, 40], ['left', '左箭头／删除', 511, 563, 63, 40],
  ['up', '上箭头', 581, 520, 63, 40], ['down', '下箭头', 581, 563, 63, 40],
  ['dump', '转储', 651, 520, 63, 40], ['right', '右箭头', 651, 563, 63, 40],
  ['setting', '设定', 721, 520, 63, 40], ['confirm', '确认', 721, 563, 63, 40],
]);

export function phaseAt(distance, stopped = false) {
  if (stopped) return { id: 'secure', label: '停车防溜' };
  return SCENARIO.phases.find((phase) => distance >= phase.start && distance < phase.end)
    || SCENARIO.phases.at(-1);
}

export function signalAt(distance) {
  if (distance >= SCENARIO.signals[0].distance) return SCENARIO.signals[1];
  return SCENARIO.signals[0];
}

export function remainingToTarget(distance) {
  return SCENARIO.targetDistance - distance;
}

export function targetCurveSpeed(remaining) {
  if (remaining >= 280) return 40;
  if (remaining >= 120) return 30 + ((remaining - 120) / 160) * 10;
  if (remaining >= 50) return 20 + ((remaining - 50) / 70) * 10;
  if (remaining > 0) return 20 * Math.sqrt(remaining / 50);
  return 0;
}

export function brakingDistanceForSpeed(speed) {
  const value = Number(speed) || 0;
  return SCENARIO.standardBrakeDistance + Math.max(0, value - SCENARIO.baselineSpeed) * SCENARIO.speedIncrementDistance;
}

export function trainingBand(remaining) {
  const target = targetCurveSpeed(remaining);
  const tolerance = remaining > 100 ? 3 : remaining > 20 ? 2.5 : 1.5;
  return { target, minimum: Math.max(0, target - tolerance), maximum: target + tolerance };
}

export function lineLimitAt(distance) {
  return SCENARIO.lineLimits.find((segment) => distance >= segment.start && distance < segment.end)?.limit
    ?? SCENARIO.lkj.speedGrade;
}

export function lkjCurvesAt(distance) {
  const lineLimit = lineLimitAt(distance);
  let modeLimit = SCENARIO.lkj.speedGrade;
  for (const target of SCENARIO.controlTargets) {
    if (distance > target.holdUntil) continue;
    if (distance >= target.distance) {
      modeLimit = Math.min(modeLimit, target.speed);
      continue;
    }
    const remaining = target.distance - distance;
    const targetMps = target.speed / 3.6;
    const envelope = Math.sqrt(targetMps ** 2 + 2 * target.serviceDeceleration * remaining) * 3.6;
    modeLimit = Math.min(modeLimit, Math.max(target.speed, envelope));
  }
  return { lineLimit, modeLimit, activeLimit: Math.min(lineLimit, modeLimit) };
}

export function lkjControlLimit(scenarioOrDistance, optionalDistance) {
  const distance = optionalDistance == null ? scenarioOrDistance : optionalDistance;
  return lkjCurvesAt(distance).activeLimit;
}

export function routeFacilitiesForScenario() {
  return [];
}

export function absoluteKilometerAt(scenario, distance) {
  return (scenario.lkj?.startKilometer || 0) + Math.max(0, Number(distance) || 0) / 1000;
}
