import { Box, alpha } from '@mui/material';
import { cores } from '../theme/theme';
import logo from '../assets/logo.png';

/**
 * A marca do PikPok, em imagem.
 *
 * É o MESMO arquivo que o site usa como ícone (`frontend/public/icon-192.png`),
 * copiado para cá em vez de referenciado por URL: o painel roda com uma CSP
 * que só aceita `img-src 'self' data:`, e um logo que depende da internet
 * apareceria quebrado exatamente na tela de ativação — que é a tela de quem
 * ainda não confia no app.
 *
 * O logo original já vem sobre fundo preto, com o halo ciano/vermelho embutido.
 * Por isso ele não pede moldura: o brilho abaixo só continua o halo que a
 * arte já tem, para o quadrado não morrer em cima de um fundo igualmente preto.
 */
export function Logo({
  tamanho = 44,
  brilhando = true,
}: {
  readonly tamanho?: number;
  /** Desligue em listas e cabeçalhos densos, onde o halo viraria borrão. */
  readonly brilhando?: boolean;
}): JSX.Element {
  return (
    <Box
      component="img"
      src={logo}
      alt="PikPok"
      draggable={false}
      sx={{
        width: tamanho,
        height: tamanho,
        borderRadius: tamanho * 0.28,
        display: 'block',
        flexShrink: 0,
        boxShadow: brilhando
          ? `0 6px 28px ${alpha(cores.vermelho, 0.28)}, 0 2px 10px ${alpha(cores.ciano, 0.20)}`
          : 'none',
      }}
    />
  );
}
