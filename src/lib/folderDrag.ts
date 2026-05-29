// Estado global de drag (FolderBrowser → Sidebar).
// Usar variável de módulo ao invés de dataTransfer.getData() que
// tem comportamento inconsistente no WebKit/WKWebView (Tauri).

export let activeFolderDragPath: string | null = null;
export let activeFileDragPaths: string[] | null = null;
export let activeFileDragName: string = "";

export function setActiveFolderDragPath(path: string | null): void {
  activeFolderDragPath = path;
}

export function setActiveFileDrag(paths: string[], name: string): void {
  activeFileDragPaths = paths;
  activeFileDragName  = name;
}

export function clearActiveFileDrag(): void {
  activeFileDragPaths = null;
  activeFileDragName  = "";
}
