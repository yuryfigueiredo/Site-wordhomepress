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
/* Os tokens de `SEM_REDE` e `EMPACA` são todos sinais de que o pacote NÃO
   chegou: a rede não levou, a conexão foi recusada ou resetada, o DNS não
   respondeu. Nenhum deles é evidência de que o serviço do outro lado está
   morto, e por isso nenhum merece espera — espera é para o que respondeu e
   pediu para voltar.
   O que NÃO entra aqui: sintoma de máquina local. Medido 15/11 08:47, uma
   chamada HTTP que recebeu `500 {"error":{"message":"getaddrinfo failed"}}`
   do DESTINO — sobre a rede DELE — saía daqui como `sem-rede`, e o `write.js`
   abandonava o provedor vivo em 0,1 s. Prosa de corpo é dado do destino, não
   desta máquina: a origem do corpo vem de `providers.origem()`, e a decisão do
   portão do 5xx mora em `esperaCura()`, aqui dentro.                         */
const SEM_REDE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENETDOWN|UND_ERR_CONNECT|getaddrinfo|no route/i;
const EMPACA = /TimeoutError|due to timeout|ETIMEDOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/i;
/* Fato desta máquina, não do destino: o binário do redator não está no disco
   ou não levantou. Não está em `SEM_REDE` porque nada tem a ver com pacote —
   e é justamente por isso que espera nenhuma o cura.                        */
const LOCAL = /não está no disco|não levantou/i;

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
/* As palavras que só ESTA máquina escreve: o binário do redator que não está no
   disco, o spawn que não levantou. Não são `SEM_REDE` — não têm nada a ver com
   pacote — e é justamente por isso que espera nenhuma as cura. */
const fatoLocal = (alvo) => LOCAL.test(typeof alvo === "string" ? alvo : sinalDe(alvo || {}));

/* O portão do 5xx, decidido uma vez: «esperar isto cura alguma coisa?»
   · corpo escrito por ESTA máquina (`origem === "local"`: o spawn que não
     levantou, o binário ausente, o stderr que o filho despejou): qualquer sinal
     de rede ou de binário que ele trouxer é fato daqui, e a escada de 15→30→90 s
     só dorme em cima de um link que não voltou — foi o que comeu a fatia
     inteira em 20:41 de 14/11.
   · corpo do DESTINO: o que lá está escrito não prova nada daqui, e a palavra
     «rede» na mensagem de erro DELES não é o sintoma DESTE lado. Espera é o que
     se deve a um 5xx, e quem resolve é outro provedor na passada seguinte. */
function esperaCura(origemDoCorpo, corpo) {
  if (origemDoCorpo !== "local") return true;
  return !(fatoLocal(corpo) || semRede(corpo));
}
/* A frase que vai para o diário. Não é decoração: as rodadas que morreram em
   "sem rede" e em "timeout" pediram consertos diferentes, e o `TURNO.md` é a
   única leitura que o dono tem da boca do redator. */
function motivo(alvo, onde) {
  const c = classe(alvo);
  const base = c === "sem-rede" ? "esta máquina não alcança o destino" : c === "empacou" ? "nenhuma resposta dentro do prazo" : null;
  return base ? `${base}${onde ? ` (${onde})` : ""}` : null;
}

module.exports = { classe, semRede, empaca, motivo, fatoLocal, esperaCura, SEM_REDE, EMPACA, LOCAL };
