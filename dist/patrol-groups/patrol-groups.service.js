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
exports.PatrolGroupsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const patrol_group_entity_1 = require("./entities/patrol-group.entity");
const sites_service_1 = require("../sites/sites.service");
let PatrolGroupsService = class PatrolGroupsService {
    constructor(groupsRepo, sitesService) {
        this.groupsRepo = groupsRepo;
        this.sitesService = sitesService;
    }
    async create(dto) {
        await this.sitesService.findOne(dto.siteId);
        return this.groupsRepo.save(this.groupsRepo.create(dto));
    }
    findAll() {
        return this.groupsRepo.find({ relations: ['site'], order: { createdAt: 'DESC' } });
    }
    async findOne(id) {
        const group = await this.groupsRepo.findOne({ where: { id }, relations: ['site'] });
        if (!group) {
            throw new common_1.NotFoundException(`Patrol group ${id} not found`);
        }
        return group;
    }
    async update(id, dto) {
        if (dto.siteId) {
            await this.sitesService.findOne(dto.siteId);
        }
        const group = await this.findOne(id);
        return this.groupsRepo.save({ ...group, ...dto });
    }
    async remove(id) {
        const group = await this.findOne(id);
        await this.groupsRepo.remove(group);
    }
};
exports.PatrolGroupsService = PatrolGroupsService;
exports.PatrolGroupsService = PatrolGroupsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(patrol_group_entity_1.PatrolGroup)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        sites_service_1.SitesService])
], PatrolGroupsService);
//# sourceMappingURL=patrol-groups.service.js.map