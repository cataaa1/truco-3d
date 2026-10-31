import type { ClientMessage, ServerMessage } from '../shared/protocol';

const tokenKey = (code: string) => `trick:token:${code}`;

/** Conexión a una sala. Reconecta sola con el token del asiento. */
export class Connection {
  onMessage: (message: ServerMessage) => void = () => {};
  onStatus: (online: boolean) => void = () => {};
  onClosed: (reason: string) => void = () => {};
  private ws: WebSocket | null = null;
  private retries = 0;
  private stopped = false;
  private everOpened = false;

  constructor(readonly code: string, private readonly name: string) {}

  open(): void {
    const token = sessionStorage.getItem(tokenKey(this.code)) ?? '';
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const query = new URLSearchParams({ name: this.name, token });
    const ws = new WebSocket(`${scheme}://${location.host}/api/rooms/${this.code}/ws?${query}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.everOpened = true;
      this.onStatus(true);
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.t === 'room' && message.token) sessionStorage.setItem(tokenKey(this.code), message.token);
      this.onMessage(message);
    };
    ws.onclose = (event) => {
      if (this.stopped || this.ws !== ws) return;
      this.onStatus(false);
      if (event.code === 4000) return this.fail('La sala se cerró');
      if (event.code === 4001) return this.fail('Abriste esta partida en otra pestaña');
      if (!this.everOpened && this.retries >= 2) return this.fail('No se pudo entrar a la sala');
      const delay = Math.min(8000, 500 * 2 ** this.retries++);
      setTimeout(() => {
        if (!this.stopped) this.open();
      }, delay);
    };
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.stopped = true;
    this.ws?.close();
    sessionStorage.removeItem(tokenKey(this.code));
  }

  private fail(reason: string): void {
    this.stopped = true;
    this.onClosed(reason);
  }
}
