import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCameras } from "../../api/cameras";
import { useCreateGrid, useUpdateGrid } from "../../api/grids";
import type { CustomGrid } from "../../api/types";

interface GridBuilderDialogProps {
  open: boolean;
  onClose: () => void;
  /** When set, edits this grid instead of creating a new one. */
  grid?: CustomGrid;
}

const COLUMN_OPTIONS = [1, 2, 3, 4, 5, 6];

/** Modal for creating/editing a custom grid: name, column count ("formato"), camera selection and order. */
export function GridBuilderDialog({ open, onClose, grid }: GridBuilderDialogProps) {
  const { t } = useTranslation();
  const { data: cameras } = useCameras();
  const createGrid = useCreateGrid();
  const updateGrid = useUpdateGrid();

  const [name, setName] = useState("");
  const [columns, setColumns] = useState(3);
  const [cameraIds, setCameraIds] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(false);

  useEffect(() => {
    if (open) {
      setName(grid?.name ?? "");
      setColumns(grid?.columns ?? 3);
      setCameraIds(grid?.cameraIds ?? []);
      setIsPublic(grid?.isPublic ?? false);
    }
  }, [open, grid]);

  if (!open) return null;

  const toggleCamera = (id: string) => {
    setCameraIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const moveCamera = (index: number, direction: -1 | 1) => {
    setCameraIds((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const isPending = createGrid.isPending || updateGrid.isPending;
  const hasError = createGrid.isError || updateGrid.isError;
  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && cameraIds.length > 0 && !isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const input = { name: trimmedName, columns, cameraIds, isPublic };
    if (grid) {
      await updateGrid.mutateAsync({ id: grid.id, input });
    } else {
      await createGrid.mutateAsync(input);
    }
    onClose();
  };

  const cameraName = (id: string) => cameras?.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="mb-4 text-lg font-semibold">{grid ? t("grid.builderEditTitle") : t("grid.builderNewTitle")}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            {t("grid.gridNameLabel")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder={t("grid.gridNamePlaceholder")}
              className="rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            {t("grid.columnsLabel")}
            <select
              value={columns}
              onChange={(e) => setColumns(Number(e.target.value))}
              className="rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            >
              {COLUMN_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {t("grid.columns", { count: n })}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            {t("grid.publicAccessLabel")}
          </label>
          {isPublic && <p className="-mt-2 text-xs text-amber-400">{t("grid.publicAccessHint")}</p>}

          <div>
            <p className="mb-2 text-sm text-neutral-300">{t("grid.availableCameras")}</p>
            <div className="flex max-h-48 flex-col gap-1 overflow-auto rounded border border-neutral-800 p-2">
              {cameras && cameras.length > 0 ? (
                cameras.map((camera) => (
                  <label key={camera.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={cameraIds.includes(camera.id)}
                      onChange={() => toggleCamera(camera.id)}
                    />
                    {camera.name} <span className="text-xs text-neutral-500">({camera.host})</span>
                  </label>
                ))
              ) : (
                <p className="text-xs text-neutral-500">{t("grid.noCamerasRegistered")}</p>
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm text-neutral-300">{t("grid.gridOrder")}</p>
            {cameraIds.length === 0 ? (
              <p className="text-xs text-neutral-500">{t("grid.selectAtLeastOne")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {cameraIds.map((id, index) => (
                  <li
                    key={id}
                    className="flex items-center justify-between rounded border border-neutral-800 px-3 py-1.5 text-sm"
                  >
                    <span>
                      {index + 1}. {cameraName(id)}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveCamera(index, -1)}
                        disabled={index === 0}
                        className="rounded px-2 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
                        aria-label={t("grid.moveUp")}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCamera(index, 1)}
                        disabled={index === cameraIds.length - 1}
                        className="rounded px-2 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
                        aria-label={t("grid.moveDown")}
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {hasError && <p className="text-sm text-red-400">{t("grid.saveError")}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm text-neutral-400 hover:text-neutral-100"
            >
              {t("grid.cancel")}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? t("grid.saving") : t("grid.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
