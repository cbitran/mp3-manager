import { useState, useRef, useEffect, useCallback } from "react";
import { useAppStore, setAutoPlayOnLoad } from "../store";
import { invoke } from "@tauri-apps/api/core";
import { buildAiKnowledge } from "../helpContent";

// ── Knowledge base ─────────────────────────────────────────────────────────────
// As entradas abaixo derivadas do helpContent.ts são a fonte de verdade compartilhada
// com os Toolchips visuais. Entradas exclusivas do AI (contextuais, biblioteca ao vivo)
// ficam abaixo.

const KNOWLEDGE: Array<{ patterns: string[]; answer: string }> = [
  // Derivadas do helpContent (Toolchips → AI)
  ...buildAiKnowledge(),

  // ── Salvar / Auto-save (complementar — resposta mais rica) ──────────────────
  {
    patterns: ["salvar", "precisa salvar", "salvo automatico", "gravar", "preciso salvar", "toda hora salvar", "salva sozinho", "auto save", "autosave"],
    answer: "A biblioteca é salva automaticamente — você não precisa fazer nada. Mas as edições de tags (título, artista, álbum, gênero…) precisam ser confirmadas clicando em 'Salvar' no painel Inspector à direita, ou pressionando Enter em qualquer campo.",
  },

  // ── Editar metadados / tags ──────────────────────────────────────────────────
  {
    patterns: ["editar", "editar tag", "editar metadado", "mudar titulo", "mudar artista", "alterar nome", "alterar genero", "como edito", "inspector", "painel direito"],
    answer: "Clique em uma faixa para abrir o Inspector no painel direito. Lá você edita título, artista, álbum, gênero, ano, BPM e tom. Clique em 'Salvar Tags' no rodapé do Inspector para gravar as mudanças no arquivo.",
  },

  // ── Capa de álbum ───────────────────────────────────────────────────────────
  {
    patterns: ["capa", "album art", "cover", "adicionar capa", "foto", "imagem da musica", "artwork"],
    answer: "A capa pode ser adicionada de três formas: (1) via enriquecimento automático (busca no iTunes/Spotify), (2) arrastando uma imagem para o Inspector, ou (3) clicando no disco de vinil no Inspector → 'Escolher arquivo'. A capa é salva diretamente na tag ID3 do arquivo.",
  },

  // ── Abrir pasta ─────────────────────────────────────────────────────────────
  {
    patterns: ["abrir pasta", "abrir musica", "adicionar pasta", "como abro", "como adiciono", "importar pasta"],
    answer: "Clique no botão vermelho com ícone de pasta na barra superior (ou pressione ⌘O no Mac / Ctrl+O no Windows). Você também pode arrastar uma pasta diretamente para a sidebar.",
  },

  // ── Remover faixas ──────────────────────────────────────────────────────────
  {
    patterns: ["deletar", "remover", "excluir", "apagar", "como deleto", "tirar da biblioteca"],
    answer: "Selecione as faixas (clique para selecionar, ⌘+A para todas) e pressione Backspace ou Delete. Ou clique com botão direito → Remover da biblioteca. Isso apenas remove do TagWave — o arquivo no disco não é apagado.",
  },

  // ── Playlists ────────────────────────────────────────────────────────────────
  {
    patterns: ["playlist", "criar playlist", "como crio playlist", "como criar playlist", "lista de reproducao"],
    answer: "Selecione as faixas, clique com botão direito e escolha 'Criar Playlist'. No modal você nomeia a playlist e ela aparece na aba 'Playlists' na sidebar. Depois pode exportar para Serato, Rekordbox, Traktor, djay Pro ou Virtual DJ.",
  },

  // ── Adicionar à playlist existente ──────────────────────────────────────────
  {
    patterns: ["adicionar playlist", "adicionar na playlist", "colocar na playlist", "incluir playlist"],
    answer: "Selecione as faixas, clique com botão direito → 'Adicionar à playlist' e escolha a playlist no submenu. A playlist deve existir antes — se não existir, crie primeiro com 'Criar Playlist'.",
  },

  // ── BPM ─────────────────────────────────────────────────────────────────────
  {
    patterns: ["bpm", "analisar bpm", "como analiso bpm", "calcular bpm", "tempo", "batidas por minuto"],
    answer: "Clique em 'Analisar BPM' na barra de ferramentas para analisar todas as faixas. Para faixas específicas, selecione-as e clique com botão direito → Analisar BPM. A análise é local (offline), sem internet.",
  },

  // ── Enriquecimento ──────────────────────────────────────────────────────────
  {
    patterns: ["enriquecer", "metadados faltando", "como enriqueco", "genero faltando", "preencher automatico", "buscar informacoes", "spotify itunes"],
    answer: "O botão 'Enriquecer' usa iTunes e Spotify para preencher gênero, álbum, ano, BPM, tom e capa automaticamente. Funciona para faixas selecionadas ou para todas de uma vez. Precisa de conexão com a internet.",
  },

  // ── Exportar ────────────────────────────────────────────────────────────────
  {
    patterns: ["exportar", "exportar csv", "rekordbox", "traktor", "serato", "m3u", "como exporto", "export", "como exportar"],
    answer: "Para exportar, primeiro selecione as faixas (clique + Shift ou ⌘) OU escolha uma playlist na sidebar. Só então o botão 'Exportar' fica ativo na barra de ferramentas. Os formatos disponíveis são: Rekordbox XML, Traktor NML, M3U, Serato DJ, djay Pro, Virtual DJ e CSV.",
  },

  // ── Waveform ─────────────────────────────────────────────────────────────────
  {
    patterns: ["waveform", "onda", "forma de onda", "visualizacao de audio", "grafico de audio"],
    answer: "Cada faixa tem uma mini waveform na coluna 'Onda' da tabela. O player na parte inferior mostra a waveform interativa em tamanho real — clique em qualquer ponto para pular para aquele momento. A parte já tocada aparece mais brilhante.",
  },

  // ── Favoritos ────────────────────────────────────────────────────────────────
  {
    patterns: ["favoritos", "como favorito", "marcar favorito", "estrela", "faixa favorita"],
    answer: "Passe o mouse sobre uma faixa e clique na estrela (★) que aparece na primeira coluna. Veja seus favoritos pela aba 'Favoritos' na sidebar.",
  },

  // ── Rating / Nota ───────────────────────────────────────────────────────────
  {
    patterns: ["rating", "nota", "avaliacao", "dar nota", "1 a 5", "estrelas nota", "classificar"],
    answer: "Clique nas estrelas na coluna 'Nota' da tabela para dar uma classificação de 1 a 5 estrelas. A nota é salva diretamente na tag ID3 do arquivo. Clicar na mesma estrela remove a nota.",
  },

  // ── Buscar ───────────────────────────────────────────────────────────────────
  {
    patterns: ["buscar", "pesquisar", "como busco", "procurar musica", "pesquisa", "encontrar"],
    answer: "Use a barra de busca na barra de ferramentas (ícone de lupa). Ela pesquisa em título, artista, álbum, gênero, BPM, tom e nome do arquivo ao mesmo tempo. Pressione ⌘+F para abrí-la rápido.",
  },

  // ── Configurações ────────────────────────────────────────────────────────────
  {
    patterns: ["configuracoes", "settings", "apikey", "api", "chave api", "spotify key", "discogs", "acoustid"],
    answer: "Abra as Configurações pelo ícone de engrenagem na barra de ferramentas (ou ⌘+,). Lá você configura: chaves de API (Spotify, Discogs, AcoustID, Last.fm), tema, software DJ padrão e atalhos de teclado.",
  },

  // ── Atalhos de teclado ───────────────────────────────────────────────────────
  {
    patterns: ["atalho", "shortcut", "teclado", "tecla", "keyboard", "comandos"],
    answer: "Atalhos principais: Space (play/pause), ← → (faixa anterior/próxima), ⌘O (abrir pasta), ⌘K (este assistente), ⌘+, (configurações). Veja e edite todos os atalhos em Configurações.",
  },

  // ── Tom / Camelot ────────────────────────────────────────────────────────────
  {
    patterns: ["tom", "key", "camelot", "harmonic", "compativel", "harmonicamente"],
    answer: "O TagWave exibe o tom na notação Camelot colorida. Quando você seleciona uma faixa, faixas harmonicamente compatíveis ficam com o badge verde na coluna 'Tom'. O enriquecimento via Spotify pode preencher o tom automaticamente.",
  },

  // ── Duplicatas ───────────────────────────────────────────────────────────────
  {
    patterns: ["duplicata", "duplicado", "arquivos iguais", "arquivo repetido"],
    answer: "O TagWave detecta duplicatas ao escanear pastas. Uma notificação aparece quando encontra arquivos com mesmo conteúdo. Você pode ver os grupos de duplicatas e decidir quais manter.",
  },

  // ── Filtros avançados ────────────────────────────────────────────────────────
  {
    patterns: ["filtrar", "filtro avancado", "filtrar bpm", "filtrar genero", "filtrar ano", "filtro", "filtrar tom"],
    answer: "Use o botão de funil na barra de ferramentas para filtros avançados: BPM mínimo/máximo, intervalo de ano e tom musical. Clicar em um gênero na coluna 'Gênero' também filtra automaticamente.",
  },

  // ── Trial / Licença ──────────────────────────────────────────────────────────
  {
    patterns: ["trial", "licenca", "comprar", "expirou", "pagar", "ativar", "chave de ativacao"],
    answer: "O TagWave tem 14 dias de trial completo, sem limitações. Após expirar, insira sua chave de licença em Configurações → 'Ativar Licença'. Para obter uma chave, clique em 'Obter Licença' na barra de ferramentas.",
  },

  // ── Colunas ──────────────────────────────────────────────────────────────────
  {
    patterns: ["colunas", "esconder coluna", "mostrar coluna", "coluna picker", "reorganizar coluna"],
    answer: "Clique no ícone de grade (⊞) na barra de ferramentas para mostrar/esconder colunas individualmente. Para reordenar, arraste o cabeçalho da coluna para a posição desejada.",
  },

  // ── Normalizar tags ──────────────────────────────────────────────────────────
  {
    patterns: ["normalizar", "normalizar tags", "encoding", "acento errado", "caractere especial", "texto corrompido"],
    answer: "O botão 'Normalizar Tags' corrige problemas de encoding em tags ID3 (acentos, cedilha, caracteres especiais corrompidos). Funciona em todas as faixas da biblioteca de uma vez.",
  },

  // ── Formatos suportados ──────────────────────────────────────────────────────
  {
    patterns: ["formato", "flac", "wav", "aiff", "m4a", "ogg", "wma", "mp4", "formatos suportados", "tipo de arquivo"],
    answer: "O TagWave suporta: MP3, FLAC, AIFF, WAV, M4A, OGG, Opus, WMA, MP4 e MKV. Arquivos de vídeo (MP4/MKV) abrem no player nativo do sistema.",
  },

  // ── Offline ──────────────────────────────────────────────────────────────────
  {
    patterns: ["offline", "internet", "sem conexao", "funciona sem internet", "precisa de internet"],
    answer: "O TagWave funciona completamente offline: escaneamento, player, waveform, BPM e edição de tags. Apenas o enriquecimento de metadados (iTunes/Spotify) e AcoustID precisam de internet. Um aviso aparece automaticamente se você tentar enriquecer sem conexão.",
  },

  // ── Novas faixas / detecção automática ──────────────────────────────────────
  {
    patterns: ["novas musicas", "musicas novas", "arquivo novo", "deteccao automatica", "novas faixas", "adicionou musica na pasta"],
    answer: "O TagWave detecta automaticamente músicas adicionadas às suas pastas monitoradas. Quando você abre o app, um modal aparece com as novas faixas encontradas — você pode adicioná-las e enriquecê-las de uma vez.",
  },

  // ── Sidebar ──────────────────────────────────────────────────────────────────
  {
    patterns: ["sidebar", "painel esquerdo", "aba", "recentes", "navegacao", "pastas monitoradas"],
    answer: "A sidebar à esquerda tem 3 abas: Recentes (pastas abertas recentemente), Favoritos (faixas marcadas com ★) e Playlists (playlists salvas). Você pode redimensioná-la arrastando a borda direita.",
  },

  // ── Subpastas ────────────────────────────────────────────────────────────────
  {
    patterns: ["subpasta", "pasta dentro de pasta", "recursivo", "subdiretorio", "pasta aninhada"],
    answer: "O scan de pasta é recursivo — o TagWave encontra automaticamente todas as músicas dentro de subpastas, sem limite de profundidade. Subpastas aparecem como itens expansíveis na sidebar.",
  },

  // ── Temas ────────────────────────────────────────────────────────────────────
  {
    patterns: ["tema", "dark", "light", "claro", "escuro", "modo escuro", "aparencia", "cor da interface"],
    answer: "Vá em Configurações → Tema. As opções são: Escuro (dark), Claro (light) e Automático (segue a preferência do macOS).",
  },

  // ── Player / Tocar ───────────────────────────────────────────────────────────
  {
    patterns: ["como toco", "tocar musica", "play", "reproduzir", "iniciar musica", "dar play"],
    answer: "Dê duplo-clique em qualquer faixa na tabela para tocar. Você também pode selecionar a faixa e pressionar Space, ou clicar com botão direito → Tocar.",
  },

  // ── Próxima / anterior ───────────────────────────────────────────────────────
  {
    patterns: ["proxima", "anterior", "skip", "pular faixa", "avancar", "voltar faixa"],
    answer: "Use as setas ← → no teclado para pular entre faixas. No player na parte inferior há também os botões ⏮ ⏭ para navegar.",
  },

  // ── Volume ───────────────────────────────────────────────────────────────────
  {
    patterns: ["volume", "aumentar volume", "diminuir volume", "mudo", "silenciar", "controle de volume"],
    answer: "Clique no ícone de volume no player (canto inferior direito) para ajustar. Um popup vertical aparece para controle fino do volume.",
  },

  // ── Limpeza de filenames ─────────────────────────────────────────────────────
  {
    patterns: ["renomear", "limpeza de nome", "filename", "nome do arquivo", "underscore", "prefixo numerico", "limpar nome"],
    answer: "O TagWave detecta automaticamente filenames sujos (underscores, prefixos numéricos, parênteses com caracteres estranhos) e oferece uma limpeza com preview antes/depois. Acesse via botão 'Limpar Nomes' ou clique com botão direito em faixas selecionadas.",
  },

  // ── Quantas faixas ───────────────────────────────────────────────────────────
  {
    patterns: ["quantas", "total de faixas", "quantos arquivos", "tamanho da biblioteca", "gb", "horas"],
    answer: `Sua biblioteca tem ${0} faixas — mas vou buscar o número real:`,
  },

  // ── O que é o TagWave ────────────────────────────────────────────────────────
  {
    patterns: ["o que e tagwave", "o que e isso", "para que serve", "funcionalidades", "overview", "sobre o tagwave"],
    answer: "O TagWave é um gerenciador de biblioteca musical para DJs e produtores. Principais recursos: scan e organização de arquivos de áudio, edição de tags ID3, análise de BPM, enriquecimento automático de metadados (iTunes/Spotify), waveform interativa, playlists e exportação para Serato, Rekordbox, Traktor e djay Pro.",
  },

  // ── AI Assistant ─────────────────────────────────────────────────────────────
  {
    patterns: ["assistente", "ai", "chat", "como uso o assistente", "o que voce faz"],
    answer: "Posso responder dúvidas sobre como usar o TagWave, buscar músicas na sua biblioteca ('encontre [nome]'), tocar uma faixa ('tocar [nome]') e explicar qualquer funcionalidade do app. É só perguntar!",
  },

  // ── TagWave Pro ───────────────────────────────────────────────────────────────
  {
    patterns: ["tagwave pro", "versao pro", "pro plan", "plano pro", "upgrade", "obter pro", "ativar pro", "chave pro"],
    answer: "O TagWave Pro ($69, pagamento único) desbloqueia três recursos avançados: (1) AcoustID Fingerprinting — identifica faixas sem tag por impressão digital de áudio; (2) Filename → Tag — extrai metadados do nome do arquivo usando padrões customizáveis; (3) Editor de Tags Avançadas — visualiza e edita todos os campos ocultos de qualquer faixa. Para ativar, clique em qualquer botão PRO na toolbar ou vá em Configurações → Licença.",
  },

  // ── AcoustID ─────────────────────────────────────────────────────────────────
  {
    patterns: ["acoustid", "fingerprint", "impressao digital", "identificar faixa", "musica sem tag", "identificacao automatica", "reconhecer musica", "id button"],
    answer: "O AcoustID Fingerprinting (recurso Pro) analisa o áudio de cada faixa e consulta o banco de dados global AcoustID para identificar a música, mesmo que não tenha nenhum metadado. Clique no botão 'ID' na toolbar. Funciona em lote — você pode identificar 50 faixas de uma vez e aplicar os metadados encontrados com um clique.",
  },

  // ── Filename → Tag ────────────────────────────────────────────────────────────
  {
    patterns: ["filename tag", "nome do arquivo tag", "extrair do nome", "nome para tag", "formato nome", "pattern nome", "arquivo para metadado", "nome para metadado"],
    answer: "O recurso Filename → Tag (Pro) extrai metadados do nome do arquivo usando padrões. Por exemplo: se seus arquivos se chamam 'Artista - Título.mp3', você define o padrão '%artist% - %title%' e o TagWave preenche os campos automaticamente em todas as faixas. Clique no botão 'Nome→Tag' (ou 'File→Tag') na toolbar. Há um preview das primeiras 8 faixas antes de aplicar.",
  },

  // ── Extended Tags ─────────────────────────────────────────────────────────────
  {
    patterns: ["tags avancadas", "tags ocultas", "campos ocultos", "extended tags", "tags serato", "tags rekordbox", "ver todos campos", "campo customizado", "id3 completo"],
    answer: "O Editor de Tags Avançadas (Pro) mostra TODOS os campos ID3 de um arquivo, incluindo dados internos do Serato, rekordbox e campos customizados. Você pode editar qualquer campo, deletar campos indesejados ou adicionar novos. Acesse clicando com botão direito em uma faixa → 'Tags avançadas', ou pelo botão 'Tags+' na toolbar.",
  },

  // ── Playlists hierárquicas ────────────────────────────────────────────────────
  {
    patterns: ["playlist mae", "playlist filha", "subplaylist", "playlist hierarquica", "aninhar playlist", "pasta de playlist", "playlist dentro de playlist", "hierarquia playlist"],
    answer: "O TagWave suporta playlists hierárquicas com dois níveis. Uma playlist Mãe funciona como pool mestre — tudo que você adiciona a uma playlist Filha vai automaticamente para a Mãe. Se remover uma faixa da Filha, ela permanece na Mãe. Para criar uma Filha: clique com botão direito em uma playlist → 'Criar subplaylist aqui'. Para aninhar uma playlist existente: arraste-a (pelo ícone de 6 pontos que aparece ao passar o mouse) sobre outra playlist.",
  },

  // ── Arrastar playlist ─────────────────────────────────────────────────────────
  {
    patterns: ["arrastar playlist", "mover playlist", "reorganizar playlist", "drag playlist", "aninhar playlist drag", "colocar dentro de outra"],
    answer: "Para aninhar uma playlist dentro de outra (criar hierarquia), passe o mouse sobre ela na sidebar — um ícone de 6 pontos (⠿) aparece à esquerda. Arraste esse ícone e solte sobre a playlist que deve ser a Mãe. O contorno laranja indica quando a Mãe está pronta para receber. Para desfazer, clique com botão direito → 'Remover da pasta'.",
  },

  // ── Playlist Rules ────────────────────────────────────────────────────────────
  {
    patterns: ["regras de playlist", "playlist rules", "propriedades globais", "aplicar automaticamente", "capa automatica", "genero automatico", "preset playlist"],
    answer: "As Playlist Rules definem metadados que são aplicados automaticamente a cada faixa adicionada à playlist. Acesse via botão direito na playlist → Configurações. Você pode definir capa, álbum, gênero e comentário. Ao arrastar faixas para a playlist, os campos ativos são aplicados automaticamente. Você pode salvar as regras como Preset para reutilizar em outras playlists.",
  },

  // ── Tema sol/lua ──────────────────────────────────────────────────────────────
  {
    patterns: ["mudar tema", "trocar tema", "sol lua", "botao tema", "alternar tema", "tema rapido", "claro escuro rapido"],
    answer: "Para trocar o tema rapidamente, clique no ícone de sol (☀) ou lua (☽) na barra de ferramentas, ao lado do ícone de engrenagem. Cada clique alterna entre tema Claro e Escuro. Para mais opções (incluindo Automático), vá em Configurações → Aparência.",
  },

  // ── Drag & Drop do Finder ─────────────────────────────────────────────────────
  {
    patterns: ["arrastar finder", "arrastar arquivo", "drag drop arquivo", "soltar arquivo", "drop arquivo", "jogar arquivo"],
    answer: "Você pode arrastar arquivos de áudio diretamente do Finder (Mac) ou Explorer (Windows) para a janela do TagWave. Um modal aparecerá perguntando se você quer adicionar à Biblioteca, a uma Playlist existente ou criar uma Nova Playlist com essas faixas.",
  },

  // ── Dispositivos / Volumes ────────────────────────────────────────────────────
  {
    patterns: ["dispositivo", "usb", "pendrive", "hd externo", "volume", "sd card", "ssd externo", "disco externo"],
    answer: "Na seção 'Dispositivos' no fundo da sidebar, o TagWave lista automaticamente todos os volumes conectados (HD externo, pendrive, cartão SD). Clique num volume para navegar pelos arquivos. Quando você conecta um novo dispositivo, um toast aparece com opção de adicionar à biblioteca.",
  },

  // ── Hotkeys CUE ───────────────────────────────────────────────────────────────
  {
    patterns: ["cue points", "pontos cue", "hot cue", "marcadores", "cue editor", "ponto de entrada", "loop point"],
    answer: "O TagWave tem um editor completo de CUE Points estilo Serato. Clique no botão CUE na waveform do player para abrir o editor. Você pode adicionar até 8 hot cues coloridos, ajustar com precisão de milissegundos, usar Quantize para snap automático no beat, e salvar o Beat Grid. Os CUE Points são compatíveis com Serato (MP3/AIFF) e salvos em sidecar JSON para outros formatos.",
  },

  // ── Normalização de volume ────────────────────────────────────────────────────
  {
    patterns: ["volume diferente", "musicas com volume diferente", "normalizar volume", "replaygain", "volume igual", "equalizar volume"],
    answer: "O TagWave não aplica normalização de volume (ReplayGain) automaticamente — isso preserva a intenção artística de cada faixa. Para equalizar volumes no mix, use o controle de volume do player ou o recurso de normalização do seu software DJ.",
  },

  // ── LibraryStats ──────────────────────────────────────────────────────────────
  {
    patterns: ["estatisticas", "cobertura de metadata", "top generos", "biblioteca stats", "quantas horas", "total gb", "cobertura"],
    answer: "O painel direito tem uma aba 'Biblioteca' com estatísticas completas: cobertura de metadados (% de faixas com título, artista, gênero, BPM, capa), top 5 gêneros clicáveis (clique para filtrar a tabela por gênero), total de horas e tamanho em GB da biblioteca.",
  },
];

