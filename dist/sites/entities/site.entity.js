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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Site = void 0;
const typeorm_1 = require("typeorm");
const patrol_group_entity_1 = require("../../patrol-groups/entities/patrol-group.entity");
const patrol_schedule_entity_1 = require("../../patrol-schedules/entities/patrol-schedule.entity");
const patrol_image_entity_1 = require("../../patrol-images/entities/patrol-image.entity");
const patrol_slot_entity_1 = require("../../patrol-slots/entities/patrol-slot.entity");
const patrol_alert_entity_1 = require("../../patrol-alerts/entities/patrol-alert.entity");
let Site = class Site {
};
exports.Site = Site;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Site.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)({ unique: true }),
    (0, typeorm_1.Column)({ length: 20 }),
    __metadata("design:type", String)
], Site.prototype, "siteCode", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 120 }),
    __metadata("design:type", String)
], Site.prototype, "siteName", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 120, nullable: true }),
    __metadata("design:type", Object)
], Site.prototype, "clientName", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], Site.prototype, "active", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], Site.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], Site.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => patrol_group_entity_1.PatrolGroup, (group) => group.site),
    __metadata("design:type", Array)
], Site.prototype, "groups", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => patrol_schedule_entity_1.PatrolSchedule, (schedule) => schedule.site),
    __metadata("design:type", Array)
], Site.prototype, "schedules", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => patrol_image_entity_1.PatrolImage, (image) => image.site),
    __metadata("design:type", Array)
], Site.prototype, "images", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => patrol_slot_entity_1.PatrolSlot, (slot) => slot.site),
    __metadata("design:type", Array)
], Site.prototype, "slots", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => patrol_alert_entity_1.PatrolAlert, (alert) => alert.site),
    __metadata("design:type", Array)
], Site.prototype, "alerts", void 0);
exports.Site = Site = __decorate([
    (0, typeorm_1.Entity)('sites')
], Site);
//# sourceMappingURL=site.entity.js.map