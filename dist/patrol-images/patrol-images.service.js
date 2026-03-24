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
exports.PatrolImagesService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const patrol_image_entity_1 = require("./entities/patrol-image.entity");
const compliance_service_1 = require("../compliance/compliance.service");
const patrol_slot_status_enum_1 = require("../common/enums/patrol-slot-status.enum");
let PatrolImagesService = class PatrolImagesService {
    constructor(imageRepo, complianceService) {
        this.imageRepo = imageRepo;
        this.complianceService = complianceService;
    }
    async create(dto) {
        const image = await this.imageRepo.save(this.imageRepo.create({
            ...dto,
            sentAt: new Date(dto.sentAt),
            receivedAt: new Date(dto.receivedAt),
            status: patrol_slot_status_enum_1.PatrolSlotStatus.PENDING,
        }));
        const status = await this.complianceService.updateSlotStatusFromImage(image);
        image.status = status;
        return this.imageRepo.save(image);
    }
};
exports.PatrolImagesService = PatrolImagesService;
exports.PatrolImagesService = PatrolImagesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(patrol_image_entity_1.PatrolImage)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        compliance_service_1.ComplianceService])
], PatrolImagesService);
//# sourceMappingURL=patrol-images.service.js.map