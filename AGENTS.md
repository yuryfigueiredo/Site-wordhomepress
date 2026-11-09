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

**Limitação do GitHub Actions (medido em 08/11):** o scheduler do free tier entrega apenas 2 das 6 rodadas agendadas por dia — os outros 4 slots somem silenciosamente, sem aviso. O cron original (`23 3,7,11,15,19,23 * * *`) foi reduzido para os 2 horários que consistentemente dispararam (15:23 e 23:23 UTC). O teto de publicações/dia caiu de 4 para 2 para espelhar o que o relógio realmente entrega. O aviso `cadence-entrega` do doctor agora deve ficar silencioso: a régua bate com a realidade.

Mudar uma destas linhas exige mudar o número no `cadence.json` — se divergirem, o doctor fecha vermelho e a rodada não publica.

As réguas que `build.js` e `doctor.js` usam são módulos únicos, não cópia: `tools/lib/cover-rules.js` decide "qual matéria pode ser capa" (o painel, o build e o doctor veem a mesma lista), `tools/lib/picks-rules.js` decide "quais são as escolhas de hoje do Today's Picks" (mesma regra, mesmas três bocas), `tools/lib/slot-markup.js` decide "o que é um card de slot e onde fica a região automática" (o formato do marcador `hwp:auto`, a classe do `<article>` e a leitura das regiões) e `tools/lib/catalog-notes.js` injeta a nota medida de `pipeline/scores.json` no catálogo. Duas implementações paralelas foi o que fez o doctor acusar "nenhuma matéria passa do piso" com 7.8 no ar.

## Nada na home é escrito à mão — com três exceções curadas

Todo bloco listado em `pipeline/placements.json` é regenerado pelo `build.js` entre os marcadores `<!-- hwp:auto:<slot>:start/end -->`. Um card de matéria FORA desses marcadores é dois defeitos: ninguém o regenera (a grade "01 // CULTURE" ficou semanas com os mesmos 6 cards sob um rótulo que promete novidade) e ele entra na conta de `takenIds` do build, roubando vaga do próprio slot — a CULTURE tinha `limit` 6 e gerava 3. Foi o mesmo mecanismo que congelou a coluna central da grade de 3 colunas e abriu um vão preto de 807px ao lado do hero, medido em 09/11.

O que continua à mão é curadoria que não aponta para o catálogo: a lista "TRENDING // TOP 5", os `rec-card` de reviews e as duas placas de promoção do Dumarest (`dumarest/index.htm`). O portão `[slot-stale]` ignora card cujo link não é uma matéria do catálogo — é escolha deliberada, não buraco.

Três modalidades de desconto em `build.js`, todas por slot: `dedup: "nenhum"` (páginas de categoria: o feed é o acervo, repetir a curadoria do topo é normal), `dedup: "somente-automatico"` (grade CULTURE: só os blocos automáticos descontam, senão as duas matérias do trending tiravam vaga e a grade de 3 colunas fechava com 5 — buraco de 437px na última linha) e o desconto do arquivo inteiro, que vale para os slots da home que dividem tela.

## Sequência de uma rodada

```bash
node tools/turno.js              # a rodada inteira, com o que estiver armado
```

Passo a passo, que é o que `turno.js` executa — e é também o caminho manual:

1. `ingest.js` → `doctor.js --offline`. **Erro aberto = a rodada para aí**, vermelha, e nada publica.
2. Lê `cadence.json` + `pipeline/memory.json`: no teto do dia ou antes do intervalo mínimo, a rodada termina cedo (isso é comportamento correto, não falha) — mas ainda gira a capa, ver passo 10.
3. `pick-lead.js` escolhe a pauta (fonte que abre, não publicada, não tentada há menos de `lead_retry_hours`, com menos de `lead_max_age_days`). **Rodar isto à mão também compromete a pauta** (`em_andamento` em `memory.json`, fora da fila por 6h): para olhar a fila sem tocar nela, use `node tools/ingest.js --show`.
4. `new-post.js` → brief + `pipeline/drafts/<slug>/prompt.md`. **O `prompt.md` é o contrato**: quem escreve é o `write.js` ou um humano, e o `draft.json` que sair precisa obedecê-lo.
5. `write.js` escreve o `draft.json` (JSON puro, sem cercas de código, sem fonte/número/preço inventado além do brief).
6. Foto real: `find-cover.js` → `publish.js` aborta sem foto. Placa SVG só entra quando a matéria não tem foto (`make-cover.js` sai com exit 0 quando já há foto).
7. `check-post.js <slug>` — até 3 correções; reprovado na terceira, o rascunho fica para revisão humana e a pauta sai da fila por `reprovada` (72h).
8. `score.js --draft <slug>` — nota medida; quase-duplicata (≥72% de sobreposição) barra.
9. `publish.js <slug>` — catálogo, `build.js`, `build-sitemap.js`, `build-feed.js` (o `feed.xml` RSS: até 07/11 esta linha da documentação era falsa — nenhuma etapa regenerava o feed, e ele ficou cinco publicações parado), `meta-pages.js`, commit local `publish:`. **Nunca push.** Quem escreve `pipeline/state/cover-state.json` é o `build.js` que o publish chama, nunca o publish direto.
10. Rodada que passou pela manutenção mas **não** publicou (teto, distância mínima, sem pauta, reprovado, duplicata): `turno.js` chama `build.js` para girar a capa, senão a meta `cover_changes_per_day` iria a zero em silêncio nos dias sem matéria. Se esse build falhar, a rodada fecha vermelha — e o `finish()` ainda cobra a prova (`capaServiuRodada()` lê o estado do disco e exige troca na rodada), porque build verde sem troca no hero é a falha de três semanas repetida.

