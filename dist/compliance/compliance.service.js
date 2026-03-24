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
var ComplianceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComplianceService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const site_entity_1 = require("../sites/entities/site.entity");
const patrol_schedule_entity_1 = require("../patrol-schedules/entities/patrol-schedule.entity");
const patrol_slots_service_1 = require("../patrol-slots/patrol-slots.service");
const patrol_slot_status_enum_1 = require("../common/enums/patrol-slot-status.enum");
const patrol_alerts_service_1 = require("../patrol-alerts/patrol-alerts.service");
let ComplianceService = ComplianceService_1 = class ComplianceService {
    constructor(siteRepo, schedulesRepo, patrolSlotsService, patrolAlertsService) {
        this.siteRepo = siteRepo;
        this.schedulesRepo = schedulesRepo;
        this.patrolSlotsService = patrolSlotsService;
        this.patrolAlertsService = patrolAlertsService;
        this.logger = new common_1.Logger(ComplianceService_1.name);
    }
    async generateSlotsForDate(date) {
        const dayStart = new Date(`${date}T00:00:00.000Z`);
        const dayEnd = new Date(`${date}T23:59:59.999Z`);
        const activeSites = await this.siteRepo.find({ where: { active: true } });
        let slotsCreated = 0;
        let sitesProcessed = 0;
        for (const site of activeSites) {
            const schedule = await this.schedulesRepo.findOne({
                where: { siteId: site.id, active: true },
                order: { createdAt: 'DESC' },
            });
            if (!schedule || !schedule.activeDays.includes(dayStart.getUTCDay())) {
                continue;
            }
            sitesProcessed += 1;
            const existing = await this.patrolSlotsService.findBySiteAndDate(site.id, dayStart, dayEnd);
            const existingExpectedTimes = new Set(existing.map((slot) => slot.expectedAt.toISOString()));
            const slots = [];
            const frequency = schedule.frequencyMinutes;
            for (let hour = schedule.startHour; hour <= schedule.endHour; hour += 1) {
                const slotStart = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate(), hour, 0, 0));
                for (let minute = 0; minute < 60; minute += frequency) {
                    const expectedAt = new Date(slotStart.getTime() + minute * 60 * 1000);
                    const slotEnd = new Date(expectedAt.getTime() + frequency * 60 * 1000);
                    if (expectedAt > dayEnd) {
                        continue;
                    }
                    if (existingExpectedTimes.has(expectedAt.toISOString())) {
                        continue;
                    }
                    slots.push({
                        siteId: site.id,
                        expectedAt,
                        slotStart: expectedAt,
                        slotEnd,
                        status: patrol_slot_status_enum_1.PatrolSlotStatus.PENDING,
                    });
                }
            }
            if (slots.length > 0) {
                await this.patrolSlotsService.createMany(slots);
                slotsCreated += slots.length;
            }
        }
        return { slotsCreated, sitesProcessed };
    }
    async generateToday() {
        const date = new Date().toISOString().slice(0, 10);
        return this.generateSlotsForDate(date);
    }
    async updateSlotStatusFromImage(image) {
        const slot = await this.patrolSlotsService.findSlotForTimestamp(image.siteId, image.sentAt);
        if (!slot) {
            return patrol_slot_status_enum_1.PatrolSlotStatus.MISSING;
        }
        if (slot.imageId) {
            return patrol_slot_status_enum_1.PatrolSlotStatus.DUPLICATE;
        }
        const schedule = await this.schedulesRepo.findOne({
            where: { siteId: image.siteId, active: true },
            order: { createdAt: 'DESC' },
        });
        const graceMinutes = schedule?.graceMinutes ?? 15;
        const graceCutoff = new Date(slot.expectedAt.getTime() + graceMinutes * 60 * 1000);
        const status = image.sentAt <= graceCutoff ? patrol_slot_status_enum_1.PatrolSlotStatus.RECEIVED_ON_TIME : patrol_slot_status_enum_1.PatrolSlotStatus.RECEIVED_LATE;
        await this.patrolSlotsService.updateSlotStatus(slot.id, status, image.id);
        return status;
    }
    async markMissingSlots(now = new Date()) {
        const stalePending = await this.patrolSlotsService.findPendingPastCutoff(now);
        let missingCount = 0;
        for (const slot of stalePending) {
            const schedule = await this.schedulesRepo.findOne({
                where: { siteId: slot.siteId, active: true },
                order: { createdAt: 'DESC' },
            });
            const graceMinutes = schedule?.graceMinutes ?? 15;
            const missingCutoff = new Date(slot.slotEnd.getTime() + graceMinutes * 60 * 1000);
            if (now <= missingCutoff) {
                continue;
            }
            await this.patrolSlotsService.updateSlotStatus(slot.id, patrol_slot_status_enum_1.PatrolSlotStatus.MISSING);
            await this.patrolAlertsService.createMissingAlert({
                siteId: slot.siteId,
                slotId: slot.id,
                alertTime: now,
                alertMessage: `Missing patrol evidence for expected slot ${slot.expectedAt.toISOString()}`,
            });
            missingCount += 1;
        }
        return missingCount;
    }
    async checkMissingPatrols() {
        const marked = await this.markMissingSlots();
        if (marked > 0) {
            this.logger.warn(`Marked ${marked} slot(s) as missing.`);
        }
    }
};
exports.ComplianceService = ComplianceService;
__decorate([
    (0, schedule_1.Cron)('*/5 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ComplianceService.prototype, "checkMissingPatrols", null);
exports.ComplianceService = ComplianceService = ComplianceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(site_entity_1.Site)),
    __param(1, (0, typeorm_1.InjectRepository)(patrol_schedule_entity_1.PatrolSchedule)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        patrol_slots_service_1.PatrolSlotsService,
        patrol_alerts_service_1.PatrolAlertsService])
], ComplianceService);
//# sourceMappingURL=compliance.service.js.map