// ── Intenções conversacionais ────────────────────────────────────────────────
// Respostas com variação para soar mais natural (pick aleatório).

const CONV: Array<{ patterns: RegExp; replies: string[] }> = [
  {
    patterns: /\b(oi|ola|boa\s?tarde|boa\s?noite|bom\s?dia|hey|hello|hi)\b/,
    replies: [
      "Olá! Como posso te ajudar hoje?",
      "Oi! O que você precisa saber sobre o TagWave?",
      "Olá! Pode perguntar à vontade.",
    ],
  },
  {
    patterns: /\b(tenho\s+uma?\s+(pergunta|d[uú]vida)|quero\s+perguntar|posso\s+perguntar|pode\s+me\s+ajudar|preciso\s+de\s+ajuda|me\s+ajuda)\b/,
    replies: [
      "Claro! O que você quer saber?",
      "Pode perguntar, estou aqui!",
      "Com certeza! Me conta o que precisa.",
      "Ótimo, pode falar!",
    ],
  },
  {
    patterns: /\b(obrigad[ao]|valeu|muito\s+obrigad[ao]|thanks|brigad[ao])\b/,
    replies: [
      "De nada! Se precisar de mais alguma coisa, é só falar.",
      "Por nada! Qualquer dúvida, estou aqui.",
      "Disponha! Pode perguntar sempre que quiser.",
    ],
  },
  {
    patterns: /\b(tudo\s+bem|tudo\s+bom|como\s+vai|como\s+voce\s+esta|beleza)\b/,
    replies: [
      "Tudo ótimo! E você? Posso te ajudar com algo no TagWave?",
      "Bem, obrigado! O que posso fazer por você?",
    ],
  },
  {
    patterns: /\b(o\s+que\s+voce\s+(sabe|faz|pode)|o\s+que\s+voce\s+e|quem\s+e\s+voce|se\s+apresenta)\b/,
    replies: [
      "Sou o assistente do TagWave! Posso ajudar com: buscar músicas na biblioteca, explicar funcionalidades, responder dúvidas sobre tags, BPM, playlists, exportação e muito mais. O que precisa?",
      "Sou o assistente virtual do TagWave. Sei responder perguntas sobre o app, buscar faixas na sua biblioteca ('encontre [nome]') e tocar músicas ('tocar [nome]'). Pode perguntar!",
    ],
  },
  {
    patterns: /\b(nao\s+entendi|como\s+assim|pode\s+explicar|explica\s+de\s+novo|nao\s+ficou\s+claro)\b/,
    replies: [
      "Desculpe! Pode me dizer com mais detalhes o que você quer saber?",
      "Vou tentar explicar melhor. Qual é a sua dúvida específica?",
    ],
  },
  {
    patterns: /\b(legal|bacana|otimo|perfeito|certo|entendi|ok|blz|show)\b/,
    replies: [
      "Ótimo! Se surgir mais alguma dúvida, é só perguntar.",
      "Que bom! Estou aqui se precisar.",
      "Show! Alguma outra coisa em que posso ajudar?",
    ],
  },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Detecção de plataforma e adaptação de atalhos ────────────────────────────
const IS_MAC = typeof navigator !== "undefined" &&
  (navigator.platform.toLowerCase().includes("mac") ||
   navigator.userAgent.toLowerCase().includes("mac os"));

function adaptShortcuts(text: string): string {
  if (IS_MAC) return text;
  return text
    .replace(/⌘\+/g, "Ctrl+")
    .replace(/⌘/g, "Ctrl");
}

// ── Fuzzy matching ────────────────────────────────────────────────────────────

function normalize(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\s]/g, " ");
}

