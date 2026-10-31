# Automação — as três camadas

Node puro: sem npm, sem dependência, sem serviço pago. A única chave de API é a do Gemini (free tier), usada só pela Camada 3. Rodam na sua máquina com o Node que já existe (v24); a Camada 3 também roda na nuvem.

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
- `pipeline/state/seen.json` — URLs já vistas (últimas 4000). **Só vale na sua máquina**: `state/` é gitignored, então no Actions ele nasce vazio todo turno. O que impede a fila de repetir o que já está no ar, em qualquer lugar, é `pipeline/memory.json` + as fontes do catálogo (ver Camada 3).

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
node tools/make-cover.js <slug>      # miniatura SVG → images/covers/<slug>.svg
node tools/check-post.js <slug>      # editor mecânico → review.md, exit 1 se reprovar
node tools/score.js --draft <slug>   # nota 0–10 calculada por rubrica (não é opinião)
node tools/publish.js <slug>         # só com check verde: catálogo + capa + feeds + sitemap + commit
```

- `pick-lead.js` só entrega pauta cuja fonte abre agora: feed de notícia às vezes publica item com link morto, e o editor mecânico reprova link 404 depois que o texto já custou chave. Pautas descartadas saem no stderr.
- `new-post.js` monta o brief no formato exato do input contract de `voice/WRITER_PROMPT.md`, escolhe a byline pelo território (`EDITORIAL_VOICE.md` §4) e embute a memória anti-repetição de `voice/state/last_runs.json` no prompt.
- `make-cover.js` desenha a miniatura sem banco de imagens e sem custo: placa 1200×675 em SVG, com a cor do pilar (a mesma de `css/styles.css`), o kicker e o título quebrado em até 4 linhas. É determinística — mesmo slug, mesma placa — e só preenche `image`/`imageAlt` quando o draft ainda está sem capa. O turno roda ela de novo depois de cada reescrita, porque o modelo devolve `image: null` e `write.js` preserva a capa anterior.
- `check-post.js` mede tudo no texto, não confia no `self_check`: tags permitidas, vocabulário banido (lista única em `WRITER_PROMPT.md`), templates estruturais (máx. 1, nenhum como fecho), ritmo (frase ≤30 palavras, frase curta obrigatória, 1 parágrafo de uma frase, 1 parágrafo longo), humor ≤2 e zero em pauta de morte, abertura/fecho diferentes da última peça do registro, fontes alcançáveis, links do texto presentes nas fontes, comprimento (abaixo de 70% do alvo da pauta é reprovado — o mesmo número que o prompt pede), e a regra dura: **"we tested" só com `products[].tested=true` e protocolo em `test_notes`**.
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

Uma automação local do Qoder (`Homeworld Press — turno editorial 5x/dia`, cron `0 7,10,14,17,21 * * *` em America/Sao_Paulo) faz, nesta ordem: `ingest.js` → `doctor.js --offline` (para tudo se houver erro, e a rodada fecha vermelha) → confere o teto diário **e** a distância mínima da última publicação em `pipeline/cadence.json` (os dois **antes** de escolher pauta) → escolhe a melhor pauta nova → `new-post.js` → escreve o `draft.json` seguindo `prompt.md` → `make-cover.js` → `check-post.js` (máx. 3 correções) → `score.js` (para se for duplicata) → `publish.js`. Nunca faz push, nunca faz deploy, nunca toca na identidade visual.

- **Teto de publicação:** `max_publishes_per_day` (hoje 1). As 5 rodadas diárias são *verificações*; publicar 5x/dia em domínio recém-reativado é o perfil exato que os buscadores tratam como fábrica de conteúdo. Para furar o teto uma vez: `node tools/publish.js <slug> --force-cadence`.
- **Distância entre publicações:** `min_hours_between_publishes` (hoje 20). Sem ele, duas rodadas perto da meia-noite UTC publicavam no mesmo dia com 43 minutos de diferença. É checado **antes** de escolher a pauta e **vale depois da virada do dia UTC**: com uma peça às 21h, as rodadas da manhã seguinte pararão cedo em vez de percorrer brief + texto + editor para serem barradas no `publish.js`. Se o `pipeline/memory.json` estiver ilegível, o gap cai no histórico dos commits `publish:` — a trava não abre junto com o teto.
- **A memória do robô: `pipeline/memory.json`.** Versionada, é a única coisa que sobrevive entre rodadas no runner do Actions (`drafts/`, `leads/` e `state/` são gitignored e nascem vazios). Guarda, por URL de fonte normalizada (`utm_`, barra no cabo, âncora, http→https — o caminho continua sensível a maiúsculas, porque no servidor ele é), o resultado de cada tentativa — `em_andamento`, `falha_brief`, `falha_texto`, `falha_publicacao`, `fonte_inalcancavel`, `reprovada`, `publicada` — e a lista das publicações com data. É o que o teto lê e o que impede a mesma pauta de ser reescolhida três rodadas seguidas. Janela de re-tentativa por resultado em `lead_retry_hours`; `publicada` nunca volta.
- **Idade da pauta:** `lead_max_age_days` (hoje 7). Uma fonte de 24 dias não é notícia; era isso que entrava no ar quando a nota vinha de palavra-chave e não de frescor. Sem data legível no feed, a pauta **não** é descartada.
- **Anti-duplicata tem três portas,** todas com a mesma definição em `tools/lib/memory.js`: a URL da fonte já citada por matéria no ar (`pick-lead`, `ingest`, `check-post`), o título da fonte já citada — pega coluna recorrente, que sai toda semana com URL nova (`pick-lead`) — e a quase-duplicata de texto calculada por `score.js`.
- **Painel:** `node tools/admin.js` sobe em `http://127.0.0.1:8099` (só nesta máquina). Mostra estado, rascunhos com veredito, pautas com botão de brief, ranking com badge de capa, ajuste manual de nota e os últimos logs. Os botões chamam os mesmos scripts; o PUBLICAR só habilita com check verde.
- **Para pausar o robô:** desative a automação no Qoder (Automations) ou mude `max_publishes_per_day` para 0 — as verificações continuam, a publicação para.
- **Contabilidade alta e clara:** se o commit `publish:` local falhar, `publish.js` escreve `AVISO:` e `turno.js` fecha a rodada em vermelho. Uma rodada que publica sem registrar é pior que uma rodada que não publica, porque o teto do dia seguinte lê 0/1 e o robô repete a fonte. Se o *registro* em `pipeline/memory.json` estourar, o `publish.js` desfaz a publicação inteira (catálogo, HTML, sitemap, notas, memória e last_runs) e sai vermelho — porque o último passo do workflow faz `git add -A` mesmo em rodada falha, e um artigo no ar sem contabilidade seria empurrado com o rótulo `turno:`.

