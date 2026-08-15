import { BadRequestException } from '@nestjs/common';
import { CsvImportSource } from './csv-import.source';

const file = (content: string, originalName = 'relatorio.csv') => ({
  file: { buffer: Buffer.from(content, 'utf8'), originalName },
});

describe('CsvImportSource', () => {
  const source = new CsvImportSource('dmy');

  describe('orders', () => {
    const csv = [
      'Order ID,Order Status,Created Time,Ship by,Seller SKU,Product Name,Quantity,SKU Unit Original Price,SKU Subtotal After Discount,Order Amount,Shipping Provider Name,Tracking ID',
      '5001,Awaiting Shipment,01/05/2024 10:00:00,03/05/2024 10:00:00,SKU-A,Camiseta,2,"39,90","79,80","89,80",Correios,BR123',
      '5001,Awaiting Shipment,01/05/2024 10:00:00,03/05/2024 10:00:00,SKU-B,Boné,1,"25,00","25,00","89,80",Correios,BR123',
      '5002,Completed,02/05/2024 11:30:00,,SKU-A,Camiseta,1,"39,90","39,90","39,90",Jadlog,BR999',
    ].join('\n');

    it('agrupa as linhas de SKU de volta em pedidos', async () => {
      const result = await source.orders(file(csv));

      expect(result.rows).toHaveLength(2);
      expect(result.rowsRead).toBe(3);
      expect(result.issues).toHaveLength(0);

      const [first] = result.rows;
      expect(first.externalId).toBe('5001');
      expect(first.items.map((i) => i.sku)).toEqual(['SKU-A', 'SKU-B']);
      // O total do pedido não é somado por linha repetida.
      expect(first.grossAmount).toBe(89.8);
      expect(first.placedAt.toISOString()).toBe('2024-05-01T10:00:00.000Z');
      expect(first.shipBy?.toISOString()).toBe('2024-05-03T10:00:00.000Z');
      expect(first.trackingCode).toBe('BR123');
    });

    it('lê quantidade e subtotal de cada item', async () => {
      const { rows } = await source.orders(file(csv));
      const item = rows[0].items[0];
      expect(item).toMatchObject({
        sku: 'SKU-A',
        quantity: 2,
        unitPrice: 39.9,
        subtotal: 79.8,
      });
    });

    it('pula a linha sem número de pedido e registra o problema', async () => {
      const withBad = csv + '\n,Completed,03/05/2024,,SKU-C,Meia,1,"9,90","9,90","9,90",,';
      const result = await source.orders(file(withBad));

      expect(result.rows).toHaveLength(2);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].message).toContain('sem número de pedido');
      expect(result.issues[0].line).toBe(5);
    });

    it('pula pedido com data inválida', async () => {
      const bad = [
        'Order ID,Order Status,Created Time,Seller SKU,Quantity',
        '7001,Completed,data ruim,SKU-A,1',
      ].join('\n');
      const result = await source.orders(file(bad));
      expect(result.rows).toHaveLength(0);
      expect(result.issues[0].message).toContain('sem data de criação');
    });

    it('soma os itens quando o relatório não traz o total do pedido', async () => {
      const semTotal = [
        'Order ID,Order Status,Created Time,Seller SKU,Quantity,SKU Subtotal After Discount',
        '8001,Completed,10/05/2024,SKU-A,1,"10,00"',
        '8001,Completed,10/05/2024,SKU-B,1,"5,50"',
      ].join('\n');
      const { rows } = await source.orders(file(semTotal));
      expect(rows[0].grossAmount).toBe(15.5);
    });
  });

  describe('products', () => {
    const csv = [
      'Product ID,Product Name,Seller SKU,Category,Retail Price,Quantity,Status',
      'P1,Camiseta Oversized,SKU-A,Moda,"39,90",120,Ativo',
      'P1,Camiseta Oversized,SKU-A,Moda,"39,90",120,Ativo',
      'P2,Boné Trucker,SKU-B,Moda,"25,00",0,Ativo',
    ].join('\n');

    it('deduplica variações do mesmo SKU', async () => {
      const result = await source.products(file(csv));
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toMatchObject({
        externalId: 'P1',
        sku: 'SKU-A',
        title: 'Camiseta Oversized',
        price: 39.9,
        stock: 120,
      });
    });

    it('ignora linha sem SKU', async () => {
      const bad = csv + '\n,Sem SKU,,Moda,"1,00",1,Ativo';
      const result = await source.products(file(bad));
      expect(result.issues[0].message).toContain('sem SKU');
    });
  });

  describe('settlements', () => {
    it('converte as taxas negativas do extrato em custo positivo', async () => {
      const csv = [
        'Order/adjustment ID,Order settled time,Total revenue,TikTok Shop commission fee,Transaction fee,Affiliate commission,Total settlement amount',
        '5001,10/05/2024,"89,80","-4,49","-1,80","-8,98","74,53"',
      ].join('\n');

      const { rows } = await source.settlements(file(csv));
      expect(rows[0]).toMatchObject({
        externalOrderId: '5001',
        grossAmount: 89.8,
        commissionFee: 4.49,
        platformFee: 1.8,
        affiliateFee: 8.98,
        netAmount: 74.53,
      });
      expect(rows[0].settledAt?.toISOString()).toBe('2024-05-10T00:00:00.000Z');
    });
  });

  describe('validação de arquivo', () => {
    it('rejeita XLSX com instrução de exportar em CSV', async () => {
      const xlsx = {
        file: {
          buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
          originalName: 'pedidos.xlsx',
        },
      };
      await expect(source.orders(xlsx)).rejects.toThrow(BadRequestException);
      await expect(source.orders(xlsx)).rejects.toThrow(/CSV/);
    });

    it('rejeita arquivo vazio', async () => {
      await expect(source.orders(file(''))).rejects.toThrow('vazio');
    });

    it('rejeita planilha com colunas irreconhecíveis', async () => {
      await expect(source.orders(file('foo,bar\n1,2'))).rejects.toThrow(
        /não reconhecemos as colunas/i,
      );
    });
  });
});
