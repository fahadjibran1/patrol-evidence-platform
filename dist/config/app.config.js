"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appConfig = void 0;
const appConfig = () => ({
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    storageRootPath: process.env.STORAGE_ROOT_PATH ?? 'D:/Security_Patrols',
});
exports.appConfig = appConfig;
//# sourceMappingURL=app.config.js.map