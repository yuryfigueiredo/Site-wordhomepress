# AGENTS.md — como este repositório é operado

Site estático (HTML + `js/articles-db.js`) com um pipeline editorial em Node puro, sem npm e sem dependências. Todo trabalho de conteúdo aqui é feito pelas ferramentas de `tools/`; nada é publicado à mão.

## Proibições permanentes

| Proibição | Quem garante |
|---|---|
| `git push` a partir desta máquina | nenhum script de `tools/` chama push; só `.github/workflows/turno.yml` (etapa final, no runner) |
| deploy / upload para servidor | não existe passo manual; a Vercel publica quando o Actions empurra em `main` |
| editar `css/styles.css`, cabeçalho, rodapé ou identidade visual | nenhuma ferramenta escreve nesses arquivos; `doctor.js` quebra em `asset-*`/`meta-*` se uma referência sumir. Mudança de marca é decisão do dono |
| criar contas, cadastros ou chamadas pagas | as chaves existentes são free tier (`pipeline/providers.json`, Secrets); provedor sem chave é pulado, não cadastrado |

## A régua mora nos arquivos, não na conversa

`pipeline/cadence.json` é a única fonte de verdade de ritmo; `tools/lib/schedule.js` + `tools/doctor.js` conferem se o que está no JSON é fisicamente possível com o cron que o GitHub executa de verdade (`.github/workflows/turno.yml`). Hoje: 2 verificações/dia no cron `23 15,23 * * *` UTC (12:23 e 20:23 em Brasília), teto de 2 publicações/dia, mínimo de 3h entre peças, **1 troca de capa por rodada** (`cover_changes_per_day` 2 = número de horários do `check_hours`), piso de nota para a capa `cover_baseline` 6.5 e **1 troca do bloco de Today's Picks por dia** (`picks_changes_per_day` 1 — a régua é a troca, não o tamanho: o bloco são 3 cards, e o `limit` mora em `pipeline/placements.json`).

**Limitação do GitHub Actions (medido em 08/11):** o scheduler do free tier entrega apenas 2 das 6 rodadas agendadas por dia — os outros 4 slots somem silenciosamente, sem aviso. O cron original (`23 3,7,11,15,19,23 * * *`) foi reduzido para os 2 horários que consistentemente dispararam (15:23 e 23:23 UTC). O teto de publicações/dia caiu de 4 para 2 para espelhar o que o relógio realmente entrega. O aviso `cadence-entrega` do doctor **não** confere régua contra agenda: ele compara a média de publicações/dia nos 7 dias UTC com o teto e fica aberto enquanto sair menos matéria que o teto (`doctor.js`, `mediaPubs < teto`). Quem confere régua×agenda é o erro `[cadence]` do `lib/schedule.js`, e esse sim está silencioso.

Mudar uma destas linhas exige mudar o número no `cadence.json` — se divergirem, o doctor fecha vermelho e a rodada não publica.

As réguas que `build.js` e `doctor.js` usam são módulos únicos, não cópia: `tools/lib/cover-rules.js` decide "qual matéria pode ser capa" (o painel, o build e o doctor veem a mesma lista), `tools/lib/picks-rules.js` decide "quais são as escolhas de hoje do Today's Picks" (mesma regra, mesmas três bocas), `tools/lib/slot-markup.js` decide "o que é um card de slot e onde fica a região automática" (o formato do marcador `hwp:auto`, a classe do `<article>` e a leitura das regiões) e `tools/lib/catalog-notes.js` injeta a nota medida de `pipeline/scores.json` no catálogo. Duas implementações paralelas foi o que fez o doctor acusar "nenhuma matéria passa do piso" com 7.8 no ar.

## Nada na home é escrito à mão, salvo as exceções declaradas

Todo bloco listado em `pipeline/placements.json` é regenerado pelo `build.js` entre os marcadores `<!-- hwp:auto:<slot>:start/end -->`. Um card de matéria FORA desses marcadores é dois defeitos: ninguém o regenera (a grade "01 // CULTURE" ficou semanas com os mesmos 6 cards sob um rótulo que promete novidade) e ele entra na conta de `takenIds` do build, roubando vaga do próprio slot — a CULTURE tinha `limit` 6 e gerava 3. Foi o mesmo mecanismo que congelou a coluna central da grade de 3 colunas e abriu um vão preto de 807px ao lado do hero, medido em 09/11.

