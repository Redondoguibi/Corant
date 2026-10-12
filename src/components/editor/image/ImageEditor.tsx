import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ImagePreview } from "../ImagePreview";
import { readProjectImage } from "../../../services/projectImages";
import {
  canvasBlob,
  context,
  crop,
  drawLayer,
  flatten,
  makeCanvas,
  renderDocument,
  resize,
  transform,
  ImageSessions,
  type ImageDocument,
  type Layer,
  type Point,
  type Tool,
} from "../../../services/imageEditor";
import "../../../styles/imageEditor.css";

type Props = {
  path: string;
  name: string;
  relativePath: string;
  projectPath: string;
  source?: string;
  sessions: ImageSessions;
  onExport: () => void;
};
const tools: { id: Tool; label: string; icon: string }[] = [
  { id: "move", label: "Mover camada", icon: "↖" },
  { id: "crop", label: "Recortar", icon: "⌗" },
  { id: "brush", label: "Pincel", icon: "✎" },
  { id: "eraser", label: "Borracha", icon: "◇" },
  { id: "rectangle", label: "Retângulo", icon: "□" },
  { id: "ellipse", label: "Elipse", icon: "○" },
  { id: "triangle", label: "Triângulo", icon: "△" },
  { id: "pentagon", label: "Pentágono", icon: "⬠" },
  { id: "arrow", label: "Seta", icon: "↗" },
  { id: "text", label: "Texto", icon: "T" },
];
export function ImageSurface(props: Props) {
  const { sessions, path } = props;
  useSyncExternalStore(sessions.subscribe, sessions.snapshot);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function start() {
    const existing = sessions.get(path);
    if (existing) {
      existing.editing = true;
      sessions.notify();
      return;
    }
    const id = ++generation.current;
    setLoading(true);
    setError("");
    let url: string | undefined;
    try {
      const blob =
        props.source === undefined
          ? await readProjectImage(path, props.projectPath, props.relativePath)
          : new Blob([props.source], { type: "image/svg+xml" });
      if (id !== generation.current) return;
      url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      await img.decode();
      if (id !== generation.current) return;
      const base = makeCanvas(img.naturalWidth, img.naturalHeight);
      context(base).drawImage(img, 0, 0);
      sessions.set(path, flatten(base));
    } catch (cause) {
      if (id === generation.current) setError(String(cause));
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (id === generation.current) setLoading(false);
    }
  }
  if (sessions.get(path)?.editing) return <ImageEditor {...props} />;
  return (
    <>
      {loading && <p role="status">Preparando editor…</p>}
      {error && <p role="alert">{error}</p>}
      <ImagePreview
        {...props}
        onEdit={loading ? undefined : () => void start()}
      />
    </>
  );
}

