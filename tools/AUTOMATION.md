# Automação — Camada 1 (manutenção + curadoria)

Três scripts Node, sem npm, sem dependência, sem serviço pago, sem chave de API.
Rodam na sua máquina com o Node que já existe (v24). Nenhum deles publica nada.

```bash
node tools/doctor.js            # varredura completa (inclui links externos)
node tools/doctor.js --offline  # sem rede: assets, metadata, catálogo, sitemap
node tools/doctor.js --quick    # só catálogo + assets + metadata
node tools/ingest.js            # atualiza a fila de pautas
node tools/ingest.js --show     # imprime a fila de hoje
node tools/build-sitemap.js     # regenera sitemap.xml a partir do catálogo
```

## `doctor.js` — o que ele pega sozinho

| Checagem | Erro quando |
|---|---|
| `asset-missing` | arquivo referenciado em HTML/DB não existe no disco |
| `asset-not-image` | `.jpg`/`.png` que na verdade é HTML salvo (foi assim que o `toyman_cover.jpg` quebrou) |
| `internal-link` / `anchor` | link interno não resolve, âncora sem alvo |
| `date-rot` | data relativa tipo "2 HOURS AGO" no catálogo |
| `meta-*` | página sem title/description/canonical/og:image/favicon; 404 sem `noindex` |
| `a11y-input` | `<input>` sem label |
| `sitemap-drift` | artigo publicado ausente do sitemap |
| `repetition` | dois artigos publicados abrindo com as mesmas palavras, ou com o mesmo padrão rítmico |
| `orphan` | artigo que nenhuma página linka |
| `affiliate` | link Amazon/Audible sem `tag=`, ou tags inconsistentes entre si |
| `placeholder-copy` | texto de rascunho visível ao público (ex.: o bloco "ADVERTISEMENT // …") |
| `external-broken` | link externo devolvendo 404/500 |
| `external-blocked` | 401/403/406/429 — provável bloqueio a robô, abre manualmente (aviso, não erro) |

Saída: console + `tools/reports/AAAA-MM-DD.md`. Código de saída `1` quando há erro — é isso que o agendador usa para saber que algo mudou.

## `ingest.js` — de onde vêm as pautas

12 feeds públicos gratuitos (Publishers Weekly, Reactor, Guardian SF, Publishing Perspectives, SFWA, Ars Technica, The Verge, Hacker News, Science Daily, Phys.org, Space.com). Nenhum exige cadastro.

Cada item é pontado pelos vocabulários dos 5 pilares, descartado se parecer tema já publicado, deduplicado por título e limitado a 8 pautas por fonte. O resultado vai para:

- `pipeline/leads/AAAA-MM-DD.json` — estrutura para consumo por script
- `pipeline/leads/AAAA-MM-DD.md` — a mesma fila legível, com pilar, registro sugerido e url
- `pipeline/state/seen.json` — URLs já vistas (últimas 4000), para a fila não repetir amanhã

Cada pauta traz `pillar`, `register` e `fit`. Isso é o insumo da Camada 2: quando você quiser escrever, a pauta já vem com o encaixe editorial decidido — mas a decisão de escrever continua sua.

O que o `ingest.js` **não** faz: não acessa a Amazon, não verifica preço, não confirma fato, não escreve.

## Agendar no Windows (uma vez, sem instalar nada)

Abrir o PowerShell e rodar (troque o caminho se o projeto mudar de lugar):

```powershell
schtasks /Create /TN "HomeworldPress Doctor" /SC DAILY /ST 08:00 `
  /TR "cmd /c cd /d ""C:\Users\Yury\Documents\Projetos Yury\Site HOMEWORLDPRESS.COM"" && node tools\doctor.js > tools\reports\last-doctor.txt 2>&1"
schtasks /Create /TN "HomeworldPress Ingest" /SC DAILY /ST 08:10 `
  /TR "cmd /c cd /d ""C:\Users\Yury\Documents\Projetos Yury\Site HOMEWORLDPRESS.COM"" && node tools\ingest.js > tools\reports\last-ingest.txt 2>&1"
```

Para testar na hora, sem esperar as 8h: `schtasks /Run /TN "HomeworldPress Doctor"`.
Para desfazer: `schtasks /Delete /TN "HomeworldPress Doctor" /F`.

Depois disso, a manutenção e a curadoria rodam todo dia sem você abrir nada. Você só lê `tools/reports/` quando algo falha e `pipeline/leads/` quando quiser publicar.

## Publicação de posts (Camada 2)

Quatro comandos. O passo de escrever o texto pode ser seu (colar `prompt.md` no chat) ou do robô agendado (Camada 3):

```bash
node tools/ingest.js                 # fila de pautas (camada 1)
node tools/new-post.js 3             # pauta nº 3 → pipeline/drafts/<slug>/{brief.json,prompt.md}
#   quem escreve: você, ou o turno agendado, seguindo prompt.md à risca
node tools/check-post.js <slug>      # editor mecânico → review.md, exit 1 se reprovar
node tools/score.js --draft <slug>   # nota 0–10 calculada por rubrica (não é opinião)
node tools/publish.js <slug>         # só com check verde: catálogo + capa + feeds + sitemap + commit
```

- `new-post.js` monta o brief no formato exato do input contract de `voice/WRITER_PROMPT.md`, escolhe a byline pelo território (`EDITORIAL_VOICE.md` §4) e embute a memória anti-repetição de `voice/state/last_runs.json` no prompt.
- `check-post.js` mede tudo no texto, não confia no `self_check`: tags permitidas, vocabulário banido (lista única em `WRITER_PROMPT.md`), templates estruturais (máx. 1, nenhum como fecho), ritmo (frase ≤30 palavras, frase curta obrigatória, 1 parágrafo de uma frase, 1 parágrafo longo), humor ≤2 e zero em pauta de morte, abertura/fecho diferentes da última peça do registro, fontes alcançáveis, links do texto presentes nas fontes, e a regra dura: **"we tested" só com `products[].tested=true` e protocolo em `test_notes`**.
- `publish.js` insere no catálogo, roda `build.js` + `build-sitemap.js` + `doctor.js`, atualiza `last_runs.json` e faz **commit local**. Se qualquer etapa falhar, restaura o catálogo e não publica. Nunca faz push, nunca faz deploy.

