# TagWave — Fila de Tarefas (atualizado 23/05/2026 05:30)

## ✅ Concluído nesta sessão

### Rodada 1 (03:00–04:42)
- [x] Rust: corrigir erros de compilação (lofty pictures().first(), set_year, tipagem)
- [x] Waveform: remover overflow-visible, conter dentro da célula, fallback variado por hash
- [x] Seleção múltipla: fundo branco sutil + número da linha em vermelho
- [x] MiniPlayer: redesenho completo (barra fina de progresso + SVG icons + áudio via convertFileSrc)
- [x] Build universal ARM64 + x86_64 instalado em /Applications
- [x] Export Rekordbox XML — UI + backend funcionando
- [x] Export M3U — UI + backend funcionando
- [x] Normalizar Tags — multi-formato (MP3/AIFF via id3, demais via lofty)
- [x] Suporte multi-formato (FLAC, AIFF, WAV, M4A, OGG) via lofty
- [x] Formato / Bitrate / SampleRate no Inspector
- [x] Double-click numa faixa → carregar no player
- [x] Sidebar: emoji icons (📁📂🗑) → flat SVG
- [x] Inspector: gradiente teal → paleta terracota
- [x] FilenamePrompt: success state verde → paleta
- [x] TrialBanner: emoji ⏱ → SVG clock
- [x] Filtro "Recentes" (últimos 30 dias, modified_at)
- [x] Confirmação ao fechar janela com processo ativo
- [x] Indicador de faixa tocando (barras equalizer animadas)
- [x] Atalhos de teclado: Space, ArrowLeft/Right, Cmd+O, Cmd+A, Escape
- [x] Toast notifications para export e normalize
- [x] Filename cleanup Fase 1 e Fase 2 (ParenReviewPrompt)
- [x] QA audit 1ª rodada — todos os features OK

### Rodada 2 (04:42–05:30)
- [x] Fix JSX root fragment em TrackTable (context menu fora do div)
- [x] **Scan progress real-time** — evento Rust `scan_progress {done/total}`; botão mostra "X/Y" durante scan
- [x] **Toolbar ícones SVG flat** — Abrir Pasta (folder), Normalizar (filtro), Exportar (arrow-up), Enriquecer (relógio)
- [x] **Inspector overlay** — quando janela < 820px, Inspector em posição absoluta com slide-in animation
- [x] **Drag & drop de pasta** — `onDragDropEvent()` nativo Tauri + overlay visual com borda dashed
- [x] **Batch enrichment (iTunes)** — `batch_enrich_itunes` Rust + botão no toolbar "Enriquecer / Enriquecer N"
  - Enriquece selecionadas (se houver seleção) ou todas sem metadados completos
  - Salva gênero, álbum, ano + baixa capas ausentes via `save_cover`
  - Progresso em tempo real "X/Y" no botão
- [x] **Rating column na TrackTable** — estrelas SVG fill/outline 1–5 na coluna "★"
- [x] **LibraryStats panel** — quando nenhuma faixa selecionada + biblioteca carregada, mostra:
  - Total faixas, GB, horas
  - Barras de cobertura: BPM, Tom, Gênero, Capa, Rating (%)
  - Card de problemas (N faixas com issues)
  - Top 5 gêneros
- [x] QA 2ª rodada — null checks, cores Tailwind → hex customizados
  - TrackTable: yellow-400 → #DC5547, emerald → #3db87a
  - Inspector save button: emerald → #2a5c3f
  - TrialBanner: red/orange → #DC5547/#e07a35
  - Sidebar: red-400 → #DC5547
  - DuplicatePrompt: amber → #DC5547
- [x] **Estrela favorita SVG** — substituiu ★ unicode por SVG de 5 pontas (fill/outline)
- [x] Build universal final — TagWave_0.3.0_universal.dmg (05:04)
- [x] **Tela de Onboarding** — 4 feature cards + trial info + localStorage key; integrada em App.tsx (05:30)
- [x] **MiniPlayer capa** — thumbnail 32×32 com `read_cover_base64`, fallback com ícone SVG

## 🟡 Próximas features (prioridade média)

- [ ] AcoustID fingerprint — identificação automática por audio fingerprint (requer chromaprint)
- [ ] Spotify batch enrichment — BPM + Tom via Spotify para múltiplas faixas (ver nota de deprecação)
- [ ] Cover miniatura inline na tabela — lazy-load de capa por row (1 invoke por row)

## 🎨 Visual / UX pendente

- [ ] Spinner ⟳ no botão Escaneando — ainda Unicode, mas aceitável (já há spinner SVG animado)
- [x] LibraryStats: drill-down por gênero (clicar no gênero filtra a tabela) ✅ já implementado

## 📦 Distribuição

- [ ] Code signing e notarização Apple
- [ ] Página de licença / compra (antes do lançamento)
- [ ] ReplayGain / LUFS analysis — análise de loudness (requer symphonia decoder)
- [ ] Atualizar PDFs beta
