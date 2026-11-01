import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  Matrix4,
  ShaderMaterial,
  Texture,
  Vector3,
} from 'three';

const VARIANTS = 6;
const SKIN = [0xeec4a0, 0xe0ac84, 0xcc9268, 0xa9734e, 0x82563a, 0xf3d4b8];
const DARK_HAIR = [0x1a110c, 0x2e1d14, 0x4a2e1b, 0x23201e];
const GRAY_HAIR = [0x8c877e, 0xa8a399, 0x6f6b64];
const WOMAN_HAIR = [0x1a110c, 0x3b2315, 0x6a3f22, 0x8a5a2c];
const HATS = [0x2b2622, 0x4d4033, 0x25303d, 0x5e4f3b];
const BERETS = [0x1d1a18, 0x2a3440, 0x45302a];
const BELTS = [0x1c1612, 0x3b2a1e];
const GARTERS = [0x1c1612, 0x7a6a4a];
const EYES = [0x3a2212, 0x4c2f17, 0x2e1f14, 0x4a4f2c, 0x3f5260];
const US = [0x2b6fa5, 0x2f7fb8, 0x245f8f];
const THEM = [0xa03428, 0xaf4032, 0x8c2c22];
const GLOSS_LIPS = 0xa8302c;

/** Proporciones de cada personaje: mandíbula, ancho y largo de la cara. */
const SHAPES: Record<number, [number, number, number]> = {
  1: [0, 0, 0],
  2: [-0.04, -0.02, 0.03],
  3: [0.05, 0.01, -0.01],
  4: [0.1, 0.05, -0.03],
  5: [-0.1, -0.05, -0.01],
  6: [0.03, 0.03, -0.02],
};

export interface Appearance {
  skin: Color;
  hair: Color;
  cloth: Color;
  accent: Color;
  eyes: Color;
  lips: Color;
  shape: [number, number, number];
  variant: number;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Todos ven a cada asiento igual: el aspecto sale del código de sala y del asiento. */
export function appearanceFor(code: string, seat: number, myTeam: boolean): Appearance {
  const base = hash(code);
  const pick = <T,>(list: readonly T[], salt: string) => list[hash(`${code}:${seat}:${salt}`) % list.length]!;
  // El orden de variantes se reparte por asiento para que no se repitan en la mesa.
  const variant = ((base + seat) % VARIANTS) + 1;
  const hair = variant === 4 || variant === 6 ? GRAY_HAIR : variant === 5 ? WOMAN_HAIR : DARK_HAIR;
  const accent = variant === 3 ? HATS : variant === 4 ? BERETS : variant === 6 ? GARTERS : BELTS;
  const skin = new Color(pick(SKIN, 'skin'));
  return {
    skin,
    hair: new Color(pick(hair, 'hair')),
    cloth: new Color(pick(myTeam ? US : THEM, 'cloth')),
    accent: new Color(pick(accent, 'accent')),
    eyes: new Color(pick(EYES, 'eyes')),
    lips: variant === 5 ? new Color(GLOSS_LIPS) : skin.clone().multiply(new Color(0.62, 0.3, 0.27)),
    shape: SHAPES[variant]!,
    variant,
  };
}

export function setCharacterInstances(geometry: BufferGeometry, looks: readonly Appearance[], shaped: boolean): void {
  const colors = (read: (look: Appearance) => Color) =>
    new InstancedBufferAttribute(new Float32Array(looks.flatMap((look) => read(look).toArray())), 3);
  geometry.setAttribute('aSkin', colors((look) => look.skin));
  geometry.setAttribute('aHair', colors((look) => look.hair));
  geometry.setAttribute('aCloth', colors((look) => look.cloth));
  geometry.setAttribute('aAccent', colors((look) => look.accent));
  geometry.setAttribute('aEyes', colors((look) => look.eyes));
  geometry.setAttribute('aLips', colors((look) => look.lips));
  geometry.setAttribute('aVariant', new InstancedBufferAttribute(new Float32Array(looks.map((look) => look.variant)), 1));
  geometry.setAttribute(
    'aShape',
    new InstancedBufferAttribute(new Float32Array(looks.flatMap((look) => (shaped ? look.shape : [0, 0, 0]))), 3),
  );
}

/**
 * Los modelos no traen normales para pesar menos: se calculan al cargar, promediando
 * las caras que comparten un punto salvo que formen una arista marcada.
 */
export function smoothNormals(source: BufferGeometry, creaseDegrees = 60): BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  const position = geometry.getAttribute('position');
  const corners = position.count;
  const faceNormals = new Float32Array(corners);
  const groups = new Map<number, number[]>();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const keyOf = (i: number) => {
    const x = Math.round(position.getX(i) * 16384) + 16384;
    const y = Math.round(position.getY(i) * 16384) + 16384;
    const z = Math.round(position.getZ(i) * 16384) + 16384;
    return x * 2 ** 32 + y * 2 ** 16 + z;
  };
  for (let i = 0; i < corners; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1).sub(a);
    c.fromBufferAttribute(position, i + 2).sub(a);
    b.cross(c);
    // Sin normalizar: las caras grandes pesan más que las astillas de los polos.
    faceNormals.set([b.x, b.y, b.z], i);
    for (let k = i; k < i + 3; k++) {
      const key = keyOf(k);
      const group = groups.get(key);
      if (group) group.push(i);
      else groups.set(key, [i]);
    }
  }
  const limit = Math.cos((creaseDegrees * Math.PI) / 180);
  const normals = new Float32Array(corners * 3);
  const own = new Vector3();
  const other = new Vector3();
  const sum = new Vector3();
  for (let i = 0; i < corners; i += 3) {
    own.fromArray(faceNormals, i);
    const length = own.length() || 1;
    for (let k = i; k < i + 3; k++) {
      sum.set(0, 0, 0);
      for (const face of groups.get(keyOf(k))!) {
        other.fromArray(faceNormals, face);
        if (own.dot(other) >= limit * length * (other.length() || 1)) sum.add(other);
      }
      sum.normalize().toArray(normals, k * 3);
    }
  }
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  return geometry;
}

