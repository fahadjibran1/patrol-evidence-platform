"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const fs_1 = require("fs");
const path = require("path");
let StorageService = class StorageService {
    constructor(configService) {
        this.rootPath = configService.getOrThrow('storageRootPath');
    }
    async savePatrolEvidence(params) {
        const siteCode = this.sanitize(params.siteCode);
        const patrolDate = this.formatDate(params.timestamp);
        const timePart = this.formatTime(params.timestamp);
        const storedFileName = `${siteCode}_${patrolDate}_${timePart}.jpg`;
        const targetDir = path.join(this.rootPath, siteCode, patrolDate);
        const filePath = path.join(targetDir, storedFileName);
        await fs_1.promises.mkdir(targetDir, { recursive: true });
        await fs_1.promises.writeFile(filePath, params.buffer);
        return {
            storedFileName,
            filePath,
            fileSize: params.buffer.length,
            mimeType: params.mimeType,
        };
    }
    sanitize(value) {
        return value
            .trim()
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/_+/g, '_');
    }
    formatDate(value) {
        const year = value.getUTCFullYear();
        const month = String(value.getUTCMonth() + 1).padStart(2, '0');
        const day = String(value.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    formatTime(value) {
        const hh = String(value.getUTCHours()).padStart(2, '0');
        const mm = String(value.getUTCMinutes()).padStart(2, '0');
        const ss = String(value.getUTCSeconds()).padStart(2, '0');
        return `${hh}-${mm}-${ss}`;
    }
};
exports.StorageService = StorageService;
exports.StorageService = StorageService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], StorageService);
//# sourceMappingURL=storage.service.js.map