import { teamOf, type Action, type GameEvent, type PlayerView } from '../../engine/game';
import { PHRASES, SENA_MS, SENAS, type RoomInfo, type ServerMessage } from '../../shared/protocol';
import type { Connection } from '../net';
import { faceSlot, faceThumbnail } from './atlas';
import { TableScene } from './scene';
import { TableVoices } from './voices';

export interface GameController {
  handle(message: ServerMessage): void;
  setOnline(online: boolean): void;
  dispose(): void;
}

const STYLE = `
  #game { position: fixed; inset: 0; overflow: hidden; user-select: none; }
  #game canvas.view { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .hud { position: absolute; pointer-events: none; }
  .hud button, .hud .panel { pointer-events: auto; }
  #overlay { inset: 0; }
  .score { top: 12px; left: 12px; background: rgba(20,16,12,.92); border: 2px solid var(--gold); outline: 2px solid var(--sky); outline-offset: 2px; border-radius: 4px; padding: 8px 12px; min-width: 130px; }
  .tally-head { display: flex; justify-content: space-between; gap: 14px; font-size: 13px; font-weight: 700; }
  .tally-board { display: flex; justify-content: space-around; margin-top: 4px; }
  .tally { display: block; }
  .score .us { color: var(--us); } .score .them { color: var(--them); }
  .status { top: 12px; left: 50%; transform: translateX(-50%); background: rgba(20,16,12,.92); border: 2px solid var(--gold); border-radius: 4px; padding: 8px 18px; text-align: center; min-width: 260px; max-width: 46vw; font-family: var(--lettering); color: var(--cream); text-shadow: 1px 1px 0 #000; }
  .timer { height: 4px; background: var(--gold); margin-top: 6px; border-radius: 2px; transform-origin: left; }
  .toasts { top: 112px; left: 50%; transform: translateX(-50%); text-align: center; width: min(560px, 90vw); }
  .toast { background: var(--cream); color: var(--red); font: 400 19px/1.25 var(--lettering); border: 3px solid var(--red); outline: 2px solid var(--gold); border-radius: 4px; padding: 6px 16px; margin-bottom: 8px; display: inline-block; box-shadow: 0 4px 14px rgba(0,0,0,.5); }
  .actions { bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; width: min(760px, 96vw); }
  .actions button { background: rgba(20,16,12,.95); font-family: var(--lettering); color: var(--cream); }
  .actions button:hover:not(:disabled) { background: #33261a; }
  .actions button.answer { background: var(--red); border-color: var(--cream); }
  .actions button.answer:hover:not(:disabled) { background: #cf3227; }
  .actions .tip { width: 100%; text-align: center; color: var(--cream); text-shadow: 0 1px 3px #000, 0 0 6px #000; font-size: 14px; }
  kbd { font: 12px ui-monospace, Consolas, monospace; background: rgba(255,255,255,.14); color: var(--cream); border-radius: 3px; padding: 1px 5px; margin-left: 6px; text-shadow: none; }
  .tools { top: 12px; right: 12px; display: flex; gap: 8px; }
  .tools button { background: rgba(20,16,12,.92); padding: 6px 10px; font-size: 14px; border-width: 1px; }
  .crosshair { top: 50%; left: 50%; width: 6px; height: 6px; margin: -3px; border-radius: 50%; background: rgba(255,240,200,.8); box-shadow: 0 0 2px #000; }
  .panel { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); background: rgba(20,16,12,.97); border: 3px solid var(--gold); outline: 3px solid var(--sky); outline-offset: 3px; border-radius: 4px; padding: 18px; width: min(480px, 92vw); max-height: 84vh; overflow: auto; }
  .panel h2 { margin-bottom: 8px; }
  .sena-row { display: flex; align-items: center; gap: 10px; padding: 3px 4px; width: 100%; text-align: left; background: none; border: 0; border-radius: 4px; }
  .sena-row canvas { width: 40px; height: 40px; flex: none; }
  .hint { top: 74px; left: 50%; transform: translateX(-50%); background: rgba(20,16,12,.85); border-radius: 4px; padding: 5px 12px; font-size: 14px; text-align: center; white-space: nowrap; max-width: 96vw; }
  .offline { top: 60px; right: 12px; background: var(--red); color: var(--cream); border-radius: 4px; padding: 6px 12px; }
`;

