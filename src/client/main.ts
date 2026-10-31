import type { PublicRoom, RoomInfo, ServerMessage } from '../shared/protocol';
import './style.css';
import logoArt from './assets/menu-logo.webp?url';
import joinArt from './assets/menu-entrar.webp?url';
import createArt from './assets/menu-crear.webp?url';
import roomsArt from './assets/menu-salas.webp?url';
import { Connection } from './net';

const app = document.getElementById('app')!;
const loadGame = () => import('./game/index');

// La mesa 3D se baja en segundo plano: la entrada no espera a Three.js.
const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 200));
idle(() => void loadGame());

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const isMobile = () => matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;

function readName(): string {
  try {
    return localStorage.getItem('trick:name') ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem('trick:name', name);
  } catch {
    // Sin almacenamiento se vuelve a preguntar el nombre.
  }
}

// Coordenadas de la composición original. Cada capa se ubica en ella, y sus controles dentro de la capa.
const ART_W = 1672;
const ART_H = 941;
type Box = readonly [left: number, top: number, right: number, bottom: number];
const LOGO: Box = [401, 19, 1280, 409];
const JOIN: Box = [179, 426, 580, 805];
const CREATE: Box = [596, 425, 1093, 798];
const ROOMS: Box = [1110, 426, 1489, 801];
const STRIP: Box = [520, 812, 1152, 876];
const ERROR: Box = [420, 882, 1252, 930];
const FULL: Box = [0, 0, ART_W, ART_H];

const percent = (value: number, total: number) => `${((value / total) * 100).toFixed(3)}%`;

/** Ubica `box` adentro de `parent`, en porcentajes para que acompañe cualquier tamaño. */
function at(box: Box, parent: Box = FULL): string {
  const w = parent[2] - parent[0];
  const h = parent[3] - parent[1];
  return `left:${percent(box[0] - parent[0], w)};top:${percent(box[1] - parent[1], h)};width:${percent(box[2] - box[0], w)};height:${percent(box[3] - box[1], h)}`;
}

// Profundidad: al mover el mouse, cada capa se desplaza según qué tan cerca está.
let parallaxFrame = 0;
function onParallax(event: PointerEvent): void {
  if (parallaxFrame) return;
  parallaxFrame = requestAnimationFrame(() => {
    parallaxFrame = 0;
    const root = document.documentElement.style;
    root.setProperty('--mx', ((event.clientX / innerWidth) * 2 - 1).toFixed(3));
    root.setProperty('--my', ((event.clientY / innerHeight) * 2 - 1).toFixed(3));
  });
}

function setParallax(on: boolean): void {
  document.removeEventListener('pointermove', onParallax);
  if (on && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.addEventListener('pointermove', onParallax, { passive: true });
  }
}

