import { useTranslation } from "react-i18next";

const REPO_URL = "https://github.com/ceelsoin/opendvr";
const AUTHOR_URL = "https://github.com/ceelsoin";
const AUTHOR_NAME = "Celso Inacio";

export function Footer() {
  const { t } = useTranslation();
  const [before, after] = t("footer.madeBy", { author: "\u0000" }).split("\u0000");

  return (
    <footer className="mt-8 flex flex-col items-center gap-1 border-t border-neutral-800 pt-4 pb-2 text-center text-xs text-neutral-500 sm:flex-row sm:justify-between sm:text-left">
      <p>
        OpenDVR · {before}
        <a
          href={AUTHOR_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-neutral-300"
        >
          {AUTHOR_NAME}
        </a>
        {after}
      </p>
      <div className="flex items-center gap-3">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-neutral-300"
        >
          {t("footer.sourceCode")}
        </a>
        <span aria-hidden="true">·</span>
        <a
          href={`${REPO_URL}/blob/main/LICENSE`}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-neutral-300"
        >
          {t("footer.license")}
        </a>
      </div>
    </footer>
  );
}

