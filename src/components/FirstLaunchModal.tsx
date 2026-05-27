import { useState } from "react";
import { useAppStore, CURRENT_PRIVACY_VERSION } from "../store";

const PRIVACY_TEXT = `POLÍTICA DE PRIVACIDADE — TagWave
Versão ${CURRENT_PRIVACY_VERSION} · Vigência: maio de 2026

CONTROLADOR DOS DADOS
Bitran Software (Célio Bitran) · celio.bitran@gmail.com

O QUE O TAGWAVE FAZ COM SEUS DADOS

O TagWave processa seus arquivos de áudio localmente, no seu computador.
Nenhum arquivo de áudio é enviado para nenhum servidor externo.

Com a sua autorização, o TagWave pode enviar metadados de faixas (título e
artista) para serviços externos com o único propósito de enriquecer sua
biblioteca:

  • Spotify Web API — busca BPM, tom musical e capas de álbum
  • Apple iTunes Search API — busca metadados e capas de álbum
  • Last.fm API — informações complementares de artistas

Para validar sua licença, o TagWave envia a chave de licença e um
identificador anônimo da máquina (hash técnico, sem dados pessoais)
para a plataforma LemonSqueezy.

O QUE NÃO É COLETADO

  • Seus arquivos de áudio nunca saem do computador
  • Nenhuma telemetria, analytics ou histórico de uso é enviado
  • Não coletamos informações de localização, contatos ou qualquer
    dado pessoal além do e-mail informado na ativação da licença

BASE LEGAL (LGPD — Lei 13.709/2018)

O enriquecimento de metadados é baseado em seu consentimento explícito,
concedido nesta tela. Você pode revogar a qualquer momento em
Configurações → Privacidade.

SEUS DIREITOS

Acesso, correção, exclusão de dados ou revogação de consentimento:
celio.bitran@gmail.com

O TagWave não vende, compartilha nem transfere seus dados a terceiros
para fins distintos dos descritos acima.`;

const TERMS_TEXT = `TERMOS DE USO — TagWave
Versão ${CURRENT_PRIVACY_VERSION} · Vigência: maio de 2026

O TagWave é licenciado, não vendido.

VOCÊ PODE

  • Usar o TagWave para fins pessoais e profissionais
  • Instalar em até 2 dispositivos de sua propriedade com a mesma licença
  • Criar backups do software para uso próprio

VOCÊ NÃO PODE

  • Redistribuir, vender, sublicenciar ou transferir o software
  • Remover, desabilitar ou contornar o sistema de licença
  • Realizar engenharia reversa, descompilar ou desmontar o software
  • Usar o software de forma que viole leis aplicáveis

ISENÇÃO DE RESPONSABILIDADE

O TagWave é fornecido "como está". Bitran Software não garante que o
software estará livre de erros. Recomendamos manter backups dos seus
arquivos de áudio antes de realizar edições em lote de metadados.

Bitran Software não se responsabiliza por perda de dados resultante
do uso do software.

JURISDIÇÃO

Este acordo é regido pelas leis brasileiras. Fica eleito o foro da
Comarca de São Paulo/SP para dirimir quaisquer controvérsias.`;

type Section = "privacy" | "terms";

export default function FirstLaunchModal() {
  const { privacyAcceptedVersion, acceptPrivacy, enrichmentOptIn, setEnrichmentOptIn } = useAppStore();

  const [section, setSection] = useState<Section>("privacy");
  const [accepted, setAccepted] = useState(false);
  const [optIn, setOptIn] = useState(enrichmentOptIn);

  if (privacyAcceptedVersion === CURRENT_PRIVACY_VERSION) return null;

  function handleStart() {
    if (!accepted) return;
    setEnrichmentOptIn(optIn);
    acceptPrivacy();
  }

  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div
        className="flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{
          width: 560,
          maxHeight: "88vh",
          background: "#18161A",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* Header */}
        <div className="px-8 pt-7 pb-5 flex flex-col items-center gap-3 border-b border-white/[0.06]">
          <img src="/tagwave-logo.png" alt="TagWave" className="h-7 opacity-85" />
          <div className="text-center">
            <h2 className="text-[17px] font-bold text-[#F5F5F4] leading-tight">Bem-vindo ao TagWave</h2>
            <p className="text-[12px] text-[#4C4743] mt-1">
              Antes de começar, leia e aceite os termos abaixo.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/[0.06] px-8">
          {(["privacy", "terms"] as Section[]).map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={`px-3 pt-3 pb-[13px] text-[11px] font-semibold border-b-2 -mb-px transition-colors ${
                section === s
                  ? "text-[#D95340] border-[#D95340]"
                  : "text-[#605A55] border-transparent hover:text-[#8F8883]"
              }`}
            >
              {s === "privacy" ? "Política de Privacidade" : "Termos de Uso"}
            </button>
          ))}
        </div>

        {/* Text area */}
        <div className="flex-1 overflow-y-auto px-8 py-5 min-h-0">
          <pre
            className="text-[11px] leading-relaxed whitespace-pre-wrap font-sans"
            style={{ color: "#8F8883" }}
          >
            {section === "privacy" ? PRIVACY_TEXT : TERMS_TEXT}
          </pre>
        </div>

        {/* Opt-in enrichment */}
        <div className="px-8 py-4 border-t border-white/[0.06]">
          <label className="flex items-start gap-3 cursor-pointer group">
            <div
              onClick={() => setOptIn((v) => !v)}
              className={`mt-0.5 shrink-0 w-8 h-4.5 rounded-full transition-colors relative cursor-pointer ${
                optIn ? "bg-[#D95340]" : "bg-white/[0.10]"
              }`}
              style={{ height: 18, width: 32 }}
            >
              <span
                className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform"
                style={{ transform: optIn ? "translateX(14px)" : "translateX(0)", width: 14, height: 14 }}
              />
            </div>
            <div>
              <p className="text-[12px] font-semibold text-[#C2BEBC]">
                Permitir enriquecimento de metadados
              </p>
              <p className="text-[11px] text-[#4C4743] mt-0.5">
                Envia título e artista para Spotify e iTunes para buscar BPM, tom e capas.
                Você pode alterar isso depois em Configurações → Privacidade.
              </p>
            </div>
          </label>
        </div>

        {/* Checkbox + CTA */}
        <div className="px-8 pb-7 pt-2 flex flex-col gap-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="accent-[#D95340] w-4 h-4 shrink-0"
            />
            <span className="text-[12px] text-[#8F8883]">
              Li e aceito a{" "}
              <span
                className="text-[#D95340] cursor-pointer underline underline-offset-2"
                onClick={() => setSection("privacy")}
              >
                Política de Privacidade
              </span>{" "}
              e os{" "}
              <span
                className="text-[#D95340] cursor-pointer underline underline-offset-2"
                onClick={() => setSection("terms")}
              >
                Termos de Uso
              </span>
            </span>
          </label>

          <button
            onClick={handleStart}
            disabled={!accepted}
            className="w-full py-2.5 rounded-lg font-bold text-[13px] uppercase tracking-wide transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: accepted ? "#D95340" : "#3A2E2C", color: "#fff" }}
          >
            Começar
          </button>
        </div>
      </div>
    </div>
  );
}