const SHARED_VERTEX = /* glsl */ `
  uniform mat4 uNode;
  attribute vec3 aShape;
  varying vec3 vNormal;
  varying vec3 vWorld;

  // Cada personaje afina o ensancha la misma cabeza; la cara pintada se deforma igual.
  vec3 reshape(vec3 p) {
    float low = smoothstep(0.0, 0.15, -p.y);
    p.x *= 1.0 + aShape.x * low + aShape.y;
    p.y *= 1.0 + aShape.z;
    return p;
  }

  vec4 place() {
    vec3 local = reshape((uNode * vec4(position, 1.0)).xyz);
    vec4 world = instanceMatrix * vec4(local, 1.0);
    vWorld = world.xyz;
    vNormal = mat3(instanceMatrix) * mat3(uNode) * normal;
    return world;
  }
`;

const SHARED_FRAGMENT = /* glsl */ `
  uniform vec3 uLamp;
  varying vec3 vNormal;
  varying vec3 vWorld;

  // skin: luz que atraviesa la piel. gloss y shine: brillo del material.
  vec3 shade(vec3 base, float skin, float gloss, float shine) {
    vec3 n = normalize(vNormal);
    vec3 toEye = normalize(cameraPosition - vWorld);
    vec3 toLamp = normalize(uLamp - vWorld);
    float wrap = mix(0.08, 0.38, skin);
    float key = clamp((dot(n, toLamp) + wrap) / (1.0 + wrap), 0.0, 1.0);
    float sky = n.y * 0.5 + 0.5;
    vec3 light = vec3(0.3, 0.24, 0.2) + vec3(0.4, 0.31, 0.24) * sky;
    light += vec3(0.3, 0.17, 0.09) * max(-n.y, 0.0);
    light += vec3(1.0, 0.76, 0.5) * key * 0.74;
    light += vec3(0.32, 0.24, 0.17) * pow(1.0 - max(dot(n, toEye), 0.0), 3.0) * 0.6;
    vec3 lit = base * light;
    lit += base * vec3(0.16, 0.035, 0.02) * (1.0 - key) * skin;
    float highlight = pow(max(dot(n, normalize(toLamp + toEye)), 0.0), shine);
    return lit + vec3(1.0, 0.86, 0.68) * highlight * gloss;
  }
`;