A capa gira **em toda rodada do cron** (6/dia), com matéria nova ou não: quem ainda não passou pelo hero toma a capa na primeira publicação da rodada e, sem inédita acima do piso, o `build.js` caminha um passo na lista de elegíveis e volta ao topo no fim do ciclo — rotação, nunca ping-pong A→B→A. Uma troca por rodada: o Actions chama o `build.js` várias vezes dentro da mesma rodada (uma pelo `publish.js`, outra pelo `girarCapa()`), e rebuild não é capa nova — por isso a trava da rodada vem ANTES da matéria inédita. Consequência medida em 07/11, três publicações na mesma rodada: a primeira foi ao hero, a segunda e a terceira saíram com `capa mantida` e só entram no hero na rodada seguinte. A unidade é a rodada (`check_hours`), não mais a janela dia/noite, e o dia da meta vai de 00:23 a 00:22 do fuso (a troca às 00:05 pertence à rodada das 20:23 de ontem). E troca só é registrada se o hero mudou de verdade para outra matéria: com uma única elegível no catálogo não há para onde girar, a rodada não se declara servida e o `turno.js` fecha vermelho. Publicações contam no **dia UTC**; a meta de capa conta o **dia da rodada** no fuso. É escolha documentada, não descuido.

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
| Card de matéria escrito à mão fora dos marcadores | `doctor.js` via `lib/slot-markup.js` | erro `[slot-stale]`: todo slot de `placements.json` é conferido — card da classe do slot que aponta para matéria do catálogo e está fora da região automática não é regenerado por ninguém e ainda rouba vaga. Vermelho também quando o rótulo `count_pill` (ALL CULTURE) discorda da grade, porque o número é consequência da grade. Testado por mutação em 09/11: `node .audit/muta-slot-stale.js` (4 casos — card de matéria solto na home e numa página de editoria, pill discordando da grade, e a curadoria sem link de catálogo que o portão NÃO pode morder) |
| Slot gerando menos que o `limit` | `doctor.js` | aviso `[slot-vazio]` com a conta do acervo na régua — falta matéria ou ainda há markup solto descontando da fila (tech-feed: 5 de 8 porque o acervo tech tem 5 peças; é teto honesto, não defeito) |
| Rodada que falha em etapa de publicação | `turno.js` | exit 1 (`publish.js` abortou, nenhum provedor armado, ou alerta registrado) — workflow fecha vermelho. Parar cedo **por cadência** é exit 0 por desenho: nada a publicar, rodada verde — desde que o `build.js` do passo 10 rode; capa quebrada é vermelha mesmo sem matéria nova |

Para testar um gate, mute a entrada e veja a cor mudar — não confie na descrição dele.

## Estado que sobrevive entre rodadas

Versionado: `pipeline/memory.json` (pautas tentadas + publicações), `pipeline/scores.json` (notas), `pipeline/state/cover-state.json`, `pipeline/state/hero-fallback.html`.
Ignorado (renasce vazio no runner): `pipeline/drafts/`, `pipeline/leads/`, `pipeline/state/seen.json`, `tools/reports/`.

## Onde ler mais

`tools/AUTOMATION.md` (as três camadas, provedores, painel, troca de capa), `tools/PUBLISHING.md` (domínio/deploy), `voice/WRITER_PROMPT.md` (contrato do texto), `voice/EDITORIAL_VOICE.md` (vozes e bylines).