O que continua à mão é o card cuja CLASSE não é classe de slot em `placements.json`: a lista "TRENDING // TOP 5", os `rec-card` de reviews, as duas placas de promoção do Dumarest (`dumarest/index.htm`), os 3 cards de spotlight no topo de cada página de editoria (`cat-hero-left` + `cat-hero-right__card`) e os blocos de `reviews.html`, que não tem marcador nenhum. O portão `[slot-stale]` ignora card cujo link não é uma matéria do catálogo, e só enxerga as classes declaradas — é escolha deliberada, mas nada disso é regenerado por ninguém, e é aí que as datas literal "UPDATED OCTOBER 2026" apodrecem. Trazer spotlight e `reviews.html` para o build é decisão do dono, não buraco escondido.

Modalidades de desconto em `build.js`, todas por slot: `dedup: "prioridade-ineditas"` + `acervo: true` (páginas de categoria: o feed lista TODA a editoria, inéditas primeiro e a repetição da curadoria do topo afunda para o fim — com cap fixo em 8 e 15 peças em science, 4 delas não apareciam na página — nem eram as mais velhas, eram as que o `slice` alcançava —, e 2 matérias do catálogo (uma cortada de science, outra de cultura) não tinham UM link de entrada em lugar nenhum, medido no HEAD em 09/11), `dedup: "somente-automatico"` (grade CULTURE: só os blocos automáticos descontam, senão as duas matérias do trending tiravam vaga e a grade de 3 colunas fechava com 5 — buraco de 437px na última linha) e o desconto do arquivo inteiro, que vale para os slots da home que dividem tela.

Alcance é régua, não sorte: `[orphan]` fecha **vermelho** quando uma matéria ou review do catálogo não tem **link** (`article.html?id=` / `review.html?id=`) em nenhuma página além da própria — `a-<id>.html` e `r-<id>.html` são o destino, não a entrada. Duas versões antigas passavam verde: uma contava a própria página, a outra contava qualquer menção do slug em qualquer lugar do arquivo, e um `<script>window.__LEGADO=["<slug>"]</script>` plantado na home apagava o aviso sem criar um clique. Medido no HEAD~1 em 09/11: 2 matérias sem link de entrada (`philip-k-dick-liu-cixin-prophetic-scifi-novels`, `lunar-farside-radio-telescopes-cosmic-dark-ages`). E `[slot-stale]` fecha vermelho se um slot `"acervo"` deixar peça de editoria de fora. Prova: `node .audit/muta-slot-stale.js`.

## Sequência de uma rodada

```bash
node tools/turno.js              # a rodada inteira, com o que estiver armado
```

Passo a passo, que é o que `turno.js` executa — e é também o caminho manual:

