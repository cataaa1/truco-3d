import { BufferGeometry, Color, InstancedBufferAttribute, ShaderMaterial, Vector3 } from 'three';

const VARIANTS = 6;
const SKIN = [0xf0c8a0, 0xe0ac80, 0xc98e64, 0xa56f4a, 0x7f5235, 0xf5d6b8];
const HAIR = [0x1c120c, 0x35221a, 0x5c3a22, 0x2a2a2a, 0x8a8478, 0x201814];
const HATS = [0x2a2622, 0x4a3c2e, 0x1e2a38, 0x5a4a36];
const US = [0x2f7fb8, 0x3a8fc6, 0x256a9e];
const THEM = [0xa83a2e, 0xb8473a, 0x8f2e24];

export interface Appearance {
  skin: Color;
  hair: Color;
  cloth: Color;
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
  const wearsHat = variant === 3 || variant === 4;
  return {
    skin: new Color(pick(SKIN, 'skin')),
    hair: new Color(wearsHat ? pick(HATS, 'hat') : pick(HAIR, 'hair')),
    cloth: new Color(pick(myTeam ? US : THEM, 'cloth')),
    variant,
  };
}

export function setCharacterInstances(geometry: BufferGeometry, looks: readonly Appearance[]): void {
  const colors = (read: (look: Appearance) => Color) =>
    new InstancedBufferAttribute(new Float32Array(looks.flatMap((look) => read(look).toArray())), 3);
  geometry.setAttribute('aSkin', colors((look) => look.skin));
  geometry.setAttribute('aHair', colors((look) => look.hair));
  geometry.setAttribute('aCloth', colors((look) => look.cloth));
  geometry.setAttribute('aVariant', new InstancedBufferAttribute(new Float32Array(looks.map((look) => look.variant)), 1));
}

const VERTEX = /* glsl */ `
  attribute vec3 aSkin;
  attribute vec3 aHair;
  attribute vec3 aCloth;
  attribute float aVariant;
  varying vec3 vBase;
  varying vec3 vWorld;
  void main() {
    float kind = floor(uv.x * 4.0 + 0.5);
    float variant = floor(uv.y * 8.0 + 0.5);
    vec3 tint = kind < 0.5 ? vec3(1.0) : kind < 1.5 ? aSkin : kind < 2.5 ? aHair : aCloth;
    vBase = color.rgb * tint;
    vec4 world = instanceMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    // Todas las cabezas viven en una geometría: las variantes ajenas quedan fuera de pantalla.
    gl_Position = variant > 0.5 && abs(variant - aVariant) > 0.5
      ? vec4(2.0, 2.0, 2.0, 1.0)
      : projectionMatrix * viewMatrix * world;
  }`;

const FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3 uLamp;
  varying vec3 vBase;
  varying vec3 vWorld;
  void main() {
    // Normal por cara, calculada acá: no hace falta descargar normales y refuerza el estilo facetado.
    vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 toLamp = normalize(uLamp - vWorld);
    float key = max(dot(normal, toLamp), 0.0);
    float sky = normal.y * 0.5 + 0.5;
    vec3 light = vec3(0.34, 0.27, 0.22) + vec3(0.42, 0.33, 0.25) * sky + vec3(1.0, 0.76, 0.5) * key * 0.72;
    gl_FragColor = vec4(vBase * light, 1.0);
    #include <colorspace_fragment>
  }`;

export function characterMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    vertexColors: true,
    uniforms: { uLamp: { value: new Vector3(0, 2.5, 0) } },
  });
}
