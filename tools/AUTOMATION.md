# Automação — as três camadas

Node puro: sem npm, sem dependência, sem serviço pago. As chaves de API usadas são a do Gemini/NVIDIA (free tiers, só pela Camada 3) e a do Unsplash (`UNSPLASH_ACCESS_KEY`, para achar foto real). Rodam na sua máquina com o Node que já existe (v24); a Camada 3 também roda na nuvem, no GitHub Actions.

```bash
node tools/doctor.js            # varredura completa (inclui links externos)
node tools/doctor.js --offline  # sem rede: assets, metadata, catálogo, sitemap
node tools/doctor.js --quick    # só catálogo + assets + metadata
node tools/ingest.js            # atualiza a fila de pautas
node tools/ingest.js --show     # imprime a fila de hoje
node tools/build-sitemap.js     # regenera sitemap.xml a partir do catálogo
node tools/build-dist.js        # monta dist/ para upload (ver PUBLISHING.md)
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
| `feed-stale` | o `feed.xml` commitado não é exatamente o que `build-feed.js → buildItems()` escolhe hoje (matéria nova fora do RSS — foi assim que o feed ficou parado no Hubble por cinco publicações com o robô verde) |
| `cadence-override` | publicação dos últimos 7 dias marcada `forcada:true` em `pipeline/memory.json` (aviso: alguém furou o teto com `--force-cadence`, e agora isso é contável) |
| `repetition` | dois artigos publicados abrindo com as mesmas palavras, ou com o mesmo padrão rítmico |
| `orphan` | artigo que nenhuma página linka |
| `affiliate` | link Amazon/Audible sem `tag=`, ou tags inconsistentes entre si |
| `cover` | `cover_changes_per_day` ≠ número de horários do `check_hours`, `cron_expression` ≠ workflow, nenhuma matéria acima do piso da capa, ou acervo sem para onde girar |
| `picks` | `picks_changes_per_day` ≠ 1, slot sem `"rotacao": "dia"`, pool abaixo do mínimo para trocar todo dia, o par publicado ≠ o par que a régua de hoje calcula, card `pick-item` fora dos marcadores, picks repetindo a capa ou sem artigo no catálogo |
| `placeholder-copy` | texto de rascunho visível ao público (ex.: o bloco "ADVERTISEMENT // …") |
| `external-broken` | link externo devolvendo 404/500 |
| `external-blocked` | 401/403/406/429 — provável bloqueio a robô, abre manualmente (aviso, não erro) |

Saída: console + `tools/reports/AAAA-MM-DD.md`. Código de saída `1` quando há erro — é isso que o agendador usa para saber que algo mudou.

## `ingest.js` — de onde vêm as pautas

12 feeds públicos gratuitos (Publishers Weekly, Reactor, Guardian SF, Publishing Perspectives, SFWA, Ars Technica, The Verge, Hacker News, Science Daily, Phys.org, Space.com). Nenhum exige cadastro.

Cada item é pontado pelos vocabulários dos 5 pilares, descartado se parecer tema já publicado, deduplicado por título e limitado a 8 pautas por fonte. O resultado vai para:

- `pipeline/leads/AAAA-MM-DD.json` — estrutura para consumo por script
- `pipeline/leads/AAAA-MM-DD.md` — a mesma fila legível, com pilar, registro sugerido e url
- `pipeline/state/seen.json` — URLs já vistas (últimas 4000). **Só vale na sua máquina**: `state/` é gitignored (com duas exceções versionadas, abaixo), então no Actions ele nasce vazio todo turno. O que impede a fila de repetir o que já está no ar, em qualquer lugar, é `pipeline/memory.json` + as fontes do catálogo (ver Camada 3).
- `pipeline/state/cover-state.json` e `pipeline/state/hero-fallback.html` — **versão no git**, porque a memória da capa tem de sobreviver ao runner limpo: sem `cover-state.json` cada rodada do Actions acreditaria que nunca trocou a capa, e sem o fallback a capa escrita à mão sumiria do `index.html` no primeiro build.

Cada pauta traz `pillar`, `register` e `fit`. Isso é o insumo da Camada 2: quando você quiser escrever, a pauta já vem com o encaixe editorial decidido — mas a decisão de escrever continua sua.

O que o `ingest.js` **não** faz: não acessa a Amazon, não verifica preço, não confirma fato, não escreve.

## Agendar no Windows (opcional, uma vez, sem instalar nada)

O `turno editorial` do Actions já faz coleta e manutenção 6x/dia com o PC desligado — isto aqui só serve para ter um doctor local matinal na sua máquina. Medido em 2026-11-06: **nenhuma** dessas tarefas foi criada (0 de 374 tarefas do Windows), então quem sempre rodou foi o robô da nuvem.

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
node tools/make-cover.js <slug>      # só para matéria SEM foto real: placa SVG → images/covers/<slug>.svg
node tools/check-post.js <slug>      # editor mecânico → review.md, exit 1 se reprovar
node tools/score.js --draft <slug>   # nota 0–10 calculada por rubrica (não é opinião)
node tools/publish.js <slug>         # só com check verde: catálogo + capa + feeds + sitemap + commit
```

