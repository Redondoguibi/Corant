import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type WorkspaceMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void | Promise<unknown>;
};

export type WorkspaceMenu = { label: string; items: WorkspaceMenuItem[] };

export function WorkspaceMenuBar({ menus, onError }: {
  menus: WorkspaceMenu[];
  onError: (error: unknown) => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggers = useRef<Array<HTMLButtonElement | null>>([]);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 80 });
  const items = openIndex === null ? [] : menus[openIndex].items;

  function close(restoreFocus = false) {
    setOpenIndex(null);
    if (restoreFocus && openIndex !== null) triggers.current[openIndex]?.focus();
  }

  function open(index: number) {
    if (openIndex === null) previousFocus.current = document.activeElement as HTMLElement;
    setFocusIndex(index);
    setOpenIndex(index);
  }

  useLayoutEffect(() => {
    if (openIndex === null) return;
    const trigger = triggers.current[openIndex]?.getBoundingClientRect();
    const popup = popupRef.current;
    if (!trigger || !popup) return;
    const bounds = popup.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(trigger.left, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(trigger.bottom, window.innerHeight - bounds.height - 8)),
    });
    (popup.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? popup).focus();
  }, [openIndex]);

  useEffect(() => {
    if (openIndex === null) return;
    const dismiss = () => setOpenIndex(null);
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [openIndex]);

  return (
    <nav ref={rootRef} className="workspace-menubar" aria-label="Menu principal"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) close();
      }}>
      <div role="menubar" aria-label="Menu principal" className="workspace-menu-triggers">
        {menus.map((menu, index) => (
          <button key={menu.label} ref={(element) => { triggers.current[index] = element; }}
            type="button" role="menuitem" aria-haspopup="menu" aria-expanded={openIndex === index}
            aria-controls={openIndex === index ? "workspace-menu-popup" : undefined}
            tabIndex={focusIndex === index ? 0 : -1}
            onFocus={() => setFocusIndex(index)}
            onPointerDown={() => {
              if (openIndex === null) previousFocus.current = document.activeElement as HTMLElement;
            }}
            onClick={() => openIndex === index ? close(true) : open(index)}
            onPointerEnter={() => { if (openIndex !== null && openIndex !== index) open(index); }}
            onKeyDown={(event) => {
              if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault(); open(index);
              } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? menus.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + menus.length) % menus.length;
                triggers.current[next]?.focus();
              } else if (event.key === "Escape") close(true);
            }}>{menu.label}</button>
        ))}
      </div>
      {openIndex !== null && (
        <div ref={popupRef} id="workspace-menu-popup" role="menu" tabIndex={-1} aria-label={menus[openIndex].label}
          className="corant-context-menu workspace-menu-popup" style={position}
          onKeyDown={(event) => {
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
            else if (event.key === "Tab") { close(true); }
            else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
              event.preventDefault();
              open((openIndex + (event.key === "ArrowRight" ? 1 : -1) + menus.length) % menus.length);
            } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
                : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
              buttons[next]?.focus();
            }
          }}>
          {items.map((item) => (
            <div key={item.id}>
              {item.separatorBefore && <div role="separator" className="corant-context-menu-separator" />}
              <button type="button" className="corant-context-menu-item"
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={item.checked} disabled={item.disabled} tabIndex={-1}
                onClick={() => {
                  close();
                  previousFocus.current?.focus();
                  try { Promise.resolve(item.onSelect()).catch(onError); } catch (error) { onError(error); }
                }}>
                <span className="workspace-menu-check">{item.checked ? "✓" : ""}</span>
                <span>{item.label}</span>
                {item.shortcut && <span className="workspace-menu-shortcut" aria-hidden="true">{item.shortcut}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
