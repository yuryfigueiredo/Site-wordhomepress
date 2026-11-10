/* relogio-falso.js — preload para rodar uma ferramenta com o relógio parado.
   Uso: HWP_AGORA=2026-11-09T12:00:00Z node -r .audit/relogio-falso.js tools/build.js --daily
   Sem HWP_AGORA o preload não faz nada, então é seguro deixar no caminho. */
const RealDate = Date;
const alvo = process.env.HWP_AGORA;
if (alvo) {
  const fixo = RealDate.parse(alvo);
  if (Number.isNaN(fixo)) throw new Error(`HWP_AGORA ilegível: "${alvo}"`);
  class FakeDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixo]));
    }
    static now() {
      return fixo;
    }
  }
  global.Date = FakeDate;
}