- `pick-lead.js` só entrega pauta cuja fonte abre agora: feed de notícia às vezes publica item com link morto, e o editor mecânico reprova link 404 depois que o texto já custou chave. Pautas descartadas saem no stderr.
- `new-post.js` monta o brief no formato exato do input contract de `voice/WRITER_PROMPT.md`, escolhe a byline pelo território (`EDITORIAL_VOICE.md` §4) e embute a memória anti-repetição de `voice/state/last_runs.json` no prompt.
- `make-cover.js` desenha a miniatura sem banco de imagens e sem custo: placa 1200×675 em SVG, com a cor do pilar (a mesma de `css/styles.css`), o kicker e o título quebrado em até 4 linhas. É determinística — mesmo slug, mesma placa — e só preenche `image`/`imageAlt` quando o draft ainda está sem capa. O turno roda ela de novo depois de cada reescrita, porque o modelo devolve `image: null` e `write.js` preserva a capa anterior. **Matéria que já tem foto real (`images/posts/*.jpg`) sai dela com exit 0 e nenhuma placa gerada** — era exatamente esse `exit 1` que, desde 05/11, abortava todo `publish.js` de matéria com foto: o turno chamava a placa depois de a foto já estar no draft, a placa falhava, e o `publish.js` desfazia a publicação inteira.
- **Foto real é portão, não enfeite:** antes de inserir no catálogo, `publish.js` exige `image` (ou `bookCover`) apontando para `.jpg`/`.png`/`.webp` que não seja placa. Sem foto, chama `tools/find-cover.js` (busca em `tools/lib/find-photo.js`: Unsplash → Pexels), salva em `images/posts/<slug>.jpg` e grava crédito e autor no draft. Se nenhum candidato achar foto, a publicação **aborta** (exit 1, catálogo intacto) e `tools/notify-foto.js` abre uma issue no repositório com o log da busca — porque rodada abortada em silêncio foi exatamente como o site passou três semanas sem publicar.
- **De onde sai a foto (régua de 07/11):** a primeira query é o campo `photoQuery` do rascunho — 3 a 6 palavras em inglês nomeando a CENA que a foto deveria mostrar, escritas por quem escreve o texto. `check-post.js` reprova rascunho sem ele (gate `photo-query`), porque a query montada a partir da manchete já colocou no ar um render de "QUANTUM" numa matéria de íons presos: "two trapped ions let a gauge field" não é vocabulário de banco de imagem. O numeral e a palavra vazia são riscados da query por `palavrasConcretas()`, a mesma régua que o portão usa. E a foto deixada de fora do catálogo não é mais `results[0]`: pedem-se 5 candidatas e escolhe-se a cuja legenda (`alt_description`) aparecem palavras inteiras da query — prova de assunto que existe sem ver a imagem; empate se decide por curtidas. Se nenhuma das 5 legendas menciona a query, o candidato é recusado com motivo e a busca passa para a próxima query; esgotadas as queries, aborta como acima. `node .audit/teste-foto-query.js` (offline, fetch falso) e `node .audit/muta-foto-query.js` (desliga cada regra e exige teste vermelho) são a prova disso.
- `check-post.js` mede tudo no texto, não confia no `self_check`: tags permitidas, vocabulário banido (lista única em `WRITER_PROMPT.md`), templates estruturais (máx. 1, nenhum como fecho), ritmo (frase ≤30 palavras, frase curta obrigatória, 1 parágrafo de uma frase, 1 parágrafo longo), humor ≤2 e zero em pauta de morte, abertura/fecho diferentes da última peça do registro, fontes alcançáveis, links do texto presentes nas fontes, comprimento (abaixo de 70% do alvo da pauta é reprovado — o mesmo número que o prompt pede), e a regra dura: **"we tested" só com `products[].tested=true` e protocolo em `test_notes`**.
- `publish.js` insere no catálogo, roda `build.js` + `build-sitemap.js` + `build-feed.js` + `meta-pages.js` + `doctor.js`, atualiza `last_runs.json` e faz **commit local**. Se qualquer etapa falhar, restaura o catálogo e não publica. Nunca faz push, nunca faz deploy.

