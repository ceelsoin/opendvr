import { connectToDevice, discoverStreams } from "./device.js";
import { ptzGotoPreset, ptzListPresets, ptzMove, ptzSetPreset, ptzStop, ptzZoom } from "./ptz.js";
import type { PtzDirection } from "./ptz.js";
import { isTcpPortReachable } from "../lib/tcpCheck.js";
import type { Camera } from "../types/camera.js";

/**
 * Registry of ONVIF operations that can be triggered ad-hoc against a
 * stored camera, for the "/comando" debug terminal (GridPage-adjacent ONVIF
 * debug screen). Each command resolves the camera's credentials itself
 * (never accepts host/user/pass from the request) and returns whatever
 * data the underlying ONVIF SOAP call responds with, for inspection.
 *
 * Deliberately excludes mutating/destructive device operations (reboot,
 * setHostname, setNTP, createUsers, deleteUsers, etc.) - only read-only
 * "get*" queries and the already-safe PTZ move/stop/preset actions (which
 * are also exposed elsewhere in the app UI) are included.
 */

export interface OnvifDebugCommand {
  name: string;
  usage: string;
  description: string;
  run: (camera: Camera, args: string[]) => Promise<unknown>;
}

function requireArg(args: string[], index: number, label: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`Argumento obrigatório faltando: ${label}`);
  }
  return value;
}

async function currentProfileToken(camera: Camera, device: unknown): Promise<string> {
  if (camera.onvifProfileToken) return camera.onvifProfileToken;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token: string | undefined = (device as any)?.getCurrentProfile?.()?.token;
  if (!token) throw new Error("Não há profileToken salvo nem resolvível para esta câmera.");
  return token;
}

const PTZ_DIRECTIONS: PtzDirection[] = [
  "up",
  "down",
  "left",
  "right",
  "upLeft",
  "upRight",
  "downLeft",
  "downRight",
];