const CANTO_TEXT: Record<string, string> = {
  truco: '¡Truco!',
  retruco: '¡Quiero retruco!',
  vale4: '¡Quiero vale cuatro!',
  envido: '¡Envido!',
  real: '¡Real envido!',
  falta: '¡Falta envido!',
  flor: '¡Flor!',
  contraflor: '¡Contraflor!',
  contraflor_resto: '¡Contraflor al resto!',
};

const ACTION_KEYS: Record<string, string> = {
  truco: 'KeyT',
  envido: 'KeyE',
  real: 'KeyR',
  falta: 'KeyF',
  quiero: 'KeyY',
  noquiero: 'KeyN',
  mazo: 'KeyM',
  flor: 'KeyL',
};

const SENS = 0.0022;
const GAZE_INTERVAL_MS = 125;
const GAZE_MIN_CHANGE = 0.017;

/** Un palito de fósforo entre dos puntos, con la cabeza en el extremo final. */
function stick(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ecd9ae" stroke-width="2.6" stroke-linecap="round"/><circle cx="${x2}" cy="${y2}" r="2.3" fill="#b3261e"/>`;
}

/** Puntaje de truco: cuatro palitos forman el cuadrado y el quinto lo cruza. Las malas se separan de las buenas. */
function tallySvg(points: number, target: number): string {
  const box = 24;
  const gap = 8;
  const divider = 14;
  const groups = target / 5;
  const half = groups / 2;
  let out = '';
  let y = 4;
  for (let group = 0; group < groups; group++) {
    if (target === 30 && group === half) {
      out += `<line x1="1" y1="${y + divider / 2 - gap / 2}" x2="35" y2="${y + divider / 2 - gap / 2}" stroke="#e3a93c" stroke-width="1.6"/>`;
      y += divider;
    }
    const count = Math.max(0, Math.min(5, points - group * 5));
    const [l, r, t, b] = [6, 6 + box, y, y + box];
    const sides = [stick(l, t, r, t), stick(r, t, r, b), stick(r, b, l, b), stick(l, b, l, t), stick(l, b, r, t)];
    out += sides.slice(0, count).join('');
    y += box + gap;
  }
  return `<svg class="tally" viewBox="0 0 36 ${y}" width="36" height="${y}">${out}</svg>`;
}

