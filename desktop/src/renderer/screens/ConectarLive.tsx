import {
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import type { BaseDeConhecimento, CarteiraLive } from '@shared/desktop-api';
import { Aviso, Carregando } from '../components/Estados';
import { mensagemDeErro } from '../erros';
import { SEM_PONTE, obterPonte } from '../ponte';

/**
 * Tela 2 — escolher a base e entrar na live.
 *
 * São duas decisões e nada mais: SOBRE O QUE o copiloto responde e QUAL live
 * ele está assistindo. Tudo o que não for uma dessas duas coisas atrapalha
 * alguém que já está com a câmera ligada esperando para começar.
 *
 * O saldo aparece ANTES de conectar, e não numa fatura depois, porque o minuto
 * é debitado em batimento durante a transmissão: quem entra com quatro minutos
 * precisa saber disso enquanto ainda dá para comprar mais.
 */
export function ConectarLive({
  aoConectar,
  aoAbrirConfiguracoes,
}: {
  readonly aoConectar: () => void;
  readonly aoAbrirConfiguracoes: () => void;
}): JSX.Element {
  const ponte = obterPonte();
  const [bases, setBases] = useState<BaseDeConhecimento[] | null>(null);
  const [carteira, setCarteira] = useState<CarteiraLive | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baseId, setBaseId] = useState('');
  const [usuario, setUsuario] = useState('');
  const [conectando, setConectando] = useState(false);
  const [erroConexao, setErroConexao] = useState<string | null>(null);

  const carregar = useCallback(async (): Promise<void> => {
    if (!ponte) return;
    setErro(null);
    try {
      // As duas juntas: mostrar a lista sem o saldo faria o vendedor escolher
      // uma base para só então descobrir que não tem minuto para usá-la.
      const [listadas, saldo] = await Promise.all([
        ponte.listarBases(),
        ponte.obterCarteiraLive(),
      ]);
      setBases(listadas);
      setCarteira(saldo);
      if (listadas.length === 1) setBaseId(listadas[0]!.id);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, [ponte]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!ponte) {
    return (
      <Moldura>
        <Aviso tom="erro" titulo="Não consegui carregar suas bases" descricao={SEM_PONTE} />
      </Moldura>
    );
  }

  if (erro) {
    return (
      <Moldura>
        <Aviso
          tom="erro"
          titulo="Não consegui falar com o PikPok"
          descricao={erro}
          acao={{ rotulo: 'Tentar de novo', aoClicar: () => void carregar() }}
        />
      </Moldura>
    );
  }

  if (!bases || !carteira) {
    return (
      <Moldura>
        <Carregando texto="Procurando suas bases de conhecimento…" />
      </Moldura>
    );
  }

  if (bases.length === 0) {
    return (
      <Moldura>
        <Aviso
          titulo="Você ainda não tem uma base pronta"
          descricao={
            'O copiloto responde a partir de uma live sua já gravada: suba a gravação no site do PikPok, confira os produtos e os preços que a IA extraiu e marque a base como pronta. Aí ela aparece aqui.'
          }
          acao={{
            rotulo: 'Abrir o PikPok no navegador',
            aoClicar: () => void ponte.abrirNoNavegador('https://app.pikpok.com.br/live'),
          }}
        />
      </Moldura>
    );
  }

  const semSaldo = carteira.minutos <= 0 && !carteira.trialDisponivel;

  const conectar = async (): Promise<void> => {
    setConectando(true);
    setErroConexao(null);
    try {
      await ponte.conectar({
        knowledgeSessionId: baseId,
        tiktokUsername: usuario.trim(),
      });
      aoConectar();
    } catch (e) {
      setErroConexao(mensagemDeErro(e));
    } finally {
      setConectando(false);
    }
  };

  return (
    <Moldura>
      <Stack spacing={2.5}>
        <Box
          sx={{
            p: 2,
            borderRadius: 3,
            bgcolor: carteira.trialDisponivel
              ? 'rgba(0,194,187,0.10)'
              : 'rgba(22,24,35,0.03)',
            border: '1px solid',
            borderColor: carteira.trialDisponivel ? 'secondary.main' : 'divider',
          }}
        >
          <Typography variant="overline" color="text.secondary">
            minutos de live
          </Typography>
          <Typography variant="h5" sx={{ mt: 0.25 }}>
            {carteira.minutos} min
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {carteira.trialDisponivel
              ? `Os primeiros ${carteira.trialMinutos} minutos são por nossa conta — entram assim que você conectar.`
              : 'Cada minuto no ar desconta um daqui.'}
          </Typography>
        </Box>

        <TextField
          select
          fullWidth
          label="Base de conhecimento"
          value={baseId}
          onChange={(e) => setBaseId(e.target.value)}
          helperText="É daqui que saem os preços, as variações e o frete das respostas."
        >
          {bases.map((base) => (
            <MenuItem key={base.id} value={base.id}>
              <Stack>
                <Typography variant="body2" fontWeight={700}>
                  {base.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {base.produtos} produtos · {base.faqs} respostas prontas
                </Typography>
              </Stack>
            </MenuItem>
          ))}
        </TextField>

        <TextField
          fullWidth
          label="Perfil da live no TikTok"
          placeholder="@sualoja"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          helperText="O mesmo @ que está transmitindo agora, do lado esquerdo da tela."
        />

        {semSaldo ? (
          <Aviso
            titulo="Seus minutos acabaram"
            descricao="Compre um pacote de horas no site para o copiloto voltar a acompanhar o chat."
            acao={{
              rotulo: 'Comprar horas',
              aoClicar: () => void ponte.abrirNoNavegador('https://app.pikpok.com.br/planos'),
            }}
          />
        ) : null}

        {erroConexao ? (
          <Aviso
            tom="erro"
            titulo="Não consegui entrar na live"
            descricao={erroConexao}
            acao={{ rotulo: 'Tentar de novo', aoClicar: () => void conectar() }}
          />
        ) : null}

        <Button
          fullWidth
          size="large"
          variant="contained"
          disabled={!baseId || usuario.trim().length === 0 || conectando || semSaldo}
          onClick={() => void conectar()}
        >
          {conectando ? 'Entrando na live…' : 'Entrar na live'}
        </Button>

        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Chip size="small" variant="outlined" label="nada é publicado no chat" />
          <Button size="small" onClick={aoAbrirConfiguracoes}>
            Ajustes
          </Button>
        </Stack>
      </Stack>
    </Moldura>
  );
}

function Moldura({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <Stack spacing={2} sx={{ p: 3, overflowY: 'auto' }}>
      <Typography variant="h5">Conectar à live</Typography>
      {children}
    </Stack>
  );
}