function ImageEditor({ sessions, path, name, projectPath, onExport }: Props) {
  useSyncExternalStore(sessions.subscribe, sessions.snapshot);
  const session = sessions.get(path)!;
  const doc = session.history[session.index];
  const canvasRef = useRef<HTMLCanvasElement>(null),
    overlayRef = useRef<HTMLCanvasElement>(null),
    viewportRef = useRef<HTMLDivElement>(null),
    rootRef = useRef<HTMLElement>(null);
  const [tool, setTool] = useState<Tool>("move"),
    [selected, setSelected] = useState<string | null>(null),
    [zoom, setZoom] = useState(1),
    [fit, setFit] = useState(true),
    [compare, setCompare] = useState(false);
  const [color, setColor] = useState("#f43f5e"),
    [color2, setColor2] = useState("#fbbf24"),
    [fill, setFill] = useState(true),
    [gradient, setGradient] = useState(false),
    [stroke, setStroke] = useState(6),
    [fontSize, setFontSize] = useState(48),
    [text, setText] = useState("Seu texto");
  const [selection, setSelection] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [resizeWidth, setResizeWidth] = useState(doc.base.width),
    [resizeHeight, setResizeHeight] = useState(doc.base.height),
    [ratio, setRatio] = useState(true);
  const [format, setFormat] = useState("png"),
    [quality, setQuality] = useState(92),
    [exportName, setExportName] = useState(
      name.replace(/\.[^.]+$/, "") + "-editada",
    );
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const gesture = useRef<{
    start: Point;
    layer?: Layer;
    moving?: Layer;
  } | null>(null);
  const layer = doc.layers.find((l) => l.id === selected);
  const commit = (next: ImageDocument) => {
    sessions.commit(path, next);
    setNotice("");
  };
  const act = (fn: () => void) => {
    try {
      setError("");
      fn();
    } catch (cause) {
      setError(String(cause));
    }
  };
  useEffect(() => {
    setResizeWidth(doc.base.width);
    setResizeHeight(doc.base.height);
    setSelection(null);
  }, [doc.base]);
  useEffect(() => {
    if (canvasRef.current) renderDocument(doc, canvasRef.current, compare);
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.width = doc.base.width;
      overlay.height = doc.base.height;
      const ctx = context(overlay);
      const bounds =
        selection ??
        (layer ? { x: layer.x, y: layer.y, w: layer.w, h: layer.h } : null);
      if (bounds) {
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
      }
    }
  }, [doc, compare, selection, layer, zoom]);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      if (fit)
        setZoom(
          Math.max(
            0.02,
            Math.min(
              1,
              (el.clientWidth - 48) / doc.base.width,
              (el.clientHeight - 48) / doc.base.height,
            ),
          ),
        );
    };
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, [doc.base, fit]);
  function changeLayer(patch: Partial<Layer>) {
    if (layer) {
      const next = { ...layer, ...patch };
      if (next.kind === "text") {
        const ctx = context(doc.base);
        ctx.font = `${next.fontSize}px sans-serif`;
        next.w = Math.max(
          ...next.text.split("\n").map((line) => ctx.measureText(line).width),
        );
        next.h = next.text.split("\n").length * next.fontSize * 1.2;
      }
      commit({
        ...doc,
        layers: doc.layers.map((l) => (l.id === layer.id ? next : l)),
      });
    }
  }
  function point(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const r = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          doc.base.width,
          ((event.clientX - r.left) / r.width) * doc.base.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          doc.base.height,
          ((event.clientY - r.top) / r.height) * doc.base.height,
        ),
      ),
    };
  }
  function down(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (session.busy || compare || event.button !== 0) return;
    event.preventDefault();
    rootRef.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event);
    if (tool === "move") {
      const hit = [...doc.layers]
        .reverse()
        .find(
          (l) =>
            l.visible &&
            start.x >= Math.min(l.x, l.x + l.w) - 8 / zoom &&
            start.x <= Math.max(l.x, l.x + l.w) + 8 / zoom &&
            start.y >= Math.min(l.y, l.y + l.h) - 8 / zoom &&
            start.y <= Math.max(l.y, l.y + l.h) + 8 / zoom,
        );
      setSelected(hit?.id ?? null);
      gesture.current = { start, moving: hit };
      return;
    }
    if (tool === "crop") {
      setSelection(null);
      gesture.current = { start };
      return;
    }
    if (doc.layers.length >= 100) {
      setError(
        "Limite de 100 camadas. Exporte ou una as camadas para continuar.",
      );
      return;
    }
    const newLayer: Layer = {
      id: crypto.randomUUID(),
      name: tools.find((t) => t.id === tool)!.label,
      kind: tool,
      x: start.x,
      y: start.y,
      w: 0,
      h: 0,
      points: [{ x: 0, y: 0 }],
      color,
      color2,
      fill,
      gradient,
      opacity: 1,
      visible: true,
      stroke,
      text,
      fontSize,
    };
    if (tool === "text") {
      if (!text.trim()) return;
      const ctx = context(doc.base);
      ctx.font = `${fontSize}px sans-serif`;
      newLayer.w = Math.max(
        ...text.split("\n").map((line) => ctx.measureText(line).width),
      );
      newLayer.h = text.split("\n").length * fontSize * 1.2;
      commit({ ...doc, layers: [...doc.layers, newLayer] });
      setSelected(newLayer.id);
      return;
    }
    gesture.current = { start, layer: newLayer };
  }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    const g = gesture.current;
    if (!g) return;
    const p = point(event);
    const dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = context(overlay);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (tool === "crop") {
      setSelection({
        x: Math.min(p.x, g.start.x),
        y: Math.min(p.y, g.start.y),
        w: Math.abs(dx),
        h: Math.abs(dy),
      });
      return;
    }
    if (g.moving) {
      const next = { ...g.moving, x: g.moving.x + dx, y: g.moving.y + dy };
      g.layer = next;
      if (canvasRef.current)
        renderDocument(
          {
            ...doc,
            layers: doc.layers.map((l) => (l.id === next.id ? next : l)),
          },
          canvasRef.current,
        );
      return;
    }
    if (g.layer) {
      if (tool === "brush" || tool === "eraser") {
        if (g.layer.points.length < 10000)
          g.layer.points.push({ x: dx, y: dy });
        const xs = g.layer.points.map((p) => p.x),
          ys = g.layer.points.map((p) => p.y);
        g.layer.w = Math.max(...xs) - Math.min(...xs);
        g.layer.h = Math.max(...ys) - Math.min(...ys);
      } else {
        g.layer.w = dx;
        g.layer.h = dy;
      }
      if (tool === "eraser" && canvasRef.current)
        renderDocument(
          { ...doc, layers: [...doc.layers, g.layer] },
          canvasRef.current,
        );
      else drawLayer(ctx, g.layer);
    }
  }
  function up(event: ReactPointerEvent<HTMLCanvasElement>) {
    const g = gesture.current;
    if (!g) return;
    move(event);
    gesture.current = null;
    if (g.layer) {
      let next = g.layer;
      if (next.kind === "brush" || next.kind === "eraser") {
        const minX = Math.min(...next.points.map((p) => p.x)),
          minY = Math.min(...next.points.map((p) => p.y));
        next = {
          ...next,
          x: next.x + minX,
          y: next.y + minY,
          points: next.points.map((p) => ({ x: p.x - minX, y: p.y - minY })),
        };
      }
      commit({
        ...doc,
        layers: g.moving
          ? doc.layers.map((l) => (l.id === next.id ? next : l))
          : [...doc.layers, next],
      });
      setSelected(next.id);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function cancelGesture() {
    gesture.current = null;
    if (canvasRef.current) renderDocument(doc, canvasRef.current);
    if (overlayRef.current)
      context(overlayRef.current).clearRect(
        0,
        0,
        doc.base.width,
        doc.base.height,
      );
  }
  async function exportImage() {
    if (session.busy) return;
    session.busy = true;
    sessions.notify();
    setError("");
    setNotice("");
    const captured = doc;
    try {
      let canvas = renderDocument(captured);
      if (format === "jpg") {
        const opaque = makeCanvas(canvas.width, canvas.height);
        const ctx = context(opaque);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, opaque.width, opaque.height);
        ctx.drawImage(canvas, 0, 0);
        canvas = opaque;
      }
      const mime =
        format === "jpg"
          ? "image/jpeg"
          : format === "webp"
            ? "image/webp"
            : "image/png";
      const blob = await canvasBlob(canvas, mime, quality / 100);
      if (blob.type !== mime)
        throw new Error("Este formato não é suportado pelo dispositivo.");
      if (blob.size > (format === "tiff" ? 80 : 32) * 1024 * 1024)
        throw new Error("A exportação excede o limite do formato. Reduza as dimensões ou escolha JPEG/WebP.");
      const fileName = `${exportName.trim()}.${format}`;
      await invoke("image_export", {
        projectPath,
        name: fileName,
        data: Array.from(new Uint8Array(await blob.arrayBuffer())),
      });
      session.saved = captured;
      session.lastExport = `Exportado: ${fileName}`;
      setNotice(`Exportado: ${fileName}`);
      onExport();
    } catch (cause) {
      setError(String(cause));
    } finally {
      session.busy = false;
      sessions.notify();
    }
  }
  return (
    <section
      className="image-editor"
      ref={rootRef}
      tabIndex={-1}
      aria-label={`Editor de ${name}`}
      onKeyDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.matches("input,textarea,select")) return;
        if (event.ctrlKey || event.metaKey) {
          const key = event.key.toLowerCase();
          if (["z", "y", "s"].includes(key)) {
            event.preventDefault();
            event.stopPropagation();
            if (session.busy) return;
            if (key === "s") void exportImage();
            else sessions.undo(path, key === "y" || event.shiftKey ? 1 : -1);
          }
        } else if (event.key === "Delete" && layer && !session.busy) {
          event.preventDefault();
          commit({
            ...doc,
            layers: doc.layers.filter((l) => l.id !== layer.id),
          });
          setSelected(null);
        } else if (event.key === "Escape") {
          cancelGesture();
          setSelection(null);
        }
      }}
    >
      <header className="image-editor-header">
        <div>
          <strong>Estúdio de imagem</strong>
          <span>
            {doc.base.width} × {doc.base.height} px ·{" "}
            {sessions.dirty(path) ? "Edições não exportadas" : "Pronto"}
          </span>
        </div>
        <div className="image-editor-actions">
          <button
            disabled={session.busy || session.index === 0}
            onClick={() => sessions.undo(path, -1)}
            title="Ctrl+Z"
          >
            ↶ Desfazer
          </button>
          <button
            disabled={
              session.busy || session.index === session.history.length - 1
            }
            onClick={() => sessions.undo(path, 1)}
            title="Ctrl+Shift+Z"
          >
            ↷ Refazer
          </button>
          <button disabled={session.busy} onClick={() => void exportImage()}>
            Exportar cópia
          </button>
          <button aria-pressed={compare} onClick={() => setCompare(!compare)}>
            Comparar base
          </button>
          <button
            disabled={session.busy}
            onClick={() => {
              session.editing = false;
              sessions.notify();
            }}
          >
            Ver arquivo original
          </button>
        </div>
      </header>
      {error && (
        <div className="image-editor-message" role="alert">
          {error}
        </div>
      )}
      {!error && (notice || session.lastExport) && (
        <div className="image-editor-message" role="status">
          {notice || session.lastExport}
        </div>
      )}
      <div className="image-editor-body">
        <nav className="image-toolbox" aria-label="Ferramentas de imagem">
          {tools.map((t) => (
            <button
              key={t.id}
              title={t.label}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              disabled={session.busy}
              onClick={() => {
                setTool(t.id);
                setSelection(null);
                setSelected(null);
              }}
            >
              <b>{t.icon}</b>
              <small>{t.label}</small>
            </button>
          ))}
        </nav>
        <div className="image-workarea">
          <div className="image-zoom">
            <button onClick={() => setFit(true)} aria-pressed={fit}>
              Ajustar
            </button>
            <button
              onClick={() => {
                setFit(false);
                setZoom(1);
              }}
            >
              100%
            </button>
            <input
              aria-label="Zoom"
              type="range"
              min="5"
              max="400"
              value={Math.round(zoom * 100)}
              onChange={(e) => {
                setFit(false);
                setZoom(Number(e.target.value) / 100);
              }}
            />
            <span>{Math.round(zoom * 100)}%</span>
          </div>
          <div className="image-editor-viewport" ref={viewportRef}>
            <div
              className="image-canvas-stack"
              style={{
                width: doc.base.width * zoom,
                height: doc.base.height * zoom,
              }}
            >
              <canvas ref={canvasRef} aria-label="Imagem editada" />
              <canvas
                ref={overlayRef}
                className="image-gesture-canvas"
                aria-label="Área de desenho"
                style={{ cursor: tool === "move" ? "move" : "crosshair" }}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={cancelGesture}
              />
            </div>
          </div>
          <div className="image-editor-hint">
            {tool === "move"
              ? "Clique e arraste uma camada para posicionar."
              : tool === "crop"
                ? "Arraste um retângulo na imagem e aplique o recorte."
                : tool === "text"
                  ? "Digite o texto nas propriedades e clique na imagem."
                  : "Arraste sobre a imagem para desenhar."}{" "}
            · Ctrl+Z desfaz
          </div>
        </div>
        <aside className="image-properties" aria-label="Propriedades da imagem">
          <fieldset disabled={session.busy}>
            <details open>
              <summary>Ferramenta</summary>
              <div className="image-property-grid">
                <label>
                  Cor
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => {
                      setColor(e.target.value);
                      changeLayer({ color: e.target.value });
                    }}
                  />
                </label>
                <label>
                  Espessura
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={stroke}
                    onChange={(e) => {
                      const v = Math.max(
                        1,
                        Math.min(200, Number(e.target.value)),
                      );
                      setStroke(v);
                      changeLayer({ stroke: v });
                    }}
                  />
                </label>
              </div>
              <label className="image-check">
                <input
                  type="checkbox"
                  checked={fill}
                  onChange={(e) => {
                    setFill(e.target.checked);
                    changeLayer({ fill: e.target.checked });
                  }}
                />
                Preencher formas
              </label>
              <label className="image-check">
                <input
                  type="checkbox"
                  checked={gradient}
                  onChange={(e) => {
                    setGradient(e.target.checked);
                    changeLayer({ gradient: e.target.checked });
                  }}
                />
                Gradiente
              </label>
              {gradient && (
                <label>
                  Segunda cor
                  <input
                    type="color"
                    value={color2}
                    onChange={(e) => {
                      setColor2(e.target.value);
                      changeLayer({ color2: e.target.value });
                    }}
                  />
                </label>
              )}
              {(tool === "text" || layer?.kind === "text") && (
                <>
                  <label>
                    Texto
                    <textarea
                      maxLength={2000}
                      value={layer?.kind === "text" ? layer.text : text}
                      onChange={(e) => {
                        setText(e.target.value);
                        if (layer?.kind === "text")
                          changeLayer({ text: e.target.value });
                      }}
                    />
                  </label>
                  <label>
                    Tamanho do texto
                    <input
                      type="number"
                      min="8"
                      max="1000"
                      value={layer?.kind === "text" ? layer.fontSize : fontSize}
                      onChange={(e) => {
                        const v = Math.max(
                          8,
                          Math.min(1000, Number(e.target.value)),
                        );
                        setFontSize(v);
                        if (layer?.kind === "text")
                          changeLayer({ fontSize: v });
                      }}
                    />
                  </label>
                </>
              )}
              {tool === "crop" && (
                <button
                  disabled={!selection || selection.w < 1 || selection.h < 1}
                  onClick={() =>
                    act(() => {
                      commit(crop(doc, selection!));
                      setSelection(null);
                      setSelected(null);
                    })
                  }
                >
                  Aplicar recorte
                </button>
              )}
            </details>
            <details open>
              <summary>
                Camadas <span>{doc.layers.length + 1}</span>
              </summary>
              <div className="image-layers">
                {[...doc.layers].reverse().map((l) => (
                  <div
                    className={selected === l.id ? "is-selected" : ""}
                    key={l.id}
                  >
                    <button
                      aria-label={`${l.visible ? "Ocultar" : "Mostrar"} ${l.name}`}
                      onClick={() =>
                        commit({
                          ...doc,
                          layers: doc.layers.map((item) =>
                            item.id === l.id
                              ? { ...item, visible: !item.visible }
                              : item,
                          ),
                        })
                      }
                    >
                      {l.visible ? "●" : "○"}
                    </button>
                    <button
                      onClick={() => {
                        setSelected(l.id);
                        setTool("move");
                        setColor(l.color);
                        setFill(l.fill);
                        setStroke(l.stroke);
                        setGradient(l.gradient);
                        setColor2(l.color2);
                      }}
                    >
                      {l.name}
                    </button>
                  </div>
                ))}
                <div className="image-base-layer">▧ Imagem base</div>
              </div>
              {layer && (
                <>
                  <label>
                    Nome da camada
                    <input
                      maxLength={80}
                      value={layer.name}
                      onChange={(e) => changeLayer({ name: e.target.value })}
                    />
                  </label>
                  <label>
                    Opacidade {Math.round(layer.opacity * 100)}%
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={layer.opacity * 100}
                      onChange={(e) =>
                        changeLayer({ opacity: Number(e.target.value) / 100 })
                      }
                    />
                  </label>
                  <div className="image-property-grid">
                    {(["x", "y"] as const).map((key) => (
                      <label key={key}>
                        {key.toUpperCase()}
                        <input
                          type="number"
                          value={Math.round(layer[key])}
                          onChange={(e) =>
                            changeLayer({ [key]: Number(e.target.value) })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div className="image-editor-actions">
                    <button
                      onClick={() => {
                        const list = [...doc.layers],
                          i = list.indexOf(layer);
                        if (i < list.length - 1) {
                          [list[i], list[i + 1]] = [list[i + 1], list[i]];
                          commit({ ...doc, layers: list });
                        }
                      }}
                    >
                      Subir
                    </button>
                    <button
                      onClick={() => {
                        const list = [...doc.layers],
                          i = list.indexOf(layer);
                        if (i > 0) {
                          [list[i], list[i - 1]] = [list[i - 1], list[i]];
                          commit({ ...doc, layers: list });
                        }
                      }}
                    >
                      Descer
                    </button>
                    <button
                      onClick={() => {
                        if (doc.layers.length >= 100) return;
                        const copy = {
                          ...layer,
                          id: crypto.randomUUID(),
                          x: layer.x + 12,
                          y: layer.y + 12,
                          name: layer.name + " cópia",
                        };
                        commit({ ...doc, layers: [...doc.layers, copy] });
                        setSelected(copy.id);
                      }}
                    >
                      Duplicar
                    </button>
                    <button
                      onClick={() => {
                        commit({
                          ...doc,
                          layers: doc.layers.filter((l) => l.id !== layer.id),
                        });
                        setSelected(null);
                      }}
                    >
                      Excluir camada
                    </button>
                  </div>
                </>
              )}
            </details>
            <details>
              <summary>Ajustes da base</summary>
              {(
                [
                  ["brightness", "Brilho", 200],
                  ["contrast", "Contraste", 200],
                  ["saturation", "Saturação", 200],
                  ["grayscale", "Preto e branco", 100],
                  ["sepia", "Sépia", 100],
                ] as const
              ).map(([key, label, max]) => (
                <label key={key}>
                  {label} · {doc.adjustments[key]}
                  <input
                    type="range"
                    min="0"
                    max={max}
                    value={doc.adjustments[key]}
                    onChange={(e) =>
                      commit({
                        ...doc,
                        adjustments: {
                          ...doc.adjustments,
                          [key]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </details>
            <details>
              <summary>Transformar</summary>
              <p>
                Estas ações aplicam ajustes e unem as camadas. Você pode
                desfazer.
              </p>
              <div className="image-editor-actions">
                {(
                  [
                    ["left", "↶ 90°"],
                    ["right", "↷ 90°"],
                    ["horizontal", "Espelhar horizontal"],
                    ["vertical", "Espelhar vertical"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() =>
                      act(() => {
                        commit(transform(doc, id));
                        setSelected(null);
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="image-property-grid">
                <label>
                  Largura
                  <input
                    type="number"
                    min="1"
                    value={resizeWidth}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setResizeWidth(v);
                      if (ratio)
                        setResizeHeight(
                          Math.round((v * doc.base.height) / doc.base.width),
                        );
                    }}
                  />
                </label>
                <label>
                  Altura
                  <input
                    type="number"
                    min="1"
                    value={resizeHeight}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setResizeHeight(v);
                      if (ratio)
                        setResizeWidth(
                          Math.round((v * doc.base.width) / doc.base.height),
                        );
                    }}
                  />
                </label>
              </div>
              <label className="image-check">
                <input
                  type="checkbox"
                  checked={ratio}
                  onChange={(e) => setRatio(e.target.checked)}
                />
                Manter proporção
              </label>
              <button
                onClick={() =>
                  act(() => {
                    commit(resize(doc, resizeWidth, resizeHeight));
                    setSelected(null);
                  })
                }
              >
                Redimensionar
              </button>
            </details>
            <details open>
              <summary>Exportar cópia</summary>
              <label>
                Nome do arquivo
                <input
                  maxLength={130}
                  value={exportName}
                  onChange={(e) => setExportName(e.target.value)}
                />
              </label>
              <label>
                Formato
                <select
                  aria-label="Formato"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option value="png">PNG · transparência</option>
                  <option value="jpg">JPEG · fundo branco</option>
                  <option value="webp">WebP</option>
                  <option value="tiff">TIFF · RGBA 8 bits</option>
                </select>
              </label>
              {(format === "jpg" || format === "webp") && (
                <label>
                  Qualidade {quality}%
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                  />
                </label>
              )}
              <button
                className="image-export-button"
                onClick={() => void exportImage()}
                disabled={!exportName.trim()}
              >
                {session.busy ? "Exportando…" : "Exportar imagem"}
              </button>
              <p>
                Cria um arquivo na raiz do projeto, sem sobrescrever. Camadas
                ficam nesta sessão; a cópia exportada é uma imagem única. SVG e
                animações são rasterizados; TIFF usa a primeira página, sem
                preservar metadados ou perfis de cor.
              </p>
            </details>
          </fieldset>
        </aside>
      </div>
    </section>
  );
}
