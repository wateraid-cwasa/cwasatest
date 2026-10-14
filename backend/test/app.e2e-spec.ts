import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.SOURCE_DATABASE_URL ??=
      'sqlserver://localhost:1433;database=source_test;user=test;password=test;trustServerCertificate=true';
    process.env.PLATFORM_DATABASE_URL ??=
      'sqlserver://localhost:1433;database=platform_test;user=test;password=test;trustServerCertificate=true';

    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-with-at-least-thirty-two-characters';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-with-at-least-thirty-two-characters';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  it('/api/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('protects administrator endpoints', () => {
    return request(app.getHttpServer()).get('/api/v1/admin/inspectors').expect(401);
  });

  it('protects reading lookup and creation endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/readings/assigned-customers')
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/readings/customer-lookup')
      .query({ identifier: '310245' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/readings')
      .send({
        identifier: '310245',
        currentBill: '1850.00',
        latitude: 22.3385,
        longitude: 91.8152,
      })
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/readings/pending')
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/readings/completed')
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/readings/admin/pending')
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/readings/admin/00000000-0000-0000-0000-000000000000/approve')
      .expect(401);
  });

  it('protects service request list, customer lookup, and creation endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/service-requests')
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/service-requests/customer-lookup')
      .query({ identifier: '310245' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/service-requests')
      .send({
        identifier: '310245',
        problemType: 'Meter defective',
        description: 'Meter dial is not moving.',
      })
      .expect(401);
  });

  it('validates inspector login input before database access', () => {
    return request(app.getHttpServer())
      .post('/api/v1/meter-reader/login')
      .send({ meterReaderId: '', password: '' })
      .expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
