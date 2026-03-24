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
exports.PatrolSlotsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const patrol_slot_entity_1 = require("./entities/patrol-slot.entity");
const patrol_slot_status_enum_1 = require("../common/enums/patrol-slot-status.enum");
let PatrolSlotsService = class PatrolSlotsService {
    constructor(slotsRepo) {
        this.slotsRepo = slotsRepo;
    }
    createMany(slots) {
        return this.slotsRepo.save(this.slotsRepo.create(slots));
    }
    findBySiteAndDate(siteId, dayStart, dayEnd) {
        return this.slotsRepo.find({
            where: {
                siteId,
                expectedAt: (0, typeorm_2.Between)(dayStart, dayEnd),
            },
            order: { expectedAt: 'ASC' },
        });
    }
    async findBySiteCodeAndDate(siteCode, dayStart, dayEnd) {
        return this.slotsRepo
            .createQueryBuilder('slot')
            .innerJoinAndSelect('slot.site', 'site')
            .where('site.siteCode = :siteCode', { siteCode })
            .andWhere('slot.expectedAt BETWEEN :dayStart AND :dayEnd', { dayStart, dayEnd })
            .orderBy('slot.expectedAt', 'ASC')
            .getMany();
    }
    async findSlotForTimestamp(siteId, timestamp) {
        return this.slotsRepo
            .createQueryBuilder('slot')
            .where('slot.siteId = :siteId', { siteId })
            .andWhere(':timestamp >= slot.slotStart', { timestamp })
            .andWhere(':timestamp < slot.slotEnd', { timestamp })
            .orderBy('slot.slotStart', 'DESC')
            .getOne();
    }
    async updateSlotStatus(slotId, status, imageId) {
        const slot = await this.slotsRepo.findOne({ where: { id: slotId } });
        if (!slot) {
            throw new common_1.NotFoundException(`Slot ${slotId} not found`);
        }
        slot.status = status;
        slot.imageId = imageId ?? null;
        slot.resolvedAt = new Date();
        return this.slotsRepo.save(slot);
    }
    async save(slot) {
        return this.slotsRepo.save(slot);
    }
    async findPendingPastCutoff(now) {
        return this.slotsRepo
            .createQueryBuilder('slot')
            .where('slot.status = :status', { status: patrol_slot_status_enum_1.PatrolSlotStatus.PENDING })
            .andWhere('slot.slotEnd < :now', { now })
            .getMany();
    }
};
exports.PatrolSlotsService = PatrolSlotsService;
exports.PatrolSlotsService = PatrolSlotsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(patrol_slot_entity_1.PatrolSlot)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], PatrolSlotsService);
//# sourceMappingURL=patrol-slots.service.js.map