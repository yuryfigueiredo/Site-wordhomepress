# Como o site vai para o ar

## O fluxo, de ponta a ponta

```
turno (timer local hwp-turno, 4x/dia — o Actions está desabilitado)
  └─ coleta pauta → redator armado escreve → check-post → nota → publish.js
       └─ commita e faz push para main
            └─ Vercel detecta o push e publica sozinha
                 └─ homeworldpress.com no ar + analytics
```

Nenhuma etapa tem upload manual. O `publish.js` já commita local e **nunca** faz push;
quem empurra é o runner — `~/.local/bin/hwp-turno.sh` na máquina que hoje é o relógio,
desde 13/11 — e a Vercel publica a cada push em `main`. É o mesmo mecanismo dos outros
projetos.

## Por que Vercel e não Cloudflare Pages

Três motivos concretos, todos verificados:

1. **Deploy por git.** O Cloudflare Workers (o caminho que usamos primeiro) só aceita
   upload de pasta. Toda publicação seria arrastar `dist/` manualmente — uma ponta
   solta exatamente no lugar que precisa ser automático.
2. **Analytics grátis no plano Hobby.** Visitantes, page views, bounce rate,
   referrers, países e dispositivos. O Workers de arquivos estáticos devolve
   "Metrics is unavailable for Workers with only static assets" — ou seja, nada.
3. **Sem o 307 cortando `.html`.** O roteador de assets do Workers esconde a
   extensão com redirect temporário, brigando com os canonicals. A Vercel não faz
   isso, e o `vercel.json` já fixa o comportamento.

## Configuração do projeto na Vercel

Ao importar `yuryfigueiredo/Site-wordhomepress`:

| Campo | Valor |
|---|---|
| Framework Preset | `Other` |
| Build Command | `node tools/build-dist.js` |
| Output Directory | `dist` |
| Install Command | vazio (o build não usa `node_modules`) |

O `vercel.json` na raiz cuida de todos os redirects e cabeçalhos. Não precisa criar
nada na interface.

## O que o build garante

`tools/build-dist.js` não copia a pasta inteira — ele monta um manifesto e recusa o
que não é site:

- `.audit/`, `tools/`, `pipeline/`, `voice/`, `.git/` fora do pacote
- rascunhos editoriais, relatórios e o histórico do git nunca são publicados
- **stubs do GitHub Pages ficam fora**: `tools/make-stubs.js` gera contorno com
  `meta refresh` + `noindex` porque o Pages não lê `_redirects`. Em Vercel/Workers o
  301 nativo faz o mesmo trabalho melhor, e o stub só brigaria com ele.
- **em CI, cada stub removido precisa ter uma regra de 301 correspondente** em
  `_redirects` ou `vercel.json`. Se alguém criar um stub novo e esquecer a regra, o
  build falha com `saiu do pacote mas nenhuma regra de 301 cobre essa URL` — porque
  o resultado seria uma URL histórica viva virando 404 em silêncio.

## Domínio próprio

Vercel → Settings → Domains → `homeworldpress.com`. Ela mostra os dois nameservers
dela. Você troca na tela do DomainControl que já conhece (aba "Servidores de nomes"),
deixando de usar `ns11/ns12.domaincontrol.com`. O HTTPS é emitido sozinho depois que
o DNS valida. Adicione `www.homeworldpress.com` como segundo domínio apontando para o
mesmo projeto — os canonicals do site todo usam o ápice sem `www`.

## Quando algo publicar errado

O histórico de deploys da Vercel tem botão **Rollback** em cada linha. Um clique e a
versão anterior volta ao ar, sem tocar em git. É o freio que o upload manual não tem.

## GitHub Pages: não existe, e o job que tentava publicar foi removido

O workflow tinha um job `pages` que montava `_site/` e publicaria uma cópia em
`yuryfigueiredo.github.io`. Ele **nunca publicou nada**: o `configure-pages` falha em
todas as rodadas porque o Pages está desligado no repositório. O efeito prático era
deixar o workflow vermelho toda vez, escondendo que a rodada editorial deu certo.
Removido em 2026-10-30. Se um dia você ligar o Pages de propósito, não volte a job:
o site duplicado em outro domínio compete com o seu.

## O relógio: duas agendas que têm de bater

O cron de verdade é o de `.github/workflows/turno.yml` (`23 11,15,19,23 * * *`, sempre
UTC) porque é dele que `tools/lib/schedule.js` e o `doctor.js` conferem a régua de
`pipeline/cadence.json`. O workflow está desabilitado na aba Actions, e o que dispara
hoje é o `OnCalendar=*-*-* 08,12,16,20:23:00` do `~/.config/systemd/user/hwp-turno.timer`
— mesmo minutos, no fuso da máquina (America/Sao_Paulo, UTC−3).

Mudar um sem o outro não quebra o portão: quebra o relógio, porque a régua passa a
prometer troca de capa para rodadas que ninguém dispara. São três lugares para mexer
juntos — o `cron_expression` do JSON, o cron do workflow e o `OnCalendar` do timer.
Para forçar uma rodada agora: `systemctl --user start hwp-turno.service`.
