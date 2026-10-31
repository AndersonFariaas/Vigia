// Textos legais exibidos no painel. RASCUNHO: revise com profissional jurídico antes de publicar.
// Campos entre colchetes precisam ser preenchidos pelo responsável pelo serviço.
export const LEGAL_CONTACT = '[e-mail de contato do responsável]';
export const LEGAL_CONTROLLER = '[nome ou razão social do responsável pelo serviço]';

export const TERMOS = {
  titulo: 'Termos de uso',
  secoes: [
    {
      titulo: '1. O serviço',
      texto: [
        'O Vigia monitora páginas públicas da internet. Quando o conteúdo muda, cria um alerta e envia um e-mail com a diferença.',
        'Os sinais de risco e a análise opcional com a Devin são automatizados. Eles ajudam a decidir, mas não substituem a sua avaliação.',
      ],
    },
    {
      titulo: '2. Conta',
      texto: [
        'Para usar o serviço, crie uma conta com um e-mail seu e uma senha. Você é responsável pela senha e por tudo que for feito com a sua conta.',
        'Você pode alterar seus dados e excluir sua conta a qualquer momento, em Minha conta.',
      ],
    },
    {
      titulo: '3. Uso permitido',
      texto: [
        'Monitore apenas páginas que você tem o direito de acompanhar. Não use o serviço para atacar sites, sobrecarregá-los, contornar bloqueios ou violar leis.',
        'Não monitore páginas para coletar dados pessoais de terceiros.',
      ],
    },
    {
      titulo: '4. Disponibilidade',
      texto: [
        'O serviço pode sofrer interrupções, atrasos de checagem ou falhas de envio de e-mail. Não há garantia de que um alerta seja entregue no momento exato da mudança.',
      ],
    },
    {
      titulo: '5. Alterações',
      texto: [
        'Estes termos podem mudar. Quando isso acontecer, a versão nova passa a valer a partir da publicação, e a data do aceite fica registrada.',
      ],
    },
  ],
};

export const PRIVACIDADE = {
  titulo: 'Política de privacidade',
  secoes: [
    {
      titulo: '1. Quem é responsável pelos dados',
      texto: [`Responsável: ${LEGAL_CONTROLLER}. Contato para assuntos de privacidade: ${LEGAL_CONTACT}.`],
    },
    {
      titulo: '2. Quais dados coletamos',
      texto: [
        'Nome, e-mail e senha (guardada apenas como hash, nunca em texto puro).',
        'Endereços das páginas monitoradas, o texto de cada checagem (snapshots) e os alertas gerados.',
        'A versão dos termos aceita e a data do aceite.',
      ],
    },
    {
      titulo: '3. Para que usamos',
      texto: [
        'Para criar e manter sua conta, monitorar as páginas que você cadastrou, enviar alertas por e-mail e, quando você pedir, analisar um alerta com a Devin.',
      ],
    },
    {
      titulo: '4. Base legal',
      texto: [
        'Execução do serviço que você contratou ao criar a conta (LGPD, art. 7º, V) e o seu consentimento no aceite dos termos (art. 7º, I). Você pode retirar o consentimento excluindo a conta.',
      ],
    },
    {
      titulo: '5. Com quem compartilhamos',
      texto: [
        'Fornecedores que operam o serviço: Firecrawl (coleta das páginas), Resend (envio de e-mails), Devin (somente quando você pede a análise de um alerta) e a hospedagem da aplicação.',
        'Não vendemos dados pessoais.',
      ],
    },
    {
      titulo: '6. Por quanto tempo guardamos',
      texto: [
        'O histórico de checagens e os alertas são apagados automaticamente após 90 dias.',
        'Enquanto a conta existir, guardamos seus dados de cadastro e as páginas monitoradas. As sessões de login expiram em 7 dias.',
      ],
    },
    {
      titulo: '7. Exclusão da conta',
      texto: [
        'Em Minha conta, você pode excluir sua conta. Ao confirmar com a sua senha, apagamos a conta, as páginas monitoradas, o histórico e os alertas.',
      ],
    },
    {
      titulo: '8. Seus direitos',
      texto: [
        'Você pode pedir confirmação de tratamento, acesso, correção, anonimização, bloqueio ou eliminação dos dados, portabilidade e informação sobre compartilhamento. Para isso, use o contato acima.',
        'Você também pode procurar a Autoridade Nacional de Proteção de Dados (ANPD).',
      ],
    },
    {
      titulo: '9. Segurança',
      texto: [
        'A senha é guardada como hash com scrypt. O cookie de sessão é HttpOnly e SameSite=Strict. Em produção, o acesso deve ser feito somente por HTTPS.',
      ],
    },
  ],
};