### Onde os cards novos aparecem

`tools/build.js` preenche, entre marcadores `<!-- hwp:auto:<slot>:start/end -->`, os feeds listados em `pipeline/placements.json`: MOST RECENT, o bloco TODAY'S PICKS e os grids de culture/tech/science na home, e o feed das três páginas de editoria. Nos feeds, a região automática só acrescenta no topo os ids que ainda não aparecem no resto da página — cards escritos à mão nunca são tocados nem duplicados. A exceção é o bloco de picks (`"rotacao": "dia"`): ali o desconto é só a região do hero, porque picks é bloco de descoberta e o par pode, sim, estar também no feed de cultura logo abaixo.

A capa (`index-hero`, modo `replace`) é a exceção: ela é **substituída por uma matéria do pipeline que passe o piso** `cover_baseline` em `pipeline/cadence.json` (hoje 6.5) — qual delas é a régua de rotação abaixo. A nota é peneira de qualidade, não troféu: as notas não decaem depois de publicadas — a atualidade é medida no dia em que `score.js` avalia —, então escolher por "maior nota de todos os tempos" deixaria a mesma matéria na capa por semanas. Só competem matérias com nota medida por rubrica (`auto`) ou ajustada por você (`manual`): o acervo antigo (`baseline`) fica de fora porque o HTML escrito à mão dele carrega dek, alt e botão que o catálogo não tem. Quando nenhuma passa do piso, o HTML da capa escrita à mão — guardado em `pipeline/state/hero-fallback.html` — volta ao lugar, e é ressincronizado quando você edita a capa à mão. A imagem do hero usa a variante `-hero.svg` da placa (sem título gravado, porque o H1 vem logo abaixo); `tools/make-cover.js` escreve as duas de uma vez e `--from-db <id>` regera ambas a partir do catálogo, que é a fonte da verdade do título. **Foto real vai ao hero sem variante** — `heroImg()` só troca por `-hero.svg` quando a imagem é uma placa `images/covers/*.svg`.

A régua de **rotação** é por rodada: `cover_changes_per_day` (hoje 6) tem de ser igual ao número de horários do `check_hours`, porque **a capa gira em toda rodada do turno**, com matéria nova ou não — a capa é o que mais chama atenção e o hero não pode ficar parado 4 horas. A unidade foi a janela (dia 03:00–12:59 / noite 13:00–02:59, 2 trocas/dia) até 2026-11-07; com seis rodadas por dia, a janela conteria três rodadas e a meta cobraria duas. A régua é o log `changes` de `pipeline/state/cover-state.json`, e **só o `build.js` o escreve**: `publish.js` carimbava a rodada como "servida" mesmo quando a matéria publicada não passava do piso e continuava não sendo capa.

