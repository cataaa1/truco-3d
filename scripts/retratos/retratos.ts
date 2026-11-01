// Parámetros: ?face=N gesto, ?d=distancia, ?y=altura, ?x=costado, ?turn=giro, ?cols=columnas, ?only=personaje.
import {
  BufferGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildFaceAtlas, FACE_GRID } from '../../src/client/game/atlas';
import { appearanceFor, characterMaterial, faceMaterial, setCharacterInstances, smoothNormals } from '../../src/client/game/characters';
import url from '../../src/client/game/assets/boliche.glb?url';

const params = new URLSearchParams(location.search);
const number = (name: string, fallback: number) => Number(params.get(name) ?? fallback);

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x3a2a1e);
document.body.append(renderer.domElement);
const scene = new Scene();
const camera = new PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 30);

const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
const part = (name: string) => {
  const mesh = gltf.scene.getObjectByName(name) as Mesh;
  mesh.updateMatrix();
  return mesh;
};

// El código elige una persona por variante hasta encontrar el aspecto de cada una.
const only = number('only', 0);
const variants = only ? [only] : [1, 2, 3, 4, 5, 6];
const looks = variants.map((variant, i) => {
  for (let tries = 0; ; tries++) {
    const look = appearanceFor(`${params.get('code') ?? 'demo'}${tries}`, i, i % 2 === 0);
    if (look.variant === variant) return look;
  }
});

const count = looks.length;
const cols = number('cols', Math.min(3, count));
const spacing = number('s', 0.72);
const rowGap = number('rg', 1);
const turn = number('turn', 0);
const rows = Math.ceil(count / cols);

const prepare = (geometry: BufferGeometry, shaped: boolean) => {
  const out = smoothNormals(geometry);
  setCharacterInstances(out, looks, shaped);
  return out;
};

const helper = new Object3D();
const seat = (mesh: InstancedMesh, y: number) => {
  looks.forEach((_, i) => {
    helper.position.set(((i % cols) - (cols - 1) / 2) * spacing, y - Math.floor(i / cols) * rowGap, 0);
    helper.rotation.set(0, turn, 0);
    helper.updateMatrix();
    mesh.setMatrixAt(i, helper.matrix);
  });
  mesh.frustumCulled = false;
  scene.add(mesh);
};

const body = part('cuerpo');
seat(new InstancedMesh(prepare(body.geometry, false), characterMaterial(body.matrix), count), 0);
const head = part('cabeza');
seat(new InstancedMesh(prepare(head.geometry, true), characterMaterial(head.matrix), count), 1.22);
const face = part('cara');
const texture = new Texture(buildFaceAtlas());
texture.needsUpdate = true;
texture.colorSpace = SRGBColorSpace;
texture.minFilter = LinearMipmapLinearFilter;
const faceShape = prepare(face.geometry, true);
faceShape.setAttribute('aSlot', new InstancedBufferAttribute(Float32Array.from(looks, (_, i) => number('face', 0) + i * number('step', 0)), 1));
seat(new InstancedMesh(faceShape, faceMaterial(texture, [FACE_GRID.cols, FACE_GRID.rows], face.matrix), count), 1.22);

const y = number('y', 1.0 - ((rows - 1) * rowGap) / 2);
camera.position.set(number('x', 0), y, number('d', 3));
camera.lookAt(number('x', 0), y, 0);
renderer.render(scene, camera);
