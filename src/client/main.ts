import type { PublicRoom, RoomInfo, ServerMessage } from '../shared/protocol';
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

function showHome(error = ''): void {
  history.replaceState(null, '', '/');
  app.innerHTML = `
    <main class="page">
      <h1>Trick</h1>
      <p class="sub">Truco argentino en primera persona. Sin cuenta: entrás con un código.</p>
      ${isMobile() ? '<div class="warn">Por ahora Trick se juega en computadora, con mouse y teclado.</div>' : ''}
      <div class="stack" style="margin-bottom:16px">
        <div><label for="name">Tu nombre</label>
        <input id="name" maxlength="16" placeholder="Invitado" value="${escapeHtml(readName())}" /></div>
      </div>
      <div class="grid">
        <section class="card stack">
          <h2>Entrar con código</h2>
          <form id="join" class="row">
            <input id="code" inputmode="numeric" maxlength="4" pattern="\\d{4}" placeholder="1234" aria-label="Código de la sala" />
            <button class="primary" type="submit">Entrar</button>
          </form>
          <button id="quick" style="width:100%">Jugar ya</button>
        </section>
        <section class="card stack">
          <h2>Crear sala</h2>
          <div class="row">
            <div style="flex:1"><label for="players">Jugadores</label>
              <select id="players"><option value="2">2</option><option value="4" selected>4</option><option value="6">6</option></select></div>
            <div style="flex:1"><label for="target">Puntos</label>
              <select id="target"><option value="30" selected>30</option><option value="15">15</option></select></div>
            <div style="flex:1"><label for="visibility">Sala</label>
              <select id="visibility"><option value="private" selected>Privada</option><option value="public">Pública</option></select></div>
          </div>
          <button id="create" class="primary" style="width:100%">Crear</button>
        </section>
      </div>
      <p class="error" id="error" role="alert">${escapeHtml(error)}</p>
      <section class="card" style="margin-top:8px">
        <h2>Salas públicas</h2>
        <div id="rooms" class="stack muted">Buscando...</div>
      </section>
    </main>`;

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

  void listRooms(currentName);
}

async function listRooms(currentName: () => string): Promise<void> {
  const box = document.getElementById('rooms');
  if (!box) return;
  const response = await fetch('/api/rooms').catch(() => null);
  const rooms = response?.ok ? ((await response.json()) as PublicRoom[]) : [];
  if (!document.body.contains(box)) return;
  box.textContent = rooms.length === 0 ? 'No hay salas abiertas. Creá una o tocá "Jugar ya".' : '';
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
    <main class="page" style="max-width:520px">
      <p class="muted">${room.public ? 'Sala pública' : 'Sala privada'} para ${room.players}, a ${room.target} puntos</p>
      <div class="code" aria-label="Código de la sala">${room.code}</div>
      <p class="muted">Pasales este código a los demás. Los colores marcan los equipos.</p>
      <div class="stack">${seats}</div>
      ${fillNote}
      <div class="row" style="margin-top:16px;flex-wrap:wrap">
        ${isHost ? `<button class="primary" id="start" ${full ? '' : 'disabled'}>Empezar</button>` : '<span class="muted">Esperando a que empiece quien creó la sala</span>'}
        ${isHost && !full ? '<button id="fill">Completar con bots</button>' : ''}
        <button id="leave">Salir</button>
      </div>
      <p class="error" id="error" role="alert"></p>
    </main>`;
  document.getElementById('start')?.addEventListener('click', () => conn.send({ t: 'start', fill: false }));
  document.getElementById('fill')?.addEventListener('click', () => conn.send({ t: 'start', fill: true }));
  document.getElementById('leave')!.addEventListener('click', leave);
}

const invited = new URLSearchParams(location.search).get('c');
if (invited && /^\d{4}$/.test(invited)) void join(invited, readName());
else showHome();