A escolha, em ordem (`pickCover`): **matéria que ainda não passou pelo hero** toma a capa na primeira publicação da rodada (é o caminho de toda publicação nova), e sem inédita acima do piso a rodada **caminha um passo na lista de elegíveis** (`proximaNaRotação`), voltando ao topo no fim do ciclo. Medido em 07/11 com três publicações na mesma rodada: a primeira virou capa, a segunda e a terceira saíram `capa mantida` — a trava da rodada vem antes da inédita, então quem publica depois da primeira troca espera a rodada seguinte. É por isso que a novidade é medida por ID (o conjunto `capaVistas`), não por data: `a.date` do catálogo tem granularidade de dia, então "a mais nova do catálogo" não distingue a matéria publicada agora da que a rotação acabou de derrubar — e foi assim que o segundo build da mesma rodada desfazia a rotação, registrando troca sem publicação enquanto o leitor via a capa em ping-pong.

Como o Actions chama o build várias vezes por rodada, repetir a capa da rodada não conta como troca — e a trava é dupla: `registrarCapa` só grava se o HTML do hero mudou de verdade **e** se a matéria agora no ar é outra. Sem a segunda condição, um catálogo com uma única matéria elegível "girava" a capa para ela mesma em cada rodada nova e a meta subia sem nada ter mudado na página. Entradas com mais de 14 dias caem do log (`capaVistas` fica: é memória, não histórico). Quem confere a prova no fim é `tools/turno.js`: `capaServiuRodada()` lê o estado do disco e fecha a rodada em vermelho se não houve troca na rodada em curso — inclusive na que publicou, onde quem girou foi o build chamado pelo `publish.js`.

Duas consequências disso ficam nos painéis de propósito:

- **Publicação e capa contam dias diferentes.** O teto de publicações é por **dia UTC** (é o dia do commit `publish:` no runner); a meta de capa é pelo **dia do fuso** do instante. Antes, com janelas, a rodada das 00:23 pertencia à noite do dia anterior e o painel mostrava 5/6 num dia que tinha cumprido as seis — hoje as seis rodadas (00:23 a 20:23) caem todas no mesmo dia do fuso. Às 21h de Brasília os dois dias já são outros — não é bug, é o relógio de cada régua.
- **A rodada que não publica também gira a capa.** `tools/turno.js` chama `build.js` ao encerrar qualquer rodada que passou pela manutenção sem publicar (teto, intervalo mínimo, falta de pauta): antes disso, a troca forçada só acontecia nos dias em que saía matéria, e a meta ia a zero em silêncio nos outros.
- **Rodada sem publicação não deixa foto no disco.** `turno.js` tira o retrato de `images/posts` e `images/covers` no começo e apaga o que nasceu durante a rodada em toda saída sem publicação — é o `garantirFoto()` dele que baixa o jpg, minutos antes de o `publish.js` existir como processo, então o retrato do publish não pegava nada. `publish.js` mantém o dele (mais o gancho de `process.on("exit")`, para exceção sem catch) porque alguém roda o publish à mão. `turno.js` tem o mesmo gancho: um throw sem catch derruba a rodada antes do `finish()`, e no runner o `git clean -fdq` da vermelha encobre isso — na máquina do dono, não. Ctrl+C e o `timeout-minutes: 45` do Actions chegam por sinal, onde o gancho de `exit` não roda, então `SIGINT`/`SIGTERM` chamam o próprio `finish`, que desfaz as fotos, escreve o `TURNO.md` e sai vermelho.

Quem garante foto real antes de pedir a placa é `tools/turno.js`. O filtro "matéria que pode ser capa" (nota medida, foto, acima do piso) está em `tools/lib/cover-rules.js` e é o mesmo que `doctor.js` confere; as notas são injetadas no catálogo por `tools/lib/catalog-notes.js`.

**TODAY'S PICKS — régua de 07/11.** O bloco da coluna esquerda da home se vende como "as escolhas de hoje" e era HTML escrito à mão: os dois cards eram as matérias de 29/out e 23/out havia **15 dias**, com hotlink do Unsplash e link de afiliado que não existe no catálogo. Agora é o slot `index-picks` (`"rotacao": "dia"`, `limit: 2`, categoria `culture`) e a régua mora em `tools/lib/picks-rules.js`:

