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

## O que continua dependendo de gente

- **Publicar.** Nada aqui escreve no site.
- **"Nós testamos."** Só sai da sua mão. Sem aparelho na mão, o texto é comparação de especificações e precisa se chamar isso.
- **Conta Amazon Associates.** Sem a sua Store ID real, os 147 links sem tag não rendem nada e a tag placeholder não paga.
- **Fotos de produto.** As imagens do review de e-readers são Unsplash, e algumas não batem com o produto (tem luminária ilustrando um Kindle Scribe).
- **Direito de imagem de capas.** As capas históricas da editora vêm do arquivo do James Gauthier; antes de publicar, confirme a permissão por escrito.
