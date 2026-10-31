import { teamOf, type Action, type GameEvent, type PlayerView } from '../../engine/game';
import { PHRASES, SENA_MS, SENAS, type RoomInfo, type ServerMessage } from '../../shared/protocol';
import type { Connection } from '../net';
import { faceSlot, faceThumbnail } from './atlas';
import { TableScene } from './scene';

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
  .score { top: 12px; left: 12px; background: rgba(20,14,10,.82); border-radius: 10px; padding: 10px 14px; min-width: 150px; }
  .score b { font-size: 22px; }
  .score .us, .score .them { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
  .score .us { color: var(--us); } .score .them { color: var(--them); }
  .status { top: 12px; left: 50%; transform: translateX(-50%); background: rgba(20,14,10,.82); border-radius: 10px; padding: 8px 16px; text-align: center; min-width: 240px; }
  .timer { height: 4px; background: var(--accent); margin-top: 6px; border-radius: 2px; transform-origin: left; }
  .toasts { top: 120px; left: 50%; transform: translateX(-50%); text-align: center; width: min(520px, 90vw); }
  .toast { background: rgba(232,176,74,.95); color: #241808; font-weight: 600; border-radius: 8px; padding: 6px 12px; margin-bottom: 6px; display: inline-block; }
  .actions { bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; width: min(760px, 96vw); }
  .actions button { background: rgba(42,32,26,.94); }
  .actions button.answer { background: var(--accent); color: #241808; font-weight: 600; }
  kbd { font: 12px ui-monospace, monospace; background: rgba(255,255,255,.14); border-radius: 4px; padding: 1px 5px; margin-left: 6px; }
  .tools { top: 12px; right: 12px; display: flex; gap: 8px; }
  .tools button { background: rgba(20,14,10,.82); padding: 6px 10px; font-size: 14px; }
  .crosshair { top: 50%; left: 50%; width: 6px; height: 6px; margin: -3px; border-radius: 50%; background: rgba(255,255,255,.7); }
  .panel { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); background: rgba(20,14,10,.95); border: 1px solid var(--line); border-radius: 12px; padding: 16px; width: min(460px, 92vw); max-height: 86vh; overflow: auto; }
  .panel h2 { margin-bottom: 8px; }
  .sena-row { display: flex; align-items: center; gap: 10px; padding: 3px 0; width: 100%; text-align: left; background: none; border: 0; border-radius: 6px; }
  .sena-row canvas { width: 40px; height: 40px; flex: none; }
  .hint { top: 76px; left: 50%; transform: translateX(-50%); background: rgba(20,14,10,.82); border-radius: 8px; padding: 6px 12px; font-size: 14px; text-align: center; }
  .offline { top: 60px; right: 12px; background: var(--them); color: #240; border-radius: 8px; padding: 6px 12px; }
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

function speak(text: string): void {
  // Voz provisoria del navegador, hasta tener grabaciones propias. No pesa nada.
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-AR';
  utterance.rate = 1.15;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
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
  let muted = false;

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
  const scene = new TableScene(canvas, room.players, me);
  const teamGame = room.players > 2;
  try {
    if (sessionStorage.getItem('trick:debug')) (window as unknown as { __trick: TableScene }).__trick = scene;
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

  function say(text: string): void {
    if (!muted) speak(text);
  }

  function describe(event: GameEvent): void {
    switch (event.e) {
      case 'canto': {
        const text = CANTO_TEXT[event.canto] ?? event.canto;
        toast(`${nameOf(event.seat)}: ${text}`);
        say(text);
        break;
      }
      case 'answer': {
        const text = event.quiero ? '¡Quiero!' : 'No quiero';
        toast(`${nameOf(event.seat)}: ${text}`);
        say(text);
        break;
      }
      case 'mazo':
        toast(`${nameOf(event.seat)} se fue al mazo`);
        break;
      case 'envido':
        if (event.tantos >= 0) toast(`${nameOf(event.seat)} tiene ${event.tantos}: ${event.points} para ${teamLabel(event.team)}`, 3600);
        else toast(`Envido rechazado: ${event.points} para ${teamLabel(event.team)}`);
        break;
      case 'flor':
        toast(`Flor: ${event.points} para ${teamLabel(event.team)}`);
        break;
      case 'round':
        if (event.winner === null) toast('Parda');
        break;
      case 'hand':
        toast(`${event.points} ${event.points === 1 ? 'punto' : 'puntos'} para ${teamLabel(event.team)}`, 3200);
        break;
      default:
        break;
    }
  }

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
    muted = !muted;
    $('mute-btn').textContent = `Voz: ${muted ? 'no' : 'sí'}`;
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
    $('score').innerHTML = `
      <div class="us">Nosotros <b>${v.scores[mine]}</b></div>
      <div class="them">Ellos <b>${v.scores[mine === 0 ? 1 : 0]}</b></div>
      <div class="muted">A ${v.config.target}${v.scores[0] > 15 || v.scores[1] > 15 ? ', en las buenas' : ''}</div>`;
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
    tip.className = 'muted';
    tip.style.width = '100%';
    tip.style.textAlign = 'center';
    const cardsHelp = v.legal.some((a) => a.t === 'play') ? 'Clic en una carta o 1, 2, 3 para jugarla. ' : '';
    tip.textContent = `${cardsHelp}Tenés ${v.myTantos} de envido.${teamGame ? ' Q + número: seña.' : ''} C + número: frase.`;
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
          view = message.view;
          for (const event of message.events) describe(event);
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
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      scene.dispose();
    },
  };
}
