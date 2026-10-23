import * as THREE from '../lib/three/three.module.js';
import { MstsRouteScene } from './mstsRouteScene.js';

const ASPECT_COLORS = Object.freeze({
  green: ['#1cff65'],
  'green-yellow': ['#1cff65', '#ffd640'],
  'double-yellow': ['#ffd640', '#ffd640'],
  yellow: ['#ffd640'],
  red: ['#ff302a'],
});

export class TerminalStoppingScene extends MstsRouteScene {
  constructor(canvas, scenario, mode = 'training') {
    super(canvas, { profile: 'power-training' });
    this.stoppingScenario = scenario;
    this.trainingMode = mode === 'training';
    this.startOffset = scenario.startOffset;
    this.stationObjects = [];
    this.trainingAids = [];
  }

  async load() {
    await super.load();
    this.startOffset = this.stoppingScenario.startOffset;
    this.buildSignals();
    this.buildPlatform();
    this.buildStoppingMarker();
    this.buildDistanceAids();
    this.applyCamera();
  }

  makeTextTexture(text, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = options.width || 512;
    canvas.height = options.height || 192;
    const context = canvas.getContext('2d');
    context.fillStyle = options.background || '#f7f7ef';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = options.border || '#142b58';
    context.lineWidth = options.lineWidth || 16;
    context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
    context.fillStyle = options.color || '#102350';
    context.font = options.font || 'bold 74px "Microsoft YaHei", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  buildSignals() {
    const glowMap = this.createSignalGlowTexture();
    for (const config of this.stoppingScenario.signals) {
      const root = new THREE.Group();
      root.name = `TERMINAL_SIGNAL_${config.id}`;
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(.11, .14, 6.2, 10),
        new THREE.MeshStandardMaterial({ color: '#d8d8d1', roughness: .72 }),
      );
      pole.position.y = 3.1;
      root.add(pole);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(.88, 2.55, .55),
        new THREE.MeshStandardMaterial({ color: '#151b1c', roughness: .58 }),
      );
      head.position.set(0, 6.65, 0);
      root.add(head);
      const colors = ASPECT_COLORS[config.aspect] || ASPECT_COLORS.green;
      for (let index = 0; index < 3; index += 1) {
        const color = colors[index];
        const lamp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowMap,
          color: color || '#26302b',
          transparent: true,
          opacity: color ? 1 : .2,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }));
        lamp.position.set(0, 7.4 - index * .74, -.34);
        lamp.scale.set(.72, .72, 1);
        root.add(lamp);
      }
      this.placeLookoutObject3D(root, this.stoppingScenario.startOffset + config.distance, 3.7, 0);
      this.routeRoot.add(root);
      this.stationObjects.push({ root, distance: config.distance, range: 2_000 });
    }
  }

  buildPlatform() {
    const scenario = this.stoppingScenario;
    const concrete = new THREE.MeshStandardMaterial({ color: '#b8b7ad', roughness: .92 });
    const edge = new THREE.MeshStandardMaterial({ color: '#eee5bd', roughness: .86 });
    const canopyMaterial = new THREE.MeshStandardMaterial({ color: '#42738c', roughness: .62, metalness: .12 });
    const columnMaterial = new THREE.MeshStandardMaterial({ color: '#d7dde0', roughness: .7, metalness: .16 });
    const platformLength = scenario.platformEnd - scenario.platformStart;
    const center = scenario.platformStart + platformLength / 2;
    const root = new THREE.Group();
    root.name = 'TERMINAL_PLATFORM';

    const deck = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.05, platformLength), concrete);
    deck.position.y = .38;
    root.add(deck);
    const warningEdge = new THREE.Mesh(new THREE.BoxGeometry(.34, .08, platformLength), edge);
    warningEdge.position.set(-2.67, .94, 0);
    root.add(warningEdge);

    for (let z = -platformLength / 2 + 28; z < platformLength / 2 - 20; z += 42) {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(.1, .12, 4.6, 10), columnMaterial);
      column.position.set(.35, 3.2, z);
      root.add(column);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.7, .16, 20), canopyMaterial);
      canopy.position.set(.35, 5.5, z);
      root.add(canopy);
    }
    this.placeLookoutObject3D(root, scenario.startOffset + center, 5.55, 0);
    this.routeRoot.add(root);
    this.stationObjects.push({ root, distance: center, range: 1_500 });

    for (const offset of [70, 250, 430]) {
      const boardRoot = new THREE.Group();
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(4.7, 1.35),
        new THREE.MeshBasicMaterial({
          map: this.makeTextTexture(scenario.stationName, { background: '#123a72', border: '#f4f6ef', color: '#fff', font: 'bold 62px "Microsoft YaHei", sans-serif' }),
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      board.position.y = 2.8;
      board.rotation.y = Math.PI;
      boardRoot.add(board);
      this.placeLookoutObject3D(boardRoot, scenario.startOffset + scenario.platformStart + offset, 4.15, 0);
      this.routeRoot.add(boardRoot);
      this.stationObjects.push({ root: boardRoot, distance: scenario.platformStart + offset, range: 900 });
    }
  }

  buildStoppingMarker() {
    const scenario = this.stoppingScenario;
    const root = new THREE.Group();
    root.name = 'TERMINAL_STOPPING_MARKER';
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(.08, .1, 2.5, 10),
      new THREE.MeshStandardMaterial({ color: '#d7d9d5', roughness: .7 }),
    );
    pole.position.y = 1.25;
    root.add(pole);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.45),
      new THREE.MeshBasicMaterial({
        map: this.makeTextTexture('停车', { width: 384, height: 224, background: '#f7f5e9', border: '#173d82', color: '#173d82', font: 'bold 96px "Microsoft YaHei", sans-serif' }),
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    board.position.y = 2.75;
    board.rotation.y = Math.PI;
    root.add(board);
    this.placeLookoutObject3D(root, scenario.startOffset + scenario.targetDistance, 4.2, 0);
    this.routeRoot.add(root);
    this.stationObjects.push({ root, distance: scenario.targetDistance, range: 1_300 });
  }

  buildDistanceAids() {
    const scenario = this.stoppingScenario;
    const aids = [
      { distance: scenario.brakingPoint, label: '400 m 初减点' },
      { distance: scenario.checkPoint, label: '100 m 校速点' },
      { distance: scenario.lowSpeedPoint, label: '50 m 观察点' },
    ];
    for (const aid of aids) {
      const root = new THREE.Group();
      root.name = `TRAINING_AID_${aid.distance}`;
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, .9),
        new THREE.MeshBasicMaterial({
          map: this.makeTextTexture(aid.label, { width: 512, height: 192, background: '#082c3e', border: '#63def6', color: '#e9fbff', font: 'bold 54px "Microsoft YaHei", sans-serif', lineWidth: 10 }),
          transparent: true,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      board.position.y = 2.1;
      board.rotation.y = Math.PI;
      root.add(board);
      this.placeLookoutObject3D(root, scenario.startOffset + aid.distance, -4.1, 0);
      root.visible = this.trainingMode;
      this.routeRoot.add(root);
      this.trainingAids.push(root);
      this.stationObjects.push({ root, distance: aid.distance, range: 650, trainingOnly: true });
    }
  }

  setTrainingMode(training) {
    this.trainingMode = Boolean(training);
    this.trainingAids.forEach((root) => { root.visible = this.trainingMode; });
  }

  update(distance, speed, view = this.view) {
    super.update(distance, speed, view, true, 1);
    for (const item of this.stationObjects) {
      if (item.trainingOnly && !this.trainingMode) item.root.visible = false;
      else item.root.visible = Math.abs(item.distance - distance) < item.range;
    }
  }
}
