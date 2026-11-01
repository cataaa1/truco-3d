import { DurableObject } from 'cloudflare:workers';
import { botAction, botSena } from '../engine/bot';
import {
  applyAction,
  createGame,
  nextHand,
  respondingTeam,
  teamOf,
  timeoutAction,
  viewFor,
  type Action,
  type GameState,
  type PlayerCount,
} from '../engine/game';
import {
  bearingTo,
  canSee,
  cleanName,
  isSena,
  MAX_PITCH,
  MAX_YAW,
  MIN_PITCH,
  PHRASES,
  SENA_MS,
  type ClientMessage,
  type PublicRoom,
  type RoomInfo,
  type SenaId,
  type ServerMessage,
} from '../shared/protocol';
import type { Env } from './index';

const TURN_MS = 25_000;
const BOT_MIN_MS = 900;
const BOT_MAX_MS = 1_900;
const BOT_SENA_MIN_MS = 1_500;
const BOT_SENA_MAX_MS = 5_000;
const NEXT_HAND_MS = 3_500;
const SHOW_MS = 15_000;
const SHOWN_HAND_MS = 6_000;
const AWAY_MS = 15_000;
const LOBBY_SEAT_MS = 15_000;
const QUICK_FILL_MS = 20_000;
const EMPTY_TTL_MS = 2 * 60_000;
const FINISHED_TTL_MS = 10 * 60_000;

interface Seat {
  name: string;
  token: string;
  bot: boolean;
  connected: boolean;
  leftAt: number | null;
  /** Nombre de quien se desconectÃ³ y puede volver a su asiento mientras juega un bot. */
  humanName?: string;
}

interface RoomData {
  code: string;
  public: boolean;
  quick: boolean;
  players: PlayerCount;
  target: 15 | 30;
  status: RoomInfo['status'];
  host: number;
  seats: (Seat | null)[];
  game: GameState | null;
  deadline: number | null;
  botDue: number | null;
  nextHandDue: number | null;
  autoStartAt: number | null;
  emptySince: number | null;
  finishedAt: number | null;
}

interface ActiveSena {
  seat: number;
  id: SenaId;
  until: number;
  seen: Set<number>;
}

interface Attachment {
  seat: number;
}

