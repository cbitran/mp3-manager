import { useEffect, useState } from "react";

const TOUR_KEY = "tagwave_tour_v1";

const STEPS = [
  {
    target: "open-folder",
    title: "Abrir Pasta",
    desc: "Clique aqui para carregar uma pasta com suas músicas. Você pode arrastar uma pasta direto para a janela também.",
  },
  {
    target: "enrich",
    title: "Enriquecer em Lote",
    desc: "Selecione várias faixas e enriqueça tudo de uma vez via iTunes e Spotify — gênero, álbum, ano e capa.",
  },
  {
    target: "enrich-inspector",
    title: "Enriquecer Faixa Individual",
    desc: "Selecione uma faixa e clique aqui para buscar metadados detalhados com Spotify + iTunes — incluindo BPM, tom e capa.",
    fallback: "center",
  },
  {
    target: "analyze-bpm",
    title: "Analisar BPM",
    desc: "Detecta o BPM de cada música diretamente do arquivo de áudio, sem precisar de internet.",
  },
  {
    target: "player",
    title: "Player de Áudio",
    desc: "Dê duplo clique em qualquer faixa para tocar com waveform interativo e seekável.",
    fallback: "bottom",
  },
];

export function shouldShowTour(): boolean {
  return !localStorage.getItem(TOUR_KEY);
}

interface Pos {
  left: number;
  top: number | null;
  bottom: number | null;
  arrowLeft: number;
  arrowUp: boolean;
}

function getTooltipPos(target: string, fallback?: string): Pos | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  const TOOLTIP_W = 260;
  const GAP = 12;

  if (el) {
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(
      window.innerWidth - TOOLTIP_W - 8,
      r.left + r.width / 2 - TOOLTIP_W / 2
    ));
    const arrowLeft = Math.max(16, Math.min(TOOLTIP_W - 16, r.left + r.width / 2 - left));
    // Se o elemento está na metade inferior, tooltip vai acima
    const goAbove = r.bottom > window.innerHeight * 0.6;
    if (goAbove) {
      return { left, top: r.top - GAP - 160, bottom: null, arrowLeft, arrowUp: false };
    }
    return { left, top: r.bottom + GAP, bottom: null, arrowLeft, arrowUp: true };
  }

  if (fallback === "bottom") {
    const left = window.innerWidth / 2 - TOOLTIP_W / 2;
    return { left, top: null, bottom: 80, arrowLeft: TOOLTIP_W / 2, arrowUp: false };
  }

  if (fallback === "center") {
    const left = window.innerWidth / 2 - TOOLTIP_W / 2;
    const top = window.innerHeight / 2 - 90;
    return { left, top, bottom: null, arrowLeft: TOOLTIP_W / 2, arrowUp: false };
  }

  return null;
}

interface ProductTourProps {
  onDone: () => void;
  onStepChange?: (step: number) => void;
}

export default function ProductTour({ onDone, onStepChange }: ProductTourProps) {
  const [step, setStep] = useState(0);
  const [pos, setPos] = useState<Pos | null>(null);

  const current = STEPS[step];

  useEffect(() => {
    // Duplo rAF: aguarda o DOM renderizar o elemento alvo antes de medir
    let id1: number, id2: number;
    id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        setPos(getTooltipPos(current.target, current.fallback));
      });
    });
    function onResize() { setPos(getTooltipPos(current.target, current.fallback)); }
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
      window.removeEventListener("resize", onResize);
    };
  }, [step]);

  function dismiss() {
    localStorage.setItem(TOUR_KEY, "1");
    onDone();
  }

  function next() {
    if (step < STEPS.length - 1) {
      const nextStep = step + 1;
      setStep(nextStep);
      onStepChange?.(nextStep);
    } else {
      dismiss();
    }
  }

  const targetEl = document.querySelector(`[data-tour="${current.target}"]`);
  const targetRect = targetEl?.getBoundingClientRect() ?? null;

  if (!pos) return null;

  const PAD = 5;

  return (
    <>
      {/* Spotlight — box-shadow cria o buraco escuro ao redor, sem cobrir o elemento */}
      {targetRect && (
        <div
          className="fixed z-[9000] rounded-lg pointer-events-none"
          style={{
            left: targetRect.left - PAD,
            top: targetRect.top - PAD,
            width: targetRect.width + PAD * 2,
            height: targetRect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.58), 0 0 0 2.5px #D95340, 0 0 12px 2px rgba(217,83,64,0.35)",
            background: "transparent",
          }}
        />
      )}

      {/* Tooltip */}
      <div
        className="fixed z-[9002] pointer-events-auto"
        style={{
          left: pos.left,
          top: pos.top !== null ? pos.top : undefined,
          bottom: pos.bottom !== null ? pos.bottom : undefined,
          width: 260,
        }}
      >
        {/* Seta para cima */}
        {pos.arrowUp && (
          <div
            className="absolute -top-[7px] w-0 h-0"
            style={{
              left: pos.arrowLeft - 7,
              borderLeft: "7px solid transparent",
              borderRight: "7px solid transparent",
              borderBottom: "7px solid #2a2522",
            }}
          />
        )}

        <div
          className="rounded-xl shadow-2xl p-4 border"
          style={{
            background: "#1c1715",
            borderColor: "rgba(217,83,64,0.25)",
          }}
        >
          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mb-3">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className="h-1 rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 20 : 5,
                  background: i === step ? "#D95340" : i < step ? "#5a3530" : "#2e2826",
                }}
              />
            ))}
            <span className="ml-auto text-[9px] font-mono text-[#605A55]">
              {step + 1}/{STEPS.length}
            </span>
          </div>

          <p className="text-[13px] font-semibold text-[#F5F5F4] mb-1.5">{current.title}</p>
          <p className="text-[11px] text-[#8F8883] leading-relaxed mb-4">{current.desc}</p>

          <div className="flex items-center justify-between">
            <button
              onClick={dismiss}
              className="text-[10px] text-[#756D67] hover:text-[#8F8883] transition-colors"
            >
              Pular tutorial
            </button>
            <button
              onClick={next}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white transition-colors"
              style={{ background: "#D95340" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#E07364")}
              onMouseLeave={e => (e.currentTarget.style.background = "#D95340")}
            >
              {step < STEPS.length - 1 ? (
                <>Próximo <span style={{ fontSize: 10 }}>›</span></>
              ) : (
                "Entendi!"
              )}
            </button>
          </div>
        </div>

        {/* Seta para baixo (fallback bottom) */}
        {!pos.arrowUp && (
          <div
            className="absolute -bottom-[7px] w-0 h-0"
            style={{
              left: pos.arrowLeft - 7,
              borderLeft: "7px solid transparent",
              borderRight: "7px solid transparent",
              borderTop: "7px solid #2a2522",
            }}
          />
        )}
      </div>
    </>
  );
}
