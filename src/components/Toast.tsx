import { useEffect, useState, useCallback } from "react";

export interface ToastMessage {
  id: number;
  text: string;
  kind?: "success" | "error" | "info";
}

let _nextId = 1;
let _dispatch: ((msg: ToastMessage) => void) | null = null;

export function toast(text: string, kind: ToastMessage["kind"] = "success") {
  _dispatch?.({ id: _nextId++, text, kind });
}

export default function ToastContainer() {
  const [items, setItems] = useState<ToastMessage[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((m) => m.id !== id));
  }, []);

  useEffect(() => {
    _dispatch = (msg) => {
      setItems((prev) => [...prev.slice(-3), msg]);
      setTimeout(() => remove(msg.id), 3000);
    };
    return () => { _dispatch = null; };
  }, [remove]);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-14 right-4 z-[100] flex flex-col gap-1.5 pointer-events-none">
      {items.map((msg) => (
        <div
          key={msg.id}
          className={`px-3.5 py-2 rounded-lg shadow-2xl border text-[12px] font-medium flex items-center gap-2
            animate-[fade-in-up_0.2s_ease-out] ${
            msg.kind === "error"
              ? "bg-[#1c1110] border-[#D95340]/40 text-[#D95340]"
              : msg.kind === "info"
              ? "bg-[#23201E] border-white/[0.1] text-[#756D67]"
              : "bg-[#23201E] border-[#D95340]/30 text-[#F5F5F4]"
          }`}
        >
          {msg.kind === "error" ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="shrink-0 opacity-80">
              <path d="M6 1a5 5 0 110 10A5 5 0 016 1zm-.5 2.5v3h1V3.5h-1zm0 4.5v1h1V8h-1z"/>
            </svg>
          ) : (
            <span className="text-[#D95340] text-xs shrink-0">✓</span>
          )}
          {msg.text}
        </div>
      ))}
    </div>
  );
}
