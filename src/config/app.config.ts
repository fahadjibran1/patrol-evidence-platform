export const appConfig = () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  storageRootPath: process.env.STORAGE_ROOT_PATH ?? 'D:/Security_Patrols',
});