export function mountGame(
  host: HTMLElement,
  conn: Connection,
  initialRoom: RoomInfo,
  me: number,
  leave: () => void,
): GameController {
  let room = initialRoom;
  let view: PlayerView | null = null;
  let previousPending: string | null = null;

  host.innerHTML = `
    <style>${STYLE}</style>
    <div id="game">
      <canvas class="view" aria-label="Mesa de truco"></canvas>
      <div class="hud crosshair" id="crosshair" hidden></div>
      <div class="hud score" id="score"></div>
      <div class="hud status"><div id="status"></div><div class="timer" id="timer"></div></div>
      <div class="hud toasts" id="toasts" aria-live="polite"></div>
      <div class="hud tools">
        <button id="guide-btn">Guía <kbd>G</kbd></button>
        <button id="mute-btn">Voz: sí</button>
        <button id="leave-btn">Salir</button>
      </div>
      <div class="hud hint" id="hint">Hacé clic en la mesa para mirar con el mouse. Con <kbd>Esc</kbd> recuperás el cursor.</div>
      <div class="hud actions" id="actions"></div>
      <div class="hud offline" id="offline" hidden>Reconectando...</div>
      <div class="hud" id="overlay"></div>
    </div>`;

  const $ = (id: string) => document.getElementById(id)!;
  const canvas = host.querySelector('canvas.view') as HTMLCanvasElement;
  const scene = new TableScene(canvas, room.players, me, room.code);
  const voices = new TableVoices(room.code, room.players, me);
  const teamGame = room.players > 2;
  try {
    if (sessionStorage.getItem('trick:debug')) {
      Object.assign(window, { __trick: scene, __voices: voices });
    }
  } catch {
    // Sin almacenamiento no hay modo de depuración.
  }

  const nameOf = (seat: number) => (seat === me ? 'Vos' : room.seats[seat]?.name ?? `Jugador ${seat + 1}`);
  const names = () => room.seats.map((seat, i) => seat?.name ?? `Jugador ${i + 1}`);

  function toast(text: string, ms = 2600): void {
    const box = document.createElement('div');
    box.className = 'toast';
    box.textContent = text;
    const wrap = document.createElement('div');
    wrap.append(box);
    $('toasts').append(wrap);
    while ($('toasts').childElementCount > 4) $('toasts').firstElementChild!.remove();
    setTimeout(() => wrap.remove(), ms);
  }

  /** El truco a veces se canta con verso. La elección es igual en todas las pantallas. */
  function trucoClip(seat: number): string {
    const verse = voices.pick(`verso:${view?.scores}:${seat}`, ['truco', 'truco', 'truco', 'truco_verso1', 'truco_verso2']);
    return voices.has(seat, verse) ? verse : 'truco';
  }

  function cantoClip(seat: number, canto: string): string {
    if (canto === 'truco') return trucoClip(seat);
    const envido = canto === 'envido' || canto === 'real' || canto === 'falta';
    return envido && previousPending === 'truco' && voices.has(seat, 'envido_primero') ? 'envido_primero' : canto;
  }

  /** Comentario ocasional de quien ganó la mano, si esa voz lo tiene grabado. */
  function maybeBanter(team: number, points: number): void {
    const seats = Array.from({ length: room.players }, (_, seat) => seat).filter((seat) => teamOf(seat) === team && seat !== me);
    if (seats.length === 0) return;
    const salt = `dicho:${view?.scores}:${points}`;
    const seat = Number(voices.pick(salt, seats.map(String)));
    const clip = voices.pick(salt, ['', '', '', 'dicho1', 'dicho2', 'dicho3', 'dicho4', 'dicho5', 'dicho6', 'dicho7', 'dicho8']);
    if (clip) setTimeout(() => voices.play(seat, clip), 900);
  }

  function describe(event: GameEvent): void {
    switch (event.e) {
      case 'canto': {
        const text = CANTO_TEXT[event.canto] ?? event.canto;
        toast(`${nameOf(event.seat)}: ${text}`);
        voices.play(event.seat, cantoClip(event.seat, event.canto), text);
        break;
      }
      case 'answer': {
        const what = event.what === 'truco' ? 'el truco' : event.what === 'envido' ? 'el envido' : 'la flor';
        const text = event.quiero ? `¡Quiero ${what}!` : `No quiero ${what}`;
        toast(`${nameOf(event.seat)}: ${text}`);
        const clip = event.quiero ? 'quiero' : event.what === 'flor' && voices.has(event.seat, 'achico') ? 'achico' : 'noquiero';
        voices.play(event.seat, clip, event.quiero ? '¡Quiero!' : 'No quiero');
        break;
      }
      case 'mazo':
        toast(`${nameOf(event.seat)} se fue al mazo`);
        voices.play(event.seat, 'mazo');
        break;
      case 'envido':
        if (event.tantos >= 0) {
          toast(`${nameOf(event.seat)} tiene ${event.tantos}: ${event.points} para ${teamLabel(event.team)}`, 3600);
          voices.play(event.seat, String(event.tantos));
          const rival = (event.seat + 1) % room.players;
          setTimeout(() => voices.play(rival, 'son_buenas'), 800);
        } else toast(`Envido rechazado: ${event.points} para ${teamLabel(event.team)}`);
        break;
      case 'flor':
        toast(`Flor: ${event.points} para ${teamLabel(event.team)}`);
        break;
      case 'round':
        if (event.winner === null) toast('Parda');
        break;
      case 'hand':
        toast(`${handReason(event.reason)}${event.points} ${event.points === 1 ? 'punto' : 'puntos'} para ${teamLabel(event.team)}`, 3200);
        maybeBanter(event.team, event.points);
        break;
      default:
        break;
    }
  }

  const handReason = (reason: string) =>
    reason === 'mazo' ? 'Se fueron al mazo. ' : '';

  const teamLabel = (team: number) => (team === teamOf(me) ? 'nosotros' : 'ellos');

  // ---- Controles ----
  let senasOpen = false;
  let phrasesOpen = false;
  let guideOpen = false;

  function send(action: Action): void {
    conn.send({ t: 'act', a: action });
  }

  function legal(t: Action['t'], call?: string): Action | undefined {
    return view?.legal.find((a) => a.t === t && (a.t !== 'envido' || a.call === call));
  }

  function actionByKey(code: string): boolean {
    for (const [name, key] of Object.entries(ACTION_KEYS)) {
      if (key !== code) continue;
      const isEnvido = name === 'envido' || name === 'real' || name === 'falta';
      const action = isEnvido ? legal('envido', name) : legal(name as Action['t']);
      if (action) send(action);
      return true;
    }
    return false;
  }

  function playIndex(index: number): void {
    const card = view?.myCards[index];
    if (card !== undefined && legal('play')) send({ t: 'play', card });
  }

  function renderPanel(): void {
    const overlay = $('overlay');
    overlay.innerHTML = '';
    if (!senasOpen && !phrasesOpen && !guideOpen) return;
    const panel = document.createElement('div');
    panel.className = 'panel';
    if (phrasesOpen) {
      panel.innerHTML = '<h2>Frases: apretá el número</h2>';
      PHRASES.forEach((phrase, i) => {
        const row = document.createElement('button');
        row.className = 'sena-row';
        row.innerHTML = `<kbd>${i + 1}</kbd>`;
        row.append(phrase);
        row.addEventListener('click', () => conn.send({ t: 'phrase', i }));
        panel.append(row);
      });
    } else {
      panel.innerHTML = senasOpen
        ? '<h2>Seña: apretá el número</h2><p class="muted">La ve cualquiera que te esté mirando. Mirá primero a los rivales.</p>'
        : '<h2>Guía de señas</h2><p class="muted">Solo muestra los gestos. Nadie te traduce lo que hace otro.</p>';
      SENAS.forEach((sena, i) => {
        const row = document.createElement('button');
        row.className = 'sena-row';
        row.append(faceThumbnail(scene.faceAtlas, faceSlot(sena.id), 80));
        const text = document.createElement('span');
        text.textContent = `${sena.card}: ${sena.gesture}`;
        row.append(text);
        if (senasOpen) {
          const key = document.createElement('kbd');
          key.textContent = String(i + 1);
          row.append(key);
          row.addEventListener('click', () => makeSena(i));
        }
        panel.append(row);
      });
    }
    overlay.append(panel);
  }

  function makeSena(index: number): void {
    const sena = SENAS[index];
    if (!sena || !teamGame) return;
    conn.send({ t: 'sena', id: sena.id });
    toast(`Hiciste: ${sena.gesture.toLowerCase()}`, SENA_MS + 500);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.repeat && !event.code.startsWith('Arrow')) return;
    const digit = /^Digit([1-9])$/.exec(event.code);
    const look = 0.05;
    switch (event.code) {
      case 'ArrowLeft': scene.look(-look, 0); event.preventDefault(); return;
      case 'ArrowRight': scene.look(look, 0); event.preventDefault(); return;
      case 'ArrowUp': scene.look(0, look); event.preventDefault(); return;
      case 'ArrowDown': scene.look(0, -look); event.preventDefault(); return;
      case 'KeyQ':
        if (teamGame && !senasOpen) {
          senasOpen = true;
          renderPanel();
        }
        return;
      case 'KeyC':
        if (!phrasesOpen) {
          phrasesOpen = true;
          renderPanel();
        }
        return;
      case 'KeyG':
        guideOpen = !guideOpen;
        renderPanel();
        return;
    }
    if (digit) {
      const index = Number(digit[1]) - 1;
      if (senasOpen) makeSena(index);
      else if (phrasesOpen) {
        if (index < PHRASES.length) conn.send({ t: 'phrase', i: index });
      } else if (index < 3) playIndex(index);
      return;
    }
    actionByKey(event.code);
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'KeyQ' && senasOpen) {
      senasOpen = false;
      renderPanel();
    }
    if (event.code === 'KeyC' && phrasesOpen) {
      phrasesOpen = false;
      renderPanel();
    }
  }

  const isLocked = () => document.pointerLockElement === canvas;
  let dragging = false;
  let cursorX = 0;
  let cursorY = 0;

  function updateHover(): void {
    const index = isLocked() ? scene.pickHand(0, 0) : scene.pickHand(cursorX, cursorY);
    scene.setHovered(legal('play') ? index : -1, view);
  }

  function onMouseMove(event: MouseEvent): void {
    if (isLocked() || dragging) {
      scene.look(event.movementX * SENS, -event.movementY * SENS);
    }
    if (!isLocked()) {
      const rect = canvas.getBoundingClientRect();
      cursorX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      cursorY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    updateHover();
  }

  function onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    const index = isLocked() ? scene.pickHand(0, 0) : scene.pickHand(cursorX, cursorY);
    if (index >= 0 && legal('play')) {
      playIndex(index);
      return;
    }
    if (isLocked()) return;
    dragging = true;
    const request = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    request?.catch?.(() => {});
  }

  const onMouseUp = () => {
    dragging = false;
  };

  function onLockChange(): void {
    const locked = isLocked();
    if (locked) dragging = false;
    $('crosshair').hidden = !locked;
    $('hint').hidden = locked;
  }

  canvas.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('pointerlockchange', onLockChange);

  $('leave-btn').addEventListener('click', leave);
  $('guide-btn').addEventListener('click', () => {
    guideOpen = !guideOpen;
    renderPanel();
  });
  $('mute-btn').addEventListener('click', () => {
    voices.muted = !voices.muted;
    $('mute-btn').textContent = `Voz: ${voices.muted ? 'no' : 'sí'}`;
  });

  // Solo se manda la mirada si la cabeza se movió, para cuidar el cupo diario del servidor.
  let lastGazeYaw = Number.NaN;
  let lastGazePitch = Number.NaN;
  let gazeTimer: ReturnType<typeof setTimeout> | null = null;

  function flushGaze(): void {
    gazeTimer = null;
    const moved =
      !(Math.abs(scene.yaw - lastGazeYaw) < GAZE_MIN_CHANGE) || !(Math.abs(scene.pitch - lastGazePitch) < GAZE_MIN_CHANGE);
    if (!moved) return;
    lastGazeYaw = scene.yaw;
    lastGazePitch = scene.pitch;
    conn.send({ t: 'gaze', y: Math.round(scene.yaw * 1000) / 1000, p: Math.round(scene.pitch * 1000) / 1000 });
  }

  scene.onLook = () => {
    updateHover();
    if (!gazeTimer) gazeTimer = setTimeout(flushGaze, GAZE_INTERVAL_MS);
  };

  // ---- Interfaz de la partida ----
  function renderScore(v: PlayerView): void {
    const mine = teamOf(me);
    const us = v.scores[mine];
    const them = v.scores[mine === 0 ? 1 : 0];
    $('score').innerHTML = `
      <div class="tally-head"><span class="us">Nosotros</span><span class="them">Ellos</span></div>
      <div class="tally-board" role="img" aria-label="Nosotros ${us}, ellos ${them}, a ${v.config.target} puntos">
        ${tallySvg(us, v.config.target)}${tallySvg(them, v.config.target)}
      </div>`;
  }

  function statusText(v: PlayerView): string {
    if (v.phase === 'gameOver') return v.winner === teamOf(me) ? '¡Ganamos!' : 'Perdimos';
    if (v.phase === 'handOver') return 'Mano terminada';
    if (v.responding !== null && v.pendingLabel) {
      const canto = CANTO_TEXT[v.pendingLabel] ?? v.pendingLabel;
      return v.responding === teamOf(me) ? `Te cantaron ${canto} ¿Qué respondés?` : `Cantaron ${canto} Esperando respuesta`;
    }
    return v.turn === me ? 'Te toca' : `Turno de ${nameOf(v.turn)}`;
  }

  function button(label: string, key: string, action: Action, answer = false): HTMLButtonElement {
    const el = document.createElement('button');
    if (answer) el.className = 'answer';
    el.innerHTML = `<kbd style="margin:0 6px 0 0">${key}</kbd>`;
    el.append(label);
    el.addEventListener('click', () => send(action));
    return el;
  }

  function renderActions(v: PlayerView): void {
    const box = $('actions');
    box.innerHTML = '';
    if (v.phase !== 'playing') return;
    const add = (t: Action['t'], label: string, key: string, answer = false) => {
      const action = v.legal.find((a) => a.t === t);
      if (action) box.append(button(label, key, action, answer));
    };
    add('quiero', 'Quiero', 'Y', true);
    add('noquiero', 'No quiero', 'N', true);
    const level = v.responding !== null && v.pendingLabel === 'truco' ? 2 : v.responding !== null && v.pendingLabel === 'retruco' ? 3 : v.trucoLevel + 1;
    add('truco', level === 1 ? 'Truco' : level === 2 ? 'Retruco' : 'Vale cuatro', 'T');
    for (const [call, label, key] of [['envido', 'Envido', 'E'], ['real', 'Real envido', 'R'], ['falta', 'Falta envido', 'F']] as const) {
      const action = v.legal.find((a) => a.t === 'envido' && a.call === call);
      if (action) box.append(button(label, key, action));
    }
    add('flor', 'Flor', 'L');
    add('mazo', 'Mazo', 'M');
    const tip = document.createElement('div');
    tip.className = 'tip';
    const cardsHelp = v.legal.some((a) => a.t === 'play') ? 'Clic en una carta o 1, 2, 3 para jugarla. ' : '';
    tip.textContent = `${cardsHelp}${teamGame ? 'Q + número: seña. ' : ''}C + número: frase.`;
    box.append(tip);
  }

  function restartTimer(deadline: number | null): void {
    const bar = $('timer');
    bar.getAnimations().forEach((animation) => animation.cancel());
    if (deadline === null) {
      bar.style.visibility = 'hidden';
      return;
    }
    bar.style.visibility = 'visible';
    const left = Math.max(0, deadline - Date.now());
    bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: left, fill: 'forwards' });
  }

  function renderGameOver(v: PlayerView): void {
    if (v.phase !== 'gameOver') return;
    const overlay = $('overlay');
    overlay.innerHTML = `
      <div class="panel" style="text-align:center">
        <h2>${v.winner === teamOf(me) ? '¡Ganamos!' : 'Perdimos'}</h2>
        <p>${v.scores[teamOf(me)]} a ${v.scores[teamOf(me) === 0 ? 1 : 0]}</p>
        <button class="primary" id="exit">Volver al inicio</button>
      </div>`;
    document.getElementById('exit')!.addEventListener('click', leave);
    if (isLocked()) document.exitPointerLock();
  }

  let lastTurn = -1;

  return {
    handle(message) {
      switch (message.t) {
        case 'room':
          room = message.room;
          scene.setTags(names(), lastTurn);
          break;
        case 'game':
          previousPending = view?.pendingLabel ?? null;
          view = message.view;
          for (const event of message.events) describe(event);
          // El envido se resuelve primero, pero el truco cantado antes sigue esperando respuesta.
          if (message.events.some((event) => event.e === 'envido') && view.pendingLabel && view.responding !== null) {
            toast(`Sigue pendiente: ${CANTO_TEXT[view.pendingLabel] ?? view.pendingLabel}`, 3600);
          }
          scene.setView(view);
          if (view.turn !== lastTurn) {
            lastTurn = view.turn;
            scene.setTags(names(), lastTurn);
          }
          renderScore(view);
          $('status').textContent = statusText(view);
          renderActions(view);
          restartTimer(message.deadline);
          renderGameOver(view);
          updateHover();
          break;
        case 'gaze':
          scene.setGaze(message.s, message.y, message.p);
          break;
        case 'sena':
          scene.showFace(message.s, faceSlot(message.id), message.ms);
          break;
        case 'phrase':
          toast(`${nameOf(message.s)}: ${PHRASES[message.i] ?? ''}`);
          voices.play(message.s, `frase${message.i + 1}`);
          break;
        case 'err':
          toast(message.msg);
          break;
      }
    },
    setOnline(online) {
      $('offline').hidden = online;
    },
    dispose() {
      if (gazeTimer) clearTimeout(gazeTimer);
      canvas.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      if (isLocked()) document.exitPointerLock();
      voices.dispose();
      scene.dispose();
    },
  };
}
