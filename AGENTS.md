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

`pipeline/cadence.json` é a única fonte de verdade de ritmo; `tools/lib/schedule.js` + `tools/doctor.js` conferem se o que está no JSON é fisicamente possível com o cron que o GitHub executa de verdade (`.github/workflows/turno.yml`). Hoje: 6 verificações/dia no cron `23 3,7,11,15,19,23 * * *` UTC (00, 04, 08, 12, 16 e 20 em Brasília), teto de 4 publicações/dia, mínimo de 3h entre peças, 2 trocas de capa/dia (janela dia 03:00–12:59 e noite 13:00–02:59), piso de nota para a capa `cover_baseline` 6.5.

Mudar uma destas linhas exige mudar o número no `cadence.json` — se divergirem, o doctor fecha vermelho e a rodada não publica.

As réguas que `build.js` e `doctor.js` usam são módulos únicos, não cópia: `tools/lib/cover-rules.js` decide "qual matéria pode ser capa" (o painel, o build e o doctor veem a mesma lista) e `tools/lib/catalog-notes.js` injeta a nota medida de `pipeline/scores.json` no catálogo. Duas implementações paralelas foi o que fez o doctor acusar "nenhuma matéria passa do piso" com 7.8 no ar.

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
9. `publish.js <slug>` — catálogo, feeds, sitemap, commit local `publish:`. **Nunca push.** Quem escreve `pipeline/state/cover-state.json` é o `build.js` que o publish chama, nunca o publish direto.
10. Rodada que passou pela manutenção mas **não** publicou (teto, distância mínima, sem pauta, reprovado, duplicata): `turno.js` chama `build.js` para girar a capa, senão a meta `cover_changes_per_day` iria a zero em silêncio nos dias sem matéria. Se esse build falhar, a rodada fecha vermelha.

A capa é mantida dentro da janela (dia 03:00–12:59 / noite 13:00–02:59, fuso do `cadence.json`): um rebuild na mesma janela não troca se não houver matéria mais nova que a `era` registrada na última troca — foi o ping-pong que inflava a meta sem notícia. E troca só é registrada se o hero mudou de verdade para uma capa diferente: rodar build com uma matéria elegível sozinha no catálogo não serve janela. Publicações contam no **dia UTC**; a meta de capa conta o **dia das janelas** — 03:00 de um dia até 02:59 do seguinte, porque a janela da noite atravessa a meia-noite. É escolha documentada, não descuido.

Cada etapa imprime uma linha legível em `TURNO.md`, que o workflow commita mesmo em rodada vermelha — inclusive a causa de um abort do `publish.js` (exit 1).

## Gates que falham alto (não conte com eles silenciosamente)

| Gate | Onde | O que acontece quando falta |
|---|---|---|
| Manutenção vermelha | `doctor.js` | rodada para antes de escolher pauta |
| Teto > agenda | `lib/schedule.js` via `doctor.js` | erro `[cadence]` (meta inatingível por construção foi o que produziu 3 semanas de verde sem publicar) |
| `cron_expression` ≠ workflow | `doctor.js` | erro `[cadence]` de régua dupla |
| Cron ilegível ou workflow sem cron | `lib/schedule.js` via `doctor.js` | erro `[cadence]` — sem conferência o teto não vale nada, a rodada não publica |
| Sem foto real | `publish.js` | abort + issue aberta por `notify-foto.js` |
| Rodada que termina sem publicar | `turno.js` → `desfazerFotosDaRodada()` | toda imagem criada durante a rodada (jpg do `garantirFoto`, placa do `make-cover`) é apagada: foto de matéria que não saiu não entra no `git add -A` do workflow. `publish.js` tem o retrato e o gancho de exit dele mesmo, para quem roda o publish à mão |
| Repetir a mesma capa | `lib/cover-state.js` | não conta como troca: `registrarCapa` só grava quando o hero mudou de verdade para outra matéria (rebuild na mesma janela é `mantida`, e uma elegível sozinha no catálogo não serve janela) |
| Rodada que falha em etapa de publicação | `turno.js` | exit 1 (`publish.js` abortou, nenhum provedor armado, ou alerta registrado) — workflow fecha vermelho. Parar cedo **por cadência** é exit 0 por desenho: nada a publicar, rodada verde — desde que o `build.js` do passo 10 rode; capa quebrada é vermelha mesmo sem matéria nova |

Para testar um gate, mute a entrada e veja a cor mudar — não confie na descrição dele.

## Estado que sobrevive entre rodadas

Versionado: `pipeline/memory.json` (pautas tentadas + publicações), `pipeline/scores.json` (notas), `pipeline/state/cover-state.json`, `pipeline/state/hero-fallback.html`.
Ignorado (renasce vazio no runner): `pipeline/drafts/`, `pipeline/leads/`, `pipeline/state/seen.json`, `tools/reports/`.

## Onde ler mais

`tools/AUTOMATION.md` (as três camadas, provedores, painel, troca de capa), `tools/PUBLISHING.md` (domínio/deploy), `voice/WRITER_PROMPT.md` (contrato do texto), `voice/EDITORIAL_VOICE.md` (vozes e bylines).
