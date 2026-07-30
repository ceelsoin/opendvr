import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { useCreateFace, useDeleteFace, useFaces } from "../api/faces";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Item 3 (face recognition): manage the "known faces" enrolled for matching against detected people. */
export function FacesPage() {
  const { t } = useTranslation();
  const { data: faces, isLoading } = useFaces();
  const createFace = useCreateFace();
  const deleteFace = useDeleteFace();

  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) return;
    try {
      const image = await fileToBase64(file);
      await createFace.mutateAsync({ name, image });
      setName("");
      setFile(null);
    } catch (err) {
      const data = axios.isAxiosError(err) ? (err.response?.data as { error?: string }) : undefined;
      setError(data?.error ?? t("facesPage.saveFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t("facesPage.title")}</h1>
        <p className="text-sm text-neutral-400">{t("facesPage.description")}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-800 p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-500">{t("facesPage.nameLabel")}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder={t("facesPage.namePlaceholder")}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-500">{t("facesPage.photoLabel")}</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
            className="text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={createFace.isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm hover:bg-blue-500 disabled:opacity-50"
        >
          {createFace.isPending ? t("facesPage.saving") : t("facesPage.addButton")}
        </button>
        {error && <p className="w-full text-xs text-red-400">{error}</p>}
      </form>

      {isLoading ? (
        <p className="text-neutral-400">{t("facesPage.loading")}</p>
      ) : !faces || faces.length === 0 ? (
        <p className="text-neutral-400">{t("facesPage.none")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {faces.map((face) => (
            <div
              key={face.id}
              className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm"
            >
              <span>{face.name}</span>
              <button
                type="button"
                onClick={() => deleteFace.mutate(face.id)}
                className="rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-950"
              >
                {t("facesPage.remove")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
