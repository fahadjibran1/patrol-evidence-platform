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
exports.PatrolSchedulesController = void 0;
const common_1 = require("@nestjs/common");
const patrol_schedules_service_1 = require("./patrol-schedules.service");
const create_patrol_schedule_dto_1 = require("./dto/create-patrol-schedule.dto");
const update_patrol_schedule_dto_1 = require("./dto/update-patrol-schedule.dto");
let PatrolSchedulesController = class PatrolSchedulesController {
    constructor(schedulesService) {
        this.schedulesService = schedulesService;
    }
    create(dto) {
        return this.schedulesService.create(dto);
    }
    findAll() {
        return this.schedulesService.findAll();
    }
    findOne(id) {
        return this.schedulesService.findOne(id);
    }
    update(id, dto) {
        return this.schedulesService.update(id, dto);
    }
    remove(id) {
        return this.schedulesService.remove(id);
    }
};
exports.PatrolSchedulesController = PatrolSchedulesController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_patrol_schedule_dto_1.CreatePatrolScheduleDto]),
    __metadata("design:returntype", Promise)
], PatrolSchedulesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PatrolSchedulesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PatrolSchedulesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_patrol_schedule_dto_1.UpdatePatrolScheduleDto]),
    __metadata("design:returntype", Promise)
], PatrolSchedulesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PatrolSchedulesController.prototype, "remove", null);
exports.PatrolSchedulesController = PatrolSchedulesController = __decorate([
    (0, common_1.Controller)('patrol-schedules'),
    __metadata("design:paramtypes", [patrol_schedules_service_1.PatrolSchedulesService])
], PatrolSchedulesController);
//# sourceMappingURL=patrol-schedules.controller.js.map