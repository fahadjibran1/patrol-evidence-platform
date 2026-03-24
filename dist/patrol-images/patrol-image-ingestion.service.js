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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatrolImageIngestionService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const collector_type_enum_1 = require("../common/enums/collector-type.enum");
const patrol_slot_status_enum_1 = require("../common/enums/patrol-slot-status.enum");
const site_entity_1 = require("../sites/entities/site.entity");
const patrol_image_entity_1 = require("./entities/patrol-image.entity");
const storage_service_1 = require("../storage/storage.service");
const compliance_service_1 = require("../compliance/compliance.service");
let PatrolImageIngestionService = class PatrolImageIngestionService {
    constructor(siteRepo, imageRepo, storageService, complianceService) {
        this.siteRepo = siteRepo;
        this.imageRepo = imageRepo;
        this.storageService = storageService;
        this.complianceService = complianceService;
    }
    async ingestPatrolImage(event) {
        const normalized = this.normalizeIncomingEvent(event);
        const site = await this.mapSourceToSite(normalized.siteCode);
        const stored = await this.storageService.savePatrolEvidence({
            siteCode: site.siteCode,
            timestamp: normalized.timestamp,
            buffer: normalized.fileBuffer,
            mimeType: normalized.mimeType,
        });
        const patrolDate = normalized.timestamp.toISOString().slice(0, 10);
        const image = await this.imageRepo.save(this.imageRepo.create({
            siteId: site.id,
            collectorType: normalized.collectorType,
            senderName: normalized.senderName ?? null,
            senderNumber: null,
            messageExternalId: null,
            sentAt: normalized.timestamp,
            receivedAt: new Date(),
            patrolDate,
            patrolHour: normalized.timestamp.getUTCHours(),
            originalFileName: normalized.originalFileName ?? null,
            storedFileName: stored.storedFileName,
            filePath: stored.filePath,
            fileSize: String(stored.fileSize),
            mimeType: stored.mimeType,
            status: patrol_slot_status_enum_1.PatrolSlotStatus.PENDING,
            notes: null,
        }));
        const slotStatus = await this.complianceService.updateSlotStatusFromImage(image);
        image.status = slotStatus;
        return this.imageRepo.save(image);
    }
    normalizeIncomingEvent(event) {
        return {
            ...event,
            collectorType: event.collectorType ?? collector_type_enum_1.CollectorType.MANUAL,
            timestamp: new Date(event.timestamp),
            senderName: event.senderName?.trim() || 'manual',
        };
    }
    async mapSourceToSite(siteCode) {
        const site = await this.siteRepo.findOne({ where: { siteCode, active: true } });
        if (!site) {
            throw new common_1.NotFoundException(`Active site with code ${siteCode} not found`);
        }
        return site;
    }
};
exports.PatrolImageIngestionService = PatrolImageIngestionService;
exports.PatrolImageIngestionService = PatrolImageIngestionService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(site_entity_1.Site)),
    __param(1, (0, typeorm_1.InjectRepository)(patrol_image_entity_1.PatrolImage)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        storage_service_1.StorageService,
        compliance_service_1.ComplianceService])
], PatrolImageIngestionService);
//# sourceMappingURL=patrol-image-ingestion.service.js.map