import * as THREE from '../lib/three/three.module.js';
import { MstsRouteScene } from './mstsRouteScene.js?v=terminal-station-5';

export class TerminalStoppingScene extends MstsRouteScene {
  constructor(canvas, scenario, mode = 'training') {
    super(canvas, { profile: 'terminal-station', routeWindow: scenario.routeWindow });
    this.stoppingScenario = scenario;
    this.trainingMode = mode === 'training';
    this.startOffset = scenario.startOffset;
    this.stationObjects = [];
    this.trainingAids = [];
  }

  async load() {
    await super.load();
    this.startOffset = this.stoppingScenario.startOffset;
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
    this.placeLookoutObject3D(root, scenario.startOffset + scenario.targetDistance, -4.2, 0);
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
