import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

// Hosts obviamente internos são bloqueados (proteção SSRF básica).
const BLOCKED_HOST = /^(localhost|127\.|0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|\[::1\]|.*\.local)$/i;

/**
 * Proxy de imagens: CDNs de terceiros (TikTok, Shopee, Mercado Livre...)
 * bloqueiam hotlink pelo Referer do navegador, mas respondem a requisições
 * de servidor. Sem auth (é usado em <img>), com cache agressivo.
 */
@ApiTags('media')
@Controller('media')
export class MediaController {
  @Get('proxy')
  @ApiOperation({ summary: 'Proxy de imagem externa (contorna bloqueio de hotlink)' })
  async proxy(@Query('url') url: string, @Res() res: Response) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('URL inválida');
    }
    if (parsed.protocol !== 'https:' || BLOCKED_HOST.test(parsed.hostname) || /^[\d.]+$/.test(parsed.hostname)) {
      throw new BadRequestException('Host não permitido');
    }

    const upstream = await fetch(parsed.toString(), {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!upstream.ok || !upstream.body) {
      res.status(502).end();
      return;
    }
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
      res.status(415).end();
      return;
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  }
}
