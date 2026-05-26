import { useEffect, useState, useCallback } from "react";

export interface ToastMessage {
  id: number;
  text: string;
  kind?: "success" | "error" | "info";
  action?: { label: string; fn: () => void };
}

let _nextId = 1;
let _dispatch: ((msg: ToastMessage) => void) | null = null;

export function toast(
  text: string,
  kind: ToastMessage["kind"] = "success",
  action?: { label: string; fn: () => void },
) {
  _dispatch?.({ id: _nextId++, text, kind, action });
}

export default function ToastContainer() {
  const [items, setItems] = useState<ToastMessage[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((m) => m.id !== id));
  }, []);

  useEffect(() => {
    _dispatch = (msg) => {
      setItems((prev) => [...prev.slice(-3), msg]);
      setTimeout(() => remove(msg.id), msg.action ? 8000 : 3000);
    };
    return () => { _dispatch = null; };
  }, [remove]);

  if (items.length === 0) return null;

  return (
    <div className="fixed top-[72px] left-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none"
      style={{ transform: "translateX(-50%)" }}
    >
      {items.map((msg) => (
        <div
          key={msg.id}
          className={`min-w-[300px] px-5 py-3 rounded-xl shadow-2xl border text-[13px] font-semibold flex items-center gap-3
            pointer-events-auto ${
            msg.kind === "error"
              ? "bg-[#1c1110] border-[#D95340]/40 text-[#D95340]"
              : "bg-[#E07840] border-[#C8622A]/50 text-[#1F0A02]"
          }`}
          style={{ animation: "slide-down-bounce 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" }}
        >
          {msg.kind === "error" ? (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" className="shrink-0 opacity-80">
              <path d="M6 1a5 5 0 110 10A5 5 0 016 1zm-.5 2.5v3h1V3.5h-1zm0 4.5v1h1V8h-1z"/>
            </svg>
          ) : (
            <span className="text-[#1F0A02] text-sm shrink-0 font-bold">✓</span>
          )}
          <span className="flex-1">{msg.text}</span>
          {msg.action && (
            <button
              onClick={() => { msg.action!.fn(); remove(msg.id); }}
              className="shrink-0 ml-1 px-2.5 py-1 rounded-lg text-[12px] font-bold bg-[#1F0A02]/20 text-[#1F0A02] hover:bg-[#1F0A02]/30 transition-colors"
            >
              {msg.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
