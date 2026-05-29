import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppStore } from "../store";

const PRO_URL = "https://tagwave.app/pro";

interface Props {
  children: React.ReactNode;
  feature: string;
  description: string;
}

export default function ProGate({ children, feature, description }: Props) {
  const isPro = useAppStore((s) => s.isPro);
  const [showModal, setShowModal] = useState(false);

  if (isPro()) return <>{children}</>;

  return (
    <>
      <div className="relative inline-flex" onClick={(e) => { e.stopPropagation(); setShowModal(true); }}>
        <div className="opacity-50 pointer-events-none select-none">{children}</div>
        <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#D95340] flex items-center justify-center z-10">
          <svg width="7" height="8" viewBox="0 0 7 8" fill="white">
            <rect x="1" y="3.5" width="5" height="4" rx="0.8"/>
            <path d="M2 3.5V2.5a1.5 1.5 0 013 0v1" stroke="white" strokeWidth="1" fill="none"/>
          </svg>
        </div>
      </div>
      {showModal && <ProUpgradeModal onClose={() => setShowModal(false)} feature={feature} description={description} />}
    </>
  );
}

export function ProUpgradeModal({ onClose, feature, description }: { onClose: () => void; feature: string; description: string }) {
  const { t } = useTranslation();
  const activateProLicense = useAppStore((s) => s.activateProLicense);
  const [showActivate, setShowActivate] = useState(false);
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleActivate = async () => {
    if (!key.trim()) return;
    setLoading(true);
    setError(null);
    const result = await activateProLicense(key);
    setLoading(false);
    if (result.ok) {
      setSuccess(true);
      setTimeout(onClose, 1500);
    } else {
      setError(result.error ?? t("pro.exclusiveFeature"));
    }
  };

  const features = [
    { title: t("pro.feat1Title"), desc: t("pro.feat1Desc") },
    { title: t("pro.feat2Title"), desc: t("pro.feat2Desc") },
    { title: t("pro.feat3Title"), desc: t("pro.feat3Desc") },
  ];

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/65 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1c1715] border border-white/[0.09] rounded-2xl w-[400px] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-5 text-center" style={{ background: "linear-gradient(160deg, rgba(217,83,64,0.12) 0%, transparent 100%)" }}>
          <div className="w-12 h-12 rounded-2xl bg-[#D95340]/20 border border-[#D95340]/30 flex items-center justify-center mx-auto mb-3">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#D95340" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <h2 className="text-[16px] font-bold text-[#F5F5F4] mb-1">{t("pro.title")}</h2>
          <p className="text-[12px] text-[#8F8883]">
            <span className="text-[#D95340] font-semibold">{feature}</span> {t("pro.exclusiveFeature")}
          </p>
        </div>

        <div className="px-6 py-4">
          <p className="text-[12px] text-[#C2BEBC] leading-relaxed text-center mb-4">{description}</p>

          <div className="space-y-2 mb-5">
            {features.map(({ title, desc }) => (
              <div key={title} className="flex items-start gap-2.5 px-3 py-2 rounded-lg" style={{ background: "rgba(217,83,64,0.05)", border: "1px solid rgba(217,83,64,0.12)" }}>
                <div className="w-4 h-4 rounded-full bg-[#D95340]/20 flex items-center justify-center shrink-0 mt-0.5">
                  <svg width="7" height="5" viewBox="0 0 7 5" fill="none" stroke="#D95340" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 2.5l1.5 1.5 3.5-3.5"/>
                  </svg>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[#E8E4E1]">{title}</p>
                  <p className="text-[10px] text-[#605A55]">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mb-4">
            <span className="text-[11px] text-[#605A55]">$39 →</span>
            <span className="text-[22px] font-bold text-[#F5F5F4] ml-2">$69</span>
            <span className="text-[11px] text-[#8F8883] ml-1">{t("pro.singlePayment")}</span>
          </div>

          {!showActivate ? (
            <div className="space-y-2">
              <button
                onClick={() => openUrl(PRO_URL).catch(() => {})}
                className="w-full py-2.5 rounded-xl text-[13px] font-bold bg-[#D95340] hover:bg-[#E07364] text-white transition-colors"
              >
                {t("pro.getProBtn")}
              </button>
              <button onClick={() => setShowActivate(true)} className="w-full py-2 text-[11px] text-[#605A55] hover:text-[#C2BEBC] transition-colors">
                {t("pro.alreadyHaveKey")}
              </button>
            </div>
          ) : success ? (
            <div className="text-center py-3">
              <div className="w-10 h-10 rounded-full bg-[#5BA055]/20 flex items-center justify-center mx-auto mb-2">
                <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="#5BA055" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 6l5 5 9-10"/>
                </svg>
              </div>
              <p className="text-[13px] font-semibold text-[#6DBF7E]">{t("pro.activatedSuccess")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="text" value={key} onChange={(e) => setKey(e.target.value)}
                placeholder={t("pro.keyPlaceholder")} autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleActivate()}
                className="w-full px-3 py-2 rounded-lg text-[12px] font-mono focus:outline-none focus:border-[#D95340]/50"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", color: "#E8E4E1" }}
              />
              {error && <p className="text-[11px] text-[#D95340] text-center">{error}</p>}
              <div className="flex gap-2">
                <button onClick={() => setShowActivate(false)}
                  className="flex-1 py-2 rounded-lg text-[12px] text-[#605A55] hover:text-[#C2BEBC] transition-colors"
                  style={{ background: "rgba(255,255,255,0.03)" }}>
                  {t("pro.back")}
                </button>
                <button onClick={handleActivate} disabled={loading || !key.trim()}
                  className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-[#D95340] hover:bg-[#E07364] text-white transition-colors disabled:opacity-40">
                  {loading ? t("pro.activating") : t("pro.activate")}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-4 text-center">
          <button onClick={onClose} className="text-[11px] text-[#4C4743] hover:text-[#605A55] transition-colors">
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
