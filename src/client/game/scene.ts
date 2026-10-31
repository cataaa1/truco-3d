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
import { appearanceFor, characterMaterial, setCharacterInstances } from './characters';

const EYE_HEIGHT = 1.18;
const TABLE_Y = 0.74;
const HEAD_RADIUS = 0.17;
const FOV = 55;
const FACE_SIZE = 0.3;
const HEAD_SHAPE = { x: 0.165, y: 0.175, z: 0.165 };
const TAG_HEIGHT = 0.36;

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
function atlasQuads(canvas: HTMLCanvasElement, cols: number, rows: number, count: number, anisotropy: number, shape?: PlaneGeometry) {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = anisotropy;
  const geometry = shape ?? new PlaneGeometry(1, 1);
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

/** Plano apoyado sobre la cabeza: la cara se ve bien también cuando la persona gira. */
function curvedFace(): PlaneGeometry {
  const geometry = new PlaneGeometry(1, 1, 8, 8);
  const position = geometry.getAttribute('position');
  const { x: rx, y: ry, z: rz } = HEAD_SHAPE;
  for (let i = 0; i < position.count; i++) {
    const x = (position.getX(i) * FACE_SIZE) / rx;
    const y = (position.getY(i) * FACE_SIZE) / ry;
    position.setZ(i, rz * Math.sqrt(Math.max(0.02, 1 - x * x - y * y)) + 0.003);
  }
  return geometry;
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
  private headMesh: InstancedMesh;
  private headLocal = new Matrix4();
  private bodies: InstancedMesh | null = null;
  private readonly sprites = new Map<string, CardSprite>();
  private myCards: CardId[] = [];
  private hovered = -1;
  private frame = 0;
  private lastTime = 0;
  private disposed = false;
  private roomTexture: CanvasTexture | null = null;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly players: number,
    private readonly me: number,
    private readonly roomCode: string,
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

    this.scene.add(new HemisphereLight(0xffdcae, 0x6a4a34, 2.0), this.keyLight());
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

    this.faces = atlasQuads(this.faceAtlas, FACE_GRID.cols, FACE_GRID.rows, others, anisotropy, curvedFace());
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
    const light = new DirectionalLight(0xffd199, 1.6);
    light.position.set(0.4, 3, 0.8);
    return light;
  }

  private buildRoom(tableRadius: number): void {
    // Versión simple para el primer cuadro; el boliche llega después sin frenar la entrada.
    const table = new Mesh(new CylinderGeometry(tableRadius, tableRadius, 0.08, 32), new MeshBasicMaterial({ color: 0x5a3019 }));
    table.position.y = TABLE_Y - 0.04;
    const room = new Mesh(new BoxGeometry(8, 3.6, 8), new MeshBasicMaterial({ color: 0x2a1c12, side: BackSide }));
    room.position.y = 1.8;
    this.scene.add(table, room);
    void this.loadBoliche(tableRadius, [table, room]).catch(() => {
      // Si falla la descarga se sigue jugando en la versión simple.
    });
  }

  private async loadBoliche(tableRadius: number, placeholders: Mesh[]): Promise<void> {
    const [{ GLTFLoader }, { MeshoptDecoder }, { default: url }, { buildRoomAtlas }] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
      import('./assets/boliche.glb?url'),
      import('./roomAtlas'),
      document.fonts.load('40px Rye').catch(() => []),
    ]);
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    if (this.disposed) return;

    const texture = new CanvasTexture(buildRoomAtlas());
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = false;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.roomTexture = texture;
    // Sin luces en tiempo real: los colores ya vienen horneados en cada vértice.
    const material = new MeshBasicMaterial({ map: texture, vertexColors: true, side: DoubleSide });

    const part = (name: string) => {
      const mesh = gltf.scene.getObjectByName(name) as Mesh;
      (mesh.material as MeshBasicMaterial).dispose();
      mesh.material = material;
      return mesh;
    };
    const room = part('boliche');
    const table = part('mesa');
    const chairModel = part('silla');
    chairModel.updateMatrix();
    this.buildCharacters(gltf.scene.getObjectByName('cuerpo') as Mesh, gltf.scene.getObjectByName('cabeza') as Mesh);

    const tableHolder = new Object3D();
    tableHolder.position.y = TABLE_Y;
    tableHolder.scale.set(tableRadius + 0.04, 1, tableRadius + 0.04);
    tableHolder.add(table);

    const others = this.otherSeats();
    const chairs = new InstancedMesh(chairModel.geometry, material, others.length);
    chairs.frustumCulled = false;
    others.forEach((seat, index) => {
      const pos = this.seatPosition(seat);
      const out = (this.seatRadius + 0.05) / this.seatRadius;
      helper.position.set(pos.x * out, 0, pos.z * out);
      helper.rotation.set(0, this.seatAngle(seat) + Math.PI, 0);
      helper.scale.set(1, 1, 1);
      helper.updateMatrix();
      chairs.setMatrixAt(index, matrix.multiplyMatrices(helper.matrix, chairModel.matrix));
    });

    for (const placeholder of placeholders) {
      this.scene.remove(placeholder);
      placeholder.geometry.dispose();
      (placeholder.material as MeshBasicMaterial).dispose();
    }
    room.frustumCulled = false;
    table.frustumCulled = false;
    this.scene.add(room, tableHolder, chairs);
    this.renderer.setClearColor(0x14100c);
    this.invalidate();
  }

  /** Reemplaza los muñecos provisorios. Mi cuerpo también se dibuja: al mirar abajo veo mis brazos. */
  private buildCharacters(bodyModel: Mesh, headModel: Mesh): void {
    const material = characterMaterial();
    const others = this.otherSeats();
    const seats = [...others, this.me];
    const looks = seats.map((seat) => appearanceFor(this.roomCode, seat, seat % 2 === this.me % 2));

    bodyModel.updateMatrix();
    const bodies = new InstancedMesh(bodyModel.geometry, material, seats.length);
    bodies.frustumCulled = false;
    seats.forEach((seat, index) => {
      const pos = this.seatPosition(seat);
      helper.position.set(pos.x, 0, pos.z);
      helper.rotation.order = 'YXZ';
      helper.rotation.set(0, this.seatAngle(seat) + Math.PI, 0);
      helper.scale.set(1, 1, 1);
      helper.updateMatrix();
      bodies.setMatrixAt(index, matrix.multiplyMatrices(helper.matrix, bodyModel.matrix));
    });
    setCharacterInstances(bodies.geometry, looks);

    headModel.updateMatrix();
    this.headLocal = headModel.matrix.clone();
    const heads = new InstancedMesh(headModel.geometry, material, others.length);
    heads.frustumCulled = false;
    setCharacterInstances(heads.geometry, looks.slice(0, others.length));

    for (const old of [this.bodies, this.headMesh]) {
      if (!old) continue;
      this.scene.remove(old);
      old.geometry.dispose();
      (old.material as MeshLambertMaterial).dispose();
      old.dispose();
    }
    this.bodies = bodies;
    this.headMesh = heads;
    this.scene.add(bodies, heads);
    this.updateHeadMatrices();
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
      bodies.setColorAt(index, color.set(seat % 2 === this.me % 2 ? 0x2f6f9e : 0x9e3a30));
    });
    this.bodies = bodies;
    this.scene.add(bodies);
  }

  private placeTags(): void {
    this.otherSeats().forEach((seat, index) => {
      const pos = this.seatPosition(seat);
      helper.position.set(pos.x, pos.y + TAG_HEIGHT, pos.z);
      helper.lookAt(this.camera.position);
      helper.scale.set(0.4, 0.1, 1);
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
    ctx.font = '700 30px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.otherSeats().forEach((seat, index) => {
      const x = (index % 2) * 256;
      const y = Math.floor(index / 2) * 64;
      ctx.fillStyle = seat === turn ? '#e3a93c' : 'rgba(20,16,12,.88)';
      ctx.fillRect(x + 4, y + 4, 248, 56);
      ctx.fillStyle = seat === turn ? '#14100c' : seat % 2 === this.me % 2 ? '#9ed6f5' : '#f5b0a8';
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
      this.headMesh.setMatrixAt(index, matrix.multiplyMatrices(helper.matrix, this.headLocal));
      matrix.makeScale(FACE_SIZE, FACE_SIZE, 1).premultiply(helper.matrix);
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
    this.roomTexture?.dispose();
    this.renderer.dispose();
  }
}
