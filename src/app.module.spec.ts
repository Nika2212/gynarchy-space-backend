import { AppModule, jwtOptions, mongoOptions } from './app.module';

describe('AppModule', () => {
  it('is defined', () => {
    expect(AppModule).toBeDefined();
  });

  it('builds JWT and Mongo options from config', async () => {
    await expect(
      jwtOptions({ get: () => 'secret' } as never),
    ).resolves.toEqual({ secret: 'secret', signOptions: { expiresIn: '7d' } });

    expect(mongoOptions({ getOrThrow: () => 'mongodb://localhost/gynarchy' } as never)).toEqual({
      uri: 'mongodb://localhost/gynarchy',
      dbName: 'gynarchy',
      serverSelectionTimeoutMS: 10_000,
    });
  });
});
