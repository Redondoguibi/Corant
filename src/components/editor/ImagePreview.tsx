import { useEffect, useState } from "react";
import { MAX_IMAGE_BYTES, imageMimeType, readProjectImage } from "../../services/projectImages";
import "../../styles/imagePreview.css";

type Props = { path: string; name: string; source?: string; projectPath?: string; relativePath?: string; onEdit?: () => void };

export function ImagePreview({ path, name, source, projectPath, relativePath, onEdit }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [actualSize, setActualSize] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setUrl(null);
    setError("");
    setDimensions("");
    async function load() {
      try {
        const blob = source === undefined ? await readProjectImage(path, projectPath, relativePath) : new Blob([source], { type: "image/svg+xml" });
        if (cancelled) return;
        const limit = imageMimeType(path) === "image/tiff" ? 80 * 1024 * 1024 : MAX_IMAGE_BYTES;
        if (blob.size > limit) throw new Error(`A imagem excede o limite de ${limit / 1024 / 1024} MiB.`);
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (cause) {
        if (!cancelled) setError(String(cause));
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, source, attempt, projectPath, relativePath]);

  return <section className="image-preview" aria-label={`Visualização de ${name}`}>
    <div className="image-preview-controls">
      {onEdit && <button type="button" onClick={onEdit}>Editar imagem</button>}
      <button type="button" aria-pressed={!actualSize} onClick={() => setActualSize(false)}>Ajustar à tela</button>
      <button type="button" aria-pressed={actualSize} onClick={() => setActualSize(true)}>Tamanho original</button>
      <span>{dimensions}</span>
    </div>
    <div className={`image-preview-canvas ${actualSize ? "is-original" : ""}`}>
      {error ? <div className="image-preview-message" role="alert"><strong>Não foi possível visualizar a imagem.</strong><span>{error}</span><button type="button" onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</button></div>
        : url ? <img src={url} alt={name} onLoad={(event) => setDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight} px`)} onError={() => setError("Arquivo inválido ou formato não suportado pelo visualizador.")} />
        : <span role="status">Carregando imagem…</span>}
    </div>
  </section>;
}