function showHome(error = ''): void {
  history.replaceState(null, '', '/');
  setParallax(true);
  app.innerHTML = `
    <main class="stage">
      ${isMobile() ? '<div class="warn">Por ahora Truco Online se juega en computadora, con mouse y teclado.</div>' : ''}
      <header class="layer layer-far" style="${at(LOGO)}">
        <img src="${logoArt}" width="879" height="390" fetchpriority="high" alt="Truco Online" />
      </header>
      <section class="layer layer-mid" style="${at(JOIN)}">
        <img src="${joinArt}" width="401" height="379" alt="Entrar con código" />
        <form id="join">
          <input class="art-input" id="code" style="${at([220, 650, 431, 713], JOIN)}" inputmode="numeric" maxlength="4" pattern="\\d{4}" placeholder="Código de sala" aria-label="Código de la sala" />
          <button class="art-button" style="${at([439, 649, 547, 713], JOIN)}" type="submit" aria-label="Entrar"></button>
        </form>
      </section>
      <section class="layer layer-near" style="${at(CREATE)}">
        <img src="${createArt}" width="497" height="373" alt="Crear sala" />
        <select class="art-select" id="players" style="${at([640, 652, 765, 698], CREATE)}" aria-label="Jugadores"><option value="2">2</option><option value="4" selected>4</option><option value="6">6</option></select>
        <select class="art-select" id="target" style="${at([782, 652, 907, 698], CREATE)}" aria-label="Puntos"><option value="30" selected>30</option><option value="15">15</option></select>
        <select class="art-select" id="visibility" style="${at([924, 652, 1051, 698], CREATE)}" aria-label="Sala privada"><option value="private" selected>Sí</option><option value="public">No</option></select>
        <button class="art-button art-pill" id="create" style="${at([670, 713, 1018, 771], CREATE)}" aria-label="Crear sala"></button>
      </section>
      <section class="layer layer-mid" style="${at(ROOMS)}">
        <img src="${roomsArt}" width="379" height="375" alt="Salas públicas" />
        <button class="art-button" id="open-rooms" style="${at([1156, 658, 1448, 723], ROOMS)}" aria-label="Ver salas públicas"></button>
      </section>
      <div class="layer layer-near bar-strip" style="${at(STRIP)}">
        <label for="name">Tu nombre</label>
        <input id="name" maxlength="16" placeholder="Invitado" value="${escapeHtml(readName())}" />
        <button id="quick">Jugar ya</button>
      </div>
      <p class="stage-error" id="error" role="alert" style="${at(ERROR)}">${escapeHtml(error)}</p>
    </main>
    <dialog id="rooms-dialog" class="sign sign-navy">
      <h2>Salas públicas</h2>
      <div id="rooms" class="rooms-list">Buscando...</div>
      <form method="dialog"><button class="wide">Cerrar</button></form>
    </dialog>`;
  document.getElementById('open-rooms')!.addEventListener('click', () => {
    (document.getElementById('rooms-dialog') as HTMLDialogElement).showModal();
    void listRooms(currentName);
  });

  const nameInput = document.getElementById('name') as HTMLInputElement;
  const errorBox = document.getElementById('error')!;
  const currentName = () => {
    saveName(nameInput.value);
    return nameInput.value;
  };

  document.getElementById('join')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = (document.getElementById('code') as HTMLInputElement).value.trim();
    if (!/^\d{4}$/.test(code)) {
      errorBox.textContent = 'El código tiene 4 dígitos';
      return;
    }
    void join(code, currentName());
  });

  document.getElementById('create')!.addEventListener('click', async () => {
    const value = (id: string) => (document.getElementById(id) as HTMLSelectElement).value;
    const response = await fetch('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({
        players: Number(value('players')),
        target: Number(value('target')),
        public: value('visibility') === 'public',
      }),
    }).catch(() => null);
    if (!response?.ok) {
      errorBox.textContent = 'No se pudo crear la sala. Probá de nuevo.';
      return;
    }
    const { code } = (await response.json()) as { code: string };
    void enter(code, currentName());
  });

  document.getElementById('quick')!.addEventListener('click', async () => {
    const response = await fetch('/api/quick', { method: 'POST' }).catch(() => null);
    if (!response?.ok) {
      errorBox.textContent = 'No se pudo buscar una sala. Probá de nuevo.';
      return;
    }
    const { code } = (await response.json()) as { code: string };
    void enter(code, currentName());
  });

}

async function listRooms(currentName: () => string): Promise<void> {
  const box = document.getElementById('rooms');
  if (!box) return;
  const response = await fetch('/api/rooms').catch(() => null);
  const rooms = response?.ok ? ((await response.json()) as PublicRoom[]) : [];
  if (!document.body.contains(box)) return;
  box.textContent = rooms.length === 0 ? 'No hay salas abiertas. Creá una o probá con "Jugar ya".' : '';
  for (const room of rooms) {
    const button = document.createElement('button');
    button.style.width = '100%';
    button.textContent = `Sala ${room.code}: ${room.taken} de ${room.players} jugadores, a ${room.target}`;
    button.addEventListener('click', () => void enter(room.code, currentName()));
    box.append(button);
  }
}