function score(query: string, target: string): number {
  const q = normalize(query);
  const t = normalize(target);
  if (t.includes(q)) return 1;
  const words = q.split(/\s+/).filter(Boolean);
  const matches = words.filter((w) => w.length > 2 && t.includes(w));
  return matches.length / Math.max(words.length, 1);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  text: string;
  tracks?: Array<{ id: string; title: string; artist: string; path: string }>;
}

// ── TagWave chat bubble icon ──────────────────────────────────────────────────
// Donut (logo) com cauda de balão de conversa no canto inferior esquerdo.
// fillRule="evenodd" cria o buraco central.

function TagWaveBubbleIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={Math.round(size * 26 / 22)}
      viewBox="0 0 22 26"
      fill="none"
    >
      <path
        fillRule="evenodd"
        d="M6 18.5A9 9 0 1 1 11 20L3 25Z M11 6A5 5 0 1 1 10.999 6Z"
        fill="currentColor"
      />
    </svg>
  );
}

// ── Constantes de sessão ─────────────────────────────────────────────────────

const WELCOME: Message = {
  role: "assistant",
  text: "Olá! Sou o assistente do TagWave 🎵 Posso ajudá-lo a encontrar músicas, explicar funcionalidades ou responder dúvidas. O que precisa?",
};
const INACTIVITY_MS = 5 * 60 * 1000; // 5 min fechado → limpa histórico ao reabrir

