import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import ImageNotSupportedRoundedIcon from '@mui/icons-material/ImageNotSupportedRounded';
import { SmartImage } from '@/components/ui/SmartImage';

export interface SearchableOption {
  value: string;
  label: string;
  /**
   * URL pronta para o `<img>`. Quem chama resolve proxy/origem — o
   * componente não sabe de onde a imagem vem.
   */
  imageUrl?: string | null;
  /** Linha secundária: loja, categoria, status… */
  caption?: string;
  /** Cabeçalho da seção na lista (ex.: "Meus produtos" × "Catálogo"). */
  group?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  label?: string;
  placeholder?: string;
  /**
   * Rótulo da opção "nenhum/todos". Quando presente, ela encabeça a lista e
   * limpar o campo equivale a escolhê-la.
   */
  emptyLabel?: string;
  /** `pill` para as barras de filtro; `field` para formulários. */
  variant?: 'pill' | 'field';
  /** Mostra a coluna de miniatura mesmo nas opções sem imagem, para alinhar. */
  showImages?: boolean;
  /**
   * Permite digitar um valor fora da lista. Para campos que hoje são texto
   * livre e ganham sugestões — a lista vira atalho, não camisa de força.
   */
  allowCustom?: boolean;
  /**
   * Busca no servidor. Quando presente, o filtro local do Autocomplete é
   * desligado: a lista já vem filtrada de quem chama, e filtrar de novo aqui
   * esconderia resultados que o backend acabou de trazer.
   */
  onSearchChange?: (texto: string) => void;
  loading?: boolean;
  disabled?: boolean;
  helperText?: string;
  fullWidth?: boolean;
  size?: 'small' | 'medium';
  sx?: SxProps<Theme>;
}

const EMPTY = '';

/** Miniatura quadrada da opção (ou o vazio alinhado, quando não há foto). */
function Thumb({
  src,
  alt,
  size = 34,
}: {
  src?: string | null;
  alt: string;
  size?: number;
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 1.5,
        overflow: 'hidden',
        bgcolor: 'rgba(22,24,35,0.05)',
      }}
    >
      <SmartImage
        src={src ?? null}
        alt={alt}
        fallback={
          <ImageNotSupportedRoundedIcon
            sx={{ fontSize: 15, color: 'rgba(22,24,35,0.25)' }}
          />
        }
      />
    </Box>
  );
}

/**
 * Select com busca embutida e miniatura opcional.
 *
 * O `<TextField select>` do MUI só rola a lista — em catálogo com centenas de
 * lojas ou produtos, achar um item vira garimpo. Aqui o campo filtra conforme
 * se digita, e quando a opção tem foto ela aparece na lista e no valor
 * escolhido: reconhecer um produto pela imagem é mais rápido que pelo título.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  label,
  placeholder,
  emptyLabel,
  variant = 'field',
  showImages,
  allowCustom,
  onSearchChange,
  loading,
  disabled,
  helperText,
  fullWidth,
  size = 'small',
  sx,
}: SearchableSelectProps) {
  const agrupado = options.some((o) => o.group);
  const lista: SearchableOption[] = emptyLabel
    ? [
        // Com grupos, a opção "nenhum" também precisa de um: sem isso o MUI
        // desenha um cabeçalho em branco acima dela.
        { value: EMPTY, label: emptyLabel, group: agrupado ? 'Nenhum' : undefined },
        ...options,
      ]
    : options;

  const daLista = lista.find((o) => o.value === value) ?? null;
  // Com `allowCustom`, um valor digitado não existe na lista — o próprio texto
  // vira o valor do campo, senão o que foi escrito sumiria do input.
  const selecionada: SearchableOption | string | null =
    daLista ?? (allowCustom && value ? value : null);
  // Basta uma opção com foto para valer a coluna de miniaturas: sem ela, as
  // linhas com e sem imagem ficariam desalinhadas entre si.
  const comImagens = showImages ?? options.some((o) => o.imageUrl);

  const pill = variant === 'pill';

  return (
    <Autocomplete
      options={lista}
      value={selecionada}
      freeSolo={allowCustom}
      onChange={(_e, opcao) =>
        onChange(typeof opcao === 'string' ? opcao : (opcao?.value ?? EMPTY))
      }
      // Texto digitado só vira valor quando o campo aceita valor livre; nos
      // demais, digitar apenas filtra a lista.
      onInputChange={(_e, texto, motivo) => {
        if (allowCustom && motivo === 'input') onChange(texto);
        if (onSearchChange && motivo !== 'reset') onSearchChange(texto);
      }}
      filterOptions={onSearchChange ? (x) => x : undefined}
      // Só agrupa quando alguém marcou grupo: o Autocomplete esconde as opções
      // sem `group` se o groupBy estiver sempre ligado.
      groupBy={
        agrupado
          ? (o) => (typeof o === 'string' ? '' : (o.group ?? ''))
          : undefined
      }
      loading={loading}
      noOptionsText={loading ? 'Buscando…' : 'Nenhum resultado'}
      // Limpar o campo volta para a opção "todos" quando ela existe; sem ela,
      // o X não faria sentido e some.
      disableClearable={!emptyLabel && !value}
      disabled={disabled}
      fullWidth={fullWidth}
      size={size}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.label)}
      isOptionEqualToValue={(o, v) =>
        typeof v === 'string' ? o.label === v : o.value === v.value
      }
      renderOption={(props, opcao) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <Box
            component="li"
            key={key}
            {...rest}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}
          >
            {comImagens && opcao.value !== EMPTY && (
              <Thumb src={opcao.imageUrl} alt={opcao.label} />
            )}
            {/* A opção "todos" não tem foto: o recuo mantém o texto alinhado. */}
            {comImagens && opcao.value === EMPTY && (
              <Box sx={{ width: 34, flexShrink: 0 }} />
            )}
            <Box minWidth={0}>
              <Typography noWrap fontSize={14} fontWeight={500}>
                {opcao.label}
              </Typography>
              {opcao.caption && (
                <Typography noWrap fontSize={12} color="text.secondary">
                  {opcao.caption}
                </Typography>
              )}
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          helperText={helperText}
          // Depois de digitar, o input fica rolado no fim e o rótulo aparece
          // cortado pela esquerda ("…das as categorias"). Volta ao início.
          onBlur={(e) => {
            e.currentTarget.scrollLeft = 0;
          }}
          InputProps={{
            ...params.InputProps,
            // Miniatura do item escolhido dentro do próprio campo.
            startAdornment:
              comImagens && daLista && daLista.value !== EMPTY ? (
                <Box sx={{ display: 'flex', pl: pill ? 0.75 : 0, mr: 0.25 }}>
                  {/* Menor que na lista: precisa caber na altura do input. */}
                  <Thumb
                    src={daLista.imageUrl}
                    alt={daLista.label}
                    size={size === 'small' ? 24 : 30}
                  />
                </Box>
              ) : (
                params.InputProps.startAdornment
              ),
          }}
        />
      )}
      sx={{
        // No mobile o campo ocupa a linha inteira, como os demais filtros.
        width: pill ? { xs: '100%', sm: 'auto' } : undefined,
        // Um pouco mais largo que o select antigo: o Autocomplete gasta espaço
        // com o botão de limpar ao lado da seta.
        minWidth: pill ? { xs: 0, sm: 215 } : undefined,
        '& .MuiOutlinedInput-root': pill
          ? { borderRadius: 999, fontSize: 14, fontWeight: 500, pl: 1 }
          : { borderRadius: 2.5, fontSize: 14.5 },
        ...sx,
      }}
    />
  );
}