- O pool é a peneira do bloco — matéria da categoria, **com imagem** (o card é feito em volta da foto), descontada a que já está no hero. Ordem: data mais nova primeiro, desempate por nota.
- O par do dia é `picksDoDia(pool, n, diaUtc)`: começa no item `diaUtc % pool.length` e toma `n` consecutivos, voltando ao topo no fim do ciclo. Meia-rotação por dia (entra 1, sai 1), sem estado em disco — nada que o clone do runner precise lembrar.
- `picks_changes_per_day: 1` em `pipeline/cadence.json` é a meta, e o `doctor.js` cobra: a meta, o slot declarado, o mínimo de acervo para a troca existir por construção (`minimoParaRotacao(n) = n + 1` — com exatamente `n` peças o "par de amanhã" é o mesmo par), e **se o par publicado no `index.html` é o par que a mesma função calcula para hoje**. Mais duas conferências que não espelham o build: o par não pode repetir a capa na mesma tela, nem card apontando para id sem artigo/sem foto no catálogo.
- Prova: `node .audit/teste-picks-dia.js` (44 conferências offline, relógio falsificado) e `node .audit/muta-picks-dia.js` (14 mutações — offset congelado, unidade em hora, pool sem foto, meta 3, slot sem rotação, home com o par de ontem, card manual fora dos marcadores — cada uma exigindo vermelho no verificador declarado). A lição da falsificação: quebrar a *função* deixa o doctor verde em três casos, porque ele compara o HTML com a mesma função que o build usou; só a aritmética de dias do teste vê.

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

O robô roda no GitHub Actions: `.github/workflows/turno.yml` chama `node tools/turno.js` no cron `23 3,7,11,15,19,23 * * *` (UTC) = 00:23, 04:23, 08:23, 12:23, 16:23 e 20:23 em Brasília — 6 verificações por dia. A mesma sequência de sempre: `ingest.js` → `doctor.js --offline` (para tudo se houver erro, e a rodada fecha vermelha) → teto diário **e** distância mínima da última publicação em `pipeline/cadence.json` (os dois **antes** de escolher pauta) → `pick-lead.js` → `new-post.js` → escreve o `draft.json` seguindo `prompt.md` (o texto é do `write.js`, na fila de provedores) → foto real → `make-cover.js` → `check-post.js` (máx. 3 correções) → `score.js` (para se for duplicata) → `publish.js`. Nunca faz push, nunca faz deploy, nunca toca na identidade visual. O push é do workflow, não do `publish.js` — e só acontece em `main` no Actions.

