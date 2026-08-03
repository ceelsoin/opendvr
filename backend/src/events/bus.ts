import { EventEmitter } from "node:events";
import type { NotificationEvent } from "../notifications/channel.js";

/**
 * Internal event bus (plain Node EventEmitter, no external broker - see
 * plans/04-event-bus-plugins.md) that camera-event notifications flow
 * through. webhooks.ts is today's only subscriber (dispatching to the
 * NotificationChannel registry), but this exists so a future plugin
 * (MQTT, Home Assistant, ...) can listen independently, without editing
 * events/cameraEvents.ts or notifications/webhooks.ts.
 */
interface BusEvents {
  "camera:event": [NotificationEvent];
  "camera:unavailable": [NotificationEvent];
  "camera:recovered": [NotificationEvent];
}

class TypedEventBus extends EventEmitter {
  emitTyped<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]): void {
    this.emit(event, ...args);
  }
  onTyped<K extends keyof BusEvents>(event: K, listener: (...args: BusEvents[K]) => void): void {
    this.on(event, listener as (...args: unknown[]) => void);
  }
}

export const eventBus = new TypedEventBus();
