// Fonte única de verdade para documentação in-app.
// Usada por: HelpMarkers.tsx (badges visuais) e AIAssistant.tsx (base de conhecimento).

export interface ShortcutDef {
  keys: string[];  // ex: ["⌘", "O"] ou ["Space"]
  label: string;   // ex: "Abrir pasta"
}

export interface HelpItem {
  id: string;
  title: string;
  description: string;
  shortcuts?: ShortcutDef[];
  aiPatterns: string[];
  // posição do badge relativa ao elemento (padrão: top-right)
  badgeAnchor?: "tr" | "tl" | "br" | "bl";
}

export const HELP_ITEMS: HelpItem[] = [
  // ── Abrir pasta ──────────────────────────────────────────────────────────────
  {
    id: "open-folder",
    title: "Abrir Pasta",
    description:
      "Clique para carregar uma pasta com suas músicas. O TagWave escaneia recursivamente todas as subpastas. Você também pode arrastar uma pasta diretamente para a sidebar ou para a janela.",
    shortcuts: [
      { keys: ["⌘", "O"], label: "Abrir pasta (Mac)" },
      { keys: ["Ctrl", "O"], label: "Abrir pasta (Windows)" },
    ],
    aiPatterns: ["abrir pasta", "abrir musica", "adicionar pasta", "como abro", "como adiciono", "importar pasta", "carregar pasta"],
    badgeAnchor: "br",
  },

  // ── Enriquecer em lote ────────────────────────────────────────────────────
  {
    id: "enrich",
    title: "Enriquecer em Lote",
    description:
      "Preenche automaticamente gênero, álbum, ano, BPM, tom e capa usando iTunes e Spotify. Selecione faixas antes de clicar para enriquecer só as selecionadas; sem seleção enriquece toda a biblioteca. Precisa de internet.",
    shortcuts: [],
    aiPatterns: ["enriquecer", "metadados faltando", "genero faltando", "preencher automatico", "buscar informacoes", "spotify itunes", "como enriqueco"],
    badgeAnchor: "br",
  },

  // ── Analisar BPM ─────────────────────────────────────────────────────────
  {
    id: "analyze-bpm",
    title: "Analisar BPM",
    description:
      "Detecta o BPM de cada faixa diretamente do arquivo de áudio, sem internet. Para faixas específicas, selecione antes de clicar. O resultado é salvo como tag no arquivo.",
    shortcuts: [],
    aiPatterns: ["bpm", "analisar bpm", "calcular bpm", "tempo", "batidas por minuto", "como analiso bpm"],
  },

  // ── Player de áudio ───────────────────────────────────────────────────────
  {
    id: "player",
    title: "Player de Áudio",
    description:
      "Dê duplo-clique em qualquer faixa para tocar. A waveform é interativa e seekável — clique em qualquer ponto para pular. A parte já tocada aparece mais brilhante.",
    shortcuts: [
      { keys: ["Space"], label: "Play / Pause" },
      { keys: ["←"], label: "Faixa anterior" },
      { keys: ["→"], label: "Próxima faixa" },
    ],
    aiPatterns: ["como toco", "tocar musica", "play", "reproduzir", "player", "waveform", "onda", "duplo clique"],
    badgeAnchor: "tl",
  },

  // ── Busca ─────────────────────────────────────────────────────────────────
  {
    id: "search",
    title: "Busca",
    description:
      "Pesquisa simultânea em título, artista, álbum, gênero, BPM, tom e nome de arquivo. Clique no ícone de lupa para expandir o campo.",
    shortcuts: [
      { keys: ["⌘", "F"], label: "Abrir busca (Mac)" },
      { keys: ["Ctrl", "F"], label: "Abrir busca (Windows)" },
    ],
    aiPatterns: ["buscar", "pesquisar", "procurar musica", "pesquisa", "encontrar", "como busco"],
    badgeAnchor: "br",
  },

  // ── Exportar ──────────────────────────────────────────────────────────────
  {
    id: "export-btn",
    title: "Exportar Playlist",
    description:
      "Exporta para os principais softwares DJ: Rekordbox, Serato, Traktor, Virtual DJ, djay Pro, Engine DJ e M3U universal. O botão só ativa quando há faixas selecionadas OU uma playlist ativa na sidebar.",
    shortcuts: [],
    aiPatterns: ["exportar", "rekordbox", "serato", "traktor", "m3u", "export", "exportar csv", "virtual dj", "djay"],
    badgeAnchor: "br",
  },

  // ── Configurações ─────────────────────────────────────────────────────────
  {
    id: "settings-btn",
    title: "Configurações",
    description:
      "Acesse chaves de API (Spotify, Discogs, AcoustID, Last.fm), tema da interface, idioma, coluna picker, atalhos de teclado customizáveis e opções de acessibilidade.",
    shortcuts: [
      { keys: ["⌘", ","], label: "Configurações (Mac)" },
      { keys: ["Ctrl", ","], label: "Configurações (Windows)" },
    ],
    aiPatterns: ["configuracoes", "settings", "apikey", "api", "chave api", "spotify key", "discogs", "acoustid", "last.fm"],
    badgeAnchor: "bl",
  },

  // ── Enriquecer — Inspector ────────────────────────────────────────────────
  {
    id: "enrich-inspector",
    title: "Enriquecer Faixa Individual",
    description:
      "Busca metadados detalhados da faixa selecionada via Spotify + iTunes: gênero, álbum, ano, BPM, tom e capa em alta resolução.",
    shortcuts: [],
    aiPatterns: ["enriquecer individual", "enriquecer uma faixa", "inspector enriquecer", "enriquecer inspector"],
    badgeAnchor: "tl",
  },

  // ── Inspector — campos de tag ─────────────────────────────────────────────
  {
    id: "inspector-fields",
    title: "Editar Metadados (Tags ID3)",
    description:
      "Edite título, artista, álbum, gênero, ano, faixa #, BPM, tom e comentário. Em seleção múltipla (2+ faixas), título e artista ficam bloqueados para evitar edição acidental em lote. Clique em 'Salvar' para gravar no arquivo.",
    shortcuts: [
      { keys: ["Enter"], label: "Salvar campo atual" },
    ],
    aiPatterns: ["editar", "editar tag", "editar metadado", "mudar titulo", "mudar artista", "alterar nome", "como edito", "inspector", "painel direito"],
  },

  // ── Salvar tags ───────────────────────────────────────────────────────────
  {
    id: "save-tags-btn",
    title: "Salvar Tags",
    description:
      "Grava todas as edições do Inspector diretamente no arquivo de áudio. Use este botão ou pressione Enter em qualquer campo para salvar. Em edição em lote (2+ faixas), salva os campos editáveis para todas as faixas selecionadas.",
    shortcuts: [
      { keys: ["Enter"], label: "Salvar ao editar um campo" },
    ],
    aiPatterns: ["salvar", "precisa salvar", "gravar tag", "salvo automatico", "como salvo"],
  },

  // ── Playlists ─────────────────────────────────────────────────────────────
  {
    id: "playlists-section",
    title: "Playlists",
    description:
      "Crie playlists selecionando faixas + botão direito → 'Criar Playlist', ou arraste faixas para a zona 'Nova Playlist' que aparece na sidebar durante o drag. Playlists podem ter Propriedades Globais: capa, álbum ou gênero aplicados automaticamente a cada faixa adicionada.",
    shortcuts: [],
    aiPatterns: ["playlist", "criar playlist", "como crio playlist", "lista de reproducao", "drag playlist", "arrastar playlist"],
  },

  // ── Aba sidebar ───────────────────────────────────────────────────────────
  {
    id: "sidebar-tabs",
    title: "Navegação da Biblioteca",
    description:
      "A sidebar tem 3 abas: Recentes (pastas abertas recentemente), Favoritos (faixas marcadas com ★) e Playlists. Clique em qualquer pasta para recarregar sua coleção. Arraste a borda direita da sidebar para redimensioná-la.",
    shortcuts: [],
    aiPatterns: ["sidebar", "painel esquerdo", "aba", "recentes", "navegacao", "pastas monitoradas", "redimensionar sidebar"],
    badgeAnchor: "br",
  },

  // ── Filtros de status ─────────────────────────────────────────────────────
  {
    id: "filter-tabs",
    title: "Filtros de Status",
    description:
      "Filtre a tabela por: Todas as faixas, Problemas (sem metadados), Favoritos, Recém adicionadas (últimos 30 dias). Cada filtro mostra a contagem de faixas. Clique no mesmo filtro ativo para voltar a 'Todas'.",
    shortcuts: [],
    aiPatterns: ["filtro", "filtrar", "filter chips", "problemas", "faixas com problema", "recentes filtro"],
    badgeAnchor: "bl",
  },

  // ── Normalizar tags ───────────────────────────────────────────────────────
  {
    id: "normalize",
    title: "Normalizar Tags",
    description:
      "Corrige problemas de encoding em tags ID3: remove espaços extras, acentos corrompidos e caracteres especiais malformados. Funciona em todas as faixas da biblioteca de uma vez. Não acessa internet.",
    shortcuts: [],
    aiPatterns: ["normalizar", "normalizar tags", "encoding", "acento errado", "caractere especial", "texto corrompido"],
    badgeAnchor: "br",
  },

  // ── AI Assistant ──────────────────────────────────────────────────────────
  {
    id: "ai-assistant",
    title: "Assistente Virtual",
    description:
      "Faça perguntas sobre como usar o TagWave em linguagem natural. O assistente conhece todas as funcionalidades do app e responde em português. Funciona completamente offline.",
    shortcuts: [
      { keys: ["⌘", "K"], label: "Abrir / fechar assistente (Mac)" },
      { keys: ["Ctrl", "K"], label: "Abrir / fechar assistente (Windows)" },
    ],
    aiPatterns: ["assistente", "agente", "ajuda", "como funciona", "ai assistant", "chat", "pergunta"],
    badgeAnchor: "tl",
  },

  // ── Coluna picker ─────────────────────────────────────────────────────────
  {
    id: "col-picker",
    title: "Colunas Visíveis",
    description:
      "Escolha quais colunas exibir na tabela. Arraste os cabeçalhos das colunas para reordená-las. Clique em 'Restaurar larguras' para voltar ao layout padrão.",
    shortcuts: [],
    aiPatterns: ["colunas", "esconder coluna", "mostrar coluna", "coluna picker", "reorganizar coluna"],
    badgeAnchor: "bl",
  },

  // ── Filtros avançados ─────────────────────────────────────────────────────
  {
    id: "advanced-filters",
    title: "Filtros Avançados",
    description:
      "Filtre por BPM (mínimo e máximo), intervalo de ano e tom musical. Enquanto um filtro está ativo, um badge laranja 'Filtros ativos' aparece na toolbar. Clique nele para limpar todos os filtros.",
    shortcuts: [],
    aiPatterns: ["filtro avancado", "filtrar bpm", "filtrar ano", "filtrar tom", "funil"],
    badgeAnchor: "bl",
  },
];

// Deriva a estrutura para o AI Assistant a partir de HELP_ITEMS
export function buildAiKnowledge(): Array<{ patterns: string[]; answer: string }> {
  return HELP_ITEMS.map((item) => ({
    patterns: item.aiPatterns,
    answer: item.description,
  }));
}
