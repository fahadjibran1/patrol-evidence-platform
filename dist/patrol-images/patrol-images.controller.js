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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatrolImagesController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const patrol_images_service_1 = require("./patrol-images.service");
const create_patrol_image_dto_1 = require("./dto/create-patrol-image.dto");
const manual_ingest_dto_1 = require("./dto/manual-ingest.dto");
const patrol_image_ingestion_service_1 = require("./patrol-image-ingestion.service");
const collector_type_enum_1 = require("../common/enums/collector-type.enum");
let PatrolImagesController = class PatrolImagesController {
    constructor(patrolImagesService, patrolImageIngestionService) {
        this.patrolImagesService = patrolImagesService;
        this.patrolImageIngestionService = patrolImageIngestionService;
    }
    create(dto) {
        return this.patrolImagesService.create(dto);
    }
    async manualIngest(dto, file) {
        const ext = (file.originalname.split('.').pop() || '').toLowerCase();
        if (!['jpg', 'jpeg', 'png'].includes(ext)) {
            throw new common_1.BadRequestException('Only jpg, jpeg, and png files are allowed');
        }
        return this.patrolImageIngestionService.ingestPatrolImage({
            collectorType: collector_type_enum_1.CollectorType.MANUAL,
            siteCode: dto.siteCode,
            timestamp: dto.timestamp,
            senderName: dto.senderName,
            originalFileName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            fileBuffer: file.buffer,
        });
    }
};
exports.PatrolImagesController = PatrolImagesController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_patrol_image_dto_1.CreatePatrolImageDto]),
    __metadata("design:returntype", Promise)
], PatrolImagesController.prototype, "create", null);
__decorate([
    (0, common_1.Post)('manual-ingest'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file')),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.UploadedFile)(new common_1.ParseFilePipe({
        validators: [
            new common_1.MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
            new common_1.FileTypeValidator({ fileType: /image\/(jpeg|png)/i }),
        ],
    }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [manual_ingest_dto_1.ManualIngestDto, typeof (_b = typeof Express !== "undefined" && (_a = Express.Multer) !== void 0 && _a.File) === "function" ? _b : Object]),
    __metadata("design:returntype", Promise)
], PatrolImagesController.prototype, "manualIngest", null);
exports.PatrolImagesController = PatrolImagesController = __decorate([
    (0, common_1.Controller)('patrol-images'),
    __metadata("design:paramtypes", [patrol_images_service_1.PatrolImagesService,
        patrol_image_ingestion_service_1.PatrolImageIngestionService])
], PatrolImagesController);
//# sourceMappingURL=patrol-images.controller.js.map