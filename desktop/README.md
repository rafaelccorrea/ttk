# PikPok Copiloto (desktop)

App Electron do copiloto ao vivo, em **modo somente-painel**: ele lê o chat da
transmissão e mostra a resposta na tela para o vendedor copiar ou falar em voz
alta. **Nada é publicado no chat do TikTok** — o envio automático é a fase 2.

A janela é dividida: 60% à esquerda é uma `BrowserView` com o tiktok.com
(sessão persistente, partição `persist:tiktok`, então o login sobrevive ao
fechamento do app), 40% à direita é o painel em React + MUI.

## Rodar

```bash
npm install
npm run dev     # electron-vite em modo dev, com HMR no painel
npm run build   # tsc --noEmit + build dos três alvos em out/
npm run dist    # build + instalador via electron-builder (release/)
```

## Estrutura

| Caminho            | O que é                                                |
| ------------------ | ------------------------------------------------------ |
| `src/main/`        | Processo principal: janela, BrowserView, IPC            |
| `src/preload/`     | A ponte `contextBridge` do painel — mínima por regra    |
| `src/renderer/`    | O painel (React 18 + MUI 5, tema copiado do `frontend/`)|
| `src/shared/`      | Tipos espelhados do backend (eventos SSE da live)       |

## Antes de mexer

- `contextIsolation` **ligado** e `nodeIntegration` **desligado**, em todo
  `webPreferences`. O app carrega um site de terceiro dentro dele; o porquê
  está por extenso em `src/preload/index.ts`.
- O painel e a `BrowserView` do TikTok são **mundos separados**. O preload da
  view (quando existir) nunca expõe a API do app.
- `src/shared/live-events.ts` é cópia manual do contrato do backend
  (`backend/src/modules/live/live-run.controller.ts`). Mudou lá, muda aqui.
- As versões de React, MUI e Emotion são casadas com as do `frontend/` para que
  o tema copiado continue compilando.
