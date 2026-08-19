# 00 — Estado atual e dores do pipeline

Este documento é o "baseline factual" usado como referência pelas demais
fases. Todas as afirmações abaixo foram verificadas diretamente no código
(não é especulação) — ver referências de arquivo/linha.

## 1. Não existe frame compartilhado — cada consumidor decodifica sozinho

Por câmera habilitada, a câmera física recebe **1 conexão** (o pull nativo do
MediaMTX). A partir daí, cada consumidor abre a **própria conexão RTSP para o
MediaMTX** (não para a câmera) — não há reaproveitamento:

| # | Consumidor | Conecta em | Mecanismo | Referência |
|---|------------|-----------|-----------|------------|
| 1 | MediaMTX | Câmera | Cliente Go nativo | [backend/mediamtx.yml](../backend/mediamtx.yml) |
| 2 | Live view (HLS) | MediaMTX (mux HLS) | Proxy Express | [backend/src/app.ts](../backend/src/app.ts) |
| 3 | `motion_worker.py` | MediaMTX | `cv2.VideoCapture(rtsp_url)`, 1 processo por câmera | [backend/motion_worker.py](../backend/motion_worker.py#L93-L96), spawn em [motionDetector.ts](../backend/src/media/motionDetector.ts#L46) |
| 4 | `frameSnapshot.ts` | MediaMTX | novo processo ffmpeg a cada chamada, `-frames:v 1` | [frameSnapshot.ts](../backend/src/media/frameSnapshot.ts#L21-L32) |
| 5 | Snapshot ONVIF (tentado antes do #4) | Câmera direto | HTTP GET `GetSnapshotUri` | `backend/src/onvif/snapshot.ts` |
| 6 | Bridges de transcodificação (rotation/timestamp/mjpeg/webpage) | Câmera ou MediaMTX | ffmpeg lê e republica como `publisher` | `backend/src/media/rotationBridge.ts`, `timestampBridge.ts`, `mjpegBridge.ts`, `webpageBridge.ts` |
| 7 | VLC relay | Câmera direto | `cvlc --sout`, republica RTSP | `backend/src/media/vlcRelay.ts` |
| 8 | Gravação | Nativa MediaMTX | `record: yes` | [mediamtx.yml](../backend/mediamtx.yml#L67-L74) |
| 9 | Clip de evento | Playback API MediaMTX (HTTP) | `GET /get?path=...` | [mediamtx.ts](../backend/src/media/mediamtx.ts#L156-L177) |
| 10 | Grid broadcast (mosaico/rotação) | MediaMTX | ffmpeg com N inputs RTSP + `xstack` | `backend/src/media/gridBroadcastBridge.ts` |

**Dor concreta**: `frameSnapshot.ts` sobe um processo ffmpeg novo a cada
chamada, sem cache — usado por (a) fallback de snapshot de evento, (b) imagem
de fundo do editor de zona de detecção, (c) refresh do baseline idle a cada 10
min ([baselineSnapshot.ts](../backend/src/media/baselineSnapshot.ts)). Em uma
instalação com várias câmeras e eventos frequentes, isso significa vários
processos ffmpeg de vida curta subindo/descendo o tempo todo — overhead de
CPU e I/O que não precisaria existir se houvesse um frame recente em cache.

## 2. `motion_worker.py` × `vision_worker.py` — modelos de concorrência opostos

- **`motion_worker.py`**: **1 processo Python por câmera**, sempre rodando
  enquanto a câmera tem detecção de movimento por vídeo ativa. IPC
  unidirecional (stdout → Node), uma linha JSON por evento de movimento:
  ```json
  {"type": "motion", "areaRatio": 0.0234, "frame": "<JPEG base64, 640px>"}
  ```
  ([motion_worker.py#L133](../backend/motion_worker.py#L133),
  lido em [motionDetector.ts#L64](../backend/src/media/motionDetector.ts#L64)).
  N câmeras = N processos OpenCV/MOG2 rodando em paralelo real (processos
  separados, sem contenção de GIL). Evidência de produção registrada na
  memória do repo: ~45% de CPU em 1 processo, 10-27% nos demais, em host de 4
  vCPUs com 4 câmeras reais.

- **`vision_worker.py`**: **1 único processo compartilhado** para todas as
  câmeras, **totalmente sequencial** — `for line in sys.stdin` sem thread
  pool nem asyncio ([vision_worker.py#L228](../backend/vision_worker.py#L228)).
  Não decodifica RTSP: só recebe um JPEG já capturado, em base64, dentro de um
  request JSON-RPC-sobre-stdio (`{"id", "task", "image"}` →
  `{"id", "result"}` / `{"id", "error"}`), correlacionado por `id` incremental,
  timeout de 8s
  ([visionWorker.ts#L18-L138](../backend/src/media/visionWorker.ts#L18)).
  Tasks disponíveis: `detect`, `face`, `embed_face`, `status`
  ([vision_worker.py#L246-L253](../backend/vision_worker.py#L246-L253)).
  Só é acionado **depois** que o MOG2 do `motion_worker.py` já disparou —
  nunca roda em todo frame.

**Dor concreta**: por ser um único processo sequencial, uma detecção lenta em
uma câmera atrasa a fila de todas as outras. O próprio código já reconhece o
risco: `visionWorker.ts` expõe `pendingRequests` especificamente para o
Dashboard sinalizar "atolado"
([visionWorker.ts#L163-L176](../backend/src/media/visionWorker.ts#L163-L176)).

## 3. Detecções nunca voltam para o vídeo (sem tracking, sem overlay)

Confirmado por busca exaustiva (`track|overlay|bbox|annotated|draw|ByteTrack|
MOSSE|centroid`) em todo `backend/src/**` e `backend/*.py`: **zero** ocorrência
relacionada a tracking ou desenho de overlay. Cada detecção
(`classifyMotionFrame` em `objectDetection.ts`) é **stateless** — roda uma vez
por frame de gatilho, sem memória do que foi detectado no frame anterior.

O `box: [x, y, w, h]` normalizado que o YOLO retorna
([vision_worker.py#L169-L177](../backend/vision_worker.py#L169-L177)) hoje só
alimenta: (a) metadados do evento salvos no banco, e (b) uma dica textual
injetada no prompt do VLM de legenda (`buildDetectionContextHint` em
[captioning.ts#L38-L57](../backend/src/notifications/captioning.ts#L38)).
**Nunca toca os pixels do vídeo**, ao vivo ou gravado.

## 4. Pipeline de eventos hoje (`cameraEvents.ts`)

Ponto de entrada único: `recordCameraEvent(camera, topic, message)`
([cameraEvents.ts#L118](../backend/src/events/cameraEvents.ts#L118)), chamado
por ONVIF PullPoint ou por `motionDetector.ts`. Estágios de pipeline já
etiquetados hoje (`buildPipelineInfo`,
[cameraEvents.ts#L44-L69](../backend/src/events/cameraEvents.ts#L44)):
`onvif_event`, `video_motion`, `object_detection`, `face_recognition`,
`captioning` (este último anexado de forma assíncrona depois que o VLM
responde). Fluxo: notabilidade → debounce de sessão → tagging → insert no
banco → broadcast WebSocket → (fire-and-forget) snapshot + clipe + legenda em
paralelo → fan-out de notificações via `Promise.allSettled`.

## 5. Canais de notificação: convenção, não interface formal

`discord.ts`, `telegram.ts`, `genericWebhook.ts`, `email.ts`, `webPush.ts` são
cada um escrito à mão, com assinaturas parecidas mas **sem** um `interface`
TypeScript comum nem um registro/plugin list. Adicionar um 6º canal hoje exige
editar `webhooks.ts` em 3 lugares (`notifyEvent`, `notifyCameraUnavailable`,
`notifyCameraRecovered`) — ver
[webhooks.ts#L44-L71](../backend/src/notifications/webhooks.ts#L44).

## 6. Modelos de IA hoje

| Task | Modelo | Observação |
|------|--------|------------|
| `detect` | YOLO (`cv2.dnn.readNetFromONNX`) | COCO 80 classes, categorizado em person/vehicle/animal/other. **Não vendorizado** por licença AGPL-3.0 — ausente hoje de `app-data/models/`, precisa ser baixado manualmente. |
| `face` | YuNet (detecção) + SFace (reconhecimento) | Nativos no OpenCV, vendorizados. |
| `embed_face` | SFace | Usado só no cadastro de rosto. |
| `status` | todos | Introspecção de saúde pro Dashboard. |

Sem OCR/LPR, sem estimativa de pose — confirmado por grep sem resultados.

## 7. Fronteira MediaMTX — confirmada e correta

MediaMTX faz: ingestão RTSP nativa, HLS, WebRTC (configurado mas não usado
pelo player atual, que usa hls.js), gravação nativa fMP4, Playback API,
Control API. **Não faz**: ONVIF, transcodificação/filtros (tudo via ffmpeg
bridge separado publicando de volta como `publisher`), detecção de
movimento/IA. Nenhuma fase deste roadmap propõe mudar essa fronteira.

## Resumo das dores, em ordem de impacto prático

1. **Overhead de decode duplicado** — todo consumidor de frame único
   (snapshot, baseline, editor de zona) sobe um ffmpeg novo, sem cache. →
   [Fase 01](./01-frame-cache.md).
2. **Reprocessamento redundante do YOLO** — cada frame de gatilho é
   reclassificado do zero, sem aproveitar que o "mesmo" objeto provavelmente
   ainda está na cena no próximo gatilho da mesma sessão. → [Fase
   02](./02-tracking-de-objetos.md).
3. **Zero visibilidade visual da IA** — usuário não vê bounding boxes em
   lugar nenhum, mesmo tendo objetos/rostos detectados. → [Fase
   03](./03-stream-anotada-renderer.md).
4. **Extensibilidade de notificação manual e frágil** — 3 pontos de edição
   por canal novo. → [Fase 04](./04-event-bus-plugins.md).
5. **Câmeras ONVIF incompletas (ex. Yoosee) exigem tratamento especial
   espalhado pelo código** (`rtspCompatMode`, flags variadas em
   `provisioning.ts`) em vez de uma abstração única de capacidades. → [Fase
   05](./05-capability-resolver.md).
