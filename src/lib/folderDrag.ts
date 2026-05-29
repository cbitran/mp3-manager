// Estado global de drag de pasta (FolderBrowser → Sidebar).
// Usar variável de módulo ao invés de dataTransfer.getData() que
// tem comportamento inconsistente no WebKit/WKWebView (Tauri).
export let activeFolderDragPath: string | null = null;

export function setActiveFolderDragPath(path: string | null): void {
  activeFolderDragPath = path;
}
