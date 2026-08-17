import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { caminhoDoInstalador } from './live-config.service';

/**
 * Entrega o instalador do app de desktop.
 *
 * SEM AUTENTICAÇÃO, e a decisão é deliberada.
 *
 * O download é disparado por um `<a href>` numa navegação do navegador, e uma
 * navegação não carrega o header `Authorization` — o token só existe dentro do
 * axios do app. As saídas seriam baixar 80MB como blob em memória no navegador,
 * ou inventar URL assinada; as duas trocam um problema real (o vendedor precisa
 * do arquivo) por complexidade que não protege nada.
 *
 * Porque não protege: o instalador é INERTE sem uma conta pareada. Quem o baixa
 * sem ser cliente recebe uma janela que pede um código de ativação — que só é
 * emitido para quem tem plano Business com o recurso liberado. É a mesma razão
 * pela qual todo produto de desktop serve o instalador publicamente e guarda a
 * porta no login, não no download.
 *
 * O que fica de fora daqui, e continua autenticado: `GET /live/download`, que
 * diz se existe versão e qual é. Metadado do produto é outra conversa.
 *
 * Este caminho serve para operar sem CDN — em produção, apontar
 * `DESKTOP_DOWNLOAD_WINDOWS` para um GitHub Release tira 80MB de tráfego do
 * processo da API, que é onde ele não deveria estar.
 */
@ApiTags('downloads')
@ApiExcludeController()
@Controller('downloads')
export class DownloadController {
  @Get('copiloto/:plataforma')
  @ApiOperation({ summary: 'Baixa o instalador do app de desktop' })
  // `no-store`: o arquivo muda de conteúdo mantendo a mesma URL a cada release,
  // e um proxy servindo a versão anterior é um bug que ninguém consegue
  // reproduzir — o usuário jura que baixou o novo, e baixou mesmo, do cache.
  @Header('Cache-Control', 'no-store')
  baixar(
    @Param('plataforma') plataforma: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    /*
     * A plataforma é comparada contra uma lista fechada e NUNCA entra na
     * montagem de caminho. Concatenar um parâmetro de rota num caminho de
     * arquivo é o caminho travessado clássico (`../../.env`), e o fato de este
     * endpoint ser público torna isso um vazamento de qualquer arquivo que o
     * processo consiga ler.
     */
    if (plataforma !== 'windows' && plataforma !== 'mac') {
      throw new NotFoundException('Instalador não encontrado.');
    }

    const caminho = caminhoDoInstalador(plataforma);
    if (!caminho || !existsSync(caminho)) {
      throw new NotFoundException(
        'O instalador ainda não está publicado neste servidor.',
      );
    }

    // O nome sai do arquivo em disco, não do parâmetro: é ele que o vendedor vê
    // na pasta de Downloads, e é o único lugar em que a versão aparece depois
    // que o arquivo sai daqui.
    const nome = basename(caminho);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${nome.replace(/"/g, '')}"`,
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    // Sem o tamanho o navegador mostra uma barra de progresso indeterminada por
    // 80MB — e um download sem previsão de fim é um download que a pessoa
    // cancela achando que travou.
    res.setHeader('Content-Length', String(statSync(caminho).size));

    return new StreamableFile(createReadStream(caminho));
  }
}
