"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatrolSchedulesModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const patrol_schedule_entity_1 = require("./entities/patrol-schedule.entity");
const patrol_schedules_service_1 = require("./patrol-schedules.service");
const patrol_schedules_controller_1 = require("./patrol-schedules.controller");
const sites_module_1 = require("../sites/sites.module");
let PatrolSchedulesModule = class PatrolSchedulesModule {
};
exports.PatrolSchedulesModule = PatrolSchedulesModule;
exports.PatrolSchedulesModule = PatrolSchedulesModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([patrol_schedule_entity_1.PatrolSchedule]), sites_module_1.SitesModule],
        providers: [patrol_schedules_service_1.PatrolSchedulesService],
        controllers: [patrol_schedules_controller_1.PatrolSchedulesController],
        exports: [patrol_schedules_service_1.PatrolSchedulesService, typeorm_1.TypeOrmModule],
    })
], PatrolSchedulesModule);
//# sourceMappingURL=patrol-schedules.module.js.map