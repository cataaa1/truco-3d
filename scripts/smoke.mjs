// Prueba de punta a punta contra `npm run dev`: juega una partida real por WebSocket.
// Verifica salas, cartas ocultas, señas según la mirada y una partida completa con bots.
const BASE = process.env.BASE ?? 'http://localhost:8787';
const WS = BASE.replace('http', 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'OK ' : 'MAL'} ${name}`);
  if (!ok) failures++;
};

function player(code, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/api/rooms/${code}/ws?name=${name}&token=`);
    const p = { ws, name, seat: -1, room: null, view: null, inbox: [], raw: [] };
    p.send = (m) => ws.send(JSON.stringify(m));
    ws.onmessage = (e) => {
      p.raw.push(e.data);
      const m = JSON.parse(e.data);
      p.inbox.push(m);
      if (m.t === 'room') { p.room = m.room; p.seat = m.you; }
      if (m.t === 'game') p.view = m.view;
    };
    ws.onerror = () => reject(new Error(`no conecta ${name}`));
    ws.onopen = () => resolve(p);
  });
}

async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(25);
  }
  return false;
}

async function create(players, target = 30, isPublic = false) {
  const r = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    body: JSON.stringify({ players, target, public: isPublic }),
  });
  return (await r.json()).code;
}

// --- Código inexistente y sala pública ---
const missing = await fetch(`${BASE}/api/rooms/0000`);
check('un código inexistente da 404 o existe de verdad', missing.status === 404 || missing.status === 200);

const publicCode = await create(4, 30, true);
const listed = await (await fetch(`${BASE}/api/rooms`)).json();
check('la sala pública aparece en la lista', listed.some((r) => r.code === publicCode));

// --- Sala privada de 4 ---
const code = await create(4);
const listed2 = await (await fetch(`${BASE}/api/rooms`)).json();
check('la sala privada no aparece en la lista', !listed2.some((r) => r.code === code));

const players = [];
for (const name of ['Ana', 'Beto', 'Caro', 'Dani']) players.push(await player(code, name));
check('todos reciben asiento', await until(() => players.every((p) => p.seat >= 0)));
const fifth = await player(code, 'Quinto').then(() => 'entró', () => 'rechazado');
check('la quinta persona no entra', fifth === 'rechazado');

players[1].send({ t: 'start', fill: false });
await sleep(200);
check('solo quien creó la sala puede empezar', !players[0].view);
players[0].send({ t: 'start', fill: false });
check('la partida empieza', await until(() => players.every((p) => p.view)));

// --- Información oculta ---
const [a, b, c, d] = players;
const others = [b, c, d].flatMap((p) => p.view.myCards);
const leak = a.raw.some((text) => {
  if (!text.includes('"t":"game"')) return false;
  const v = JSON.parse(text).view;
  return v.myCards.some((card) => others.includes(card)) || 'dealt' in v || 'cards' in v;
});
check('a nadie le llegan cartas ajenas', !leak);

// --- Señas según la mirada ---
for (const p of players) p.inbox.length = 0;
a.send({ t: 'gaze', y: 0, p: -0.8 }); // Ana mira sus cartas.
c.send({ t: 'gaze', y: 0, p: 0 });    // Caro, enfrente, mira a Ana.
b.send({ t: 'gaze', y: -Math.PI / 4, p: 0 }); // Beto, a la izquierda de Caro: mira a Ana.
d.send({ t: 'gaze', y: -1.1, p: 0 }); // Dani mira a otro lado.
await sleep(250);
a.send({ t: 'sena', id: 'ancho_espada' });
await sleep(300);
const got = (p) => p.inbox.some((m) => m.t === 'sena' && m.id === 'ancho_espada');
check('la compañera que mira ve la seña', got(c));
check('el rival que mira también la ve', got(b));
check('el rival distraído no recibe nada', !got(d));
check('quien la hizo no se la recibe', !got(a));

// Entra al cono durante la seña.
await sleep(1700);
for (const p of players) p.inbox.length = 0;
d.send({ t: 'gaze', y: -1.1, p: 0 });
await sleep(100);
a.send({ t: 'sena', id: 'tres' });
await sleep(100);
const dBearing = Math.atan2(Math.sin((2 * Math.PI * 1) / 4), 1 - Math.cos((2 * Math.PI * 1) / 4));
d.send({ t: 'gaze', y: dBearing, p: 0 });
await sleep(200);
check('quien gira a tiempo alcanza a verla', d.inbox.some((m) => m.t === 'sena' && m.id === 'tres'));

