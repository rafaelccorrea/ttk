import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import type { EstadoAtivacao } from '@shared/desktop-api';
import { Aviso, Carregando } from '../components/Estados';
import { mensagemDeErro } from '../erros';
import { SEM_PONTE, obterPonte } from '../ponte';

/**
 * Tela 1 — ativação do aparelho.
 *
 * O vendedor NÃO digita e-mail e senha aqui, e isso não é economia de tela: o
 * login do PikPok é do Supabase, com provedores sociais e recuperação de senha
 * que já existem no site. Refazer tudo isso dentro de um Electron significaria
 * um segundo lugar onde a senha é digitada e um segundo lugar para errar. O
 * fluxo de dispositivo troca isso por um código de quatro caracteres: ele
 * aparece aqui, é aprovado na conta que ele já usa no navegador, e o app
 * recebe o token sem nunca ver a credencial.
 *
 * A tela é o código, grande, e um botão. Todo o resto é consequência.
 */
export function Ativacao(): JSX.Element {
  const ponte = obterPonte();
  const [estado, setEstado] = useState<EstadoAtivacao | null>(null);
  const [pedindo, setPedindo] = useState(false);

  const pedirCodigo = useCallback(async (): Promise<void> => {
    if (!ponte) return;
    setPedindo(true);
    try {
      setEstado(await ponte.iniciarAtivacao());
    } catch (erro) {
      setEstado({
        status: 'erro',
        userCode: null,
        verificationUrl: null,
        expiresIn: null,
        erro: mensagemDeErro(erro),
      });
    } finally {
      setPedindo(false);
    }
  }, [ponte]);

  useEffect(() => {
    if (!ponte) return undefined;
    // O desfecho da autorização chega pelo processo principal, que é quem faz o
    // polling do token: o painel não fica perguntando nada, só escuta.
    const cancelar = ponte.aoMudarAtivacao(setEstado);
    void pedirCodigo();
    return cancelar;
  }, [ponte, pedirCodigo]);

  if (!ponte) {
    return (
      <Moldura>
        <Aviso tom="erro" titulo="Não consegui iniciar a ativação" descricao={SEM_PONTE} />
      </Moldura>
    );
  }

  if (pedindo && !estado) {
    return (
      <Moldura>
        <Carregando texto="Gerando o seu código de ativação…" />
      </Moldura>
    );
  }

  if (!estado || estado.status === 'erro') {
    return (
      <Moldura>
        <Aviso
          tom="erro"
          titulo="Não consegui gerar o código"
          descricao={
            estado?.erro ??
            'Sem resposta do PikPok. Confira a sua internet e tente de novo.'
          }
          acao={{ rotulo: 'Tentar de novo', aoClicar: () => void pedirCodigo() }}
        />
      </Moldura>
    );
  }

  if (estado.status === 'negada' || estado.status === 'expirada') {
    const expirou = estado.status === 'expirada';
    return (
      <Moldura>
        <Aviso
          titulo={expirou ? 'Esse código venceu' : 'A autorização foi recusada'}
          descricao={
            expirou
              ? 'Os códigos duram poucos minutos por segurança. Gere outro e autorize em seguida.'
              : 'No site você clicou em recusar. Se foi engano, gere outro código e autorize.'
          }
          acao={{ rotulo: 'Gerar outro código', aoClicar: () => void pedirCodigo() }}
        />
      </Moldura>
    );
  }

  if (estado.status === 'aprovada') {
    return (
      <Moldura>
        <Carregando texto="Autorizado. Abrindo o copiloto…" />
      </Moldura>
    );
  }

  return (
    <Moldura>
      <Stack spacing={2.5}>
        <Typography variant="body2" color="text.secondary">
          A autorização acontece na mesma conta que você já usa no site do PikPok —
          aqui você não digita senha nenhuma.
        </Typography>

        <Box
          sx={{
            py: 3,
            borderRadius: 3,
            textAlign: 'center',
            bgcolor: 'rgba(254,44,85,0.06)',
            border: '1px solid rgba(254,44,85,0.20)',
          }}
        >
          <Typography variant="overline" color="text.secondary">
            seu código
          </Typography>
          <Typography
            sx={{
              // Monoespaçada e com espaço entre as letras: este código vai ser
              // lido em voz alta e digitado à mão. O que importa aqui é não
              // confundir zero com O, não a elegância da fonte.
              fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
              fontSize: 40,
              fontWeight: 800,
              letterSpacing: '0.10em',
              color: 'primary.main',
              lineHeight: 1.2,
            }}
          >
            {estado.userCode}
          </Typography>
        </Box>

        <Button
          fullWidth
          size="large"
          variant="contained"
          disabled={!estado.verificationUrl}
          onClick={() => {
            if (estado.verificationUrl) void ponte.abrirNoNavegador(estado.verificationUrl);
          }}
        >
          Autorizar no navegador
        </Button>

        <Stack direction="row" spacing={1} alignItems="center">
          <Chip size="small" color="primary" variant="outlined" label="aguardando" />
          <Typography variant="caption" color="text.secondary">
            Assim que você aprovar lá, esta tela passa sozinha.
          </Typography>
        </Stack>
      </Stack>
    </Moldura>
  );
}

function Moldura({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <Stack spacing={2} sx={{ p: 3 }}>
      <Typography variant="h5">Ativar este computador</Typography>
      {children}
    </Stack>
  );
}
