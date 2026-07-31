import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCameras } from "../api/cameras";
import { useDeleteEvent, useEvents, useMarkEventRead } from "../api/events";
import { friendlyEventType, pipelineLabel } from "../lib/eventLabels";

function todayDateInputValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
}

export function EventsPage() {
  const { t, i18n } = useTranslation();
  const { data: cameras } = useCameras();
  const [cameraId, setCameraId] = useState<string>("");
  const [date, setDate] = useState<string>(todayDateInputValue());
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const from = useMemo(() => new Date(`${date}T00:00:00`).toISOString(), [date]);
  const to = useMemo(() => new Date(`${date}T23:59:59.999`).toISOString(), [date]);

  const { data: events, isLoading } = useEvents({ cameraId: cameraId || undefined, from, to });
  const markRead = useMarkEventRead();
  const deleteEvent = useDeleteEvent();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const cameraName = (id: string) => cameras?.find((c) => c.id === id)?.name ?? id;

  const availableTypes = useMemo(() => {
    const types = new Set((events ?? []).map((e) => e.type));
    return [...types];
  }, [events]);

  const filteredEvents = (events ?? []).filter((event) => {
    if (typeFilter && event.type !== typeFilter) return false;
    if (unreadOnly && event.read) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-neutral-400" htmlFor="events-camera-select">
          {t("events.cameraLabel")}
        </label>
        <select
          id="events-camera-select"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
          value={cameraId}
          onChange={(e) => setCameraId(e.target.value)}
        >
          <option value="">{t("events.allCameras")}</option>
          {cameras?.map((camera) => (
            <option key={camera.id} value={camera.id}>
              {camera.name}
            </option>
          ))}
        </select>

        <label className="text-sm text-neutral-400" htmlFor="events-date-select">
          {t("events.dayLabel")}
        </label>
        <input
          id="events-date-select"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
        />

        <label className="text-sm text-neutral-400" htmlFor="events-type-select">
          {t("events.typeLabel")}
        </label>
        <select
          id="events-type-select"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">{t("events.allTypes")}</option>
          {availableTypes.map((type) => (
            <option key={type} value={type}>
              {friendlyEventType(type, t)}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-neutral-400">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          {t("events.unreadOnly")}
        </label>
      </div>

      {isLoading ? (
        <p className="text-neutral-400">{t("events.loading")}</p>
      ) : filteredEvents.length === 0 ? (
        <p className="text-neutral-400">{t("events.none")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredEvents.map((event) => {
            const isExpanded = expandedIds.has(event.id);
            return (
              <div
                key={event.id}
                className={`flex flex-col gap-2 rounded-md border px-4 py-2 text-sm ${
                  event.read ? "border-neutral-800 bg-neutral-900" : "border-blue-900 bg-neutral-900"
                }`}
              >
                <div className="flex items-center gap-3">
                  {event.snapshotUrl && (
                    <img
                      src={event.snapshotUrl}
                      alt={t("events.snapshotAlt")}
                      className="h-14 w-24 shrink-0 rounded object-cover"
                    />
                  )}
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="font-medium">{cameraName(event.camera_id)}</span>
                    <span className="text-xs text-neutral-500">{friendlyEventType(event.type, t)}</span>
                    {event.caption && <span className="text-xs text-neutral-400">📝 {event.caption}</span>}
                    {event.pipelines.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {event.pipelines.map((pipeline) => (
                          <span
                            key={pipeline}
                            className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-medium text-neutral-400"
                          >
                            {pipelineLabel(pipeline, t)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-neutral-500">{new Date(event.occurred_at).toLocaleString(i18n.language)}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    {event.pipelineOutputs && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(event.id)}
                        className="rounded-md bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
                      >
                        {isExpanded ? t("events.hideDetails") : t("events.showDetails")}
                      </button>
                    )}
                    {!event.read && (
                      <button
                        type="button"
                        onClick={() => markRead.mutate({ id: event.id, read: true })}
                        className="rounded-md bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
                      >
                        {t("events.markRead")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteEvent.mutate(event.id)}
                      className="rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-950"
                    >
                      {t("events.delete")}
                    </button>
                  </div>
                </div>
                {isExpanded && event.pipelineOutputs && (
                  <pre className="max-h-64 overflow-auto rounded-md border border-neutral-800 bg-black p-3 text-[11px] text-neutral-300">
                    {JSON.stringify(event.pipelineOutputs, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
