/* `voice/state/last_runs.json` é o registro de estilo (abertura e fecho da
   última peça por registro), não um portão editorial. Ele é lido em três
   momentos da rodada (new-post, check-post, publish) e um JSON quebrado ali —
   escrito interrompido no meio, arquivo voltando de um merge — derrubava a
   rodada inteira antes de chegar ao publish, sem nenhuma razão editorial.
   Ler tolerante custa um prompt sem histórico; perder a rodada do dia custa a
   notícia. */
const fs = require("fs");
const path = require("path");

const ARQUIVO = path.join("voice", "state", "last_runs.json");

/* Estrutura esperada é { runs: { <registro>: { ... } }, updated: ... }. Um array
   passa em `typeof === "object"`, e nele a atribuição por nome acontece sem
   erro — só que JSON.stringify descarta a chave e o registro se perde calado. */
function ler(root) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, ARQUIVO), "utf8"));
    if (j && typeof j === "object" && j.runs && typeof j.runs === "object" && !Array.isArray(j.runs)) return j;
  } catch {}
  return { runs: {} };
}

/* tmp + rename: o `git add -A` do turno nunca deve pegar um rastro pela metade,
   e `*.tmp` está no .gitignore justamente para isso. */
function gravar(root, dados) {
  const alvo = path.join(root, ARQUIVO);
  const tmp = `${alvo}.tmp`;
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
  fs.renameSync(tmp, alvo);
}

module.exports = { ARQUIVO, ler, gravar };
