export const PROJECT_ID = 'hxd1c-terminal-stopping-v1';

export const CAB = Object.freeze({ width: 640, height: 480 });

export const SCENARIO = Object.freeze({
  id: 'standardPassenger',
  title: '终到站一段制动精准对标',
  shortTitle: '终到对标',
  initialSpeed: 42,
  initialTraction: 1,
  startOffset: 28910,
  targetDistance: 720,
  platformStart: 464,
  platformEnd: 774,
  brakingPoint: 320,
  checkPoint: 620,
  lowSpeedPoint: 670,
  exitSignalDistance: 1251,
  finishDistance: 742,
  baselineSpeed: 40,
  baselineReduction: 50,
  targetTolerance: 0.5,
  passTolerance: 2,
  stationName: '大山铺',
  entrySignalName: '大山铺站进站信号机',
  targetName: '旅客列车停车位置标',
  routeLabel: '区间—大山铺站 Ⅰ 道',
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
    redSignalDistance: 30161,
  },
  signals: [
    { id: 'entry', label: '进站信号机', distance: 87, aspect: 'green' },
    { id: 'exit', label: '出站信号机', distance: 1251, aspect: 'red' },
  ],
  phases: [
    { id: 'confirm', start: 0, end: 200, label: '进站确认' },
    { id: 'prepare', start: 200, end: 320, label: '初减准备' },
    { id: 'observe', start: 320, end: 620, label: '初减观察' },
    { id: 'correct', start: 620, end: 670, label: '100 m 校速' },
    { id: 'align', start: 670, end: 742, label: '低速对标' },
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
  if (distance >= SCENARIO.platformStart - 100) return SCENARIO.signals[1];
  return SCENARIO.signals[0];
}

export function remainingToTarget(distance) {
  return SCENARIO.targetDistance - distance;
}

export function targetCurveSpeed(remaining) {
  if (remaining >= 400) return 40;
  if (remaining >= 100) return 30 + ((remaining - 100) / 300) * 10;
  if (remaining >= 50) return 20 + ((remaining - 50) / 50) * 10;
  if (remaining > 0) return 20 * Math.sqrt(remaining / 50);
  return 0;
}

export function trainingBand(remaining) {
  const target = targetCurveSpeed(remaining);
  const tolerance = remaining > 100 ? 3 : remaining > 20 ? 2.5 : 1.5;
  return { target, minimum: Math.max(0, target - tolerance), maximum: target + tolerance };
}

export function lkjControlLimit(distance) {
  const remaining = Math.max(0, SCENARIO.exitSignalDistance - distance);
  const serviceDeceleration = 0.56;
  const curve = Math.sqrt(2 * serviceDeceleration * remaining) * 3.6;
  return Math.max(0, Math.min(80, curve));
}
