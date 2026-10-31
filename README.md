# Trick

Truco argentino en 3D y primera persona, para el navegador. Las señas son gestos en la cara de los avatares: solo los ve quien está mirando en ese momento.

## Probarlo en tu computadora

```bash
npm install
npm run dev
```

Abrí http://localhost:8787. Para jugar con otra persona en la misma máquina, usá otra pestaña: cada pestaña es un jugador.

## Controles

| Acción | Control |
|---|---|
| Mirar | Clic en la mesa y mouse, o flechas. `Esc` recupera el cursor |
| Jugar una carta | Clic sobre la carta, o `1`, `2`, `3` |
| Cantar | `T` truco, `E` envido, `R` real envido, `F` falta envido |
| Responder | `Y` quiero, `N` no quiero |
| Irse al mazo | `M` |
| Hacer una seña | Mantener `Q` y apretar un número |
| Decir una frase | Mantener `C` y apretar un número |
| Guía de señas | `G` |

## Publicarlo

Necesita una cuenta gratis de Cloudflare. El plan gratis corta el servicio al llegar al límite diario, no cobra.

```bash
npx wrangler login
```

```bash
npm run deploy
```

## Comandos

- `npm test`: reglas, parda, envido, visión de señas y miles de jugadas simuladas.
- `npm run smoke`: partida real por WebSocket contra `npm run dev`.
- `npm run typecheck`: tipos del cliente y del servidor.
- `npm run models`: regenera con Blender los modelos 3D desde `scripts/blender`.
- `npm run build`: build del cliente. Falla si se pasan los límites de tamaño.

## Estructura

- `src/engine`: reglas puras del truco y bots. Sin red ni 3D.
- `src/shared`: protocolo, lista de señas y geometría de la visión.
- `src/server`: Worker y Durable Objects. Una sala es un objeto; el código de 4 dígitos es su nombre.
- `src/client`: entrada sin Three.js, y `game/` con la mesa 3D, que se carga aparte.

El servidor decide todo: le manda a cada jugador solo sus cartas, y la seña solo a quien la está mirando.
