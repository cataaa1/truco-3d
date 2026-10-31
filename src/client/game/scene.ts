import {
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  BackSide,
} from 'three';
import type { CardId } from '../../engine/cards';
import type { PlayerView } from '../../engine/game';
import { MAX_PITCH, MAX_YAW, MIN_PITCH } from '../../shared/protocol';
import { BACK_SLOT, buildCardAtlas, buildFaceAtlas, CARD_GRID, FACE_GRID, NEUTRAL_FACE } from './atlas';

const EYE_HEIGHT = 1.18;
const TABLE_Y = 0.74;
const HEAD_RADIUS = 0.17;
const FOV = 55;

const VERTEX = /* glsl */ `
  attribute float aSlot;
  uniform vec2 uGrid;
  varying vec2 vUv;
  void main() {
    vec2 cell = vec2(mod(aSlot, uGrid.x), floor(aSlot / uGrid.x));
    vUv = (uv + vec2(cell.x, uGrid.y - 1.0 - cell.y)) / uGrid;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;

const FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform sampler2D uMap;
  varying vec2 vUv;
  void main() {
    vec4 color = texture2D(uMap, vUv);
    if (color.a < 0.35) discard;
    gl_FragColor = color;
    #include <colorspace_fragment>
  }`;

/** Muchos rectángulos con la misma textura, en una sola llamada de dibujo. */
function atlasQuads(canvas: HTMLCanvasElement, cols: number, rows: number, count: number, anisotropy: number) {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = anisotropy;
  const geometry = new PlaneGeometry(1, 1);
  const slots = new InstancedBufferAttribute(new Float32Array(count), 1);
  geometry.setAttribute('aSlot', slots);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: DoubleSide,
    uniforms: { uMap: { value: texture }, uGrid: { value: [cols, rows] } },
  });
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, slots, texture };
}

interface CardSprite {
  slot: number;
  pos: Vector3;
  quat: Quaternion;
  scale: Vector3;
  targetPos: Vector3;
  targetQuat: Quaternion;
  targetScale: Vector3;
}

interface Head {
  yaw: number;
  pitch: number;
  targetYaw: number;
  targetPitch: number;
  face: number;
  faceTimer: ReturnType<typeof setTimeout> | null;
}

const helper = new Object3D();
const matrix = new Matrix4();

