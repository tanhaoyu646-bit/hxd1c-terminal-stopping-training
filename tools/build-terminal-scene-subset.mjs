import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRailAlignedPath, cumulativePathDistances } from '../scripts/railAlignedPath.js';
import { SCENARIO } from '../scripts/terminalStoppingConfig.js';

const root = new URL('../', import.meta.url);
const sourceSceneUrl = new URL('assets/msts-neiyi-corridor/neiyi-lookout-full-scene.json', root);
const sourcePathUrl = new URL('assets/msts-neiyi/neiyi-5635-trackdb-path.json', root);
const outputSceneUrl = new URL('assets/msts-neiyi-corridor/neiyi-dashanpu-terminal-scene.json', root);
const outputPathUrl = new URL('assets/msts-neiyi/neiyi-5635-trackdb-path-aligned.json', root);

const WINDOW = SCENARIO.routeWindow;
const scene = JSON.parse(readFileSync(sourceSceneUrl, 'utf8'));
const path = JSON.parse(readFileSync(sourcePathUrl, 'utf8'));
const alignedPoints = buildRailAlignedPath(path.positions, scene.instances, { spacing: 5 });
const distances = cumulativePathDistances(alignedPoints);

const firstIndex = Math.max(1, distances.findIndex((distance) => distance >= WINDOW.start) - 1);
const lastMatch = distances.findIndex((distance) => distance > WINDOW.end);
const lastIndex = lastMatch === -1 ? alignedPoints.length - 1 : Math.min(alignedPoints.length - 1, lastMatch + 1);

function projectToTerminalWindow(position) {
  let best = null;
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const a = alignedPoints[index - 1];
    const b = alignedPoints[index];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    const ratio = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((position[0] - a[0]) * dx + (position[1] - a[1]) * dy + (position[2] - a[2]) * dz) / lengthSquared))
      : 0;
    const x = a[0] + dx * ratio;
    const y = a[1] + dy * ratio;
    const z = a[2] + dz * ratio;
    const lateralDistance = Math.hypot(position[0] - x, position[1] - y, position[2] - z);
    if (!best || lateralDistance < best.lateralDistance) {
      best = {
        alongDistance: distances[index - 1] + Math.sqrt(lengthSquared) * ratio,
        lateralDistance,
      };
    }
  }
  return best;
}

const instances = scene.instances.filter((instance) => {
  if (!Array.isArray(instance.position)) return false;
  const projection = projectToTerminalWindow(instance.position);
  return projection
    && projection.alongDistance >= WINDOW.start
    && projection.alongDistance <= WINDOW.end
    && projection.lateralDistance <= WINDOW.lateral;
});
const shapeNames = new Set(instances.map((instance) => instance.shape));
const shapes = Object.fromEntries(Object.entries(scene.shapes).filter(([name]) => shapeNames.has(name)));
const triangleCount = Object.values(shapes).reduce((sum, shape) => (
  sum + (shape.groups || []).reduce((groupSum, group) => groupSum + Math.floor((group.positions?.length || 0) / 9), 0)
), 0);

const terminalScene = {
  ...scene,
  format: 'msts-terminal-scene-subset-v1',
  source: {
    route: scene.source?.route,
    worldTiles: (scene.source?.worldTiles || []).map(({ worldTile, worldSha256, tileX, tileZ }) => ({
      worldTile, worldSha256, tileX, tileZ,
    })),
    origin: scene.source?.origin,
    originTile: scene.source?.originTile,
    coordinateTransform: scene.source?.coordinateTransform,
    derivedFrom: 'neiyi-lookout-full-scene.json',
    routeWindow: WINDOW,
  },
  summary: {
    ...scene.summary,
    shapeCount: Object.keys(shapes).length,
    instanceCount: instances.length,
    triangleCount,
    routeWindow: WINDOW,
  },
  shapes,
  instances,
};
const alignedPath = {
  ...path,
  format: 'msts-trackdb-aligned-path-v1',
  summary: {
    ...path.summary,
    aligned: true,
    spacing: 5,
    sampledPointCount: alignedPoints.length,
    pathLength: distances.at(-1),
  },
  positions: alignedPoints.flat(),
};

writeFileSync(outputSceneUrl, JSON.stringify(terminalScene));
writeFileSync(outputPathUrl, JSON.stringify(alignedPath));
console.log(JSON.stringify({
  scene: {
    output: fileURLToPath(outputSceneUrl),
    instances: instances.length,
    shapes: Object.keys(shapes).length,
    bytes: Buffer.byteLength(JSON.stringify(terminalScene)),
  },
  path: {
    output: fileURLToPath(outputPathUrl),
    points: alignedPoints.length,
    length: distances.at(-1),
    bytes: Buffer.byteLength(JSON.stringify(alignedPath)),
  },
}, null, 2));
