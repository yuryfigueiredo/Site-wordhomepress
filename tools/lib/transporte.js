/* transporte.js — uma boca só para ler o sintoma de uma conexão que não respondeu.

   Por que existe: a lista de tokens de transporte já vivia dentro do `sonda()`
   do `pick-lead.js`, e o laço de tempo do `write.js` ia ganhar a segunda cópia
   dela agora. Duas implementações paralelas da mesma régua é o defeito desta
   doc: foi assim que o `TimeoutError` com `code` 23 do AbortSignal (NÚMERO, não
   string) caiu em `nao-abre` e enterrou 8 pautas sãs por 12h com a rodada verde
   (medido 15/11, corrigido em c59a7f6). Quem enxerga o sintoma decide o peso,
   mas o reconhecimento do sintoma é um módulo só.

   Três vereditos, e a diferença entre eles é o que custa fila:
   · `sem-rede`  — o pacote não saiu ou a conexão foi recusada: é fato DAQUI.
     Nenhuma evidência de que a fonte existe, nada pode ser marcado como morto.
   · `empacou`   — a conexão saiu e não devolveu resposta dentro do prazo: também
     não é prova de fonte morta, mas um provedor vivo pode empacar por carga.
   · `outra`     — restou o que tem resposta HTTP do outro lado (404, 403, 500
     com corpo), e aí sim o veredito é do destino, não do transporte.           */
/* Os tokens abaixo são todos "fato DAQUI, não do destino": a rede não levou o
   pacote, a conexão foi recusada ou resetada, o DNS não respondeu, ou — no caso
   do redator que é um binário local — o binário nem está no disco. Nenhum deles
   é evidência de que o serviço do outro lado está morto, e por isso nenhum
   merece espera: espera é para o que respondeu e pediu para voltar.            */
const SEM_REDE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENETDOWN|UND_ERR_CONNECT|getaddrinfo|no route|não está no disco/i;
const EMPACA = /TimeoutError|due to timeout|ETIMEDOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/i;

/* Aceita o Error da exceção ou uma string com o corpo da resposta — o que
   importa é que a leitura dos tokens aconteça num lugar só.

   A cadeia de `cause` é descida (4 níveis) porque o `fetch` do Node não joga o
   sintoma na superfície: medido 15/11 com node v24, uma conexão recusada chega
   como `TypeError: fetch failed` (sem `code` nenhum no objeto externo) e o
   `ECONNREFUSED` mora em `cause.code`, com `connect ECONNREFUSED 127.0.0.1:44444`
   em `cause.message`. Ler só `e.code` + `e.message` — que é o que a versão
   antiga do `pick-lead.js` fazia — classifica o destino recusado como `outra`,
   e `outra` é justamente o veredito que marca fila e cobra espera. A cadeia é
   o caminho por onde o AbortSignal também chega: `TimeoutError` com `code`
   NÚMERO 23, sem cause.                                                        */
function sinalDe(alvo) {
  const partes = [];
  let nó = alvo;
  for (let i = 0; i < 4 && nó; i++) {
    partes.push(`${nó.name || ""} ${nó.code || ""} ${nó.message || ""}`);
    nó = typeof nó.cause === "object" ? nó.cause : null;
  }
  return partes.join(" ");
}

function classe(alvo) {
  /* Uma única decisão para as duas entradas (Exceção com cadeia, ou corda com
     o corpo da resposta): a string é o sinal dela mesma. Dois ramos paralelos
     aqui seria o defeito que este módulo existe para impedir — e foi exatamente
     assim que a falsificação de `teste-trava-rascunho` mordeu um ramo e deixou o
     outro inteiro, com a conferência do token vermelha em cima de código verde. */
  const sinal = typeof alvo === "string" ? alvo : sinalDe(alvo || {});
  if (EMPACA.test(sinal)) return "empacou";
  if (SEM_REDE.test(sinal)) return "sem-rede";
  return "outra";
}
const semRede = (alvo) => classe(alvo) === "sem-rede";
const empaca = (alvo) => classe(alvo) === "empacou";
/* A frase que vai para o diário. Não é decoração: as rodadas que morreram em
   "sem rede" e em "timeout" pediram consertos diferentes, e o `TURNO.md` é a
   única leitura que o dono tem da boca do redator. */
function motivo(alvo, onde) {
  const c = classe(alvo);
  const base = c === "sem-rede" ? "esta máquina não alcança o destino" : c === "empacou" ? "nenhuma resposta dentro do prazo" : null;
  return base ? `${base}${onde ? ` (${onde})` : ""}` : null;
}

module.exports = { classe, semRede, empaca, motivo, SEM_REDE, EMPACA };