export class TableScene {
  yaw = 0;
  pitch = -0.5;
  onLook: (yaw: number, pitch: number) => void = () => {};

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly seatRadius: number;
  private readonly cardSpot: number;
  private readonly cards;
  private readonly faces;
  private readonly tags;
  private readonly tagCanvas: HTMLCanvasElement;
  private readonly heads: Head[];
  private readonly headMesh: InstancedMesh;
  private readonly sprites = new Map<string, CardSprite>();
  private myCards: CardId[] = [];
  private hovered = -1;
  private frame = 0;
  private lastTime = 0;
  private disposed = false;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly players: number,
    private readonly me: number,
    readonly faceAtlas: HTMLCanvasElement = buildFaceAtlas(),
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: devicePixelRatio < 2,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x241a13);
    canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => this.invalidate());

    this.seatRadius = players === 6 ? 1.4 : 1.2;
    const tableRadius = this.seatRadius - 0.34;
    this.cardSpot = tableRadius * 0.52;

    this.camera = new PerspectiveCamera(FOV, 1, 0.05, 30);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, EYE_HEIGHT, this.seatRadius);

    this.scene.add(new HemisphereLight(0xfff0dc, 0x8a6a50, 2.2), this.keyLight());
    this.buildRoom(tableRadius);

    const anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.cards = atlasQuads(buildCardAtlas(), CARD_GRID.cols, CARD_GRID.rows, 40, anisotropy);
    this.scene.add(this.cards.mesh);

    const others = players - 1;
    this.heads = Array.from({ length: players }, () => ({
      yaw: 0, pitch: -0.2, targetYaw: 0, targetPitch: -0.2, face: NEUTRAL_FACE, faceTimer: null,
    }));

    this.headMesh = new InstancedMesh(
      new SphereGeometry(HEAD_RADIUS, 20, 14),
      new MeshLambertMaterial({ color: 0xf2c9a2 }),
      others,
    );
    this.headMesh.frustumCulled = false;
    this.scene.add(this.headMesh);

    this.faces = atlasQuads(this.faceAtlas, FACE_GRID.cols, FACE_GRID.rows, others, anisotropy);
    this.faces.mesh.count = others;
    this.scene.add(this.faces.mesh);

    this.tagCanvas = document.createElement('canvas');
    this.tagCanvas.width = 512;
    this.tagCanvas.height = 192;
    this.tags = atlasQuads(this.tagCanvas, 2, 3, others, anisotropy);
    this.tags.mesh.count = others;
    this.scene.add(this.tags.mesh);

    this.buildBodies(others);
    this.placeTags();
    this.updateHeadMatrices();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    // Compila los shaders antes del primer cuadro para que no haya un tirón.
    void this.renderer.compileAsync(this.scene, this.camera).then(() => this.invalidate());
  }

  private keyLight(): DirectionalLight {
    const light = new DirectionalLight(0xffe2b8, 1.4);
    light.position.set(1, 4, 1.5);
    return light;
  }

  private buildRoom(tableRadius: number): void {
    const table = new Mesh(
      new CylinderGeometry(tableRadius, tableRadius, 0.05, 48),
      new MeshLambertMaterial({ color: 0x24613f }),
    );
    table.position.y = TABLE_Y - 0.025;
    const rim = new Mesh(
      new CylinderGeometry(tableRadius + 0.04, tableRadius + 0.02, 0.07, 48),
      new MeshLambertMaterial({ color: 0x5a3820 }),
    );
    rim.position.y = TABLE_Y - 0.05;
    const room = new Mesh(new BoxGeometry(8, 3.4, 8), new MeshBasicMaterial({ color: 0x4a3426, side: BackSide }));
    room.position.y = 1.7;
    this.scene.add(rim, table, room);
  }

  /** Posición relativa: yo siempre en el sur, y el siguiente asiento a mi derecha. */
  private seatAngle(seat: number): number {
    return (((seat - this.me + this.players) % this.players) * 2 * Math.PI) / this.players;
  }

  private seatPosition(seat: number): Vector3 {
    const angle = this.seatAngle(seat);
    return new Vector3(Math.sin(angle) * this.seatRadius, EYE_HEIGHT, Math.cos(angle) * this.seatRadius);
  }

  private otherSeats(): number[] {
    return Array.from({ length: this.players }, (_, s) => s).filter((s) => s !== this.me);
  }

  private buildBodies(others: number): void {
    const bodies = new InstancedMesh(
      new CapsuleGeometry(0.2, 0.5, 4, 12),
      new MeshLambertMaterial({ color: 0xffffff }),
      others,
    );
    bodies.frustumCulled = false;
    const color = new Color();
    this.otherSeats().forEach((seat, index) => {
      const pos = this.seatPosition(seat);
      helper.position.set(pos.x * 1.06, 0.72, pos.z * 1.06);
      helper.rotation.set(0, 0, 0);
      helper.scale.set(1, 1, 1);
      helper.updateMatrix();
      bodies.setMatrixAt(index, helper.matrix);
      bodies.setColorAt(index, color.set(seat % 2 === this.me % 2 ? 0x3f7fb5 : 0xb5473f));
    });
    this.scene.add(bodies);
  }

  private placeTags(): void {
    this.otherSeats().forEach((seat, index) => {
      const pos = this.seatPosition(seat);
      helper.position.set(pos.x, pos.y + HEAD_RADIUS + 0.09, pos.z);
      helper.lookAt(this.camera.position);
      helper.scale.set(0.46, 0.115, 1);
      helper.updateMatrix();
      this.tags.mesh.setMatrixAt(index, helper.matrix);
      this.tags.slots.setX(index, index);
    });
    this.tags.mesh.instanceMatrix.needsUpdate = true;
    this.tags.slots.needsUpdate = true;
  }

  /** Redibuja los carteles de nombre. Solo cuando cambia el turno o la lista. */
  setTags(names: string[], turn: number): void {
    const ctx = this.tagCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 192);
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.otherSeats().forEach((seat, index) => {
      const x = (index % 2) * 256;
      const y = Math.floor(index / 2) * 64;
      ctx.fillStyle = seat === turn ? '#e8b04a' : 'rgba(20,14,10,.8)';
      ctx.fillRect(x + 4, y + 4, 248, 56);
      ctx.fillStyle = seat === turn ? '#241808' : seat % 2 === this.me % 2 ? '#a8d4f5' : '#f5b0a8';
      ctx.fillText(names[seat] ?? '', x + 128, y + 33, 236);
    });
    this.tags.texture.needsUpdate = true;
    this.invalidate();
  }

  setGaze(seat: number, yaw: number, pitch: number): void {
    const head = this.heads[seat];
    if (!head || seat === this.me) return;
    head.targetYaw = yaw;
    head.targetPitch = pitch;
    this.invalidate();
  }

  showFace(seat: number, slot: number, ms: number): void {
    const head = this.heads[seat];
    if (!head || seat === this.me) return;
    if (head.faceTimer) clearTimeout(head.faceTimer);
    head.face = slot;
    head.faceTimer = setTimeout(() => {
      head.face = NEUTRAL_FACE;
      this.invalidate();
    }, ms);
    this.invalidate();
  }

  look(deltaYaw: number, deltaPitch: number): void {
    this.yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, this.yaw + deltaYaw));
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch + deltaPitch));
    this.onLook(this.yaw, this.pitch);
    this.invalidate();
  }

  /** Dónde está la mano de un asiento, frente a sus ojos y más abajo. */
  private handPlacement(seat: number, index: number, count: number, out: Object3D, lift = 0): void {
    const eye = this.seatPosition(seat);
    const angle = this.seatAngle(seat);
    const forward = new Vector3(-Math.sin(angle), 0, -Math.cos(angle));
    const right = new Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const offset = index - (count - 1) / 2;
    out.position
      .copy(eye)
      .addScaledVector(forward, 0.36)
      .addScaledVector(right, offset * 0.076);
    out.position.y += -0.24 - Math.abs(offset) * 0.004 + lift;
    out.lookAt(eye);
    out.rotateZ(-offset * 0.06);
  }

  private tablePlacement(seat: number, round: number, out: Object3D): void {
    const angle = this.seatAngle(seat);
    const right = new Vector3(Math.cos(angle), 0, -Math.sin(angle));
    out.position.set(Math.sin(angle) * this.cardSpot, TABLE_Y + 0.002 + round * 0.001, Math.cos(angle) * this.cardSpot);
    out.position.addScaledVector(right, (round - 1) * 0.135);
    out.rotation.set(-Math.PI / 2, 0, angle);
  }

  private putSprite(key: string, slot: number, placed: Object3D, scaleX: number, scaleY: number, from?: Object3D): void {
    let sprite = this.sprites.get(key);
    if (!sprite) {
      const start = from ?? placed;
      sprite = {
        slot,
        pos: start.position.clone(),
        quat: start.quaternion.clone(),
        scale: new Vector3(scaleX, scaleY, 1),
        targetPos: new Vector3(),
        targetQuat: new Quaternion(),
        targetScale: new Vector3(),
      };
      this.sprites.set(key, sprite);
    }
    sprite.slot = slot;
    sprite.targetPos.copy(placed.position);
    sprite.targetQuat.copy(placed.quaternion);
    sprite.targetScale.set(scaleX, scaleY, 1);
  }

  /** Vuelca el estado de la partida a las cartas de la mesa. */
  setView(view: PlayerView): void {
    this.myCards = view.myCards;
    const seen = new Set<string>();
    const place = new Object3D();
    const from = new Object3D();
    const handW = 0.07;
    const handH = 0.109;

    view.rounds.forEach((round, roundIndex) => {
      for (const { seat, card } of round) {
        const key = `t${card}`;
        seen.add(key);
        this.tablePlacement(seat, roundIndex, place);
        this.handPlacement(seat, 1, 3, from);
        this.putSprite(key, card, place, 0.125, 0.195, from);
      }
    });

    for (let seat = 0; seat < this.players; seat++) {
      if (seat === this.me) continue;
      const count = view.cardCounts[seat]!;
      for (let i = 0; i < count; i++) {
        const key = `o${seat}:${i}:${count}`;
        seen.add(key);
        this.handPlacement(seat, i, count, place);
        this.putSprite(key, BACK_SLOT, place, handW, handH);
      }
    }

    view.myCards.forEach((card, i) => {
      const key = `h${card}`;
      seen.add(key);
      this.handPlacement(this.me, i, view.myCards.length, place, this.hovered === i ? 0.022 : 0);
      this.putSprite(key, card, place, handW, handH);
    });

    for (const key of this.sprites.keys()) if (!seen.has(key)) this.sprites.delete(key);
    this.invalidate();
  }

  /** Índice de la carta propia bajo un punto de la pantalla (-1 a 1), o -1 si no hay. */
  pickHand(ndcX: number, ndcY: number): number {
    this.camera.updateMatrixWorld();
    let found = -1;
    const corner = new Vector3();
    this.myCards.forEach((card, i) => {
      const sprite = this.sprites.get(`h${card}`);
      if (!sprite) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [cx, cy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const) {
        corner.set(cx * sprite.scale.x, cy * sprite.scale.y, 0).applyQuaternion(sprite.quat).add(sprite.pos).project(this.camera);
        minX = Math.min(minX, corner.x);
        maxX = Math.max(maxX, corner.x);
        minY = Math.min(minY, corner.y);
        maxY = Math.max(maxY, corner.y);
      }
      if (ndcX >= minX && ndcX <= maxX && ndcY >= minY && ndcY <= maxY) found = i;
    });
    return found;
  }

  setHovered(index: number, view: PlayerView | null): void {
    if (index === this.hovered) return;
    this.hovered = index;
    if (view) this.setView(view);
  }

  invalidate(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame((time) => this.render(time));
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private updateHeadMatrices(): void {
    this.otherSeats().forEach((seat, index) => {
      const head = this.heads[seat]!;
      const pos = this.seatPosition(seat);
      helper.position.copy(pos);
      helper.rotation.order = 'YXZ';
      helper.rotation.set(-head.pitch, this.seatAngle(seat) + Math.PI - head.yaw, 0);
      helper.scale.set(1, 1, 1);
      helper.updateMatrix();
      this.headMesh.setMatrixAt(index, helper.matrix);
      matrix.makeTranslation(0, 0, HEAD_RADIUS * 0.94).scale(new Vector3(0.3, 0.3, 1));
      matrix.premultiply(helper.matrix);
      this.faces.mesh.setMatrixAt(index, matrix);
      this.faces.slots.setX(index, head.face);
    });
    this.headMesh.instanceMatrix.needsUpdate = true;
    this.faces.mesh.instanceMatrix.needsUpdate = true;
    this.faces.slots.needsUpdate = true;
  }

  private render(time: number): void {
    this.frame = 0;
    if (this.disposed) return;
    const dt = Math.min(0.05, this.lastTime ? (time - this.lastTime) / 1000 : 0.016);
    this.lastTime = time;
    let moving = false;

    const headEase = 1 - Math.exp(-dt * 10);
    for (const head of this.heads) {
      const dy = head.targetYaw - head.yaw;
      const dp = head.targetPitch - head.pitch;
      if (Math.abs(dy) > 0.002 || Math.abs(dp) > 0.002) moving = true;
      head.yaw += dy * headEase;
      head.pitch += dp * headEase;
    }
    this.updateHeadMatrices();

    const cardEase = 1 - Math.exp(-dt * 11);
    let index = 0;
    for (const sprite of this.sprites.values()) {
      if (sprite.pos.distanceToSquared(sprite.targetPos) > 1e-7) moving = true;
      sprite.pos.lerp(sprite.targetPos, cardEase);
      sprite.quat.slerp(sprite.targetQuat, cardEase);
      sprite.scale.lerp(sprite.targetScale, cardEase);
      matrix.compose(sprite.pos, sprite.quat, sprite.scale);
      this.cards.mesh.setMatrixAt(index, matrix);
      this.cards.slots.setX(index, sprite.slot);
      index++;
    }
    this.cards.mesh.count = index;
    this.cards.mesh.instanceMatrix.needsUpdate = true;
    this.cards.slots.needsUpdate = true;

    this.camera.rotation.set(this.pitch, -this.yaw, 0);
    this.renderer.render(this.scene, this.camera);

    if (moving) this.invalidate();
    else this.lastTime = 0;
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    for (const head of this.heads) if (head.faceTimer) clearTimeout(head.faceTimer);
    this.scene.traverse((object) => {
      const mesh = object as Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as MeshBasicMaterial | undefined;
      material?.dispose?.();
    });
    this.cards.texture.dispose();
    this.faces.texture.dispose();
    this.tags.texture.dispose();
    this.renderer.dispose();
  }
}
