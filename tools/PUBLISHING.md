# Colocar o homeworldpress.com no ar

Guia para publicar sem linha de comando e sem custo. Feito para ser seguido numa sessão só.

O que existe hoje: o domínio `homeworldpress.com` está **parked** no DomainControl (registro `A @ → Parked`, nameservers `ns11/ns12.domaincontrol.com`). Isso não hospeda nada — só segura o nome. O site está parado nesta pasta, e é daqui que ele vai sair.

Por que Cloudflare Pages e não outra coisa: o arquivo [`_redirects`](../_redirects) da raiz já foi escrito para ele (linha 2 diz "CLOUDFLARE PAGES SURGICAL 301 REDIRECTS"). Ele guarda as URLs históricas de 2008–2025 que a Wikipedia, ERBzine e Comics.org ainda apontam para cá. Perder isso é perder o ranqueamento antigo. Netlify lê o mesmo formato, então serve como plano B sem mudar nada.

O Qoder Sites **não** serve para isto: ele só endereça em `*.qoder.site`, sem domínio próprio. Dá para ter uma cópia de lá, mas a Amazon quer o domínio real público.

---

## Fase 1 — site no ar em URL pública (≈10 min)

**1. Recrie o pacote.** Na pasta do projeto:

```
node tools/build-dist.js
```

Saída esperada: `dist/ montado: 37 arquivos, 15 páginas, ~1.69 MB` e `pacote validado`. Se der ERRO, pare e leia a linha — o checador reclama se vazar arquivo de trabalho ou se faltar página.

**2. Crie conta em [pages.cloudflare.com](https://pages.cloudflare.com).** E-mail e senha, sem cartão.

**3. Faça o upload.** No painel: **Workers & Pages → Create → Pages → Upload and deploy**. Arraste a pasta `dist` inteira (não os arquivos soltos) para a área de upload. Dê um nome ao projeto, ex.: `homeworldpress`.

**4. Confirme.** Ele devolve algo como `https://homeworldpress.pages.dev`. Abra a raiz e uma página de review. Se isso abrir, o site está no ar — a URL `pages.dev` já é pública e indexável.

Detalhe que importa: o [`js/app.js:409`](../js/app.js) fixa `SITE_ORIGIN = "https://homeworldpress.com"`. Em `pages.dev` os canonicals e og:url apontam para o domínio final. É o comportamento correto para a versão definitiva; na URL de teste só significa que o preview não é canônico para si mesmo.

## Fase 2 — o domínio próprio (≈15 min + propagação)

**5.** No projeto Pages: **Custom domains → Set up a custom domain → homeworldpress.com**.

**6.** A Cloudflare vai dizer que o DNS está em outro lugar e oferecer duas saídas:

- **Migrar os nameservers (recomendado).** Ela te dá dois endereços tipo `kara.ns.cloudflare.com` / `walt.ns.cloudflare.com`. Você volta na tela que já conhece — DomainControl → **Servidores de nomes** — e troca os `ns11/ns12.domaincontrol.com` por esses. É a tela da sua captura de tela, aba "Servidores de nomes".
- **CNAME setup (ficar onde está).** Você mantém os nameservers do DomainControl e cria só um registro `CNAME` apontando para o projeto. Dá menos trabalho agora e a Cloudflare aceita, mas o registro `A @ → Parked` que está lá hoje precisa ser removido ou ele briga com o CNAME.

Com nameservers na Cloudflare, a Fase 3 some — ela cria os registros sozinha.

**7. HTTPS.** A Cloudflare emite o certificado automaticamente depois que o domínio valida. Não tem nada para configurar; só espere o status sair de "Pending".

**8. `www`.** Os [`canonical`](../js/app.js) e `og:url` do site todo usam o ápice sem `www`, e a [`.htaccess`](../.htaccess) seção 3 faz `www → ápice`. Adicione `www.homeworldpress.com` como segundo custom domain apontando para o mesmo projeto, para não dividir o site em dois.

---

## O que ainda é decisão sua, não passo de guia

**Direito de imagem das capas.** [`dumarest/index.htm`](../dumarest/index.htm) publica 38 capas digitalizadas do arquivo do James Gauthier, com um "ALL RIGHTS RESERVED" genérico no rodapé e nenhuma permissão declarada. As capas de Dune, Neuromancer e Stormlight em `images/books/` são a mesma categoria de risco. Antes de por isso no ar publicamente, confirme a permissão por escrito — depois de indexado, retirar é mais caro.

**Republicar.** Upload manual não é automatizável: cada mudança é arrastar a pasta de novo. Se você quiser que o `git push` publique sozinho, o caminho é conectar o projeto a um repositório no GitHub e apontar o Pages para lá — aí o build das Camadas 1 e 2 fecha o ciclo. Não é necessário agora.

**Ordem com a Amazon.** Esta fase 1 já desbloqueia o cadastro: a Amazon pede uma URL pública, e `pages.dev` resolve. Faça o cadastro com o domínio real se a Fase 2 terminar antes, ou com a URL `pages.dev` e troque depois no painel de settings. A divulgação de afiliado que a política exige já existe no site: o texto "As an Amazon Associate..." no rodapé de todas as páginas e a página [`disclosure.html`](../disclosure.html).

## Depois de no ar

Rode `node tools/doctor.js` — ele passa a checar os links externos de verdade, inclusive contra o domínio publicado. E confirme no navegador que `/index.htm` e `/dumarest` fazem os 301 do `_redirects`: esses redirecionamentos só funcionam hospedado, não no servidor de teste local.
