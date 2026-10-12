export const MAX_PIXELS = 16_000_000;
export type Point = { x: number; y: number };
export type Tool =
  | "move"
  | "crop"
  | "brush"
  | "eraser"
  | "rectangle"
  | "ellipse"
  | "triangle"
  | "pentagon"
  | "arrow"
  | "text";
export type Layer = {
  id: string;
  name: string;
  kind: Exclude<Tool, "move" | "crop">;
  x: number;
  y: number;
  w: number;
  h: number;
  points: Point[];
  color: string;
  color2: string;
  fill: boolean;
  gradient: boolean;
  opacity: number;
  visible: boolean;
  stroke: number;
  text: string;
  fontSize: number;
};
export type Adjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
  sepia: number;
};
export const neutral: Adjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: 0,
  sepia: 0,
};
export type ImageDocument = {
  base: HTMLCanvasElement;
  layers: Layer[];
  adjustments: Adjustments;
};
export function makeCanvas(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    width * height > MAX_PIXELS
  )
    throw new Error(
      "Use dimensões inteiras de até 16.384 px e no máximo 16 megapixels.",
    );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
export function context(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw new Error(
      "O editor de imagens não está disponível neste dispositivo.",
    );
  return ctx;
}
export function drawLayer(ctx: CanvasRenderingContext2D, l: Layer) {
  if (!l.visible) return;
  ctx.save();
  ctx.translate(l.x, l.y);
  ctx.globalAlpha = l.opacity;
  ctx.lineWidth = l.stroke;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const gradient = ctx.createLinearGradient(0, 0, l.w || 1, l.h || 1);
  gradient.addColorStop(0, l.color);
  gradient.addColorStop(1, l.color2);
  ctx.strokeStyle = l.color;
  ctx.fillStyle = l.gradient ? gradient : l.color;
  ctx.beginPath();
  if (l.kind === "eraser") ctx.globalCompositeOperation = "destination-out";
  if (l.kind === "brush" || l.kind === "eraser") {
    l.points.forEach((p, i) =>
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
    );
    if (l.points.length === 1) {
      ctx.arc(l.points[0].x, l.points[0].y, l.stroke / 2, 0, Math.PI * 2);
      ctx.fill();
    } else ctx.stroke();
  } else if (l.kind === "text") {
    ctx.font = `${l.fontSize}px sans-serif`;
    ctx.textBaseline = "top";
    l.text
      .split("\n")
      .forEach((text, i) => ctx.fillText(text, 0, i * l.fontSize * 1.2));
  } else if (l.kind === "arrow") {
    ctx.moveTo(0, 0);
    ctx.lineTo(l.w, l.h);
    ctx.stroke();
    const a = Math.atan2(l.h, l.w),
      r = Math.max(12, l.stroke * 3);
    ctx.beginPath();
    ctx.moveTo(l.w, l.h);
    ctx.lineTo(l.w - r * Math.cos(a - 0.5), l.h - r * Math.sin(a - 0.5));
    ctx.lineTo(l.w - r * Math.cos(a + 0.5), l.h - r * Math.sin(a + 0.5));
    ctx.closePath();
    ctx.fill();
  } else {
    if (l.kind === "rectangle") ctx.rect(0, 0, l.w, l.h);
    else if (l.kind === "ellipse")
      ctx.ellipse(
        l.w / 2,
        l.h / 2,
        Math.abs(l.w / 2),
        Math.abs(l.h / 2),
        0,
        0,
        Math.PI * 2,
      );
    else {
      const sides = l.kind === "triangle" ? 3 : 5;
      for (let i = 0; i < sides; i++) {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
        const x = l.w / 2 + (Math.cos(angle) * l.w) / 2,
          y = l.h / 2 + (Math.sin(angle) * l.h) / 2;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
    }
    if (l.fill) ctx.fill();
    else ctx.stroke();
  }
  ctx.restore();
}
export function renderDocument(
  doc: ImageDocument,
  target?: HTMLCanvasElement,
  original = false,
) {
  const canvas = target ?? makeCanvas(doc.base.width, doc.base.height);
  if (canvas.width !== doc.base.width) canvas.width = doc.base.width;
  if (canvas.height !== doc.base.height) canvas.height = doc.base.height;
  const ctx = context(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  const a = doc.adjustments;
  if (!original)
    ctx.filter = `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturation}%) grayscale(${a.grayscale}%) sepia(${a.sepia}%)`;
  ctx.drawImage(doc.base, 0, 0);
  ctx.restore();
  if (!original) doc.layers.forEach((l) => drawLayer(ctx, l));
  return canvas;
}
export function flatten(base: HTMLCanvasElement): ImageDocument {
  return { base, layers: [], adjustments: { ...neutral } };
}
export function transform(
  doc: ImageDocument,
  action: "left" | "right" | "horizontal" | "vertical",
) {
  const source = renderDocument(doc),
    rotate = action === "left" || action === "right";
  const out = makeCanvas(
    rotate ? source.height : source.width,
    rotate ? source.width : source.height,
  );
  const ctx = context(out);
  ctx.translate(out.width / 2, out.height / 2);
  if (rotate) ctx.rotate(((action === "left" ? -1 : 1) * Math.PI) / 2);
  else
    ctx.scale(action === "horizontal" ? -1 : 1, action === "vertical" ? -1 : 1);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return flatten(out);
}
export function resize(doc: ImageDocument, width: number, height: number) {
  const out = makeCanvas(width, height);
  const ctx = context(out);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(renderDocument(doc), 0, 0, width, height);
  return flatten(out);
}
export function crop(
  doc: ImageDocument,
  rect: { x: number; y: number; w: number; h: number },
) {
  const x = Math.max(0, Math.round(rect.x)),
    y = Math.max(0, Math.round(rect.y));
  const w = Math.min(Math.round(rect.w), doc.base.width - x),
    h = Math.min(Math.round(rect.h), doc.base.height - y);
  const out = makeCanvas(w, h);
  context(out).drawImage(renderDocument(doc), x, y, w, h, 0, 0, w, h);
  return flatten(out);
}
export function canvasBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Falha ao codificar imagem.")),
      type,
      quality,
    ),
  );
}

