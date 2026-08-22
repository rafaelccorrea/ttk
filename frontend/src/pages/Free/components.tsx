import LockRoundedIcon from '@mui/icons-material/LockRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { showcaseService } from '@/services/showcase.service';

/**
 * As peças que dizem, na tela, que a conta é gratuita.
 *
 * Uma conta gratuita que não sabe que é gratuita não faz upgrade — ela conclui
 * que o produto é pequeno. Por isso a limitação aparece três vezes na mesma
 * tela, e cada uma responde uma pergunta diferente: o banner diz o que ela é
 * (`FreeBanner`), os controles desabilitados dizem o que existe e ela não tem
 * (`ControlesTravados`), e o rodapé diz o tamanho do que está atrás do paywall
 * (`RodapeBloqueado`).
 */

export function FreeBanner({
  refreshAt,
  descricao,
}: {
  refreshAt: string | null;
  descricao: string;
}) {
  const dias = refreshAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(refreshAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
        ),
      )
    : null;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2, md: 2.5 },
        mb: 3,
        borderRadius: 3,
        borderStyle: 'dashed',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Chip
        label="Conta gratuita"
        color="primary"
        size="small"
        sx={{ fontWeight: 800 }}
      />
      <Box sx={{ flex: 1, minWidth: { xs: 0, sm: 240 }, flexBasis: { xs: '100%', sm: 'auto' } }}>
        <Typography fontWeight={700}>{descricao}</Typography>
        <Typography variant="body2" color="text.secondary">
          {dias === null
            ? 'A seleção é a mesma para todo mundo e muda a cada 7 dias.'
            : dias === 0
              ? 'A seleção troca hoje.'
              : `A mesma seleção para todo mundo — troca em ${dias} ${dias === 1 ? 'dia' : 'dias'}.`}
        </Typography>
      </Box>
      <Button
        component={Link}
        to="/planos"
        variant="contained"
        sx={{ width: { xs: '100%', sm: 'auto' } }}
      >
        Ver planos
      </Button>
    </Paper>
  );
}

/**
 * Busca e filtros aparecem — desabilitados, com o motivo no tooltip.
 *
 * Removê-los seria mais simples e é a decisão errada: a ausência lê como
 * produto incompleto, o cadeado lê como plano. O que se quer é que a pessoa veja
 * o que ela ganharia, não que ela conclua que aquilo não existe.
 */
export function ControlesTravados({
  /** O texto do campo muda com a tela; o cadeado, não. */
  placeholder = 'Buscar por produto ou loja',
}: {
  placeholder?: string;
}) {
  return (
    <Tooltip title="Busca e filtros fazem parte dos planos pagos">

      <Stack
        direction="row"
        spacing={1.5}
        useFlexGap
        sx={{ mb: 3, opacity: 0.55, pointerEvents: 'none', flexWrap: 'wrap' }}
      >
        <TextField
          size="small"
          disabled
          placeholder={placeholder}
          InputProps={{ startAdornment: <SearchRoundedIcon sx={{ mr: 1 }} /> }}
          // No mobile o campo ocupa a linha inteira; a largura fixa estourava os 360px.
          sx={{ width: { xs: '100%', sm: 'auto' }, minWidth: { xs: 0, sm: 260 } }}
        />
        <Button disabled variant="outlined" startIcon={<TuneRoundedIcon />}>
          Filtros
        </Button>
        <Button disabled variant="outlined" startIcon={<LockRoundedIcon />}>
          Ordenar
        </Button>
      </Stack>
    </Tooltip>
  );
}

/**
 * O fim da lista: o tamanho real do catálogo.
 *
 * O número sai da vitrine pública (`/showcase`), que já conta a base inteira —
 * é a mesma fonte da landing, então o visitante que virou cadastro não vê dois
 * números diferentes para a mesma coisa. Se a chamada falhar, o bloco continua
 * de pé sem o número: o CTA é o que importa aqui, não a estatística.
 */
export function RodapeBloqueado({
  tipo,
  /** Quantos itens a amostra já mostrou — o "+N" é o que SOBRA, não o total. */
  exibidos,
}: {
  tipo: 'produtos' | 'vídeos' | 'criadores';
  exibidos: number;
}) {
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let ativo = true;
    showcaseService
      .snapshot()
      .then((s) => ativo && setTotal(s.stats.products))
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, []);

  /*
   * "+689 produtos" com 20 já na tela e 689 no catálogo é uma promessa que a
   * assinatura não cumpre — o que falta são 669. O número exagerado não vende
   * mais; ele só garante que a primeira impressão de quem pagar seja a de ter
   * recebido menos do que foi oferecido.
   */
  const restantes =
    /*
     * `stats` conta PRODUTOS. Usar esse número na tela de vídeos daria um "+669
     * vídeos" inventado — e uma estatística errada aqui é pior do que nenhuma,
     * porque é exatamente a prova que o bloco existe para dar. Sem o número, o
     * texto genérico assume e o CTA continua igual.
     */
    total === null || tipo !== 'produtos' ? null : Math.max(0, total - exibidos);

  return (
    <Paper
      variant="outlined"
      sx={{
        mt: 4,
        p: { xs: 3, md: 5 },
        borderRadius: 4,
        borderStyle: 'dashed',
        textAlign: 'center',
      }}
    >
      <LockRoundedIcon sx={{ fontSize: 40, color: '#fe2c55', mb: 1 }} />
      <Typography variant="h6" fontWeight={800} mb={0.5}>
        {restantes
          ? `+${restantes.toLocaleString('pt-BR')} ${tipo} no plano Essencial`
          : tipo === 'criadores'
            ? 'O ranking de criadores está nos planos pagos'
            : `O catálogo completo de ${tipo} está nos planos pagos`}
      </Typography>
      {/* Só o que o plano acrescenta: roteiro e análise a conta gratuita já
          tem, e repeti-los aqui esvazia a oferta. */}
      <Typography color="text.secondary" mb={2.5}>
        {tipo === 'criadores'
          ? 'Com um plano você vê o ranking completo: quem mais fatura em cada nicho, com GMV, vendas e os vídeos de cada criador.'
          : 'Com um plano você vê o ranking inteiro, com busca, filtros, a loja de cada produto e a evolução dia a dia — além das tendências e do ranking de criadores.'}
      </Typography>
      <Button component={Link} to="/planos" variant="contained" size="large">
        Ver planos
      </Button>
    </Paper>
  );
}
