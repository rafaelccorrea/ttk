import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { StripeService } from './stripe.service';

// Público de propósito: a autenticidade vem da assinatura do Stripe
// (constructEvent com STRIPE_WEBHOOK_SECRET), não de JWT.
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