1. `ingest.js` coleta as fontes.
2. `build.js --daily` gira **só** os blocos de `"rotacao": "dia"` (hoje, o Today's Picks) e não toca na capa nem no `count_pill`. Vem antes da manutenção por necessidade, não por preferência: o doctor exige que o bloco publicado seja o que a régua de hoje calcula, e quem produz esse bloco é o build — que até 10/11 só rodava no fim da rodada. Na virada do dia UTC o portão `[picks]` nascia vermelho por construção, a rodada parava na manutenção, o bloco nunca girava e a rodada seguinte morria do mesmo jeito. Medido: três rodadas seguidas vermelhas no Actions e o site congelado desde 08/11. Se este build falhar, a rodada fecha vermelha aqui.
3. `doctor.js --offline`. **Erro aberto = a rodada para aí**, vermelha, e nada publica.
4. Lê `cadence.json` + `pipeline/memory.json`: no teto do dia ou antes do intervalo mínimo, a rodada termina cedo (isso é comportamento correto, não falha) — mas ainda gira a capa, ver passo 12.
5. `pick-lead.js` escolhe a pauta (fonte que abre, não publicada, não tentada há menos de `lead_retry_hours`, com menos de `lead_max_age_days`). **Rodar isto à mão também compromete a pauta** (`em_andamento` em `memory.json`, fora da fila por 6h): para olhar a fila sem tocar nela, use `node tools/ingest.js --show`.
6. `new-post.js` → brief + `pipeline/drafts/<slug>/prompt.md`. **O `prompt.md` é o contrato**: quem escreve é o `write.js` ou um humano, e o `draft.json` que sair precisa obedecê-lo.
7. `write.js` escreve o `draft.json` (JSON puro, sem cercas de código, sem fonte/número/preço inventado além do brief).
8. Foto real: `find-cover.js` → `publish.js` aborta sem foto. Placa SVG só entra quando a matéria não tem foto (`make-cover.js` sai com exit 0 quando já há foto).
9. `check-post.js <slug>` — até 3 correções; reprovado na terceira, o rascunho fica para revisão humana e a pauta sai da fila por `reprovada` (72h).
10. `score.js --draft <slug>` — nota medida; quase-duplicata (≥72% de sobreposição) barra.
11. `publish.js <slug>` — catálogo, `build.js`, `build-sitemap.js`, `build-feed.js` (o `feed.xml` RSS: até 07/11 esta linha da documentação era falsa — nenhuma etapa regenerava o feed, e ele ficou cinco publicações parado), `meta-pages.js`, commit local `publish:`. **Nunca push.** Quem escreve `pipeline/state/cover-state.json` é o `build.js` que o publish chama, nunca o publish direto.
12. Rodada que passou pela manutenção mas **não** publicou (teto, distância mínima, sem pauta, reprovado, duplicata): `turno.js` chama `build.js` para girar a capa, senão a meta `cover_changes_per_day` iria a zero em silêncio nos dias sem matéria. Se esse build falhar, a rodada fecha vermelha — e o `finish()` ainda cobra a prova (`capaServiuRodada()` lê o estado do disco e exige troca na rodada), porque build verde sem troca no hero é a falha de três semanas repetida.

O passo 2 é `--daily` e não o build inteiro de propósito: build completo giraria a capa também e gastaria a única troca da rodada antes de a matéria inédita tomar o hero. A capa continua sendo decidida no passo 11 ou no 12. Prova do destravamento, com relógio falsificado e restauração byte a byte: `node .audit/teste-trava-picks.js` (22 conferências — planta o bloco de ontem, vê o doctor vermelho, gira para hoje, confere que o hero, o `cover-state.json` e o resto do `index.html` não se mexeram, e que rodar duas vezes é idempotente; mais a ordem lida do próprio `turno.js`, mordida por duas mutações: apagar o passo 2 e inverter a ordem com a manutenção).

A capa gira **em toda rodada do cron** (2/dia hoje, porque é o que o Actions entrega — ver a limitação medida acima), com matéria nova ou não: quem ainda não passou pelo hero toma a capa na primeira publicação da rodada e, sem inédita acima do piso, o `build.js` caminha um passo na lista de elegíveis e volta ao topo no fim do ciclo — rotação, nunca ping-pong A→B→A. Uma troca por rodada: o Actions chama o `build.js` várias vezes dentro da mesma rodada (uma pelo `publish.js`, outra pelo `girarCapa()`), e rebuild não é capa nova — por isso a trava da rodada vem ANTES da matéria inédita. Consequência medida em 07/11, três publicações na mesma rodada: a primeira foi ao hero, a segunda e a terceira saíram com `capa mantida` e só entram no hero na rodada seguinte. A unidade é a rodada (`check_hours`), não mais a janela dia/noite, e o dia da meta vai de 00:23 a 00:22 do fuso (a troca às 00:05 pertence à rodada das 20:23 de ontem). E troca só é registrada se o hero mudou de verdade para outra matéria: com uma única elegível no catálogo não há para onde girar, a rodada não se declara servida e o `turno.js` fecha vermelho. Publicações contam no **dia UTC**; a meta de capa conta o **dia da rodada** no fuso. É escolha documentada, não descuido.

Cada etapa imprime uma linha legível em `TURNO.md`, que o workflow commita mesmo em rodada vermelha — inclusive a causa de um abort do `publish.js` (exit 1).

## Gates que falham alto (não conte com eles silenciosamente)

| Gate | Onde | O que acontece quando falta |
|---|---|---|
| Manutenção vermelha | `doctor.js` | rodada para antes de escolher pauta |
| Teto > agenda | `lib/schedule.js` via `doctor.js` | erro `[cadence]` (meta inatingível por construção foi o que produziu 3 semanas de verde sem publicar) |
| `cron_expression` ≠ workflow | `doctor.js` | erro `[cadence]` de régua dupla |
| Cron ilegível ou workflow sem cron | `lib/schedule.js` via `doctor.js` | erro `[cadence]` — sem conferência o teto não vale nada, a rodada não publica |
| Sem foto real | `publish.js` | abort + issue aberta por `notify-foto.js` |
| Rodada que termina sem publicar | `turno.js` → `desfazerFotosDaRodada()` | toda imagem criada durante a rodada (jpg do `garantirFoto`, placa do `make-cover`) é apagada: foto de matéria que não saiu não entra no `git add -A` do workflow. O `finish()` faz isso, um `process.on("exit")` pega exceção sem catch e `SIGINT`/`SIGTERM` (Ctrl+C, `timeout-minutes` do Actions) passam pelo mesmo caminho; `publish.js` tem retrato e gancho próprios, para quem roda o publish à mão |
| Conflito de push | `.github/workflows/turno.yml` | resolve-se sozinho só nos arquivos que o próximo build regenera (`TURNO.md`, `pipeline/state/*`, HTML, `sitemap.xml`, `vercel.json`); catálogo, notas e memória bloqueiam a rodada em vermelho — nenhum `-X theirs` global para apagar matéria alheia |
| Repetir a mesma capa | `lib/cover-state.js` | não conta como troca: `registrarCapa` só grava quando o hero mudou de verdade para outra matéria (rebuild na mesma rodada é `mantida`, e uma elegível sozinha no catálogo não serve rodada) |
| Rodada que fecha sem troca de capa | `turno.js` → `capaServiuRodada()` | vermelho: o `finish()` lê `pipeline/state/cover-state.json` e exige `trocaNaRodada` na rodada em curso — inclusive na que publicou, onde quem girou foi o build chamado pelo `publish.js` |
| `cover_changes_per_day` ≠ nº de rodadas | `doctor.js` via `lib/cover-state.js` | erro `[cover]`: a meta tem de ser exatamente o número de horários do `check_hours`; régua de capa descolada da agenda é a mesma classe de defeito do "teto > agenda" |
| Today's Picks sem troca / bloco velho no ar | `doctor.js` via `lib/picks-rules.js` | erro `[picks]`: `picks_changes_per_day` ≠ 1, slot sem `"rotacao": "dia"`, pool abaixo de `limit + 1` (sem para onde girar), o bloco publicado ≠ o que a régua do dia calcula, `pick-item` escrito à mão fora dos marcadores, picks repetindo a capa. Foi assim que o bloco ficou 15 dias com o par de 29/out sob um rótulo que diz "hoje" |
| Portão que exige o produto de uma etapa posterior | `turno.js` passo 2 → `build.js --daily` | **travamento por construção**, a mesma família do "teto > agenda": o doctor cobra o bloco de hoje antes de o build que o produz rodar, a rodada morre na manutenção, o bloco não gira e a rodada seguinte morre igual. Medido em 10/11: três rodadas vermelhas seguidas no Actions, site congelado desde 08/11. A correção é a ordem — girar o bloco do dia ANTES da manutenção, sem tocar na capa. Prova: `node .audit/teste-trava-picks.js`; falsificação: tirar o filtro `--daily` do build deixa 4 conferências vermelhas (hero e capa se mexem junto) |
| Trava de arquivo do Windows no rename da escrita atômica | `tools/lib/atomic-write.js`, usado por `build.js` (HTML e fallback da capa), `lib/lastRuns.js`, `lib/memory.js` e `lib/cover-state.js` | o `tmp + rename` continua atômico, mas o rename ganha fôlego (6 tentativas, 600 ms no pior caso) **só** para `EPERM`/`EACCES`/`EBUSY`. Medido em 10/11: o antivírus/indexador segurou o `index.html` por um instante e o build estourou com `EPERM ... rename 'index.html.tmp' -> 'index.html'`, derrubando a rodada sem defeito editorial nenhum. Erro de outra natureza (`ENOENT`, caminho errado) sobe na primeira, sem gastar tentativa. A memória da capa e o fallback do hero entraram na mesma passada porque eram escrita direta: kill no meio trunca o JSON e o `loadState` engole devolvendo estado vazio — memória zerada em silêncio. Prova: `node .audit/teste-trava-arquivo.js` (helper, gravadores, build inteiro com a trava simulada, mutação que troca o helper de volta por `fs.renameSync` e vê o build morrer com uma falha só, e a invariante de que nenhum rename cru sobrou em `tools/`) |
| Card de matéria escrito à mão fora dos marcadores | `doctor.js` via `lib/slot-markup.js` | erro `[slot-stale]`: todo slot de `placements.json` é conferido — card da classe do slot que aponta para matéria do catálogo e está fora da região automática não é regenerado por ninguém e ainda rouba vaga. Vermelho também quando o rótulo `count_pill` (ALL CULTURE) discorda da grade, porque o número é consequência da grade; quando o primeiro card de um feed `prioridade-ineditas` repete o que já está acima dele com inédita mais abaixo; e quando um slot `acervo` deixa peça da editoria de fora. Prova por mutação: `node .audit/muta-slot-stale.js` (11 casos — matéria solta na home e na editoria, classe com variante `is-featured`, review escrita à mão, pill discordando, ordem do feed, falta de acervo e a curadoria sem link de catálogo que o portão NÃO pode morder; os três de alcance estão na linha seguinte) |
| Matéria ou review inalcançável por navegação | `doctor.js` §7 | erro `[orphan]`: nenhuma OUTRA página tem **link** para a peça — menção do slug em texto ou num `<script>` não conta, e a própria página não conta porque é o destino. Com cap de feed no catálogo, a cauda da editoria sumia do site sem que nada acusasse (medido no HEAD~1 09/11: 2 matérias sem link de entrada, uma cortada do feed de science e outra do de culture). Review entrou na mesma régua em 09/11: o `for` rodava só sobre `DB.articles` e `r-<id>.html` nem era considerado. Prova: casos 9, 10 e 11 de `node .audit/muta-slot-stale.js`, sendo o 10 a menção de texto no lugar do link e o 11 uma review nova que ninguém linka |
| Slot gerando menos que o `limit` | `doctor.js` | aviso `[slot-vazio]` com a conta do acervo na régua — falta matéria na editoria (o acervo tech tem 5 peças; é teto honesto, não defeito). Slots `"acervo"` não têm cap, então não passam aqui |
| Rodada que falha em etapa de publicação | `turno.js` | exit 1 (`publish.js` abortou, nenhum provedor armado, ou alerta registrado) — workflow fecha vermelho. Parar cedo **por cadência** é exit 0 por desenho: nada a publicar, rodada verde — desde que o `build.js` do passo 12 rode; capa quebrada é vermelha mesmo sem matéria nova |

Para testar um gate, mute a entrada e veja a cor mudar — não confie na descrição dele.

## Estado que sobrevive entre rodadas

Versionado: `pipeline/memory.json` (pautas tentadas + publicações), `pipeline/scores.json` (notas), `pipeline/state/cover-state.json`, `pipeline/state/hero-fallback.html`.
Ignorado (renasce vazio no runner): `pipeline/drafts/`, `pipeline/leads/`, `pipeline/state/seen.json`, `tools/reports/`.

## Onde ler mais

`tools/AUTOMATION.md` (as três camadas, provedores, painel, troca de capa), `tools/PUBLISHING.md` (domínio/deploy), `voice/WRITER_PROMPT.md` (contrato do texto), `voice/EDITORIAL_VOICE.md` (vozes e bylines).