const VERTEX = /* glsl */ `
  ${SHARED_VERTEX}
  attribute vec3 aSkin;
  attribute vec3 aHair;
  attribute vec3 aCloth;
  attribute vec3 aAccent;
  attribute vec3 aEyes;
  attribute vec3 aLips;
  attribute float aVariant;
  varying vec3 vBase;
  varying vec3 vMaterial;
  void main() {
    float kind = floor(uv.x * 8.0 + 0.5);
    float variant = floor(uv.y * 8.0 + 0.5);
    vec3 tint = kind < 0.5 ? vec3(1.0) : kind < 1.5 ? aSkin : kind < 2.5 ? aHair : kind < 3.5 ? aCloth : aAccent;
    vBase = color.rgb * tint;
    // x: piel, y: brillo, z: dureza del brillo.
    float hairGloss = abs(aVariant - 2.0) < 0.5 ? 0.5 : 0.14;
    vMaterial = kind < 0.5 ? vec3(0.0, 0.06, 28.0)
      : kind < 1.5 ? vec3(1.0, 0.07, 22.0)
      : kind < 2.5 ? vec3(0.0, hairGloss, 34.0)
      : kind < 3.5 ? vec3(0.0, 0.025, 12.0)
      : vec3(0.0, 0.03, 14.0);
    vec4 world = place();
    // Todas las variantes viven en una geometría: las ajenas quedan fuera de pantalla.
    gl_Position = variant > 0.5 && abs(variant - aVariant) > 0.5
      ? vec4(2.0, 2.0, 2.0, 1.0)
      : projectionMatrix * viewMatrix * world;
  }`;

const FRAGMENT = /* glsl */ `
  precision mediump float;
  ${SHARED_FRAGMENT}
  varying vec3 vBase;
  varying vec3 vMaterial;
  void main() {
    gl_FragColor = vec4(shade(vBase, vMaterial.x, vMaterial.y, vMaterial.z), 1.0);
    #include <colorspace_fragment>
  }`;

export function characterMaterial(node: Matrix4): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    vertexColors: true,
    uniforms: { uLamp: { value: new Vector3(0, 2.5, 0) }, uNode: { value: node } },
  });
}

const FACE_VERTEX = /* glsl */ `
  ${SHARED_VERTEX}
  attribute float aSlot;
  attribute vec3 aSkin;
  attribute vec3 aHair;
  attribute vec3 aEyes;
  attribute vec3 aLips;
  uniform vec2 uGrid;
  varying vec2 vUv;
  varying vec3 vBrows;
  varying vec3 vEyes;
  varying vec3 vLips;
  void main() {
    vec2 cell = vec2(mod(aSlot, uGrid.x), floor(aSlot / uGrid.x));
    vUv = (uv + vec2(cell.x, uGrid.y - 1.0 - cell.y)) / uGrid;
    // Las cejas acompañan al pelo, sin llegar a ser tan claras como una cabeza canosa.
    vBrows = mix(aHair, aSkin * 0.25, 0.25) * 0.8;
    vEyes = aEyes;
    vLips = aLips;
    gl_Position = projectionMatrix * viewMatrix * place();
  }`;

const FACE_FRAGMENT = /* glsl */ `
  precision mediump float;
  ${SHARED_FRAGMENT}
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec3 vBrows;
  varying vec3 vEyes;
  varying vec3 vLips;
  void main() {
    vec4 pixel = texture2D(uMap, vUv);
    if (pixel.a < 0.01) discard;
    // El dibujo marca con rojo, verde y azul puros lo que depende de cada personaje.
    vec3 paint = pixel.rgb;
    float strength = max(paint.r, max(paint.g, paint.b));
    vec3 share = paint / max(strength, 0.001);
    vec3 base = paint;
    base = mix(base, vLips * strength, smoothstep(0.6, 0.95, share.r - max(share.g, share.b)));
    base = mix(base, vEyes * strength, smoothstep(0.6, 0.95, share.g - max(share.r, share.b)));
    base = mix(base, vBrows * strength, smoothstep(0.6, 0.95, share.b - max(share.r, share.g)));
    gl_FragColor = vec4(shade(base, 0.0, 0.04, 40.0), pixel.a);
    #include <colorspace_fragment>
  }`;

export function faceMaterial(map: Texture, grid: readonly [number, number], node: Matrix4): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: FACE_VERTEX,
    fragmentShader: FACE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMap: { value: map },
      uGrid: { value: [...grid] },
      uLamp: { value: new Vector3(0, 2.5, 0) },
      uNode: { value: node },
    },
  });
}
