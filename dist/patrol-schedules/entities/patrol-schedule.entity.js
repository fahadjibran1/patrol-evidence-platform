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
exports.PatrolSchedule = void 0;
const typeorm_1 = require("typeorm");
const site_entity_1 = require("../../sites/entities/site.entity");
let PatrolSchedule = class PatrolSchedule {
};
exports.PatrolSchedule = PatrolSchedule;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], PatrolSchedule.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)('uuid'),
    __metadata("design:type", String)
], PatrolSchedule.prototype, "siteId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => site_entity_1.Site, (site) => site.schedules, { onDelete: 'CASCADE' }),
    __metadata("design:type", site_entity_1.Site)
], PatrolSchedule.prototype, "site", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], PatrolSchedule.prototype, "frequencyMinutes", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], PatrolSchedule.prototype, "startHour", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], PatrolSchedule.prototype, "endHour", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { default: 15 }),
    __metadata("design:type", Number)
], PatrolSchedule.prototype, "graceMinutes", void 0);
__decorate([
    (0, typeorm_1.Column)('jsonb'),
    __metadata("design:type", Array)
], PatrolSchedule.prototype, "activeDays", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], PatrolSchedule.prototype, "active", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], PatrolSchedule.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], PatrolSchedule.prototype, "updatedAt", void 0);
exports.PatrolSchedule = PatrolSchedule = __decorate([
    (0, typeorm_1.Entity)('patrol_schedules')
], PatrolSchedule);
//# sourceMappingURL=patrol-schedule.entity.js.map