export const ONVIF_DEBUG_COMMANDS: OnvifDebugCommand[] = [
  {
    name: "tcp.check",
    usage: "/tcp.check",
    description: "Testa se a porta ONVIF (host:port) está aberta via TCP puro, sem falar SOAP.",
    run: async (camera) => {
      const reachable = await isTcpPortReachable(camera.host, camera.port, 15_000);
      return { host: camera.host, port: camera.port, reachable };
    },
  },
  {
    name: "device.info",
    usage: "/device.info",
    description: "GetDeviceInformation - fabricante, modelo, firmware, número de série.",
    run: async (camera) => {
      const device = await connectToDevice(camera);
      const result = await device.services.device.getDeviceInformation();
      return result?.data ?? result;
    },
  },
  {
    name: "device.capabilities",
    usage: "/device.capabilities",
    description: "GetCapabilities - lista os serviços/recursos que o dispositivo suporta.",
    run: async (camera) => {
      const device = await connectToDevice(camera);
      const result = await device.services.device.getCapabilities();
      return result?.data ?? result;
    },
  },
  {
    name: "device.time",
    usage: "/device.time",
    description: "GetSystemDateAndTime - data/hora e fuso horário do dispositivo.",
    run: async (camera) => {
      const device = await connectToDevice(camera);
      const result = await device.services.device.getSystemDateAndTime();
      return result?.data ?? result;
    },
  },
  {
    name: "device.scopes",
    usage: "/device.scopes",
    description: "GetScopes - escopos ONVIF anunciados pelo dispositivo (tipo, nome, localização).",
    run: async (camera) => {
      const device = await connectToDevice(camera);
      const result = await device.services.device.getScopes();
      return result?.data ?? result;
    },
  },
  {
    name: "device.hostname",
    usage: "/device.hostname",
    description: "GetHostname - hostname configurado no dispositivo.",
    run: async (camera) => {
      const device = await connectToDevice(camera);
      const result = await device.services.device.getHostname();
      return result?.data ?? result;
    },
  },
  {
    name: "device.networkInterfaces",
    usage: "/device.networkInterfaces",
    description: "GetNetworkInterfaces - interfaces de rede (IP, MAC, link) do dispositivo.",
    run: async (camera) => {
      const device = await connectToDevice(camera);
      const result = await device.services.device.getNetworkInterfaces();
      return result?.data ?? result;
    },
  },
  {
    name: "device.users",
    usage: "/device.users",
    description: "GetUsers - lista de usuários cadastrados no dispositivo.",
    run: async (camera) => {
      const device = await connectToDevice(camera);
      const result = await device.services.device.getUsers();
      return result?.data ?? result;
    },
  },
  {
    name: "media.profiles",
    usage: "/media.profiles",
    description: "GetProfiles - lista bruta de todos os media profiles ONVIF (raw SOAP, sem tratamento).",
    run: async (camera) => {
      const device = await connectToDevice(camera);
      const result = await device.services.media.getProfiles();
      return result?.data ?? result;
    },
  },
  {
    name: "media.streams",
    usage: "/media.streams",
    description: "Descobre todos os streams RTSP disponíveis (equivalente ao botão 'Obter URLs de vídeo').",
    run: async (camera) => discoverStreams(camera),
  },
  {
    name: "media.streamUri",
    usage: "/media.streamUri <profileToken> [protocol=RTSP]",
    description: "GetStreamUri - resolve a URL RTSP/HTTP/UDP de um profile específico.",
    run: async (camera, args) => {
      const profileToken = requireArg(args, 0, "profileToken");
      const protocol = (args[1] ?? "RTSP").toUpperCase();
      const device = await connectToDevice(camera);
      const result = await device.services.media.getStreamUri({ ProfileToken: profileToken, Protocol: protocol });
      return result?.data ?? result;
    },
  },
  {
    name: "media.snapshotUri",
    usage: "/media.snapshotUri <profileToken>",
    description: "GetSnapshotUri - resolve a URL HTTP de snapshot (JPEG) de um profile, se suportado.",
    run: async (camera, args) => {
      const profileToken = requireArg(args, 0, "profileToken");
      const device = await connectToDevice(camera);
      const result = await device.services.media.getSnapshotUri({ ProfileToken: profileToken });
      return result?.data ?? result;
    },
  },
  {
    name: "media.videoEncoderConfigurations",
    usage: "/media.videoEncoderConfigurations",
    description: "GetVideoEncoderConfigurations - codecs/resolução/bitrate configurados em cada encoder de vídeo.",
    run: async (camera) => {
      const device = await connectToDevice(camera);
      const result = await device.services.media.getVideoEncoderConfigurations();
      return result?.data ?? result;
    },
  },
  {
    name: "ptz.status",
    usage: "/ptz.status [profileToken]",
    description: "GetStatus - posição/estado atual do PTZ para o profile (usa o salvo na câmera se omitido).",
    run: async (camera, args) => {
      const device = await connectToDevice(camera);
      const profileToken = args[0] ?? (await currentProfileToken(camera, device));
      const result = await device.services.ptz.getStatus({ ProfileToken: profileToken });
      return result?.data ?? result;
    },
  },
  {
    name: "ptz.move",
    usage: "/ptz.move <up|down|left|right|upLeft|upRight|downLeft|downRight> [speed=0.5]",
    description: "Movimento contínuo de pan/tilt na direção indicada, até um /ptz.stop.",
    run: async (camera, args) => {
      const direction = requireArg(args, 0, "direção") as PtzDirection;
      if (!PTZ_DIRECTIONS.includes(direction)) {
        throw new Error(`Direção inválida. Use uma de: ${PTZ_DIRECTIONS.join(", ")}`);
      }
      const speed = args[1] ? Number(args[1]) : 0.5;
      await ptzMove(camera, direction, speed);
      return { ok: true, direction, speed };
    },
  },
  {
    name: "ptz.zoom",
    usage: "/ptz.zoom <valor entre -1 e 1>",
    description: "Zoom contínuo (positivo = aproxima, negativo = afasta), até um /ptz.stop.",
    run: async (camera, args) => {
      const zoom = Number(requireArg(args, 0, "valor de zoom"));
      await ptzZoom(camera, zoom);
      return { ok: true, zoom };
    },
  },
  {
    name: "ptz.stop",
    usage: "/ptz.stop",
    description: "Para qualquer movimento de pan/tilt/zoom em andamento.",
    run: async (camera) => {
      await ptzStop(camera);
      return { ok: true };
    },
  },
  {
    name: "ptz.presets",
    usage: "/ptz.presets",
    description: "GetPresets - lista os presets PTZ salvos na câmera.",
    run: async (camera) => ptzListPresets(camera),
  },
  {
    name: "ptz.gotoPreset",
    usage: "/ptz.gotoPreset <presetToken>",
    description: "GotoPreset - move a câmera para um preset salvo.",
    run: async (camera, args) => {
      const presetToken = requireArg(args, 0, "presetToken");
      await ptzGotoPreset(camera, presetToken);
      return { ok: true, presetToken };
    },
  },
  {
    name: "ptz.setPreset",
    usage: "/ptz.setPreset <nome>",
    description: "SetPreset - salva a posição atual como um novo preset com o nome dado.",
    run: async (camera, args) => {
      const name = requireArg(args, 0, "nome do preset");
      const result = await ptzSetPreset(camera, name);
      return result?.data ?? result;
    },
  },
];

const COMMANDS_BY_NAME = new Map(ONVIF_DEBUG_COMMANDS.map((cmd) => [cmd.name, cmd]));

export function listOnvifDebugCommands(): Array<Pick<OnvifDebugCommand, "name" | "usage" | "description">> {
  return ONVIF_DEBUG_COMMANDS.map(({ name, usage, description }) => ({ name, usage, description }));
}

export async function runOnvifDebugCommand(camera: Camera, name: string, args: string[]): Promise<unknown> {
  const command = COMMANDS_BY_NAME.get(name);
  if (!command) {
    throw new Error(`Comando desconhecido: "${name}". Use /help para ver os comandos disponíveis.`);
  }
  return command.run(camera, args);
}