### Onde os cards novos aparecem

`tools/build.js` preenche, entre marcadores `<!-- hwp:auto:<slot>:start/end -->`, os feeds listados em `pipeline/placements.json`: MOST RECENT e os grids de culture/tech/science na home, e o feed das três páginas de editoria. A região automática só acrescenta no topo os ids que ainda não aparecem no resto da página — cards escritos à mão nunca são tocados nem duplicados.

A capa (`index-hero`, modo `replace`) é a exceção: ela é **substituída** pela matéria de maior nota, desde que essa matéria tenha vencido a nota de base da capa vigente (`cover_baseline` em `pipeline/cadence.json`, hoje 7.0). O HTML da capa escrita à mão é guardado em `pipeline/state/hero-fallback.html` e volta ao lugar sempre que ninguém vence — e é ressincronizado quando você edita a capa à mão. Matérias do acervo antigo (sem `sources[]` para medir) têm nota de base e nunca viram capa gerada: o HTML delas carrega dek, alt e botão que o catálogo não tem.

## A nota (Camada 2.5): calculada, nunca digitada

`tools/score.js` dá 0–10 a cada matéria somando seis critérios, cinco deles medidos:

| critério | peso | o que mede |
|---|---|---|
| evidence | 2,5 | fontes únicas, domínio diverso, quantas são primárias e datadas |
| timeliness | 1,5 | idade da fonte mais recente |
| novelty | 2,0 | sobreposição de vocabulário com o catálogo (≥72% = quase-duplicata, −2,0 e bloqueio) |
| craft | 2,0 | o que `check-post.js` medeu em `metrics.json`: ritmo, léxico banido, humor, tamanho vs. brief |
| commercial | 1,0 | produto com preço, caixa de afiliado, protocolo de teste |
| judgment | 1,0 | o único ponto de opinião do modelo (`ranking.thesis_strength`, 0–2, com justificativa de até 25 palavras) |

Penalizações: `analysis_only` −0,5, quase-duplicata −2,0, sem imagem −0,5. O modelo **não pode declarar a nota** — se o draft trouxer `ranking.score`, o check reprova. Notas ficam em `pipeline/scores.json` (versionado), com origem `auto`, `baseline` ou `manual`. Nota manual só entra pelo painel com justificativa de 15+ caracteres, e o recálculo nunca a sobrescreve.

## Camada 3: o turno agendado (roda sem você)

Uma automação local do Qoder (`Homeworld Press — turno editorial 5x/dia`, cron `0 7,10,14,17,21 * * *` em America/Sao_Paulo) faz, nesta ordem: `ingest.js` → `doctor.js --offline` (para tudo se houver erro) → confere o teto diário em `pipeline/cadence.json` → escolhe a melhor pauta nova → `new-post.js` → escreve o `draft.json` seguindo `prompt.md` → `check-post.js` (máx. 3 correções) → `score.js` (para se for duplicata) → `publish.js`. Nunca faz push, nunca faz deploy, nunca toca na identidade visual.

- **Teto de publicação:** `max_publishes_per_day` (hoje 1). As 5 rodadas diárias são *verificações*; publicar 5x/dia em domínio recém-reativado é o perfil exato que os buscadores tratam como fábrica de conteúdo. Para furar o teto uma vez: `node tools/publish.js <slug> --force-cadence`.
- **Painel:** `node tools/admin.js` sobe em `http://127.0.0.1:8099` (só nesta máquina). Mostra estado, rascunhos com veredito, pautas com botão de brief, ranking com badge de capa, ajuste manual de nota e os últimos logs. Os botões chamam os mesmos scripts; o PUBLICAR só habilita com check verde.
- **Para pausar o robô:** desative a automação no Qoder (Automations) ou mude `max_publishes_per_day` para 0 — as verificações continuam, a publicação para.

### Histórico

O projeto é um repositório Git local (branch `main`). Cada publicação vira um commit; o baseline `82c6db3` é o site auditado. `pipeline/drafts/`, `pipeline/leads/`, `pipeline/state/` e `tools/reports/` estão no `.gitignore` porque rascunho não publicado em repositório público é rascunho publicado. Push para `github.com/yuryfigueiredo/Site-wordhomepress` só quando você mandar.

## O que continua dependendo de gente

- **Push e deploy.** O robô commita local e para aí. Colocar no ar (Cloudflare Pages ou Netlify, por causa do `_redirects`; GitHub Pages não serve) é decisão sua, uma vez só — depois disso o push passa a ser o único passo que separa o site local do site público.
- **"Nós testamos."** Só sai da sua mão. Sem aparelho na mão, o texto é comparação de especificações e precisa se chamar isso.
- **Conta Amazon Associates.** Sem a sua Store ID real, os 147 links sem tag não rendem nada e a tag placeholder não paga.
- **Fotos de produto.** As imagens do review de e-readers são Unsplash, e algumas não batem com o produto (tem luminária ilustrando um Kindle Scribe).
- **Direito de imagem de capas.** As capas históricas da editora vêm do arquivo do James Gauthier; antes de publicar, confirme a permissão por escrito.
- **Nota manual no painel.** Opcional. Serve para corrigir o robô quando ele erra de julgamento, não para substituí-lo.
