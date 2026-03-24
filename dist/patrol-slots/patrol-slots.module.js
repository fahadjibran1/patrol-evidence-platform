"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatrolSlotsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const patrol_slot_entity_1 = require("./entities/patrol-slot.entity");
const patrol_slots_service_1 = require("./patrol-slots.service");
const patrol_slots_controller_1 = require("./patrol-slots.controller");
let PatrolSlotsModule = class PatrolSlotsModule {
};
exports.PatrolSlotsModule = PatrolSlotsModule;
exports.PatrolSlotsModule = PatrolSlotsModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([patrol_slot_entity_1.PatrolSlot])],
        providers: [patrol_slots_service_1.PatrolSlotsService],
        controllers: [patrol_slots_controller_1.PatrolSlotsController],
        exports: [patrol_slots_service_1.PatrolSlotsService, typeorm_1.TypeOrmModule],
    })
], PatrolSlotsModule);
//# sourceMappingURL=patrol-slots.module.js.map