import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

const SKIP_KEY   = "tagwave_skipVersion";
const SNOOZE_KEY = "tagwave_updateSnoozeUntil";
const REPO       = "cbitran/mp3-manager";

interface Release { tag: string; version: string; body: string; url: string; }

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const a = parse(latest), b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0, bi = b[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

interface Props { currentVersion: string; onClose: () => void; }

export default function UpdateModal({ currentVersion, onClose }: Props) {
  const [release, setRelease] = useState<Release | null>(null);

  useEffect(() => {
    if (!currentVersion) return;
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => r.json())
      .then((data) => {
        const tag = (data.tag_name as string) ?? "";
        const version = tag.replace(/^v/, "");
        if (!isNewer(version, currentVersion)) return;
        if (localStorage.getItem(SKIP_KEY) === version) return;
        const snooze = parseInt(localStorage.getItem(SNOOZE_KEY) ?? "0");
        if (Date.now() < snooze) return;
        setRelease({ tag, version, body: data.body ?? "", url: data.html_url ?? "" });
      })
      .catch(() => {});
  }, [currentVersion]);

  if (!release) return null;

  const changelog = release.body.slice(0, 700).trim();

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1c1715] border border-white/[0.08] rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4">
        {/* Cabeçalho */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#D95340]/15 border border-[#D95340]/30 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-[#D95340]">
              <path d="M10 3v9m-3.5-3.5L10 12l3.5-3.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3.5 14.5h13" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"/>
              <path d="M3.5 17h13" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#F5F5F4]">Nova versão disponível</p>
            <p className="text-[11px] text-[#8F8883]">
              TagWave {release.tag} · você tem v{currentVersion}
            </p>
          </div>
        </div>

        {/* Changelog */}
        {changelog && (
          <div className="bg-[#0E0D0C] rounded-lg p-3 max-h-44 overflow-y-auto border border-white/[0.04]">
            <p className="text-[11px] text-[#C2BEBC] whitespace-pre-wrap leading-relaxed font-mono">
              {changelog}{release.body.length > 700 ? "\n…" : ""}
            </p>
          </div>
        )}

        {/* Ações */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => { localStorage.setItem(SKIP_KEY, release.version); onClose(); setRelease(null); }}
            className="px-3 py-2 rounded-lg text-[11px] text-[#605A55] hover:text-[#8F8883] transition-colors"
          >
            Pular versão
          </button>
          <button
            onClick={() => { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 86_400_000)); onClose(); setRelease(null); }}
            className="flex-1 px-3 py-2 rounded-lg text-[11px] text-[#C2BEBC] hover:bg-white/[0.04] border border-white/[0.08] transition-colors"
          >
            Depois (24h)
          </button>
          <button
            onClick={() => { openUrl(release.url).catch(() => {}); onClose(); setRelease(null); }}
            className="flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold text-white bg-[#D95340] hover:bg-[#E07364] transition-colors"
          >
            Baixar agora
          </button>
        </div>
      </div>
    </div>
  );
}
