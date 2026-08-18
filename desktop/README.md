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

## Publicar uma versão

A distribuição **não passa pelo GitHub**. O `publish` do electron-builder é
`generic`, apontando para `https://pikpokviral.com.br/app` — o mesmo domínio
estático do frontend. É de lá que o `electron-updater` lê o `latest.yml` para
descobrir se há versão nova, e é de lá que o botão de download baixa o
instalador. Um provider a menos, um token a menos, e a atualização deixa de
depender de permissão de repositório.

Para publicar:

1. `npm run dist` — gera `release/PikPok-Copiloto-Setup-<versão>.exe` e o
   `release/latest.yml`. O `artifactName` tira os espaços do nome de propósito:
   o `latest.yml` referencia o arquivo por nome e o updater baixa por essa URL,
   e espaço em URL de hospedagem estática é fonte de 404 silencioso.
2. `cd ../frontend && npm run build` — o build do site copia o instalador e o
   `latest.yml` para `dist/app/`. É de propósito: o deploy do frontend já é
   subir o `dist` inteiro para o `public_html`, então o app vai junto e não
   existe uma segunda subida para alguém esquecer. Sem instalador em
   `desktop/release`, o build avisa e segue — o site não fica refém do app.
3. Suba o `dist` para o `public_html` do `pikpokviral.com.br`.
4. Em produção, aponte `DESKTOP_DOWNLOAD_WINDOWS` para a URL do `.exe` e
   `DESKTOP_VERSION` para a versão publicada.

Subir a versão em `package.json` é o que faz o updater enxergar a novidade —
sem isso, o `latest.yml` novo descreve a mesma versão e ninguém atualiza.

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
