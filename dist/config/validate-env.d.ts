declare class EnvVars {
    NODE_ENV?: string;
    PORT?: number;
    DB_HOST: string;
    DB_PORT: number;
    DB_USER: string;
    DB_PASSWORD: string;
    DB_NAME: string;
    STORAGE_ROOT_PATH: string;
}
export declare function validateEnv(config: Record<string, unknown>): EnvVars;
export {};
