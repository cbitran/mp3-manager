// ── Sistema de atalhos de teclado ─────────────────────────────────────────────
// "mod" = ⌘ no macOS, Ctrl no Windows
// Formato interno: "mod+k", "Space", "ArrowLeft", "Delete", etc.

export interface ShortcutDef {
  id: string;
  label: string;
  category: string;
  defaultKey: string;
  description: string;
}

export const IS_MAC =
  typeof navigator !== "undefined" &&
  (navigator.platform.toLowerCase().includes("mac") ||
   navigator.userAgent.toLowerCase().includes("mac os"));

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // Player
  { id: "play_pause",   label: "Play / Pause",         category: "Player",    defaultKey: "Space",      description: "Toca ou pausa a faixa atual" },
  { id: "next_track",   label: "Próxima faixa",         category: "Player",    defaultKey: "ArrowRight", description: "Avança para a faixa seguinte" },
  { id: "prev_track",   label: "Faixa anterior",        category: "Player",    defaultKey: "ArrowLeft",  description: "Volta para a faixa anterior" },

  // Biblioteca
  { id: "open_folder",  label: "Abrir pasta",           category: "Biblioteca", defaultKey: "mod+o",     description: "Abre o seletor de pasta" },
  { id: "select_all",   label: "Selecionar tudo",       category: "Biblioteca", defaultKey: "mod+a",     description: "Seleciona todas as faixas visíveis" },
  { id: "remove_track", label: "Remover da biblioteca", category: "Biblioteca", defaultKey: "Delete",    description: "Remove as faixas selecionadas" },
  { id: "deselect",     label: "Desfazer seleção",      category: "Biblioteca", defaultKey: "Escape",    description: "Limpa a seleção atual" },

  // Interface
  { id: "search",       label: "Buscar",                category: "Interface", defaultKey: "mod+f",      description: "Abre a barra de busca" },
  { id: "settings",     label: "Configurações",         category: "Interface", defaultKey: "mod+,",      description: "Abre as configurações" },
  { id: "ai_assistant", label: "Assistente de IA",      category: "Interface", defaultKey: "mod+k",      description: "Abre o assistente virtual" },
];

// ── Formatação para exibição ────────────────────────────────────────────────

const KEY_LABELS: Record<string, string> = {
  Space: "Espaço",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Delete: "Delete",
  Backspace: "Backspace",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
};

export function formatShortcut(key: string): string {
  const modSymbol = IS_MAC ? "⌘" : "Ctrl+";
  const shiftSymbol = IS_MAC ? "⇧" : "Shift+";
  const altSymbol = IS_MAC ? "⌥" : "Alt+";

  return key
    .replace(/^mod\+/, modSymbol)
    .replace(/\+shift\+/, `+${shiftSymbol}`)
    .replace(/^shift\+/, shiftSymbol)
    .replace(/^alt\+/, altSymbol)
    .replace(/([A-Za-z])$/, (m) => KEY_LABELS[m] ?? m.toUpperCase())
    .replace(/^(Space|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Delete|Backspace|Escape|Enter|Tab)$/, (m) => KEY_LABELS[m] ?? m);
}

// ── Captura de tecla pressionada ────────────────────────────────────────────
// Dado um KeyboardEvent, retorna o key string interno ("mod+k", "Space", etc.)

export function captureKey(e: KeyboardEvent): string | null {
  const mod = e.metaKey || e.ctrlKey;
  const shift = e.shiftKey;
  const alt = e.altKey;

  // Ignora teclas sozinhas que são modificadores
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return null;

  let key = "";
  if (mod) key += "mod+";
  if (shift) key += "shift+";
  if (alt) key += "alt+";

  if (e.key === " ") key += "Space";
  else if (e.key.startsWith("Arrow")) key += e.key;
  else key += e.key.toLowerCase();

  return key;
}

// ── Correspondência de evento com shortcut ──────────────────────────────────

export function eventMatchesKey(e: KeyboardEvent, shortcutKey: string): boolean {
  const captured = captureKey(e);
  if (!captured) return false;
  return captured === shortcutKey;
}
