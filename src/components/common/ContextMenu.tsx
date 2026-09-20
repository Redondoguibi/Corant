import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type ContextMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void | Promise<unknown>;
};

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

const VIEWPORT_MARGIN = 8;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const bounds = menu.getBoundingClientRect();
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, x),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - bounds.width - VIEWPORT_MARGIN),
    );
    const top = Math.min(
      Math.max(VIEWPORT_MARGIN, y),
      Math.max(VIEWPORT_MARGIN, window.innerHeight - bounds.height - VIEWPORT_MARGIN),
    );

    setPosition({ left, top });
  }, [items, x, y]);

  useEffect(() => {
    const firstEnabledIndex = items.findIndex((item) => !item.disabled);
    if (firstEnabledIndex >= 0) {
      itemRefs.current[firstEnabledIndex]?.focus();
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleWindowChange() {
      onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("blur", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("blur", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [items, onClose]);

  function focusRelative(currentIndex: number, direction: 1 | -1) {
    if (items.length === 0) return;

    for (let step = 1; step <= items.length; step += 1) {
      const index = (currentIndex + direction * step + items.length) % items.length;
      if (!items[index].disabled) {
        itemRefs.current[index]?.focus();
        return;
      }
    }
  }

  return (
    <div
      ref={menuRef}
      className="corant-context-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const activeIndex = itemRefs.current.findIndex(
          (item) => item === document.activeElement,
        );

        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          focusRelative(Math.max(activeIndex, -1), 1);
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          focusRelative(activeIndex < 0 ? 0 : activeIndex, -1);
        }
      }}
    >
      {items.map((item, index) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="corant-context-menu-separator" />}
          <button
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            className={`corant-context-menu-item ${item.danger ? "is-danger" : ""}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              void item.onSelect();
            }}
          >
            <span>{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
