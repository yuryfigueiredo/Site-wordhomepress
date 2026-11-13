/* load-env.js — o único ponto onde o .env local vira ambiente do processo.

   Quem lia o .env era o find-photo.js, sozinho e para as chaves dele: uma
   GEMINI_API_KEY colocada no arquivo não chegava ao providers.js, e o turno
   fechava vermelho em "nenhum provedor de texto armado" numa máquina que
   tinha a chave no disco. Um carregador só, chamado por quem consome ambiente.

   O que já existe no ambiente não é sobrescrito: no Actions o valor vem do
   Secret, e lá o .env nem está no clone (gitignored).                     */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const FILE = path.join(ROOT, ".env");

/* Devolve quantas variáveis o arquivo pôs no ambiente (0 se não existe). */
function load() {
  if (!fs.existsSync(FILE)) return 0;
  let postas = 0;
  for (const bruto of fs.readFileSync(FILE, "utf8").split("\n")) {
    const linha = bruto.trim();
    if (!linha || linha.startsWith("#")) continue;
    const eq = linha.indexOf("=");
    if (eq < 1) continue;
    const k = linha.slice(0, eq).trim();
    const v = linha.slice(eq + 1).trim();
    if (!k || !v || process.env[k]) continue;
    process.env[k] = v;
    postas++;
  }
  return postas;
}

module.exports = { load, FILE };
