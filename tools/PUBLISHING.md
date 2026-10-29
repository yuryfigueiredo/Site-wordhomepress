# Como o site vai para o ar

## O fluxo, de ponta a ponta

```
turno (GitHub Actions, 5x/dia)
  └─ coleta pauta → Gemini escreve → check-post → nota → publish.js
       └─ commita e faz push para main
            └─ Vercel detecta o push e publica sozinha
                 └─ homeworldpress.com no ar + analytics
```

Nenhuma etapa tem upload manual. O `publish.js` já commita local, o workflow já faz
push, e a Vercel publica a cada push em `main`. É o mesmo mecanismo que você já usa
nos outros projetos.

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

## GitHub Pages: desligue

O workflow `.github/workflows/turno.yml` tem um job `pages` que publicaria uma cópia
do site em `yuryfigueiredo.github.io`. Com a Vercel no ar, isso é um site duplicado
disputando o mesmo conteúdo. Settings → Pages → Unpublish site.
