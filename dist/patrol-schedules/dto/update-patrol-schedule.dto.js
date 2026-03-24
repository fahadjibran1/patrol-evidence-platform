"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdatePatrolScheduleDto = void 0;
const mapped_types_1 = require("@nestjs/mapped-types");
const create_patrol_schedule_dto_1 = require("./create-patrol-schedule.dto");
class UpdatePatrolScheduleDto extends (0, mapped_types_1.PartialType)(create_patrol_schedule_dto_1.CreatePatrolScheduleDto) {
}
exports.UpdatePatrolScheduleDto = UpdatePatrolScheduleDto;
//# sourceMappingURL=update-patrol-schedule.dto.js.map