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
exports.PatrolGroup = void 0;
const typeorm_1 = require("typeorm");
const site_entity_1 = require("../../sites/entities/site.entity");
const patrol_image_entity_1 = require("../../patrol-images/entities/patrol-image.entity");
let PatrolGroup = class PatrolGroup {
};
exports.PatrolGroup = PatrolGroup;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], PatrolGroup.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)('uuid'),
    __metadata("design:type", String)
], PatrolGroup.prototype, "siteId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => site_entity_1.Site, (site) => site.groups, { onDelete: 'CASCADE' }),
    __metadata("design:type", site_entity_1.Site)
], PatrolGroup.prototype, "site", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 150 }),
    __metadata("design:type", String)
], PatrolGroup.prototype, "groupName", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, length: 120 }),
    __metadata("design:type", Object)
], PatrolGroup.prototype, "externalGroupId", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], PatrolGroup.prototype, "active", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], PatrolGroup.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], PatrolGroup.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => patrol_image_entity_1.PatrolImage, (image) => image.group),
    __metadata("design:type", Array)
], PatrolGroup.prototype, "images", void 0);
exports.PatrolGroup = PatrolGroup = __decorate([
    (0, typeorm_1.Entity)('patrol_groups')
], PatrolGroup);
//# sourceMappingURL=patrol-group.entity.js.map