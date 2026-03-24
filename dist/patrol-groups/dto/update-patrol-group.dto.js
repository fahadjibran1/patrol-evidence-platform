"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdatePatrolGroupDto = void 0;
const mapped_types_1 = require("@nestjs/mapped-types");
const create_patrol_group_dto_1 = require("./create-patrol-group.dto");
class UpdatePatrolGroupDto extends (0, mapped_types_1.PartialType)(create_patrol_group_dto_1.CreatePatrolGroupDto) {
}
exports.UpdatePatrolGroupDto = UpdatePatrolGroupDto;
//# sourceMappingURL=update-patrol-group.dto.js.map