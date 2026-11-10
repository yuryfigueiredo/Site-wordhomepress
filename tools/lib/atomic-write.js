/* atomic-write.js — o rename da escrita atômica (tmp + rename), com fôlego para
   a trava de arquivo do Windows.

   Por que existe: medido em 10/11, a bateria de provas derrubou a rodada 1 do
   teste de capa com `EPERM: operation not permitted, rename 'index.html.tmp' ->
   'index.html'`. O antivírus/indexador segura o alvo por um instante depois de
   o tmp ser escrito; o rename não espera e a rodada morre por nada — sem erro
   editorial, sem pauta ruim, sem régua furada. No runner Linux isso não ocorre,
   mas na máquina do dono sim, e uma rodada vermelha lá é a mesma rodada vermelha
   no relatório.

   O que NÃO muda: a escrita continua atômica (quem lê vê o arquivo velho ou o
   novo, nunca metade), e erro que não é trava de arquivo sobe na hora — ENOENT
   de caminho errado não ganha seis tentativas para continuar errado.           */
const fs = require("fs");

/* 40 + 80 + 120 + 160 + 200 = 600 ms de fôlego no pior caso. Suficiente para o
   antivírus soltar o arquivo, curto para não pendurar a rodada do cron. */
const TENTATIVAS = 6;
const ESPERA_MS = 40;
const TRAVA = new Set(["EPERM", "EACCES", "EBUSY"]);

const esperar = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function renomear(tmp, alvo) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      fs.renameSync(tmp, alvo);
      return tentativa;
    } catch (e) {
      if (tentativa >= TENTATIVAS || !TRAVA.has(e.code)) throw e;
      esperar(ESPERA_MS * tentativa);
    }
  }
}

module.exports = { renomear, TENTATIVAS, ESPERA_MS };