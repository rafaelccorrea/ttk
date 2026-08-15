import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { StripeService } from './stripe.service';

// Público de propósito: a autenticidade vem da assinatura do Stripe
// (constructEvent com STRIPE_WEBHOOK_SECRET), não de JWT.
// Fora do rate limit global: o Stripe pode disparar rajadas legítimas (retries,
// renovações em lote) de um punhado de IPs, e um 429 aqui vira pagamento
// confirmado que a gente nunca registra. A assinatura já barra quem não é ele.
@SkipThrottle()
@ApiTags('billing')
@Controller('billing/stripe')
export class StripeWebhookController {
  constructor(private readonly stripeService: StripeService) {}

  @Post('webhook')
  @ApiOperation({ summary: 'Webhook do Stripe (checkout e renovações)' })
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Requisição inválida.');
    }
    return this.stripeService.handleWebhook(req.rawBody, signature);
  }
}
