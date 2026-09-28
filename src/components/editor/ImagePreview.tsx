import { useEffect, useState } from "react";
import { MAX_IMAGE_BYTES, readProjectImage } from "../../services/projectImages";
import "../../styles/imagePreview.css";

type Props = { path: string; name: string; source?: string };

export function ImagePreview({ path, name, source }: Props) {
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
        const blob = source === undefined ? await readProjectImage(path) : new Blob([source], { type: "image/svg+xml" });
        if (cancelled) return;
        if (blob.size > MAX_IMAGE_BYTES) throw new Error("A imagem excede o limite de 32 MiB.");
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
  }, [path, source, attempt]);

  return <section className="image-preview" aria-label={`Visualização de ${name}`}>
    <div className="image-preview-controls">
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