### O mesmo turno na nuvem, com o seu PC desligado

`.github/workflows/turno.yml` roda `node tools/turno.js` no GitHub Actions, com as chaves de escrita guardadas em **Settings → Secrets**. Diferenças que importam:

- **O cron é UTC.** `0 7,10,14,17,21` = 04, 07, 11, 14 e 18 no horário de Brasília. E o gatilho agendado do GitHub é *best-effort*: em dia de fila ele simplesmente não dispara. `Run workflow` na aba Actions força uma rodada na hora.
- **Provedores de texto: `pipeline/providers.json`.** O arquivo lista os provedores *na ordem em que devem ser tentados* e diz, para cada um, o **nome** do segredo que guarda a chave — nunca a chave. Provedor sem segredo no ambiente fica inerte; provedor que responde 503/429 é esperado e tentado de novo; provedor que recusa (chave inválida, nome morto) é descartado e a rodada passa para o próximo. Some a chave em Secrets e o provedor entra sozinho na fila, sem mexer em código.
- **O segredo de escrever é `tools/write.js`**, que não tem lista fixa de modelos: pergunta a cada chave quais existem (`GET .../models`), ordena por versão, e quando a API do Google responde "use models/X", segue a dica. Nome de modelo aposentado não derruba mais a rodada.
- **Diagnóstico sem gastar rodada nem cota:** `node tools/write.js --check` mostra quem está armado, quem está sem chave e a fila de modelos de cada um. Zero geração.
- **Se a rodada para**, o motivo fica em `TURNO.md` (commitado pelo próprio robô) com uma linha por `provedor/modelo` tentado. O commit do relatório roda com `if: always()`.
- **Rodada vermelha não sobe matéria ao ar.** O mesmo `if: always()` é o risco: ele faria `git add -A` em qualquer resíduo deixado no diretório e a matéria entraria com o rótulo `turno:`, sem commit `publish:` e sem contabilidade. Antes do `add`, se a etapa da rodada não terminou `success`, o workflow recua TUDO para o HEAD (`git checkout HEAD -- .` + `git clean -fdq`) e devolve ao lugar só os dois arquivos de registro — `TURNO.md` e `pipeline/memory.json`, que dizem o que a rodada tentou e travam a reoferta da mesma fonte. Recuo geral em vez de lista de caminhos: uma saída nova de qualquer ferramenta não escapa por esquecimento. Como o `publish:` legítimo já virou HEAD, a matéria publicada de verdade continua no ar — só o que ficou pela estrada é descartado. `TURNO.md` e `pipeline/memory.json` seguem sendo commitados: é o registro do que a rodada tentou.
- **Push = deploy.** O workflow commita `TURNO.md` e o que a rodada mudou; a Vercel publica a cada push em `main`. Não existe mais passo manual de upload (ver [PUBLISHING.md](PUBLISHING.md)).

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

O projeto é um repositório Git (branch `main`, remoto `github.com/yuryfigueiredo/Site-wordhomepress`). Cada publicação vira um commit; o baseline `82c6db3` é o site auditado. `pipeline/drafts/`, `pipeline/leads/`, `pipeline/state/` e `tools/reports/` estão no `.gitignore` porque rascunho não publicado em repositório público é rascunho publicado. Push em `main` agora é deploy: a Vercel publica a cada push.

## O que continua dependendo de gente

- **Domínio.** O site está no ar em `site-homeworldpress.vercel.app`, mas os canonicals de todas as páginas apontam para `homeworldpress.com` — e esse domínio ainda responde com a página de estacionamento do GoDaddy. Enquanto os nameservers não forem trocados no DomainControl, o Google vê um canonical que não é o site. Passo a passo em [PUBLISHING.md](PUBLISHING.md).
- **Conta Amazon Associates.** Sem a sua Store ID real, os 184 links com a tag `homeworldpres-20` não rendem nada. Depois de aprovado, a troca é `node tools/set-affiliate-tag.js <sua-tag>` (acima).
- **"Nós testamos."** Só sai da sua mão. Sem aparelho na mão, o texto é comparação de especificações e precisa se chamar isso.
- **Fotos de produto.** As imagens do review de e-readers são Unsplash, e algumas não batem com o produto (tem luminária ilustrando um Kindle Scribe).
- **Direito de imagem de capas.** As capas históricas da editora vêm do arquivo do James Gauthier; antes de publicar, confirme a permissão por escrito.
- **Medição de tráfego.** Hoje não há nenhuma: escolher entre Google Search Console (o dado que decide a estratégia de afiliado) e um script de analytics é decisão sua.
- **Nota manual no painel.** Opcional. Serve para corrigir o robô quando ele erra de julgamento, não para substituí-lo.
