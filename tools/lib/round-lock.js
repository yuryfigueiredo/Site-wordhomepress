/* round-lock.js — a memória de QUEM JÁ SERVOU ESTA RODADA do relógio.

   Por que existe: até 14/11 havia uma mão no relógio e o `flock -n` do runner
   bastava — ele serializa SOBREPOSIÇÃO. Com a segunda mão (a automação agendada
   do app, disparando o mesmo `hwp-turno.sh` nos mesmos horários do check_hours)
   aparece a falha que o lock não vê: uma invocação que começa 45 minutos depois
   da primeira, ainda dentro do MESMO horário de agenda. O flock já está livre,
   então ela roda a rodada inteira e o resultado é caro e inútil — capa não gira
   (cover-state registra UMA troca por `rodadaId()`, rebuild é "mantida"), nada
   publica (`min_hours_between_publishes` é igual ao espaçamento dos horários),
   mas o passo 5 marca a pauta como `em_andamento` (6h fora da fila) e o redator
   gasta ~13 min do plano do dono. É exatamente a conta que AGENTS.md já cobra do
   `pick-lead.js --dry`: olhar a fila não pode custar pauta. Aqui quem olha de
   novo é o próprio relógio.

   A identidade do horário é o `cover-state.rodadaId()` — não uma segunda
   bucketização. Duas implementações paralelas foi o que fez o doctor acusar
   "nenhuma matéria passa do piso" com 7.8 no ar, e aqui a divergência custaria
   ou uma rodada perdida (balde largo demais) ou a pauta queimada na cara do
   dono (estreito demais). `rodadaId` ainda resolve a rodada atrasada: ela
   pertence ao horário em que DEVERIA ter rodado, então a mão que acorda tarde
   não se conta duas vezes.

   A escrita é tmp + rename via lib/atomic-write: um kill no meio de uma escrita
   direta truncaria o JSON, e o `ler()` engole JSON quebrado devolvendo vazio —
   portão fechado em silêncio é rodada duplicada em silêncio.

   Duas coisas se tiram da conta de "servida", porque a régua tem de bater com o
   que o repo já cobra: (1) rodada VERMELHA não serve o horário — uma troca de
   capa por rodada é meta exatamente igual à das outras rodadas, e um horário
   vermelho deixaria o dia inteiro atrás em 3/4; quem decide é o exit code do
   `finish()`, não este módulo; (2) a trava não expira — o desfecho proibido
   (pauta queimada + ~13 min de plano) é o mesmo no minuto 40 e na hora 5, e o
   horário seguinte tem chave própria, então TTL seria só uma janela para a mão
   duplicada chegar.                                                             */

const fs = require("fs");
const path = require("path");
const coverState = require("./cover-state");

/* O caminho é RELATIVO à raiz que chama — o mesmo contrato de lib/memory.js e
   lib/cadence.js, que recebem `root`. Não é capricho: as provas de .audit rodam
   o turno.js dentro de cópias do repo no /tmp, e um portão absoluto leria o
   estado da máquina do dono enquanto escreve o da fixture. cover-state fica
   absoluto porque quem o escreve é o build.js, que sempre parte do repo real. */
const ARQUIVO = path.join("pipeline", "state", "round-lock.json");
const ROOT = path.resolve(__dirname, "..", "..");
/* Quantos horários o arquivo carrega. Um por rodada, 4-6 rodadas/dia: 200 cobrem
   um mês e é o bastante para "este horário já foi servido?" sem arqueologia. */
const MAX_SERVIDAS = 200;

function ler(root = ROOT) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, ARQUIVO), "utf8"));
    if (!Array.isArray(j.servidas)) return { servidas: [] };
    /* O histórico é curto de propósito (MAX_SERVIDAS): um horário já fora da
       janela não serve para nada e a régua que importa é só "o de agora foi
       servido?". Cortar na leitura é o que faz a poda valer também para um
       arquivo editado à mão ou vindo de um merge. */
    return { servidas: j.servidas.slice(-MAX_SERVIDAS) };
  } catch {
    /* Arquivo inexistente (primeira rodada depois do clone) ou ilegível: ninguém
       foi servido. O portão fecha aberto de propósito — errar para o lado de
       rodar custa uma rodada duplicada; errar para o de bloquear custa o dia. */
    return { servidas: [] };
  }
}

function gravar(dados, root = ROOT) {
  const alvo = path.join(root, ARQUIVO);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2) + "\n");
  require("./atomic-write").renomear(tmp, alvo);
}

/* Identidade do horário em curso: "AAAA-MM-DDTHH:MM" no fuso declarado. */
function chave(date = new Date()) {
  return coverState.rodadaId(date);
}

function jaServida(date = new Date(), root = ROOT) {
  const id = chave(date);
  return ler(root).servidas.some((s) => s && s.rodada === id);
}

/* Marca o horário como servido. Quem chama é o `finish()` do turno.js, na única
   saída que decide o desfecho da rodada — ver o comentário lá. */
function marcarServida(meta = {}, date = new Date(), root = ROOT) {
  const id = chave(date);
  const agora = new Date();
  const dados = ler(root);
  const existente = dados.servidas.find((s) => s && s.rodada === id);
  if (existente) {
    /* Re-entrância (um segundo finish na mesma rodada): o horário continua
       servido, só o retrato do desfecho é que se atualiza. */
    existente.at = agora.toISOString();
    existente.resultado = String(meta.resultado || "").slice(0, 200);
  } else {
    dados.servidas.push({ rodada: id, at: agora.toISOString(), resultado: String(meta.resultado || "").slice(0, 200) });
  }
  dados.servidas = dados.servidas.slice(-MAX_SERVIDAS);
  dados.updated = agora.toISOString();
  gravar(dados, root);
  return id;
}

module.exports = {
  ARQUIVO,
  ROOT,
  chave,
  jaServida,
  marcarServida,
  ler,
};