// ── Component ─────────────────────────────────────────────────────────────────

export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [listening, setListening] = useState(false);
  const [bouncing, setBouncing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recogRef = useRef<any>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allTracks = useAppStore((s) => s.tracks);
  const setPlayerTrack = useAppStore((s) => s.setPlayerTrack);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  // Keyboard shortcut: ⌘+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Timer de inatividade: fecha por 5 min → limpa histórico ao reabrir
  useEffect(() => {
    if (open) {
      // Abriu: cancela o timer de limpeza (usuário está ativo)
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    } else {
      // Fechou: inicia contagem regressiva de 5 min
      inactivityTimerRef.current = setTimeout(() => {
        setMessages([WELCOME]);
        setInput("");
        inactivityTimerRef.current = null;
      }, INACTIVITY_MS);
    }
    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, [open]);

  // Bounce periódico para chamar atenção: pulsa a cada 20–30s quando fechado
  useEffect(() => {
    if (open) return;
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timeout = setTimeout(() => {
        setBouncing(true);
        setTimeout(() => setBouncing(false), 900);
        schedule();
      }, 20000 + Math.random() * 10000);
    };
    schedule();
    return () => clearTimeout(timeout);
  }, [open]);

  const processQuery = useCallback((query: string): Message => {
    const q = normalize(query);

    // Intent: conversational / social
    for (const { patterns, replies } of CONV) {
      if (patterns.test(q)) {
        return { role: "assistant", text: pick(replies) };
      }
    }

    // Intent: find song
    const findMatch = query.match(/(?:encontr|achar?|buscar?|procurar?|onde.*é|find|search|onde está)\s+(.+)/i);
    if (findMatch) {
      const term = findMatch[1].trim();
      const results = allTracks
        .map((t) => ({
          track: t,
          score: Math.max(
            score(term, t.title ?? ""),
            score(term, t.artist ?? ""),
            score(term, t.filename),
          ),
        }))
        .filter((r) => r.score > 0.4)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      if (results.length === 0) {
        return { role: "assistant", text: `Não encontrei nenhuma faixa com "${term}" na biblioteca atual. Tente buscar pelo nome do arquivo ou artista.` };
      }
      return {
        role: "assistant",
        text: `Encontrei ${results.length} faixa${results.length !== 1 ? "s" : ""} relacionada${results.length !== 1 ? "s" : ""} a "${term}":`,
        tracks: results.map((r) => ({
          id: r.track.id,
          title: r.track.title ?? r.track.filename,
          artist: r.track.artist ?? "",
          path: r.track.path,
        })),
      };
    }

    // Intent: play song
    const playMatch = query.match(/(?:tocar?|play|reproduzir?)\s+(.+)/i);
    if (playMatch) {
      const term = playMatch[1].trim();
      const result = allTracks
        .map((t) => ({
          track: t,
          score: Math.max(score(term, t.title ?? ""), score(term, t.artist ?? ""), score(term, t.filename)),
        }))
        .filter((r) => r.score > 0.5)
        .sort((a, b) => b.score - a.score)[0];
      if (result) {
        setAutoPlayOnLoad();
        setPlayerTrack(result.track.id);
        return { role: "assistant", text: `Tocando: ${result.track.title ?? result.track.filename}${result.track.artist ? ` — ${result.track.artist}` : ""}` };
      }
      return { role: "assistant", text: `Não encontrei a faixa "${term}" para tocar.` };
    }

    // Intent: how many tracks
    if (q.includes("quantas") || q.includes("total de faixa") || q.includes("quantos")) {
      return { role: "assistant", text: `Sua biblioteca atual tem ${allTracks.length} faixa${allTracks.length !== 1 ? "s" : ""}.` };
    }

    // Intent: show in finder
    if (q.includes("finder") || q.includes("explorer") || (q.includes("pasta") && q.includes("abrir"))) {
      return { role: "assistant", text: "Para revelar um arquivo no Finder/Explorer, clique com botão direito na faixa e escolha 'Revelar no Finder'." };
    }

    // Knowledge base
    let bestAnswer: string | null = null;
    let bestScore = 0;
    for (const entry of KNOWLEDGE) {
      for (const pattern of entry.patterns) {
        const s2 = score(pattern, query) * 0.5 + score(query, pattern) * 0.5;
        if (s2 > bestScore && s2 > 0.3) {
          bestScore = s2;
          // Substituir placeholder de quantas faixas
          bestAnswer = entry.answer.replace("${0}", String(allTracks.length));
        }
      }
    }
    if (bestAnswer) return { role: "assistant", text: bestAnswer };

    // Fallback
    const fallbacks = [
      "Hmm, não entendi bem. Pode reformular com mais detalhes?",
      "Não tenho certeza do que você quis dizer. Tente ser mais específico!",
      "Não encontrei nada sobre isso. Tente perguntar de outro jeito — por exemplo: 'como edito uma tag?' ou 'encontre [nome da música]'.",
    ];
    return { role: "assistant", text: pick(fallbacks) };
  }, [allTracks, setPlayerTrack]);

  const send = useCallback(() => {
    const q = input.trim();
    if (!q) return;
    const userMsg: Message = { role: "user", text: q };
    const reply = processQuery(q);
    const adapted = { ...reply, text: adaptShortcuts(reply.text) };
    setMessages((prev) => [...prev, userMsg, adapted]);
    setInput("");
  }, [input, processQuery]);

  const startListening = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert("Reconhecimento de voz não disponível neste ambiente.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new SpeechRec();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const text: string = e.results[0]?.[0]?.transcript ?? "";
      if (text) setInput((prev) => prev + (prev ? " " : "") + text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recogRef.current = rec;
    rec.start();
    setListening(true);
  };

  const stopListening = () => {
    recogRef.current?.stop();
    setListening(false);
  };

  return (
    <>
      {/* Floating button — maior, com ícone de balão usando a logo donut */}
      <button
        data-help="ai-assistant"
        onClick={() => { setOpen((v) => !v); setBouncing(false); }}
        title="Assistente TagWave (⌘K)"
        className={`fixed bottom-[68px] right-4 z-[300] w-12 h-12 rounded-full shadow-xl flex items-center justify-center transition-all duration-200 ${
          open
            ? "bg-[#D95340] text-white scale-95"
            : "bg-[#1c1715] border border-white/[0.15] text-[#D95340] hover:bg-[#251a18] hover:scale-105 hover:shadow-[0_0_16px_rgba(217,83,64,0.25)]"
        } ${bouncing && !open ? "animate-ai-bounce" : ""}`}
      >
        {open ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/>
          </svg>
        ) : (
          <TagWaveBubbleIcon size={24} />
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-[124px] right-4 z-[299] w-[320px] rounded-xl shadow-2xl flex flex-col overflow-hidden bg-[#1c1715] border border-white/[0.08]"
          style={{ maxHeight: "420px" }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
            <TagWaveBubbleIcon size={14} />
            <p className="text-[12px] font-semibold text-[#F5F5F4] flex-1">Assistente TagWave</p>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-[#C97B40]/20 border border-[#C97B40]/40 text-[#C97B40]">
              {IS_MAC ? "⌘K" : "Ctrl+K"}
            </span>
          </div>

          {/* Messages */}
          <div ref={messagesRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2" style={{ minHeight: 0 }}>
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={`rounded-xl px-3 py-2 text-[12px] leading-relaxed max-w-[90%] ${
                    msg.role === "user"
                      ? "bg-[#D95340]/20 text-[#F5F5F4] rounded-br-sm"
                      : "bg-white/[0.04] text-[#C2BEBC] rounded-bl-sm"
                  }`}
                >
                  {msg.text}
                </div>
                {msg.tracks && msg.tracks.length > 0 && (
                  <div className="mt-1 w-full space-y-1">
                    {msg.tracks.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05] cursor-pointer hover:bg-white/[0.07] transition-colors group"
                        onClick={() => {
                          setAutoPlayOnLoad();
                          setPlayerTrack(t.id);
                          useAppStore.getState().selectOnly(t.id);
                        }}
                      >
                        <svg width="9" height="9" viewBox="0 0 9 9" fill="#D95340" className="shrink-0 opacity-60 group-hover:opacity-100">
                          <path d="M1 0.5l7 4-7 4V0.5z"/>
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium text-[#C2BEBC] truncate">{t.title}</p>
                          {t.artist && <p className="text-[10px] text-[#605A55] truncate">{t.artist}</p>}
                        </div>
                        <button
                          className="shrink-0 text-[9px] text-[#4C4743] hover:text-[#8F8883] transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            invoke("reveal_in_finder", { path: t.path }).catch(() => {});
                          }}
                          title={IS_MAC ? "Revelar no Finder" : "Revelar no Explorer"}
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                            <path d="M1 1h8v8H1V1zm1 1v6h6V2H2zm1 1h4v4H3V3z"/>
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="flex items-center gap-1.5 px-2 py-2 border-t border-white/[0.06]">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Pergunte algo…"
              className="flex-1 px-2.5 py-1.5 rounded-lg text-[12px] text-[#C2BEBC] placeholder-[#4C4743] focus:outline-none bg-white/[0.04] border border-white/[0.07]"
            />
            <button
              onClick={listening ? stopListening : startListening}
              title={listening ? "Parar microfone" : "Falar"}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                listening
                  ? "bg-[#D95340]/30 text-[#D95340]"
                  : "text-[#605A55] hover:text-[#8F8883] hover:bg-white/[0.05]"
              }`}
            >
              <svg width="11" height="13" viewBox="0 0 11 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="0.5" width="5" height="7" rx="2.5"/>
                <path d="M1 6.5a4.5 4.5 0 009 0"/>
                <line x1="5.5" y1="11" x2="5.5" y2="12.5"/>
              </svg>
              {listening && (
                <span className="absolute w-2 h-2 rounded-full bg-[#D95340] top-1 right-1 animate-ping" />
              )}
            </button>
            <button
              onClick={send}
              disabled={!input.trim()}
              className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#D95340] hover:bg-[#E07364] disabled:opacity-30 transition-colors shrink-0"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="white">
                <path d="M0.5 5L9.5 0.5L5 5L9.5 9.5L0.5 5Z"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
