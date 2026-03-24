"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatrolGroupsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const patrol_group_entity_1 = require("./entities/patrol-group.entity");
const patrol_groups_service_1 = require("./patrol-groups.service");
const patrol_groups_controller_1 = require("./patrol-groups.controller");
const sites_module_1 = require("../sites/sites.module");
let PatrolGroupsModule = class PatrolGroupsModule {
};
exports.PatrolGroupsModule = PatrolGroupsModule;
exports.PatrolGroupsModule = PatrolGroupsModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([patrol_group_entity_1.PatrolGroup]), sites_module_1.SitesModule],
        providers: [patrol_groups_service_1.PatrolGroupsService],
        controllers: [patrol_groups_controller_1.PatrolGroupsController],
        exports: [patrol_groups_service_1.PatrolGroupsService, typeorm_1.TypeOrmModule],
    })
], PatrolGroupsModule);
//# sourceMappingURL=patrol-groups.module.js.map