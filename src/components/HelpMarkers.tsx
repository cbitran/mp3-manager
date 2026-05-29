import { useState, useEffect, useRef, useCallback } from "react";
import { HELP_ITEMS, type HelpItem } from "../helpContent";

// Posição calculada de um badge no viewport
interface BadgePos {
  x: number;
  y: number;
  visible: boolean;
}

// Direção do popover relativa ao badge
type PopoverSide = "right" | "left" | "top" | "bottom";

function computePopoverSide(badgeX: number, badgeY: number): PopoverSide {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const POPOVER_W = 300;
  const POPOVER_H = 200; // estimativa
  if (badgeX + POPOVER_W + 20 > W) return "left";
  if (badgeY + POPOVER_H + 20 > H) return "top";
  return "right";
}

// ── Badge individual ──────────────────────────────────────────────────────────
function HelpBadge({
  item,
  pos,
  isOpen,
  onToggle,
}: {
  item: HelpItem;
  pos: BadgePos;
  isOpen: boolean;
  onToggle: () => void;
}) {
  if (!pos.visible) return null;

  const side = computePopoverSide(pos.x, pos.y);

  const popoverStyle: React.CSSProperties = (() => {
    const GAP = 10;
    const BADGE = 20;
    switch (side) {
      case "right":  return { left: pos.x + BADGE + GAP, top: pos.y - 12 };
      case "left":   return { right: window.innerWidth - pos.x + GAP, top: pos.y - 12 };
      case "top":    return { left: Math.max(8, pos.x - 130), bottom: window.innerHeight - pos.y + GAP };
      case "bottom": return { left: Math.max(8, pos.x - 130), top: pos.y + BADGE + GAP };
    }
  })();

  return (
    <>
      {/* Badge "?" */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="fixed z-[8000] flex items-center justify-center rounded-full text-white font-bold transition-all duration-150 shadow-lg"
        style={{
          left: pos.x,
          top: pos.y,
          width: 20,
          height: 20,
          fontSize: 10,
          background: isOpen ? "#D95340" : "rgba(217,83,64,0.85)",
          border: "1.5px solid rgba(255,255,255,0.25)",
          boxShadow: isOpen
            ? "0 0 0 3px rgba(217,83,64,0.25), 0 2px 8px rgba(0,0,0,0.4)"
            : "0 2px 6px rgba(0,0,0,0.35)",
          transform: isOpen ? "scale(1.15)" : "scale(1)",
        }}
        title={item.title}
      >
        ?
      </button>

      {/* Popover */}
      {isOpen && (
        <div
          className="fixed z-[8001] w-[300px] rounded-xl shadow-2xl border"
          style={{
            ...popoverStyle,
            background: "var(--ctx-bg)",
            borderColor: "rgba(217,83,64,0.3)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-start justify-between px-4 pt-3.5 pb-2"
            style={{ borderBottom: "1px solid var(--ctx-divider-bg)" }}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold shrink-0"
                style={{ background: "rgba(217,83,64,0.18)", color: "#D95340" }}
              >
                ?
              </div>
              <p className="text-[12px] font-semibold" style={{ color: "#F5F5F4" }}>
                {item.title}
              </p>
            </div>
            <button
              onClick={onToggle}
              className="text-[#605A55] hover:text-[#8F8883] transition-colors ml-2 shrink-0"
              style={{ fontSize: 14, lineHeight: 1 }}
            >
              ×
            </button>
          </div>

          {/* Corpo */}
          <div className="px-4 py-3">
            <p className="text-[11px] leading-relaxed" style={{ color: "#8F8883" }}>
              {item.description}
            </p>

            {/* Atalhos */}
            {item.shortcuts && item.shortcuts.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "#4C4743" }}>
                  Atalhos
                </p>
                {item.shortcuts.map((sc, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-[10px]" style={{ color: "#605A55" }}>
                      {sc.label}
                    </span>
                    <div className="flex items-center gap-0.5">
                      {sc.keys.map((k, ki) => (
                        <span key={ki}>
                          <kbd
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold"
                            style={{
                              background: "var(--field-bg)",
                              border: "1px solid var(--radio-border)",
                              color: "var(--col-on)",
                              boxShadow: "0 1px 0 rgba(0,0,0,0.3)",
                            }}
                          >
                            {k}
                          </kbd>
                          {ki < sc.keys.length - 1 && (
                            <span className="text-[8px] mx-0.5" style={{ color: "#4C4743" }}>+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function HelpMarkers() {
  const [positions, setPositions] = useState<Record<string, BadgePos>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const rafRef = useRef<number>(0);

  const measureAll = useCallback(() => {
    const next: Record<string, BadgePos> = {};
    for (const item of HELP_ITEMS) {
      const el = document.querySelector(`[data-help="${item.id}"]`);
      if (!el) {
        next[item.id] = { x: 0, y: 0, visible: false };
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        next[item.id] = { x: 0, y: 0, visible: false };
        continue;
      }

      const anchor = item.badgeAnchor ?? "tr";
      const BADGE = 20;
      const OFFSET = -8;
      let x = 0, y = 0;
      switch (anchor) {
        case "tr": x = r.right - BADGE / 2 + OFFSET;  y = r.top  - BADGE / 2 + OFFSET; break;
        case "tl": x = r.left  - BADGE / 2 - OFFSET;  y = r.top  - BADGE / 2 + OFFSET; break;
        case "br": x = r.right - BADGE / 2 + OFFSET;  y = r.bottom - BADGE / 2 - OFFSET; break;
        case "bl": x = r.left  - BADGE / 2 - OFFSET;  y = r.bottom - BADGE / 2 - OFFSET; break;
      }
      next[item.id] = { x: Math.round(x), y: Math.round(y), visible: true };
    }
    setPositions(next);
  }, []);

  // Mede após render e ao redimensionar
  useEffect(() => {
    // Duplo rAF para aguardar layout
    let r1: number, r2: number;
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(measureAll);
    });
    window.addEventListener("resize", measureAll);
    // Re-mede periodicamente para elementos que aparecem/somem (Inspector, player)
    const interval = setInterval(measureAll, 800);
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", measureAll);
      clearInterval(interval);
    };
  }, [measureAll]);

  // Fechar ao clicar fora
  useEffect(() => {
    if (!openId) return;
    const handler = () => setOpenId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openId]);

  // Fechar com Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenId(null); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      {HELP_ITEMS.map((item) => {
        const pos = positions[item.id];
        if (!pos) return null;
        return (
          <HelpBadge
            key={item.id}
            item={item}
            pos={pos}
            isOpen={openId === item.id}
            onToggle={() => setOpenId((prev) => (prev === item.id ? null : item.id))}
          />
        );
      })}
    </>
  );
}