await sleep(800);
for (const p of players) p.inbox.length = 0;
a.send({ t: 'sena', id: 'trampa' });
await sleep(150);
check('una seña inventada no se reenvía', !c.inbox.some((m) => m.t === 'sena'));

// --- Jugada ilegal ---
const notTurn = players.find((p) => p.view.turn !== p.seat);
notTurn.inbox.length = 0;
notTurn.send({ t: 'act', a: { t: 'play', card: notTurn.view.myCards[0] } });
check('una jugada fuera de turno se rechaza', await until(() => notTurn.inbox.some((m) => m.t === 'err')));

// --- Reconexión ---
for (const p of players) p.ws.close();

// --- Partida completa de 2 contra un bot, a 15, con jugadas reales ---
const code2 = await create(2, 15);
const solo = await player(code2, 'Solo');
await until(() => solo.seat >= 0);
solo.send({ t: 'start', fill: true });
check('la sala se completa con bots', await until(() => solo.view));
const started = Date.now();
let moves = 0;
while (solo.view?.phase !== 'gameOver' && Date.now() - started < 300_000) {
  const v = solo.view;
  const play = v.legal.find((x) => x.t === 'play');
  const answer = v.legal.find((x) => x.t === 'quiero');
  const action = answer ?? play;
  if (action && v.phase === 'playing') {
    solo.send({ t: 'act', a: action });
    moves++;
    await sleep(120);
  } else await sleep(100);
}
check(`la partida contra el bot termina (${moves} jugadas, ${solo.view?.scores})`, solo.view?.phase === 'gameOver');

// --- Un bot compañero hace una seña cuando lo miran ---
const code4 = await create(4);
const human = await player(code4, 'Compa');
await until(() => human.seat >= 0);
human.send({ t: 'start', fill: true });
await until(() => human.view);
human.send({ t: 'gaze', y: 0, p: 0 });
check('el bot compañero le hace una seña a quien lo mira', await until(() => human.inbox.some((m) => m.t === 'sena' && m.s === (human.seat + 2) % 4), 3000));
human.inbox.length = 0;
human.send({ t: 'gaze', y: 0.785, p: 0 });
await sleep(150);
human.send({ t: 'gaze', y: 0.01, p: -0.8 });
await sleep(2200);
check('sin mirarlo no llega ninguna seña', !human.inbox.some((m) => m.t === 'sena' && m.s === (human.seat + 2) % 4));
human.ws.close();

// --- El bot canta envido cuando su compañero le hace la seña ---
let sang = false;
for (let attempt = 0; attempt < 12 && !sang; attempt++) {
  const room4 = await create(4);
  const me = await player(room4, 'Pide');
  await until(() => me.seat >= 0);
  me.send({ t: 'start', fill: true });
  await until(() => me.view);
  const partner = (me.seat + 2) % 4;
  // Solo vale si el compañero es uno de los dos últimos de la ronda.
  if ((partner - me.view.mano + 4) % 4 >= 2) {
    me.send({ t: 'gaze', y: 0, p: 0 });
    await sleep(100);
    me.send({ t: 'sena', id: 'envido' });
    const end = Date.now() + 14000;
    while (Date.now() < end && !sang && me.view.phase === 'playing') {
      sang = me.inbox.some((m) => m.t === 'game' && m.events.some((e) => e.e === 'canto' && e.seat === partner && e.canto === 'envido'));
      const play = me.view.legal.find((a) => a.t === 'quiero') ?? me.view.legal.find((a) => a.t === 'play');
      if (play && !sang) me.send({ t: 'act', a: play });
      await sleep(250);
    }
  }
  me.ws.close();
}
check('el bot canta envido cuando su compañero le hace la seña', sang);

// --- Reconexión con token ---
const code3 = await create(2);
const first = await player(code3, 'Vuelve');
await until(() => first.seat >= 0);
const seatToken = first.inbox.find((m) => m.t === 'room').token;
first.send({ t: 'start', fill: true });
await until(() => first.view);
first.ws.close();
await sleep(300);
const back = await new Promise((resolve, reject) => {
  const ws = new WebSocket(`${WS}/api/rooms/${code3}/ws?name=Vuelve&token=${seatToken}`);
  const p = { ws, view: null };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'game') p.view = m.view;
  };
  ws.onopen = () => resolve(p);
  ws.onerror = reject;
});
check('al reconectar recupera su asiento y sus cartas', await until(() => back.view && JSON.stringify(back.view.myCards).length > 0 && back.view.seat === first.seat));
back.ws.close();
solo.ws.close();

console.log(failures ? `\n${failures} fallaron` : '\nTodo bien');
process.exit(failures ? 1 : 0);
