import { render, screen } from '@testing-library/react';
import { AppThemeProvider } from '@/theme/AppThemeProvider';
import { LiveSessionStatus } from '@/services/live.service';
import {
  estaProcessando,
  mensagemDeErro,
  OrigemChip,
  STATUS_UI,
  StatusChip,
} from './status';

const TODOS: LiveSessionStatus[] = [
  'rascunho',
  'transcrevendo',
  'extraindo',
  'pronta',
  'erro',
];

const renderizar = (ui: React.ReactNode) =>
  render(<AppThemeProvider>{ui}</AppThemeProvider>);

/**
 * Uma live de quatro horas fica minutos em "transcrevendo", e nesse intervalo a
 * tela é a única coisa que separa "está trabalhando" de "quebrou". Se ela não
 * comunicar isso, o vendedor recarrega, sobe a gravação de novo e paga duas
 * vezes — o defeito que estes testes existem para impedir.
 */
describe('estados do pipeline da live', () => {
  it('descreve todos os estados possíveis, sem cair em texto vazio', () => {
    // Um estado novo no backend sem entrada aqui renderizaria undefined na
    // cara do vendedor. Este teste é o alarme dessa omissão.
    for (const status of TODOS) {
      const ui = STATUS_UI[status];
      expect(ui).toBeDefined();
      expect(ui.label.length).toBeGreaterThan(0);
      expect(ui.dica.length).toBeGreaterThan(0);
    }
  });

  it('só considera trabalhando o que o backend está de fato processando', () => {
    expect(estaProcessando('transcrevendo')).toBe(true);
    expect(estaProcessando('extraindo')).toBe(true);
    // Estes três NÃO podem manter o polling vivo: um intervalo que nunca para
    // fica batendo na API para sempre com a aba aberta.
    expect(estaProcessando('rascunho')).toBe(false);
    expect(estaProcessando('pronta')).toBe(false);
    expect(estaProcessando('erro')).toBe(false);
  });

  it('marca como trabalhando exatamente os estados que mantêm o polling', () => {
    // As duas fontes de verdade precisam concordar: se `trabalhando` disser sim
    // e `estaProcessando` disser não, a tela mostra um spinner que nunca some.
    for (const status of TODOS) {
      expect(STATUS_UI[status].trabalhando).toBe(estaProcessando(status));
    }
  });

  it('avisa que a etapa longa é longa', () => {
    // Sem dizer que leva minutos, tela parada é indistinguível de tela quebrada.
    expect(STATUS_UI.transcrevendo.dica).toMatch(/minuto/i);
  });

  it('não pinta como sucesso um estado que não é', () => {
    expect(STATUS_UI.erro.cor).toBe('error');
    expect(STATUS_UI.pronta.cor).toBe('success');
    expect(STATUS_UI.transcrevendo.cor).not.toBe('success');
    expect(STATUS_UI.extraindo.cor).not.toBe('success');
  });

  it('mostra o rótulo do estado atual', () => {
    renderizar(<StatusChip status="transcrevendo" />);
    expect(screen.getByText(STATUS_UI.transcrevendo.label)).toBeInTheDocument();
  });
});

/**
 * O selo de procedência é o que separa "a IA ouviu isso" de "eu digitei isso".
 * É a informação que decide o que o vendedor confere antes de deixar o copiloto
 * responder um preço em nome dele.
 */
describe('procedência do dado', () => {
  it('deixa claro quando o dado foi digitado pelo próprio vendedor', () => {
    renderizar(<OrigemChip origin="manual" />);
    expect(screen.getByText('Você cadastrou')).toBeInTheDocument();
  });

  it('mostra a certeza da extração quando o dado veio da live', () => {
    renderizar(<OrigemChip origin="ia" confidence="0.92" />);
    expect(screen.getByText(/Da live/)).toBeInTheDocument();
    expect(screen.getByText(/92% de certeza/)).toBeInTheDocument();
  });

  it('não inventa número quando a extração não deu nota', () => {
    renderizar(<OrigemChip origin="ia" confidence={null} />);
    expect(screen.getByText('Da live')).toBeInTheDocument();
    expect(screen.queryByText(/certeza/)).not.toBeInTheDocument();
  });

  it('arredonda a certeza sem exibir dízima na tela', () => {
    renderizar(<OrigemChip origin="ia" confidence="0.666" />);
    expect(screen.getByText(/67% de certeza/)).toBeInTheDocument();
  });
});

describe('mensagem de erro para o vendedor', () => {
  it('mostra o que o backend explicou', () => {
    expect(
      mensagemDeErro({ response: { data: { message: 'Saldo insuficiente.' } } }),
    ).toBe('Saldo insuficiente.');
  });

  it('junta a lista de erros de validação numa frase legível', () => {
    // class-validator devolve array; exibir "[object Object]" seria pior que
    // não dizer nada.
    expect(
      mensagemDeErro({ response: { data: { message: ['Título obrigatório', 'Arquivo grande'] } } }),
    ).toBe('Título obrigatório Arquivo grande');
  });

  it('nunca deixa o vendedor sem explicação', () => {
    // Falha de rede não tem `response`: ainda assim precisa sair texto útil, e
    // nunca "undefined".
    for (const erro of [undefined, null, {}, new Error('boom'), 'texto solto']) {
      const mensagem = mensagemDeErro(erro);
      expect(mensagem.length).toBeGreaterThan(0);
      expect(mensagem).not.toMatch(/undefined|null|\[object/i);
    }
  });
});