- **Teto de publicação:** `max_publishes_per_day` (hoje 4). Publicar mais que isso em domínio recém-reativado é o perfil exato que os buscadores tratam como fábrica de conteúdo. Para furar o teto uma vez: `node tools/publish.js <slug> --force-cadence`. O furo é decisão sua e continua sendo, mas deixa rastro: o travão que teria barrado (teto do dia e/ou distância mínima) é impresso no console — e portanto no `TURNO.md` — e o registro em `pipeline/memory.json` ganha `forcada: true`, que `doctor.js` conta nos últimos 7 dias como aviso `cadence-override`. Antes disto, duas de três publicações de um mesmo dia tinham entrado furadas e nada no repositório dizia isso depois. Prova: `node .audit/teste-furo-cadencia.js`.
- **A meta é conferida contra a agenda, não contra a vontade:** `tools/lib/schedule.js` lê o cron do workflow, aplica `min_hours_between_publishes` e devolve o máximo de publicações que aquele relógio entrega num dia de 24h. O `doctor.js` fecha **vermelho** se `max_publishes_per_day` passar desse número, se o `cron_expression` do JSON divergir do cron do workflow, e avisa se `checks_per_day` ou `check_hours` não baterem com o cron no fuso declarado. Foi essa conta que mostrou o buraco: com os horários antigos (07/10/14/17/21 UTC, dos quais 07/10/17 **nunca** dispararam no Actions) a agenda permitia 4 publicações contra uma meta declarada de 5 — verde dia após dia sem publicar nada.
- **Distância entre publicações:** `min_hours_between_publishes` (hoje 3). Sem ele, duas rodadas perto da meia-noite UTC publicavam no mesmo dia com 43 minutos de diferença. É checado **antes** de escolher a pauta e **vale depois da virada do dia UTC**: com uma peça às 21h, as rodadas da manhã seguinte pararão cedo em vez de percorrer brief + texto + editor para serem barradas no `publish.js`. Se o `pipeline/memory.json` estiver ilegível, o gap cai no histórico dos commits `publish:` — a trava não abre junto com o teto.
- **A memória do robô: `pipeline/memory.json`.** Versionada, é a única coisa que sobrevive entre rodadas no runner do Actions (`drafts/`, `leads/` e o resto de `state/` são gitignored e nascem vazios; `cover-state.json` e `hero-fallback.html` são as exceções versionadas, porque sem eles a troca de capa perde a memória e a capa manual some). Guarda, por URL de fonte normalizada (`utm_`, barra no cabo, âncora, http→https — o caminho continua sensível a maiúsculas, porque no servidor ele é), o resultado de cada tentativa — `em_andamento`, `falha_brief`, `falha_texto`, `falha_publicacao`, `fonte_inalcancavel`, `reprovada`, `publicada` — e a lista das publicações com data. É o que o teto lê e o que impede a mesma pauta de ser reescolhida três rodadas seguidas. Janela de re-tentativa por resultado em `lead_retry_hours`; `publicada` nunca volta.
- **Idade da pauta:** `lead_max_age_days` (hoje 7). Uma fonte de 24 dias não é notícia; era isso que entrava no ar quando a nota vinha de palavra-chave e não de frescor. Sem data legível no feed, a pauta **não** é descartada.
- **Anti-duplicata tem três portas,** todas com a mesma definição em `tools/lib/memory.js`: a URL da fonte já citada por matéria no ar (`pick-lead`, `ingest`, `check-post`), o título da fonte já citada — pega coluna recorrente, que sai toda semana com URL nova (`pick-lead`) — e a quase-duplicata de texto calculada por `score.js`.
- **Painel:** `node tools/admin.js` sobe em `http://127.0.0.1:8099` (só nesta máquina). Mostra estado, rascunhos com veredito, pautas com botão de brief, ranking com badge de capa, ajuste manual de nota e os últimos logs. Os botões chamam os mesmos scripts; o PUBLICAR só habilita com check verde.
- **Para pausar o robô:** desative o workflow (Actions → "turno editorial" → Disable workflow) ou mude `max_publishes_per_day` para 0 — as verificações continuam, a publicação para.
- **Contabilidade alta e clara:** se o commit `publish:` local falhar, `publish.js` escreve `AVISO:` e `turno.js` fecha a rodada em vermelho. Uma rodada que publica sem registrar é pior que uma rodada que não publica, porque o teto do dia seguinte lê 0/4 e o robô repete a fonte. Se o *registro* em `pipeline/memory.json` estourar, o `publish.js` desfaz a publicação inteira (catálogo, HTML, sitemap, notas, memória e last_runs) e sai vermelho — porque o último passo do workflow faz `git add -A` mesmo em rodada falha, e um artigo no ar sem contabilidade seria empurrado com o rótulo `turno:`.
- **Painel da manhã:** `node tools/morning-check.js` (ou `morning.bat`) lê tudo acima e não escreve nada — teto, última peça, trocas de capa, fila, avisos do doctor, a conta da agenda e as rodadas medidas no histórico.

### O turno na nuvem, com o seu PC desligado

`.github/workflows/turno.yml` roda `node tools/turno.js` no GitHub Actions — é ele que publica hoje — com as chaves de escrita guardadas em **Settings → Secrets**. Diferenças que importam:

