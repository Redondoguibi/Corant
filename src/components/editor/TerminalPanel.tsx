import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { WorkspaceTerminal } from "../../services/workspaceTerminal";
import "../../styles/terminal.css";

type TerminalStatus = "starting" | "stopping" | "running" | "stopped" | "exited" | "error";

export function TerminalPanel({ terminal, visible, onHide }: {
  terminal: WorkspaceTerminal;
  visible: boolean;
  onHide: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [rendererVersion, setRendererVersion] = useState(0);
  const runRef = useRef(0);
  const runningRef = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [status, setStatus] = useState<TerminalStatus>("starting");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(250);
  const dragRef = useRef<{ y: number; height: number } | null>(null);

  const fit = useCallback(() => {
    if (!visibleRef.current || !hostRef.current?.isConnected) return;
    fitRef.current?.fit();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const xterm = new Terminal({
      cursorBlink: true,
      disableStdin: true,
      fontFamily: '"Cascadia Code", Consolas, "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: "#0d0d0e", foreground: "#e5e5e5", cursor: "#ff5a60",
        selectionBackground: "#7d3038aa",
      },
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(host);
    xtermRef.current = xterm;
    fitRef.current = fitAddon;
    let disposed = false;
    let resizeFrame = 0;
    let resizeTimer = 0;

    const scheduleFit = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        if (disposed || !visibleRef.current) return;
        fit();
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          const run = runRef.current;
          if (runningRef.current) void terminal.resize(xterm.cols, xterm.rows).catch((cause) => {
            if (!disposed && run === runRef.current && runningRef.current) setError(String(cause));
          });
        }, 80);
      });
    };

    const observer = new ResizeObserver(scheduleFit);
    observer.observe(host);
    const input = xterm.onData((data) => {
      const run = runRef.current;
      void terminal.input(data).catch((cause) => {
        if (!disposed && run === runRef.current && runningRef.current) setError(String(cause));
      });
    });

    const launch = async () => {
      const run = ++runRef.current;
      runningRef.current = false;
      xterm.options.disableStdin = true;
      setStatus("starting");
      setError(null);
      setExitCode(null);
      fit();
      const initialCols = xterm.cols;
      const initialRows = xterm.rows;
      let exited = false;
      try {
        await terminal.start(initialCols, initialRows, (event) => {
          if (disposed || run !== runRef.current) return;
          if (event.type === "output") {
            // xterm decodes UTF-8 across byte chunks itself.
            xterm.write(new Uint8Array(event.data));
          } else {
            exited = true;
            runningRef.current = false;
            xterm.options.disableStdin = true;
            setExitCode(event.code);
            setStatus("exited");
            if (event.error) setError(event.error);
          }
        });
        if (disposed || run !== runRef.current || exited) return;
        runningRef.current = true;
        xterm.options.disableStdin = false;
        setStatus("running");
        if (xterm.cols !== initialCols || xterm.rows !== initialRows) scheduleFit();
      } catch (cause) {
        if (disposed || run !== runRef.current) return;
        setStatus("error");
        setError(String(cause));
      }
    };
    scheduleFit();
    void launch();

    return () => {
      disposed = true;
      ++runRef.current;
      runningRef.current = false;
      observer.disconnect();
      window.cancelAnimationFrame(resizeFrame);
      window.clearTimeout(resizeTimer);
      input.dispose();
      xterm.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      void terminal.stop().catch((cause) => console.error("Falha ao encerrar terminal:", cause));
    };
  }, [fit, terminal, rendererVersion]);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    const frame = window.requestAnimationFrame(() => {
      fit();
      const xterm = xtermRef.current;
      xterm?.focus();
      if (runningRef.current && xterm) {
        const run = runRef.current;
        void terminal.resize(xterm.cols, xterm.rows).catch((cause) => {
          if (!disposed && run === runRef.current && runningRef.current) setError(String(cause));
        });
      }
    });
    return () => { disposed = true; window.cancelAnimationFrame(frame); };
  }, [fit, terminal, visible, rendererVersion]);

  async function stop() {
    const run = ++runRef.current;
    runningRef.current = false;
    if (xtermRef.current) xtermRef.current.options.disableStdin = true;
    setStatus("stopping");
    setError(null);
    try {
      await terminal.stop();
      if (run === runRef.current) setStatus("stopped");
    } catch (cause) {
      if (run === runRef.current) { setStatus("error"); setError(String(cause)); }
    }
  }

  const statusText = status === "starting" ? "Iniciando…" : status === "stopping" ? "Encerrando…" : status === "running" ? "Em execução"
    : status === "exited" ? `Encerrado${exitCode === null ? "" : ` (${exitCode})`}`
      : status === "stopped" ? "Parado" : "Erro";

  return (
    <section className="terminal-panel" aria-label="Terminal integrado" style={{ height, flexBasis: height, display: visible ? undefined : "none" }}>
      <div className="terminal-resizer" role="separator" aria-label="Redimensionar terminal" aria-orientation="horizontal"
        tabIndex={0} aria-valuenow={height} aria-valuemin={160} aria-valuemax={600}
        onPointerDown={(event) => {
          dragRef.current = { y: event.clientY, height };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const maximum = Math.max(160, Math.min(600, window.innerHeight - 230));
          setHeight(Math.max(160, Math.min(maximum, dragRef.current.height + dragRef.current.y - event.clientY)));
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          setHeight((current) => Math.max(160, Math.min(600, current + (event.key === "ArrowUp" ? 20 : -20))));
        }}
      />
      <div className="terminal-heading">
        <div className="terminal-heading-title"><span>TERMINAL</span><span className={`terminal-status terminal-status-${status}`}>{statusText}</span></div>
        <div className="terminal-actions">
          <button type="button" onClick={() => setRendererVersion((version) => version + 1)} disabled={status === "starting" || status === "stopping"} aria-label="Reiniciar terminal">Reiniciar</button>
          <button type="button" onClick={() => void stop()} disabled={status === "stopped" || status === "stopping" || status === "exited"} aria-label="Encerrar terminal">Encerrar</button>
          <button type="button" onClick={onHide} aria-label="Ocultar terminal">×</button>
        </div>
      </div>
      {error && <div role="alert" className="terminal-error">{error}</div>}
      <div className="terminal-host" ref={hostRef} />
    </section>
  );
}