export type ImageSession = {
  history: ImageDocument[];
  index: number;
  saved: ImageDocument;
  editing: boolean;
  busy: boolean;
  lastExport?: string;
};
export class ImageSessions {
  private items = new Map<string, ImageSession>();
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.version;
  notify = () => {
    this.version++;
    this.listeners.forEach((fn) => fn());
  };
  get(path: string) {
    return this.items.get(path);
  }
  dirty(path: string) {
    const s = this.get(path);
    return Boolean(s && s.history[s.index] !== s.saved);
  }
  hasBusy() {
    return [...this.items.values()].some((s) => s.busy);
  }
  dirtyPaths() {
    return [...this.items.keys()].filter((p) => this.dirty(p));
  }
  set(path: string, doc: ImageDocument) {
    if (this.items.has(path)) return;
    if (this.items.size >= 4)
      throw new Error(
        "Feche um editor de imagem antes de abrir outro (máximo de quatro imagens em edição).",
      );
    this.items.set(path, {
      history: [doc],
      index: 0,
      saved: doc,
      editing: true,
      busy: false,
    });
    this.notify();
  }
  commit(path: string, doc: ImageDocument) {
    const s = this.get(path);
    if (!s) return;
    s.history = s.history.slice(0, s.index + 1);
    s.history.push(doc);
    if (s.history.length > 30) s.history.shift();
    s.index = s.history.length - 1;
    // Keep bounded bitmap history; vector layers share the same source canvas.
    const bytes = () =>
      [...new Set(s.history.map((d) => d.base))].reduce(
        (n, c) => n + c.width * c.height * 4,
        0,
      );
    while (s.history.length > 1 && bytes() > 128 * 1024 * 1024) {
      s.history.shift();
      s.index--;
    }
    this.notify();
  }
  undo(path: string, delta: number) {
    const s = this.get(path);
    if (s) {
      s.index = Math.max(0, Math.min(s.history.length - 1, s.index + delta));
      this.notify();
    }
  }
  remove(matches: (path: string) => boolean) {
    let changed = false;
    for (const path of this.items.keys())
      if (matches(path)) { this.items.delete(path); changed = true; }
    if (changed) this.notify();
  }
  rename(remap: (path: string) => string) {
    if (![...this.items.keys()].some(path => remap(path) !== path)) return;
    this.items = new Map([...this.items].map(([path, s]) => [remap(path), s]));
    this.notify();
  }
}
