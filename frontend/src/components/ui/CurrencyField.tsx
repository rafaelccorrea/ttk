import { InputAdornment, TextField, TextFieldProps } from '@mui/material';
import { ChangeEvent, useMemo } from 'react';

type CurrencyFieldProps = Omit<TextFieldProps, 'value' | 'onChange' | 'type'> & {
  /** Valor em REAIS (o que o backend espera). `null` = campo vazio. */
  value: number | null;
  onChange: (value: number | null) => void;
};

/** Só os dígitos: é o que o usuário realmente digitou, sem a máscara. */
function apenasDigitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

function formatarCentavos(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Campo de dinheiro em BRL.
 *
 * A máscara preenche da DIREITA para a esquerda, que é como se digita valor no
 * Brasil: "4", "49", "499", "4990" viram 0,04 → 0,49 → 4,99 → 49,90. O usuário
 * nunca digita a vírgula, e por isso nunca erra a casa decimal.
 *
 * O estado guardado é o número em reais — a formatação existe só na tela. Isso
 * evita o problema clássico de mandar "R$ 49,90" (string) para uma API que
 * espera 49.9, ou de o `parseFloat` de "1.234,56" virar 1.234.
 *
 * Digitação por dígito também elimina o `type="number"`, cuja rodinha do mouse
 * altera o valor sem querer e cujo separador decimal muda com o idioma do
 * navegador.
 */
export function CurrencyField({ value, onChange, ...props }: CurrencyFieldProps) {
  const texto = useMemo(
    () => (value === null ? '' : formatarCentavos(Math.round(value * 100))),
    [value],
  );

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const digitos = apenasDigitos(event.target.value);
    if (!digitos) {
      onChange(null);
      return;
    }
    // Teto de 12 dígitos: acima disso o float perde precisão em centavos e o
    // campo passaria a mostrar um número diferente do que foi digitado.
    const centavos = Number(digitos.slice(0, 12));
    onChange(centavos / 100);
  }

  return (
    <TextField
      {...props}
      value={texto}
      onChange={handleChange}
      // `decimal` traz o teclado numérico no celular sem os controles de
      // incremento do type="number".
      inputProps={{ inputMode: 'decimal', ...props.inputProps }}
      InputProps={{
        startAdornment: <InputAdornment position="start">R$</InputAdornment>,
        ...props.InputProps,
      }}
    />
  );
}
