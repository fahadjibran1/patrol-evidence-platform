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
exports.PatrolImage = void 0;
const typeorm_1 = require("typeorm");
const site_entity_1 = require("../../sites/entities/site.entity");
const patrol_group_entity_1 = require("../../patrol-groups/entities/patrol-group.entity");
const collector_type_enum_1 = require("../../common/enums/collector-type.enum");
const patrol_slot_status_enum_1 = require("../../common/enums/patrol-slot-status.enum");
let PatrolImage = class PatrolImage {
};
exports.PatrolImage = PatrolImage;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], PatrolImage.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)('uuid'),
    __metadata("design:type", String)
], PatrolImage.prototype, "siteId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => site_entity_1.Site, (site) => site.images, { onDelete: 'CASCADE' }),
    __metadata("design:type", site_entity_1.Site)
], PatrolImage.prototype, "site", void 0);
__decorate([
    (0, typeorm_1.Column)('uuid', { nullable: true }),
    __metadata("design:type", Object)
], PatrolImage.prototype, "groupId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => patrol_group_entity_1.PatrolGroup, (group) => group.images, { nullable: true, onDelete: 'SET NULL' }),
    __metadata("design:type", Object)
], PatrolImage.prototype, "group", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: collector_type_enum_1.CollectorType }),
    __metadata("design:type", String)
], PatrolImage.prototype, "collectorType", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, length: 120 }),
    __metadata("design:type", Object)
], PatrolImage.prototype, "senderName", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, length: 30 }),
    __metadata("design:type", Object)
], PatrolImage.prototype, "senderNumber", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, length: 120 }),
    __metadata("design:type", Object)
], PatrolImage.prototype, "messageExternalId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], PatrolImage.prototype, "sentAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], PatrolImage.prototype, "receivedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date' }),
    __metadata("design:type", String)
], PatrolImage.prototype, "patrolDate", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], PatrolImage.prototype, "patrolHour", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, length: 255 }),
    __metadata("design:type", Object)
], PatrolImage.prototype, "originalFileName", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 255 }),
    __metadata("design:type", String)
], PatrolImage.prototype, "storedFileName", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 600 }),
    __metadata("design:type", String)
], PatrolImage.prototype, "filePath", void 0);
__decorate([
    (0, typeorm_1.Column)('bigint'),
    __metadata("design:type", String)
], PatrolImage.prototype, "fileSize", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100 }),
    __metadata("design:type", String)
], PatrolImage.prototype, "mimeType", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: patrol_slot_status_enum_1.PatrolSlotStatus }),
    __metadata("design:type", String)
], PatrolImage.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'text' }),
    __metadata("design:type", Object)
], PatrolImage.prototype, "notes", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], PatrolImage.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], PatrolImage.prototype, "updatedAt", void 0);
exports.PatrolImage = PatrolImage = __decorate([
    (0, typeorm_1.Entity)('patrol_images')
], PatrolImage);
//# sourceMappingURL=patrol-image.entity.js.map