import { findLookalike } from './lookalike.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CERT_WARNING_DAYS = 14;

/**
 * Converte os sinais de uma leitura em riscos. Cada risco tem uma chave estável:
 * o alerta só dispara quando a chave é nova em relação à leitura anterior.
 *
 * `baseline: true` quer dizer que o risco também alerta na primeira leitura, porque
 * um site já nasce perigoso (senha enviada para outro domínio, domínio falso).
 * Riscos de mudança (campo novo, script novo) só alertam quando aparecem depois.
 */
export function buildRisks({ signals, pageUrl, certificateValidTo = null, now = new Date() }) {
  const pageHost = new URL(pageUrl).hostname.toLowerCase();
  const risks = [];

  for (const form of signals.forms.filter((item) => item.hasPassword)) {
    if (form.actionHost && form.actionHost !== pageHost) {
      risks.push({
        key: `senha-externa:${form.actionHost}`,
        severity: 'alta',
        baseline: true,
        title: 'Formulário de senha envia dados para outro site',
        description: `Um campo de senha envia os dados para ${form.actionHost}, que não é o site monitorado.`,
      });
    } else {
      risks.push({
        key: `formulario-senha:${form.action ?? pageHost}`,
        severity: 'media',
        baseline: false,
        title: 'Novo formulário de senha ou destino alterado',
        description: `O formulário de senha envia para ${form.action ?? 'a própria página'}.`,
      });
    }
  }

  for (const host of signals.externalScripts) {
    risks.push({
      key: `script:${host}`,
      severity: 'baixa',
      baseline: false,
      title: 'Novo script de outro domínio',
      description: `A página passou a carregar um script de ${host}.`,
    });
  }

  const imitated = findLookalike(pageHost);
  if (imitated) {
    risks.push({
      key: `dominio-parecido:${pageHost}`,
      severity: 'alta',
      baseline: true,
      title: 'Domínio parecido com um endereço conhecido',
      description: `${pageHost} é muito parecido com ${imitated}, mas não é o endereço oficial.`,
    });
  }

  if (certificateValidTo) {
    const daysLeft = Math.floor((Date.parse(certificateValidTo) - now.getTime()) / DAY_MS);
    if (daysLeft < 0) {
      risks.push({
        key: 'certificado-expirado',
        severity: 'alta',
        baseline: true,
        title: 'Certificado SSL vencido',
        description: `O certificado do site venceu em ${certificateValidTo.slice(0, 10)}.`,
      });
    } else if (daysLeft <= CERT_WARNING_DAYS) {
      risks.push({
        key: 'certificado-expirando',
        severity: 'media',
        baseline: true,
        title: 'Certificado SSL perto do vencimento',
        description: `O certificado do site vence em ${daysLeft} dia(s).`,
      });
    }
  }

  return risks;
}
