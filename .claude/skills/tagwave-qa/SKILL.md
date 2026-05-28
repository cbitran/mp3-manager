---
name: tagwave-qa
description: QA checklist obrigatório para o TagWave — deve ser executado a cada entrega, para Mac e Windows, antes de qualquer commit/push/tag
---

# TagWave — QA Obrigatório

**REGRA ABSOLUTA:** Toda entrega passa por este checklist ANTES do push. Zero regressions toleradas.

---

## Como usar este checklist

1. Rodar `npm run tauri dev` (obrigatório — sem isso você vê versão antiga)
2. Passar por TODOS os grupos abaixo
3. Marcar ✅ ou ❌ para cada item
4. Só fazer push se todos os itens estiverem ✅

Para Windows: testar no CI após o push e verificar `gh run watch` até macOS + Windows passarem.

---

## Grupo 1 — Drag & Drop (crítico)

| # | Ação | Resultado esperado |
|---|------|--------------------|
| 1 | Arrastar **pasta** do Finder/Explorer externo para a **sidebar** | Overlay vermelho aparece → ao soltar, modal "Adicionar a…" abre |
| 2 | No modal "Adicionar a…" → clicar em **Biblioteca** | Pasta é scaneada e aparece na aba Bibliotecas |
| 3 | No modal "Adicionar a…" → clicar em **playlist existente** | Faixas adicionadas à playlist |
| 4 | No modal "Adicionar a…" → clicar em **Nova playlist** | CreatePlaylistModal abre; ao salvar, faixas vão para a nova playlist |
| 5 | Arrastar **faixas** da TrackTable para **playlist existente** na sidebar | Ghost de drag aparece; faixas adicionadas à playlist |
| 6 | Arrastar **faixas** da TrackTable para zona **"Nova playlist"** | CreatePlaylistModal abre com as faixas selecionadas |
| 7 | No FolderBrowser (Dispositivos), arrastar **pasta** para a **sidebar** | Overlay "Soltar para adicionar à biblioteca" → pasta adicionada à biblioteca |

## Grupo 2 — FolderBrowser / Dispositivos

| # | Ação | Resultado esperado |
|---|------|--------------------|
| 8 | Clicar num volume em Dispositivos | FolderBrowser abre mostrando o conteúdo do volume |
| 9 | No FolderBrowser, clicar numa pasta | Navega para dentro da pasta |
| 10 | No FolderBrowser, **duplo clique** numa pasta | Pasta adicionada como biblioteca (scanFolder) |
| 11 | No FolderBrowser, clicar em **"Carregar pasta X"** | Pasta adicionada como biblioteca |
| 12 | No FolderBrowser, **selecionar arquivos** individualmente | Checkboxes marcados, contador no botão atualiza |
| 13 | Selecionar arquivos → clicar **"Carregar N faixas"** | Modal "Adicionar a…" abre com as faixas |
| 14 | Shift+Click para selecionar range de arquivos | Range selecionado |
| 15 | Cmd+A (Mac) / Ctrl+A (Windows) | Todos os arquivos da pasta selecionados |

## Grupo 3 — Biblioteca e Scan

| # | Ação | Resultado esperado |
|---|------|--------------------|
| 16 | Clicar pasta na sidebar aba Bibliotecas | Faixas carregadas na TrackTable |
| 17 | Durante scan, verificar barra de progresso | Barra vermelha embaixo da pasta ativa |
| 18 | Botão "+" ou "Nova biblioteca" na aba Bibliotecas | Dialog de seleção de pasta abre |
| 19 | Remover pasta da sidebar (context menu ou Delete) | Faixas removidas, playlist associada limpa |

## Grupo 4 — Playlists

| # | Ação | Resultado esperado |
|---|------|--------------------|
| 20 | Botão "+" ou "Nova playlist" | CreatePlaylistModal abre |
| 21 | **Duplo clique** no nome de uma playlist | Campo de edição inline ativa |
| 22 | Delete com playlist ativa e sem seleção | Dialog de confirmação de exclusão |
| 23 | Sort Recente / A-Z na aba Playlists | Ordem muda corretamente |
| 24 | Context menu → Configurações | PlaylistSettingsModal abre |
| 25 | Playlist rules: ativar toggle | Campos (capa, álbum, gênero, comentário) aparecem |
| 26 | Salvar preset de regras | Preset aparece no dropdown |
| 27 | Carregar preset existente | Campos preenchidos com os valores do preset |
| 28 | Arrastar faixa para playlist com rules ativas | Regras aplicadas automaticamente à faixa |
| 29 | Badge laranja (●) aparece quando há regras pendentes | Visível no nome da playlist |

## Grupo 5 — Edição de Metadados

| # | Ação | Resultado esperado |
|---|------|--------------------|
| 30 | Clicar num campo editável na TrackTable | Input inline aparece |
| 31 | Selecionar múltiplas faixas → editar um campo | Todas as faixas selecionadas recebem o mesmo valor |
| 32 | Salvar tags → verificar no disco com outro app | Tags gravadas corretamente |

## Grupo 6 — Context Menus

| # | Ação | Resultado esperado |
|---|------|--------------------|
| 33 | Right-click em pasta da sidebar | Menu com: Abrir, Favoritar, Analisar BPM, Enriquecer, Renomear, Remover |
| 34 | Right-click em playlist | Menu com: Configurações, Abrir, Exportar, Renomear arquivos, Trocar capa, Deletar |
| 35 | Right-click em faixa na TrackTable | Context menu da faixa aparece |

## Grupo 7 — Dispositivos e Volumes

| # | Ação | Resultado esperado |
|---|------|--------------------|
| 36 | Conectar USB/SD card | Toast "Dispositivo X conectado — clique para adicionar à biblioteca" |
| 37 | Seção Dispositivos mostra volume conectado | Nome e ícone corretos |
| 38 | Botão ↗ no volume | Abre no Finder/Explorer |

## Grupo 8 — Updates

| # | Ação | Resultado esperado |
|---|------|--------------------|
| 39 | Versão nova disponível no GitHub | Modal de update aparece com changelog |

---

## Itens que NÃO devem acontecer (regressões proibidas)

- Toast "unsupported format" sem motivo
- Idioma trocando sozinho para inglês
- Loading/spinner infinito na inicialização
- Drag de faixas da TrackTable quebrando ao abrir FolderBrowser
- Overlay de drag do Finder desaparecendo antes do drop
- Qualquer funcionalidade existente parando de responder após adicionar feature nova

---

## Notas de plataforma

**Mac:**
- Cmd+A para selecionar tudo
- Finder para drag externo
- `npm run tauri dev` na raiz do projeto

**Windows:**
- Ctrl+A para selecionar tudo
- Explorer para drag externo
- Verificar CI: `gh run watch` após push — esperar macOS + Windows ✅
