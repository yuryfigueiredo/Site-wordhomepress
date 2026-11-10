/* Preload: faz o fs.renameSync falhar com EPERM nas primeiras N chamadas, para
   simular a trava de arquivo do Windows sem precisar de antivírus cooperando.
   Uso: node -r <caminho ABSOLUTO deste arquivo> tools/build.js --daily
        com HWP_FALHAS_RENAME=N no ambiente.                                */
const fs = require("fs");
const n = Number(process.env.HWP_FALHAS_RENAME || 0);
const real = fs.renameSync;
let chamadas = 0;
fs.renameSync = function (...args) {
  chamadas++;
  if (chamadas <= n) {
    const e = new Error(`EPERM: operation not permitted, rename '${args[0]}' -> '${args[1]}'`);
    e.code = "EPERM";
    throw e;
  }
  return real.apply(this, args);
};