- **O cron é UTC e é *best-effort*.** Medido em 34 rodadas (out–nov/2026): dos horários `07,10,14,17,21`, os de 07/10/17 **nunca** dispararam e os demais chegaram de 1 a 170 minutos atrasados. Daí o cron `23 3,7,11,15,19,23 * * *` (= 00, 04, 08, 12, 16 e 20 em Brasília): minuto fora da fila das horas cheias, 4h entre horários contra 3h de distância mínima, o que deixa folga de dois atrasos por dia sem derrubar o teto. Rode agora quando quiser com **Run workflow** na aba Actions.
- **Provedores de texto: `pipeline/providers.json`.** O arquivo lista os provedores *na ordem em que devem ser tentados* e diz, para cada um, o **nome** do segredo que guarda a chave — nunca a chave. Provedor sem segredo no ambiente fica inerte; provedor que responde 503/429 é esperado e tentado de novo; provedor que recusa (chave inválida, nome morto) é descartado e a rodada passa para o próximo. Some a chave em Secrets e o provedor entra sozinho na fila, sem mexer em código.
- **O segredo de escrever é `tools/write.js`**, que não tem lista fixa de modelos: pergunta a cada chave quais existem (`GET .../models`), ordena por versão, e quando a API do Google responde "use models/X", segue a dica. Nome de modelo aposentado não derruba mais a rodada.
- **Diagnóstico sem gastar rodada nem cota:** `node tools/write.js --check` mostra quem está armado, quem está sem chave e a fila de modelos de cada um. Zero geração.
- **Se a rodada para**, o motivo fica em `TURNO.md` (commitado pelo próprio robô) com uma linha por `provedor/modelo` tentado. O commit do relatório roda com `if: always()`.
- **Rodada vermelha não sobe matéria ao ar.** O mesmo `if: always()` é o risco: ele faria `git add -A` em qualquer resíduo deixado no diretório e a matéria entraria com o rótulo `turno:`, sem commit `publish:` e sem contabilidade. Antes do `add`, se a etapa da rodada não terminou `success`, o workflow recua TUDO para o HEAD (`git checkout HEAD -- .` + `git clean -fdq`) e devolve ao lugar só os dois arquivos de registro — `TURNO.md` e `pipeline/memory.json`, que dizem o que a rodada tentou e travam a reoferta da mesma fonte. Recuo geral em vez de lista de caminhos: uma saída nova de qualquer ferramenta não escapa por esquecimento. Como o `publish:` legítimo já virou HEAD, a matéria publicada de verdade continua no ar — só o que ficou pela estrada é descartado. `TURNO.md` e `pipeline/memory.json` seguem sendo commitados: é o registro do que a rodada tentou. Consequência conhecida e aceita: a troca de capa que o `girarCapa()` do `turno.js` acabou de escrever (`index.html` + `cover-state.json`) também volta, então **rodada vermelha não serve rodada** — a meta de `cover_changes_per_day` (6, uma por horário do `check_hours`) vale para as rodadas que terminam verdes. Não é buraco de régua: o site no ar nunca viu aquela capa, porque nada foi empurrado.
- **Push = deploy.** O workflow commita `TURNO.md` e o que a rodada mudou; a Vercel publica a cada push em `main`. Não existe mais passo manual de upload (ver [PUBLISHING.md](PUBLISHING.md)).
- **Conflito de push resolve-se sozinho só onde é seguro.** Se outro commit entrou durante a rodada, o workflow faz `git pull --rebase`; se o rebase parar por conflito, ele favorece o da rodada **somente** nos arquivos que o próximo build regenera do zero (`TURNO.md`, `pipeline/state/*`, HTML de índice/artigo, `sitemap.xml`, `vercel.json`). Catálogo, `pipeline/memory.json` e `pipeline/scores.json` continuam bloqueando: o `-X theirs` global que existia aqui resolvia a capa e, no mesmo golpe, jogava fora o hunk do outro lado — ou seja, uma matéria já publicada ou o registro que o teto lê. Conflito nesses caminhos fecha a rodada vermelha com `git status` no log, para resolver à mão.

#### Armar um segundo provedor (quando quiser)

