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
exports.PatrolSchedulesService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const patrol_schedule_entity_1 = require("./entities/patrol-schedule.entity");
const sites_service_1 = require("../sites/sites.service");
let PatrolSchedulesService = class PatrolSchedulesService {
    constructor(schedulesRepo, sitesService) {
        this.schedulesRepo = schedulesRepo;
        this.sitesService = sitesService;
    }
    async create(dto) {
        this.validateHours(dto.startHour, dto.endHour);
        await this.sitesService.findOne(dto.siteId);
        return this.schedulesRepo.save(this.schedulesRepo.create(dto));
    }
    findAll() {
        return this.schedulesRepo.find({ relations: ['site'], order: { createdAt: 'DESC' } });
    }
    async findOne(id) {
        const schedule = await this.schedulesRepo.findOne({ where: { id }, relations: ['site'] });
        if (!schedule) {
            throw new common_1.NotFoundException(`Patrol schedule ${id} not found`);
        }
        return schedule;
    }
    async update(id, dto) {
        const schedule = await this.findOne(id);
        if (dto.siteId) {
            await this.sitesService.findOne(dto.siteId);
        }
        this.validateHours(dto.startHour ?? schedule.startHour, dto.endHour ?? schedule.endHour);
        return this.schedulesRepo.save({ ...schedule, ...dto });
    }
    async remove(id) {
        const schedule = await this.findOne(id);
        await this.schedulesRepo.remove(schedule);
    }
    validateHours(startHour, endHour) {
        if (endHour < startHour) {
            throw new common_1.BadRequestException('endHour must be greater than or equal to startHour');
        }
    }
};
exports.PatrolSchedulesService = PatrolSchedulesService;
exports.PatrolSchedulesService = PatrolSchedulesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(patrol_schedule_entity_1.PatrolSchedule)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        sites_service_1.SitesService])
], PatrolSchedulesService);
//# sourceMappingURL=patrol-schedules.service.js.map