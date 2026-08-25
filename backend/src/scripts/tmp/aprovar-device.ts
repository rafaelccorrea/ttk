import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { DeviceFlowService } from '../../modules/auth/device-flow.service';
async function main() {
  const [userId, code] = [process.argv[2], process.argv[3]];
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try { console.log(JSON.stringify(await app.get(DeviceFlowService).aprovar(userId, code))); }
  finally { await app.close(); }
}
void main().catch((e) => { console.error(e.message); process.exitCode = 1; });
