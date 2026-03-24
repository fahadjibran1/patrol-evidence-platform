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
exports.PatrolGroupsController = void 0;
const common_1 = require("@nestjs/common");
const patrol_groups_service_1 = require("./patrol-groups.service");
const create_patrol_group_dto_1 = require("./dto/create-patrol-group.dto");
const update_patrol_group_dto_1 = require("./dto/update-patrol-group.dto");
let PatrolGroupsController = class PatrolGroupsController {
    constructor(groupsService) {
        this.groupsService = groupsService;
    }
    create(dto) {
        return this.groupsService.create(dto);
    }
    findAll() {
        return this.groupsService.findAll();
    }
    findOne(id) {
        return this.groupsService.findOne(id);
    }
    update(id, dto) {
        return this.groupsService.update(id, dto);
    }
    remove(id) {
        return this.groupsService.remove(id);
    }
};
exports.PatrolGroupsController = PatrolGroupsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_patrol_group_dto_1.CreatePatrolGroupDto]),
    __metadata("design:returntype", Promise)
], PatrolGroupsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PatrolGroupsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PatrolGroupsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_patrol_group_dto_1.UpdatePatrolGroupDto]),
    __metadata("design:returntype", Promise)
], PatrolGroupsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PatrolGroupsController.prototype, "remove", null);
exports.PatrolGroupsController = PatrolGroupsController = __decorate([
    (0, common_1.Controller)('patrol-groups'),
    __metadata("design:paramtypes", [patrol_groups_service_1.PatrolGroupsService])
], PatrolGroupsController);
//# sourceMappingURL=patrol-groups.controller.js.map