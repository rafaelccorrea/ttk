import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Teto de upload aplicado ONDE ELE PRECISA SER APLICADO: no multer.
 *
 * O `MaxFileSizeValidator` do `ParseFilePipe` parece resolver isso e não
 * resolve — ele é um pipe, e pipe roda DEPOIS que o multer já leu a requisição
 * inteira. Sem `limits.fileSize`, o multer aceita o corpo até o fim antes de
 * alguém olhar o tamanho: nos endpoints que guardam o arquivo em memória
 * (`FileInterceptor` sem `dest`), um POST de 2 GB vira 2 GB de heap e o
 * processo morre por OOM. O validador então rejeita um arquivo que já custou o
 * servidor inteiro — e uma conta de plano básico derruba a API de todo mundo
 * com um `curl`.
 *
 * Com `limits.fileSize` o multer aborta o stream ao passar do teto, sem
 * bufferizar o resto. O `MaxFileSizeValidator` continua no lugar: ele é quem
 * transforma o corte numa mensagem que o cliente entende, e vale também para o
 * caminho em disco (`dest`), onde o custo é I/O e não memória.
 *
 * `files: 1` fecha a outra ponta: um multipart com 500 partes de arquivo
 * respeitaria o teto individual e ainda assim somaria gigabytes. `fields`
 * limita o mesmo abuso pelo lado dos campos de texto, que o multer aceita sem
 * limite por padrão.
 */
export function limiteDeUpload(bytes: number): MulterOptions {
  return { limits: { fileSize: bytes, files: 1, fields: 100 } };
}

/**
 * Mesma coisa para quem grava em disco em vez de memória (gravação de live,
 * vídeo de cortes): o teto vale igual, só muda o recurso que ele protege.
 */
export function limiteDeUploadEmDisco(
  bytes: number,
  destino: string,
): MulterOptions {
  return { dest: destino, limits: { fileSize: bytes, files: 1, fields: 100 } };
}
