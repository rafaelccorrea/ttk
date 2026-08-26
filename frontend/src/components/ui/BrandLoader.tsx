import { LoaderLeve } from '@/components/ui/GlobalLoader';

interface BrandLoaderProps {
  /** Cobre a tela inteira (boot/rotas). Sem ela, centraliza na seção. */
  fullScreen?: boolean;
  /** Texto opcional abaixo da marca (ex.: "Carregando produtos..."). */
  label?: string;
  /** Altura mínima no modo seção. */
  minHeight?: number | string;
}

/**
 * Loading padrão do app. Mantém a API antiga, mas o visual é o mesmo do
 * GlobalLoader ("PikPok…" pulsando) para todas as telas usarem um só loader.
 */
export function BrandLoader({ fullScreen = false, label, minHeight = 280 }: BrandLoaderProps) {
  return <LoaderLeve fullScreen={fullScreen} label={label} minHeight={minHeight} />;
}