Hoje estão armados o **Gemini** (`GEMINI_API_KEY`) e a **NVIDIA** com duas chaves (`NVIDIA_API_KEY` e `NVIDIA_API_KEY_2`). A NVIDIA grátis anuncia o catálogo inteiro em `/v1/models` mas libera só parte dele por conta — modelo fora da sua cota responde `404 Function not found for account`, então a fila lista só o que foi testado de verdade: `openai/gpt-oss-20b` e `minimaxai/minimax-m3.1-flash`. Os dois são modelos que "pensam": gastam tokens no raciocínio antes de escrever, daí o `max_tokens` mais alto no JSON.

Para acrescentar outro provedor, sem tocar em código:

1. Crie a conta no provedor e gere a chave (`console.groq.com`, `cloud.cerebras.ai`, `console.mistral.ai`, `openrouter.ai`). Os quatro falam o mesmo dialeto (`/chat/completions`), por isso o mesmo adaptador serve para todos. Confira no site o limite gratuito do dia — ele muda sem avisar.
2. No GitHub: **Settings → Secrets and variables → Actions → New repository secret**. O nome tem de ser exatamente o `chave_env` de `pipeline/providers.json` (`GROQ_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY` ou `OPENROUTER_API_KEY`).
3. Rode `node tools/write.js --check` com a chave no ambiente para ver a fila que ele usaria. Não gera texto, não gasta cota.
4. Nada mais. No próximo turno o provedor entra na fila na posição em que está no JSON; se o de cima falhar, o de baixo escreve e o `TURNO.md` dirá `escrito por nvidia/openai/gpt-oss-20b`.

Para inverter a ordem, basta trocar as linhas do arquivo (`peso` decide quanto tempo da rodada cada um recebe). Para desligar um provedor sem apagar a chave, `"ativo": false`.

Se um modelo responder JSON incompleto, o `write.js` grava a resposta recusada em `pipeline/drafts/<slug>/rejeitado-<provedor>-<modelo>.txt` — é ali que se vê o que ele escreveu de errado.

### Trocar a Store ID da Amazon

A tag aparece em 184 links espalhados por 15 arquivos. Um comando troca todos:

```bash
node tools/set-affiliate-tag.js minhaloja-20 --dry   # mostra o que faria
node tools/set-affiliate-tag.js minhaloja-20         # troca
node tools/doctor.js --quick                         # confirma que não sobrou tag antiga
```

### Histórico

O projeto é um repositório Git (branch `main`, remoto `github.com/yuryfigueiredo/Site-wordhomepress`). Cada publicação vira um commit; o baseline `82c6db3` é o site auditado. `pipeline/drafts/`, `pipeline/leads/`, `pipeline/state/` (menos `cover-state.json` e `hero-fallback.html`, que precisam sobreviver ao runner limpo) e `tools/reports/` estão no `.gitignore` porque rascunho não publicado em repositório público é rascunho publicado. Push em `main` agora é deploy: a Vercel publica a cada push.

## O que continua dependendo de gente

- **Domínio.** O site está no ar em `site-homeworldpress.vercel.app`, mas os canonicals de todas as páginas apontam para `homeworldpress.com` — e esse domínio ainda responde com a página de estacionamento do GoDaddy. Enquanto os nameservers não forem trocados no DomainControl, o Google vê um canonical que não é o site. Passo a passo em [PUBLISHING.md](PUBLISHING.md).
- **Conta Amazon Associates.** Sem a sua Store ID real, os 184 links com a tag `homeworldpres-20` não rendem nada. Depois de aprovado, a troca é `node tools/set-affiliate-tag.js <sua-tag>` (acima).
- **"Nós testamos."** Só sai da sua mão. Sem aparelho na mão, o texto é comparação de especificações e precisa se chamar isso.
- **Fotos de produto.** As imagens do review de e-readers são Unsplash, e algumas não batem com o produto (tem luminária ilustrando um Kindle Scribe).
- **Direito de imagem de capas.** As capas históricas da editora vêm do arquivo do James Gauthier; antes de publicar, confirme a permissão por escrito.
- **Medição de tráfego.** Hoje não há nenhuma: escolher entre Google Search Console (o dado que decide a estratégia de afiliado) e um script de analytics é decisão sua.
- **Nota manual no painel.** Opcional. Serve para corrigir o robô quando ele erra de julgamento, não para substituí-lo.