async function join(code: string, name: string): Promise<void> {
  const response = await fetch(`/api/rooms/${code}`).catch(() => null);
  if (!response) return showHome('No hay conexión con el servidor');
  if (response.status === 429) return showHome('Demasiados intentos. Esperá un minuto.');
  if (!response.ok) return showHome(`No existe la sala ${code}`);
  const room = (await response.json()) as RoomInfo;
  const hasSeat = sessionStorage.getItem(`trick:token:${code}`);
  if (!hasSeat && room.status !== 'lobby') return showHome('Esa partida ya empezó');
  if (!hasSeat && room.seats.every(Boolean)) return showHome('Esa sala está llena');
  await enter(code, name);
}

async function enter(code: string, name: string): Promise<void> {
  setParallax(false);
  history.replaceState(null, '', `/?c=${code}`);
  app.innerHTML = '<main class="page"><p class="muted">Entrando a la sala...</p></main>';
  const conn = new Connection(code, name);
  let room: RoomInfo | null = null;
  let you = 0;
  let game: import('./game/index').GameController | null = null;
  let mounting = false;
  const pending: ServerMessage[] = [];

  const leave = () => {
    conn.close();
    game?.dispose();
    showHome();
  };

  const mount = async () => {
    if (mounting || !room) return;
    mounting = true;
    const { mountGame } = await loadGame();
    game = mountGame(app, conn, room, you, leave);
    for (const message of pending.splice(0)) game.handle(message);
  };

  conn.onClosed = (reason) => {
    game?.dispose();
    showHome(reason);
  };
  conn.onStatus = (online) => game?.setOnline(online);
  conn.onMessage = (message) => {
    if (message.t === 'room') {
      room = message.room;
      you = message.you;
      if (room.status === 'lobby') showLobby(room, you, conn, leave);
      else if (!game) void mount();
    }
    if (game) game.handle(message);
    else if (mounting || message.t === 'game') {
      pending.push(message);
      if (!mounting) void mount();
    } else if (message.t === 'err') {
      const box = document.getElementById('error');
      if (box) box.textContent = message.msg;
    }
  };
  conn.open();
}

function showLobby(room: RoomInfo, you: number, conn: Connection, leave: () => void): void {
  const isHost = room.host === you;
  const full = room.seats.every(Boolean);
  const seats = room.seats
    .map((seat, i) => {
      const label = seat ? escapeHtml(seat.name) + (i === you ? ' (vos)' : '') : '<span class="muted">Libre</span>';
      const state = seat && !seat.connected ? '<span class="muted">reconectando</span>' : '';
      return `<div class="seat team${i % 2}"><span>${label}</span>${state}</div>`;
    })
    .join('');
  const fillNote =
    room.autoStartAt === null
      ? ''
      : '<p class="muted">Si no se completa en unos segundos, los lugares vacíos se llenan con bots.</p>';
  app.innerHTML = `
    <main class="page" style="max-width:560px">
      <div class="sign sign-navy lobby">
      <p class="muted" style="text-align:center;margin-top:0">${room.public ? 'Mesa pública' : 'Mesa privada'} para ${room.players}, a ${room.target} puntos</p>
      <div class="code" aria-label="Código de la sala">${room.code}</div>
      <p class="muted" style="text-align:center">Pasales este código a los demás. Los colores marcan los equipos.</p>
      <div class="stack">${seats}</div>
      ${fillNote}
      <div class="row" style="margin-top:16px;flex-wrap:wrap">
        ${isHost ? `<button class="primary" id="start" ${full ? '' : 'disabled'}>Empezar</button>` : '<span class="muted">Esperando a que empiece quien creó la sala</span>'}
        ${isHost && !full ? '<button id="fill">Completar con bots</button>' : ''}
        <button id="leave">Salir</button>
      </div>
      <p class="error" id="error" role="alert"></p>
      </div>
    </main>`;
  document.getElementById('start')?.addEventListener('click', () => conn.send({ t: 'start', fill: false }));
  document.getElementById('fill')?.addEventListener('click', () => conn.send({ t: 'start', fill: true }));
  document.getElementById('leave')!.addEventListener('click', leave);
}

const invited = new URLSearchParams(location.search).get('c');
if (invited && /^\d{4}$/.test(invited)) void join(invited, readName());
else showHome();