export class Room extends DurableObject<Env> {
  private data: RoomData | null = null;
  // La mirada y las seÃ±as viven en memoria: son efÃ­meras y no justifican escribir en disco.
  private gaze: { y: number; p: number }[] = [];
  private senas: ActiveSena[] = [];
  private lastSena: number[] = [];
  private lastPhrase: number[] = [];
  private botSenasDone = new Map<number, Set<SenaId>>();
  private botSenaAt: number | null = null;
  // Equipos cuyo bot vio la seÃ±a de envido de su compaÃ±ero en esta mano.
  private envidoHints = new Set<number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.data = (await ctx.storage.get<RoomData>('room')) ?? null;
      if (this.data) this.resetMemory(this.data.players);
    });
  }

  private resetMemory(players: number): void {
    this.gaze = Array.from({ length: players }, () => ({ y: 0, p: -0.5 }));
    this.lastSena = Array<number>(players).fill(0);
    this.lastPhrase = Array<number>(players).fill(0);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/init') return this.init(request);
    if (!this.data) return new Response('not found', { status: 404 });
    if (url.pathname === '/info') return Response.json(this.roomInfo());
    if (url.pathname === '/ws') return this.acceptPlayer(url);
    return new Response('not found', { status: 404 });
  }

  private async init(request: Request): Promise<Response> {
    if (this.data) return new Response('taken', { status: 409 });
    const body = (await request.json()) as { code: string; players: PlayerCount; target: 15 | 30; public: boolean; quick: boolean };
    this.data = {
      code: body.code,
      public: body.public,
      quick: body.quick,
      players: body.players,
      target: body.target,
      status: 'lobby',
      host: 0,
      seats: Array<Seat | null>(body.players).fill(null),
      game: null,
      deadline: null,
      botDue: null,
      nextHandDue: null,
      autoStartAt: body.quick ? Date.now() + QUICK_FILL_MS : null,
      emptySince: Date.now(),
      finishedAt: null,
    };
    this.resetMemory(body.players);
    await this.commit();
    await this.syncDirectory();
    return new Response('ok', { status: 201 });
  }

  private acceptPlayer(url: URL): Response {
    const data = this.data!;
    const token = url.searchParams.get('token') ?? '';
    let seat = token ? data.seats.findIndex((s) => s?.token === token) : -1;
    if (seat < 0) {
      if (data.status !== 'lobby') return new Response('started', { status: 409 });
      seat = data.seats.indexOf(null);
      if (seat < 0) return new Response('full', { status: 409 });
      data.seats[seat] = {
        name: cleanName(url.searchParams.get('name')),
        token: crypto.randomUUID(),
        bot: false,
        connected: true,
        leftAt: null,
      };
      if (!data.seats.some((s, i) => i !== seat && s && !s.bot)) data.host = seat;
    }

    for (const old of this.ctx.getWebSockets(`seat:${seat}`)) old.close(4001, 'reemplazado');
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [`seat:${seat}`]);
    server.serializeAttachment({ seat } satisfies Attachment);

    const occupant = data.seats[seat]!;
    if (occupant.bot) {
      occupant.bot = false;
      occupant.name = occupant.humanName ?? occupant.name;
      delete occupant.humanName;
    }
    occupant.connected = true;
    occupant.leftAt = null;
    data.emptySince = null;

    this.broadcastRoom();
    if (data.game) this.sendGame(seat, []);
    void this.commit();
    void this.syncDirectory();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 256) return;
    const seat = (ws.deserializeAttachment() as Attachment | null)?.seat;
    const data = this.data;
    if (seat === undefined || !data) return;
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    switch (message.t) {
      case 'gaze': this.onGaze(seat, message.y, message.p); break;
      case 'sena': this.onSena(seat, message.id); break;
      case 'phrase': this.onPhrase(seat, message.i); break;
      case 'act': await this.onAction(seat, message.a); break;
      case 'start': await this.onStart(seat, message.fill === true); break;
      case 'leave': await this.onLeave(seat); break;
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onDisconnect(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.onDisconnect(ws);
  }

  private async onDisconnect(ws: WebSocket): Promise<void> {
    const seat = (ws.deserializeAttachment() as Attachment | null)?.seat;
    const data = this.data;
    if (seat === undefined || !data) return;
    if (this.ctx.getWebSockets(`seat:${seat}`).some((other) => other !== ws)) return;
    const occupant = data.seats[seat];
    if (!occupant || occupant.bot) return;
    occupant.connected = false;
    occupant.leftAt = Date.now();
    if (!data.seats.some((s) => s && !s.bot && s.connected)) data.emptySince = Date.now();
    this.broadcastRoom();
    await this.commit();
  }

  /** SaliÃ³ con el botÃ³n: el asiento queda libre en la sala de espera y pasa a un bot en la partida. */
  private async onLeave(seat: number): Promise<void> {
    const data = this.data!;
    const occupant = data.seats[seat];
    if (!occupant || occupant.bot) return;
    if (data.status === 'lobby') {
      data.seats[seat] = null;
      this.passHost();
      if (!data.seats.some((s) => s && !s.bot)) data.emptySince = Date.now();
      this.broadcastRoom();
      await this.commit();
      await this.syncDirectory();
      return;
    }
    if (data.status !== 'playing') return;
    occupant.token = '';
    this.becomeBot(seat);
    // Sin nadie que pueda volver no hay partida que sostener.
    if (!data.seats.some((s) => s && s.token)) {
      data.emptySince = Date.now() - EMPTY_TTL_MS;
      if (await this.shouldDestroy(Date.now())) return;
    }
    await this.commit();
  }

  /** Un bot sigue la partida en ese asiento, con el mismo personaje y las mismas cartas. */
  private becomeBot(seat: number): void {
    const data = this.data!;
    const occupant = data.seats[seat]!;
    if (occupant.token) occupant.humanName = occupant.name;
    const taken = new Set(data.seats.map((s) => s?.name));
    let number = 1;
    while (taken.has(`Bot ${number}`)) number++;
    occupant.name = `Bot ${number}`;
    occupant.bot = true;
    occupant.connected = true;
    occupant.leftAt = null;
    this.passHost();
    const now = Date.now();
    const game = data.game;
    if ((game?.phase === 'playing' || game?.phase === 'showing') && data.botDue === null && this.botToAct() !== null) data.botDue = now + BOT_MIN_MS;
    if (this.botSenaAt === null) this.scheduleBotSenas(now);
    this.broadcastRoom();
    this.moveBotHeads();
  }

  private passHost(): void {
    const data = this.data!;
    if (data.seats[data.host] && !data.seats[data.host]!.bot) return;
    data.host = Math.max(0, data.seats.findIndex((s) => s && !s.bot));
  }

  private onGaze(seat: number, rawYaw: unknown, rawPitch: unknown): void {
    if (typeof rawYaw !== 'number' || typeof rawPitch !== 'number') return;
    if (!Number.isFinite(rawYaw) || !Number.isFinite(rawPitch)) return;
    const y = Math.max(-MAX_YAW, Math.min(MAX_YAW, rawYaw));
    const p = Math.max(MIN_PITCH, Math.min(MAX_PITCH, rawPitch));
    this.gaze[seat] = { y, p };
    this.send(undefined, { t: 'gaze', s: seat, y, p }, seat);
    // Quien entra al cono mientras dura la seÃ±a tambiÃ©n la alcanza a ver.
    const now = Date.now();
    this.senas = this.senas.filter((sena) => sena.until > now);
    for (const sena of this.senas) this.reveal(sena, seat, now);
  }

  /** PrÃ³ximo momento en que los bots buscan hacer una seÃ±a. Va con su propio reloj: mover la cabeza no lo adelanta. */
  private scheduleBotSenas(now: number): void {
    const { game, players, seats, status } = this.data!;
    this.botSenaAt = null;
    if (!game || status !== 'playing' || game.phase !== 'playing' || players === 2) return;
    const pending = seats.some((s, seat) => s?.bot && botSena(game, seat, this.botSenasDone.get(seat) ?? new Set()) !== null);
    if (pending) this.botSenaAt = now + BOT_SENA_MIN_MS + Math.random() * (BOT_SENA_MAX_MS - BOT_SENA_MIN_MS);
  }

  /** Los bots hacen seÃ±as a escondidas: en momentos al azar y nunca mientras un rival los estÃ¡ mirando. */
  private tryBotSenas(now: number): void {
    const data = this.data!;
    const game = data.game;
    if (!game || data.status !== 'playing' || game.phase !== 'playing' || data.players === 2) return;
    const humans = data.seats.flatMap((s, i) => (s && !s.bot && s.connected ? [i] : []));
    const sees = (observer: number, target: number) => {
      const { y, p } = this.gaze[observer]!;
      return canSee(observer, target, data.players, y, p);
    };
    for (let seat = 0; seat < data.players; seat++) {
      if (!data.seats[seat]?.bot || now - this.lastSena[seat]! < SENA_MS + 800 || Math.random() > 0.5) continue;
      if (humans.some((h) => teamOf(h) !== teamOf(seat) && sees(h, seat))) continue;
      const teamHumans = humans.filter((h) => teamOf(h) === teamOf(seat));
      const partner =
        teamHumans[0] ?? Array.from({ length: data.players }, (_, i) => i).find((i) => i !== seat && teamOf(i) === teamOf(seat));
      if (partner === undefined) continue;
      const done = this.botSenasDone.get(seat) ?? new Set<SenaId>();
      const id = botSena(game, seat, done);
      if (!id) continue;
      done.add(id);
      this.botSenasDone.set(seat, done);
      this.lastSena[seat] = now;
      if (id === 'envido' && teamHumans.length === 0) this.envidoHints.add(teamOf(seat));
      // Mira a su compaÃ±ero mientras hace el gesto; los demÃ¡s pueden notar hacia dÃ³nde mira.
      const y = Math.round(bearingTo(seat, partner, data.players) * 100) / 100;
      this.gaze[seat] = { y, p: 0 };
      this.send(undefined, { t: 'gaze', s: seat, y, p: 0 });
      const sena: ActiveSena = { seat, id, until: now + SENA_MS, seen: new Set() };
      this.senas.push(sena);
      for (let observer = 0; observer < data.players; observer++) this.reveal(sena, observer, now);
    }
  }

  private onSena(seat: number, id: unknown): void {
    const data = this.data!;
    if (data.status !== 'playing' || data.players === 2 || !isSena(id)) return;
    const now = Date.now();
    if (now - this.lastSena[seat]! < SENA_MS + 400) return;
    this.lastSena[seat] = now;
    const sena: ActiveSena = { seat, id, until: now + SENA_MS, seen: new Set() };
    this.senas.push(sena);
    for (let observer = 0; observer < data.players; observer++) this.reveal(sena, observer, now);
    if (id === 'envido') this.noteEnvidoHint(seat);
  }

  /** El bot compaÃ±ero siempre estÃ¡ atento a su equipo: no hace falta levantar la vista para pedirle el envido. */
  private noteEnvidoHint(seat: number): void {
    const data = this.data!;
    const hasBotPartner = data.seats.some((s, bot) => s?.bot && bot !== seat && teamOf(bot) === teamOf(seat));
    if (hasBotPartner) this.envidoHints.add(teamOf(seat));
  }

  private reveal(sena: ActiveSena, observer: number, now: number): void {
    if (sena.seen.has(observer)) return;
    const { y, p } = this.gaze[observer]!;
    if (!canSee(observer, sena.seat, this.data!.players, y, p)) return;
    sena.seen.add(observer);
    this.send(observer, { t: 'sena', s: sena.seat, id: sena.id, ms: sena.until - now });
  }

  private onPhrase(seat: number, index: unknown): void {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= PHRASES.length) return;
    const now = Date.now();
    if (now - this.lastPhrase[seat]! < 2_000) return;
    this.lastPhrase[seat] = now;
    this.send(undefined, { t: 'phrase', s: seat, i: index });
  }

  private async onAction(seat: number, action: Action): Promise<void> {
    const game = this.data?.game;
    if (!game) return;
    if (!applyAction(game, seat, action)) {
      this.send(seat, { t: 'err', msg: 'Esa jugada no vale ahora' });
      return;
    }
    await this.afterGameChange();
  }

  private async onStart(seat: number, fill: boolean): Promise<void> {
    const data = this.data!;
    if (data.status !== 'lobby' || seat !== data.host) return;
    if (fill) this.fillWithBots();
    if (data.seats.some((s) => s === null)) {
      this.send(seat, { t: 'err', msg: 'TodavÃ­a faltan jugadores' });
      return;
    }
    await this.startGame();
  }

  private fillWithBots(): void {
    const data = this.data!;
    let n = 1;
    data.seats = data.seats.map(
      (s) => s ?? { name: `Bot ${n++}`, token: '', bot: true, connected: true, leftAt: null },
    );
  }

  private async startGame(): Promise<void> {
    const data = this.data!;
    data.status = 'playing';
    data.autoStartAt = null;
    data.game = createGame({ players: data.players, target: data.target, flor: false });
    this.broadcastRoom();
    await this.afterGameChange();
    await this.syncDirectory();
  }

  private isBotControlled(seat: number): boolean {
    const occupant = this.data!.seats[seat];
    if (!occupant || occupant.bot) return true;
    return occupant.leftAt !== null && Date.now() - occupant.leftAt >= AWAY_MS;
  }

  /** Asiento controlado por el bot que debe actuar ahora, si lo hay. */
  private botToAct(): number | null {
    const { game, players } = this.data!;
    if (game?.phase === 'showing') {
      const claimant = game.hand.envidoClaim!.seat;
      return this.isBotControlled(claimant) ? claimant : null;
    }
    if (!game || game.phase !== 'playing') return null;
    const responding = respondingTeam(game.hand);
    if (responding !== null) {
      const team = Array.from({ length: players }, (_, s) => s).filter(
        (s) => teamOf(s) === responding && !game.hand.folded[s],
      );
      // Si hay una persona en el equipo, la decisiÃ³n es suya.
      return team.every((s) => this.isBotControlled(s)) ? (team[0] ?? null) : null;
    }
    return this.isBotControlled(game.hand.turn) ? game.hand.turn : null;
  }

  private async afterGameChange(): Promise<void> {
    const data = this.data!;
    const game = data.game!;
    const events = game.events;
    game.events = [];
    const now = Date.now();
    const dealt = events.some((event) => event.e === 'deal');
    if (dealt) {
      this.botSenasDone.clear();
      this.envidoHints.clear();
    }
    if (dealt || this.botSenaAt === null || game.phase !== 'playing') this.scheduleBotSenas(now);

    data.deadline = game.phase === 'playing' ? now + TURN_MS : game.phase === 'showing' ? now + SHOW_MS : null;
    const showedCards = events.some((event) => event.e === 'show' && event.shown);
    data.nextHandDue = game.phase === 'handOver' ? now + (showedCards ? SHOWN_HAND_MS : NEXT_HAND_MS) : null;
    data.botDue =
      this.botToAct() !== null ? now + BOT_MIN_MS + Math.random() * (BOT_MAX_MS - BOT_MIN_MS) : null;
    if (game.phase === 'gameOver' && data.status !== 'finished') {
      data.status = 'finished';
      data.finishedAt = now;
      this.broadcastRoom();
    }

    for (let seat = 0; seat < data.players; seat++) this.sendGame(seat, events);
    this.moveBotHeads();
    await this.commit();
  }

  /** Los bots miran a quien le toca, asÃ­ la mesa no parece de muÃ±ecos quietos. */
  private moveBotHeads(): void {
    const { game, players, seats } = this.data!;
    if (!game) return;
    for (let seat = 0; seat < players; seat++) {
      if (!seats[seat]?.bot) continue;
      const looksAt = game.hand.turn === seat ? (seat + 1) % players : game.hand.turn;
      const y = Math.round(bearingTo(seat, looksAt, players) * 100) / 100;
      const previous = this.gaze[seat]!;
      if (previous.y === y && previous.p === 0) continue;
      this.gaze[seat] = { y, p: 0 };
      this.send(undefined, { t: 'gaze', s: seat, y, p: 0 });
    }
  }

  override async alarm(): Promise<void> {
    const data = this.data;
    if (!data) return;
    const now = Date.now();

    if (data.status === 'lobby') {
      for (let seat = 0; seat < data.players; seat++) {
        const occupant = data.seats[seat];
        if (occupant && !occupant.bot && occupant.leftAt !== null && now - occupant.leftAt >= LOBBY_SEAT_MS) {
          data.seats[seat] = null;
          this.passHost();
          this.broadcastRoom();
          await this.syncDirectory();
        }
      }
      if (data.autoStartAt !== null && now >= data.autoStartAt && data.seats.some((s) => s && !s.bot)) {
        this.fillWithBots();
        await this.startGame();
        return;
      }
    }

    if (await this.shouldDestroy(now)) return;

    if (data.status === 'playing') {
      data.seats.forEach((occupant, seat) => {
        if (occupant && !occupant.bot && occupant.leftAt !== null && now - occupant.leftAt >= AWAY_MS) this.becomeBot(seat);
      });
    }

    if (this.botSenaAt !== null && now >= this.botSenaAt) {
      this.tryBotSenas(now);
      this.scheduleBotSenas(now);
      // Las seÃ±as no se guardan: si no vence nada mÃ¡s, alcanza con programar la prÃ³xima alarma.
      const other = this.nextAlarm(false);
      if (other === null || other > now) {
        await this.setNextAlarm();
        return;
      }
    }

    const game = data.game;
    if (game && data.status === 'playing') {
      if (game.phase === 'handOver' && data.nextHandDue !== null && now >= data.nextHandDue) {
        nextHand(game);
        await this.afterGameChange();
        return;
      }
      const active = game.phase === 'playing' || game.phase === 'showing';
      if (active && data.botDue !== null && now >= data.botDue) {
        const seat = this.botToAct();
        const action =
          seat === null
            ? null
            : botAction(game, seat, Math.random, { partnerHasEnvido: this.envidoHints.has(teamOf(seat)) });
        if (seat !== null && action && applyAction(game, seat, action)) {
          await this.afterGameChange();
          return;
        }
        data.botDue = null;
      }
      // Alguien pudo pasar a estar controlado por un bot mientras corrÃ­a el turno.
      if (active && data.botDue === null && this.botToAct() !== null) {
        data.botDue = now + BOT_MIN_MS;
      }
      if (active && data.deadline !== null && now >= data.deadline) {
        const timeout = timeoutAction(game);
        if (timeout && applyAction(game, timeout.seat, timeout.action)) {
          await this.afterGameChange();
          return;
        }
      }
    }
    await this.commit();
  }

  private async shouldDestroy(now: number): Promise<boolean> {
    const data = this.data!;
    const expired =
      (data.emptySince !== null && now - data.emptySince >= EMPTY_TTL_MS) ||
      (data.finishedAt !== null && now - data.finishedAt >= FINISHED_TTL_MS);
    if (!expired) return false;
    const code = data.code;
    this.data = null;
    for (const ws of this.ctx.getWebSockets()) ws.close(4000, 'sala cerrada');
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    await this.directory('/remove', { code });
    return true;
  }

  private nextAlarm(withSenas = true): number | null {
    const data = this.data!;
    const leftAts = data.seats.flatMap((s) => (s && !s.bot && s.leftAt !== null ? [s.leftAt] : []));
    const candidates = [
      data.deadline,
      data.botDue,
      data.nextHandDue,
      data.autoStartAt,
      withSenas ? this.botSenaAt : null,
      data.emptySince === null ? null : data.emptySince + EMPTY_TTL_MS,
      data.finishedAt === null ? null : data.finishedAt + FINISHED_TTL_MS,
      ...leftAts.map((t) => t + (data.status === 'lobby' ? LOBBY_SEAT_MS : AWAY_MS)),
    ].filter((t): t is number => t !== null && t > Date.now() - 1000);
    return candidates.length === 0 ? null : Math.min(...candidates);
  }

  private async commit(): Promise<void> {
    if (!this.data) return;
    await this.ctx.storage.put('room', this.data);
    await this.setNextAlarm();
  }

  private async setNextAlarm(): Promise<void> {
    const next = this.nextAlarm();
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 10));
  }

  private roomInfo(): RoomInfo {
    const data = this.data!;
    return {
      code: data.code,
      public: data.public,
      players: data.players,
      target: data.target,
      status: data.status,
      host: data.host,
      autoStartAt: data.autoStartAt,
      seats: data.seats.map((s) => s && { name: s.name, bot: s.bot, connected: s.connected }),
    };
  }

  private broadcastRoom(): void {
    const room = this.roomInfo();
    for (let seat = 0; seat < room.players; seat++) {
      const token = this.data!.seats[seat]?.token ?? '';
      this.send(seat, { t: 'room', room, you: seat, token });
    }
  }

  private sendGame(seat: number, events: GameState['events']): void {
    const data = this.data!;
    if (this.ctx.getWebSockets(`seat:${seat}`).length === 0) return;
    this.send(seat, { t: 'game', view: viewFor(data.game!, seat), events, deadline: data.deadline });
  }

  /** Manda a un asiento o, sin asiento, a todos menos `except`. */
  private send(seat: number | undefined, message: ServerMessage, except?: number): void {
    const text = JSON.stringify(message);
    const sockets = seat === undefined ? this.ctx.getWebSockets() : this.ctx.getWebSockets(`seat:${seat}`);
    for (const ws of sockets) {
      if (except !== undefined && (ws.deserializeAttachment() as Attachment | null)?.seat === except) continue;
      try {
        ws.send(text);
      } catch {
        // El cierre lo maneja webSocketClose.
      }
    }
  }

  private async syncDirectory(): Promise<void> {
    const data = this.data!;
    if (!data.public) return;
    if (data.status !== 'lobby') {
      await this.directory('/remove', { code: data.code });
      return;
    }
    const room: PublicRoom = {
      code: data.code,
      players: data.players,
      target: data.target,
      taken: data.seats.filter(Boolean).length,
      quick: data.quick,
    };
    await this.directory('/upsert', room);
  }

  private async directory(path: string, body: unknown): Promise<void> {
    const stub = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('main'));
    await stub.fetch(`https://directory${path}`, { method: 'POST', body: JSON.stringify(body) });
  }
}
